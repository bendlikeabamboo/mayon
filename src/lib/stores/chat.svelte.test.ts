import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { ProviderConfig } from '$lib/ai/types';
import type { LanguageModel } from 'ai';
import { chatStore, ExcerptOverlapError } from './chat.svelte';
import { assembleContext } from '$lib/chat/context';
import { buildExpoundPrompt, serializeAddFormats, parseAddFormats } from '$lib/chat/expound';
import { parseBrief, disabledToolsForBrief } from '$lib/chat/brief';
import type { LearningBrief } from '$lib/chat/brief';

vi.mock('$lib/ai/client', () => ({
	getActiveSdkProvider: vi.fn()
}));

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	APICallError: class extends Error {
		statusCode: number;
		responseBody?: string;
		responseHeaders?: Record<string, string>;
		constructor(
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) {
			super(msg);
			this.statusCode = opts?.statusCode ?? 0;
			this.responseBody = opts?.responseBody;
			this.responseHeaders = opts?.responseHeaders;
		}
	}
}));

const { getActiveSdkProvider } = await import('$lib/ai/client');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);

const { generateText, generateObject, streamText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);
const mockedGenerateObject = vi.mocked(generateObject);
const mockedStreamText = vi.mocked(streamText);

const stubConfig: ProviderConfig = {
	id: 'stub',
	kind: 'openai-compatible',
	name: 'stub',
	baseUrl: 'http://stub',
	defaultModel: 'stub-model',
	models: ['stub-model']
};

function mockStreamReply(tokens: string[]): void {
	mockedStreamText.mockReturnValue({
		textStream: (async function* () {
			for (const t of tokens) yield t;
		})(),
		fullStream: (async function* () {
			for (const t of tokens) yield { type: 'text-delta', text: t };
			yield { type: 'finish', finishReason: 'stop' };
		})(),
		text: tokens.join(''),
		response: { id: 'test' }
	} as never);
}
function mockDefaultProvider(): void {
	mockedGetActiveSdkProvider.mockResolvedValue({
		model: {} as LanguageModel,
		config: stubConfig,
		toolCapability: true
	});
}

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	mockedGetActiveSdkProvider.mockReset();
	mockedGenerateText.mockReset();
	mockedGenerateObject.mockReset();
	mockedStreamText.mockReset();
	chatStore.pendingPrompt = null;
});

describe('chatStore branching round-trip', () => {
	it('branchFromSelection records offsets + excerpt, and the child context includes them', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);

		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;

		const childId = await chatStore.branchFromSelection(assistant.id, reply, {
			excerpt: 'powerhouse of the cell',
			containerText: reply,
			startInContainer: start,
			endInContainer: end
		});

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.excerpt).toBe('powerhouse of the cell');
		expect(src!.sourceMessageId).toBe(assistant.id);

		const child = await repos.chats.getById(childId);
		expect(child!.parentId).toBe(parent.id);
		expect(child!.branchPointMessageId).toBe(assistant.id);

		const ctx = await assembleContext(childId);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('powerhouse of the cell');
	});

	it('branchFromSelection falls back to full-span offsets when the selection cannot be mapped', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = '```mermaid\ngraph TD\nA-->B\n```\nAfter diagram.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const childId = await chatStore.branchFromSelection(assistant.id, reply, {
			excerpt: 'Diagram renders as SVG',
			containerText: 'Diagram renders as SVG. After diagram.',
			startInContainer: 0,
			endInContainer: 'Diagram renders as SVG'.length
		});

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.startChar).toBe(0);
		expect(src!.endChar).toBe('Diagram renders as SVG'.length);
		expect(src!.excerpt).toBe('Diagram renders as SVG');
	});

	it('branchFromMessage creates a child without a branch_source row', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'hello');
		const assistant = await repos.messages.append(parent.id, 'assistant', 'hi there');
		await chatStore.load(parent.id);

		const childId = await chatStore.branchFromMessage(assistant.id);
		const child = await repos.chats.getById(childId);
		expect(child!.parentId).toBe(parent.id);
		expect(child!.branchPointMessageId).toBe(assistant.id);

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).toBeNull();
	});

	it('load resets state when switching chats (no message leak)', async () => {
		const a = await repos.chats.createRoot({ title: 'A' });
		const b = await repos.chats.createRoot({ title: 'B' });
		await repos.messages.append(a.id, 'user', 'msg-in-A');
		await repos.messages.append(b.id, 'user', 'msg-in-B');

		await chatStore.load(a.id);
		expect(chatStore.messages.map((m) => m.content)).toEqual(['msg-in-A']);
		await chatStore.load(b.id);
		expect(chatStore.messages.map((m) => m.content)).toEqual(['msg-in-B']);
		expect(chatStore.chat?.id).toBe(b.id);
	});
});

describe('chatStore.createExpoundBranch', () => {
	it('records a branch_source, stages the prompt, and the child context leads with the excerpt', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const prompt = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: 'elaborate',
			toggles: ['diagrams', 'code']
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			prompt
		);

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.excerpt).toBe('powerhouse of the cell');
		expect(src!.startChar).toBe(start);
		expect(src!.endChar).toBe(end);

		expect(chatStore.pendingPrompt?.text).toBe(prompt);

		const ctx = await assembleContext(childId);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('powerhouse of the cell');
	});

	it('throws ExcerptOverlapError and creates nothing for an overlapping selection', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const sel = {
			excerpt: 'powerhouse of the cell',
			containerText: reply,
			startInContainer: start,
			endInContainer: end
		};

		await chatStore.createExpoundBranch(assistant.id, reply, sel, 'first prompt');
		const beforeCount = (await repos.branchSources.listBySourceMessage(assistant.id)).length;

		await expect(
			chatStore.createExpoundBranch(assistant.id, reply, sel, 'second prompt')
		).rejects.toBeInstanceOf(ExcerptOverlapError);

		const afterCount = (await repos.branchSources.listBySourceMessage(assistant.id)).length;
		expect(afterCount).toBe(beforeCount);
		expect(chatStore.pendingPrompt?.text).toBe('first prompt');
	});

	it('throws ExcerptOverlapError for a partially overlapping selection', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			'p'
		);

		const s2 = reply.indexOf('the cell');
		const e2 = s2 + 'the cell. Remember'.length;
		await expect(
			chatStore.createExpoundBranch(
				assistant.id,
				reply,
				{
					excerpt: 'the cell. Remember',
					containerText: reply,
					startInContainer: s2,
					endInContainer: e2
				},
				'p2'
			)
		).rejects.toBeInstanceOf(ExcerptOverlapError);
	});

	it('allows an adjacent (non-overlapping) second expound', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'Alpha beta gamma delta epsilon zeta eta theta.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const s1 = reply.indexOf('Alpha');
		const e1 = s1 + 'Alpha beta gamma'.length;
		await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'Alpha beta gamma',
				containerText: reply,
				startInContainer: s1,
				endInContainer: e1
			},
			'p1'
		);

		const s2 = e1 + 1;
		const e2 = s2 + 'delta epsilon zeta'.length;
		const childId2 = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'delta epsilon zeta',
				containerText: reply,
				startInContainer: s2,
				endInContainer: e2
			},
			'p2'
		);

		const all = await repos.branchSources.listBySourceMessage(assistant.id);
		expect(all).toHaveLength(2);
		expect(all.some((s) => s.branchChatId === childId2)).toBe(true);
	});

	it('draining pendingPrompt (simulating route load) sends exactly once', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const prompt = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: '',
			toggles: ['tables']
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			prompt
		);

		mockDefaultProvider();
		mockStreamReply(['Hello ', 'world']);

		await chatStore.load(childId);
		expect(chatStore.pendingPrompt?.text).toBe(prompt);
		const drained = chatStore.pendingPrompt;
		if (drained) {
			chatStore.clearPendingPrompt();
			await chatStore.send(drained.text, { hidden: drained.hidden });
		}

		expect(mockedStreamText).toHaveBeenCalledTimes(1);
		expect(chatStore.pendingPrompt).toBeNull();
		const msgs = await repos.messages.listByChat(childId);
		expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(msgs.find((m) => m.role === 'user')?.content).toBe(prompt);
		expect(msgs.find((m) => m.role === 'assistant')?.content).toBe('Hello world');
	});
});

describe('chatStore auto-title', () => {
	async function waitForTitle(expected: string): Promise<void> {
		for (let i = 0; i < 200; i++) {
			if (chatStore.chat?.title === expected) return;
			await new Promise((r) => setTimeout(r, 5));
		}
	}

	it('auto-generates and persists a title from the first user message (fired in parallel)', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockedGenerateText.mockResolvedValue({ text: 'Docker Volumes' } as never);
		await chatStore.load(root.id);
		expect(chatStore.chat?.title).toBe('New chat');

		await chatStore.send('how do volumes work');

		await waitForTitle('Docker Volumes');
		const row = await repos.chats.getById(root.id);
		expect(row?.title).toBe('Docker Volumes');
		expect(chatStore.chat?.title).toBe('Docker Volumes');
	});

	it('requests the title via generateText with system prompt and first user message only', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat', brief: { goal: 'terraform' } });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockedGenerateText.mockResolvedValue({ text: 'Terraform Basics' } as never);
		await chatStore.load(root.id);

		await chatStore.send('I want to learn Terraform');
		await waitForTitle('Terraform Basics');

		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
		const titleCallArgs = mockedGenerateText.mock.calls[0][0];
		expect(titleCallArgs.system).toContain('title');
		expect(titleCallArgs.messages).toEqual([
			{ role: 'user', content: 'I want to learn Terraform' }
		]);
	});

	it('lands the title while the main reply stream is still running (parallel)', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		let releaseStream: () => void = () => {};
		const streamBlocked = new Promise<void>((resolve) => {
			releaseStream = resolve;
		});

		mockDefaultProvider();
		const streamBlocked2 = streamBlocked;
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				await streamBlocked2;
				yield 'main reply';
			})(),
			fullStream: (async function* () {
				await streamBlocked2;
				yield { type: 'text-delta', text: 'main reply' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: 'main reply',
			response: { id: 'test' }
		} as never);
		mockedGenerateText.mockResolvedValue({ text: 'Parallel Title' } as never);

		await chatStore.load(root.id);

		const sendP = chatStore.send('first message');
		await waitForTitle('Parallel Title');
		expect(chatStore.streaming).toBe(true);

		releaseStream();
		await sendP;
		expect((await repos.chats.getById(root.id))?.title).toBe('Parallel Title');
	});

	it('aborts an in-flight title request when switching chats', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat', brief: { goal: 'x' } });
		const other = await repos.chats.createRoot({ title: 'Other' });
		let titleSignal: AbortSignal | undefined;

		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
			titleSignal = opts?.abortSignal as AbortSignal | undefined;
			await new Promise<void>(() => {});
			return { text: 'Stale Title' } as never;
		});

		await chatStore.load(root.id);

		void chatStore.send('hello');
		await vi.waitFor(() => expect(titleSignal).toBeDefined());

		await chatStore.load(other.id);
		expect(titleSignal?.aborted).toBe(true);
		expect((await repos.chats.getById(root.id))?.title).toBe('New chat');
	});

	it('forwards the composer reasoning mode to the main reply stream', async () => {
		const root = await repos.chats.createRoot({ title: 'Custom Title' });
		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockResolvedValue({ text: 'Ignored' } as never);
		await chatStore.load(root.id);

		await chatStore.send('hello', { reasoning: 'disabled' });

		expect(mockedStreamText).toHaveBeenCalled();
		const streamArgs = mockedStreamText.mock.calls[0][0];
		expect(streamArgs.providerOptions).toBeDefined();
	});

	it('does not retitle a chat whose title is no longer the placeholder', async () => {
		const root = await repos.chats.createRoot({ title: 'Custom Title' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockedGenerateText.mockResolvedValue({ text: 'Should Not Apply' } as never);
		await chatStore.load(root.id);

		await chatStore.send('hi');
		await new Promise((r) => setTimeout(r, 50));

		const row = await repos.chats.getById(root.id);
		expect(row?.title).toBe('Custom Title');
	});

	it('does not retitle a child (branched) chat', async () => {
		const parent = await repos.chats.createRoot({ title: 'New chat' });
		const child = await repos.chats.createChild({
			parentId: parent.id,
			title: 'New chat'
		});
		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockResolvedValue({ text: 'Ignored Title' } as never);
		await chatStore.load(child.id);

		await chatStore.send('hello');
		await new Promise((r) => setTimeout(r, 50));

		expect((await repos.chats.getById(child.id))?.title).toBe('New chat');
	});
});

describe('chatStore.deleteChat', () => {
	it('removes the whole tree plus all attached artifacts', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const assistant = await repos.messages.append(root.id, 'assistant', 'source text');
		const child = await repos.chats.createChild({
			parentId: root.id,
			branchPointMessageId: assistant.id,
			title: 'Child'
		});
		await repos.branchSources.create({
			sourceMessageId: assistant.id,
			startChar: 0,
			endChar: 4,
			excerpt: 'sour',
			branchChatId: child.id
		});
		await repos.messages.append(child.id, 'user', 'more');
		await repos.labs.create({ chatId: root.id, title: 'L', content: 'c' });
		const quiz = await repos.quizzes.create({ chatId: root.id });

		await chatStore.deleteChat(root.id);

		expect(await repos.chats.getById(root.id)).toBeNull();
		expect(await repos.chats.getById(child.id)).toBeNull();
		expect(await repos.messages.listByChat(root.id)).toEqual([]);
		expect(await repos.messages.listByChat(child.id)).toEqual([]);
		expect(await repos.branchSources.getByBranchChat(child.id)).toBeNull();
		expect(await repos.labs.listByChat(root.id)).toEqual([]);
		expect(await repos.quizzes.getById(quiz.id)).toBeNull();
	});

	it('clears the active view when the deleted tree contained it', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const child = await repos.chats.createChild({ parentId: root.id, title: 'Child' });
		await repos.messages.append(child.id, 'user', 'hi');
		await chatStore.load(child.id);
		expect(chatStore.chat?.id).toBe(child.id);

		await chatStore.deleteChat(root.id);
		expect(chatStore.chat).toBeNull();
		expect(chatStore.chatId).toBeNull();
		expect(chatStore.messages).toEqual([]);
	});
});

describe('chatStore brief', () => {
	const sampleBrief: LearningBrief = {
		goal: 'be able to read a Makefile',
		level: 'some',
		mode: 'socratic',
		context: 'engineer',
		scope: '10 min'
	};

	it('createAndNavigate({ brief }) persists a root whose context leads with the brief note', async () => {
		const id = await chatStore.createAndNavigate({ brief: sampleBrief });
		const row = await repos.chats.getById(id);
		expect(row?.parentId).toBeNull();
		expect(row?.brief).not.toBeNull();
		const ctx = await assembleContext(id);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('be able to read a Makefile');
	});

	it('createAndNavigate() with no brief creates a null-brief root (no system note)', async () => {
		const id = await chatStore.createAndNavigate();
		const row = await repos.chats.getById(id);
		expect(row?.brief).toBeNull();
		const ctx = await assembleContext(id);
		expect(ctx.every((m) => m.role !== 'system')).toBe(true);
	});

	it('saveBrief updates the row and the store chat', async () => {
		const id = await chatStore.createAndNavigate();
		await chatStore.load(id);
		expect(chatStore.chat?.brief).toBeNull();

		await chatStore.saveBrief(sampleBrief);

		expect(chatStore.chat?.brief).toBe(JSON.stringify(sampleBrief));
		const row = await repos.chats.getById(id);
		expect(row?.brief).toBe(JSON.stringify(sampleBrief));
		const ctx = await assembleContext(id);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('be able to read a Makefile');
	});

	it('saveBrief replaces an existing brief (edit recalibrates the next reply)', async () => {
		const id = await chatStore.createAndNavigate({ brief: sampleBrief });
		await chatStore.load(id);
		const updated: LearningBrief = { goal: 'write a Makefile from scratch', mode: 'explainer' };
		await chatStore.saveBrief(updated);
		expect(chatStore.chat?.brief).toBe(JSON.stringify(updated));
		const ctx = await assembleContext(id);
		expect(ctx[0].content).toContain('write a Makefile from scratch');
		expect(ctx[0].content).not.toContain('be able to read a Makefile');
	});
});

describe('chatStore inferred brief', () => {
	const inferredBrief: LearningBrief = {
		goal: 'be able to write a Makefile',
		level: 'some',
		mode: 'socratic'
	};

	async function waitForInferredBrief(): Promise<void> {
		for (let i = 0; i < 200; i++) {
			if (chatStore.inferredBrief !== null) return;
			await new Promise((r) => setTimeout(r, 5));
		}
	}

	// Brief inference now flows through `generateText` (tool-calling path in
	// `object-tool.ts`, which passes `tools`), so it shares the mock with title
	// generation (`generateText` without tools). Dispatch on the presence of
	// `tools` to return the tool-call shape for briefs and the text shape for
	// titles.
	function mockTitleAndBrief(brief: unknown = inferredBrief, title = 'Docker'): void {
		mockedGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
			if (opts && 'tools' in opts) {
				return { toolCalls: [{ toolName: 'json', input: brief }], text: '' } as never;
			}
			return { text: title } as never;
		});
	}

	it('first message on a null-brief root sets inferredBrief', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockTitleAndBrief();
		await chatStore.load(root.id);
		expect(chatStore.inferredBrief).toBeNull();

		await chatStore.send('I want to learn about Makefiles');

		await waitForInferredBrief();
		expect(chatStore.inferredBrief).not.toBeNull();
		expect(chatStore.inferredBrief!.goal).toBe('be able to write a Makefile');
	});

	it('briefed root does not trigger inference', async () => {
		const existingBrief: LearningBrief = { goal: 'learn rust', level: 'novice' };
		const root = await repos.chats.createRoot({ title: 'New chat', brief: existingBrief });
		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockResolvedValue({ text: 'Title' } as never);
		await chatStore.load(root.id);
		await chatStore.send('hello');

		await new Promise((r) => setTimeout(r, 100));
		expect(chatStore.inferredBrief).toBeNull();
		expect(mockedGenerateObject).not.toHaveBeenCalled();
	});

	it('branch does not trigger inference', async () => {
		const parent = await repos.chats.createRoot({ title: 'New chat' });
		const assistant = await repos.messages.append(parent.id, 'assistant', 'hi');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: assistant.id,
			title: 'New chat'
		});
		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockResolvedValue({ text: 'Title' } as never);
		await chatStore.load(child.id);
		await chatStore.send('hello');

		await new Promise((r) => setTimeout(r, 100));
		expect(chatStore.inferredBrief).toBeNull();
		expect(mockedGenerateObject).not.toHaveBeenCalled();
	});

	it('confirmInferredBrief persists the brief and clears inferredBrief', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockTitleAndBrief();
		await chatStore.load(root.id);
		await chatStore.send('teach me Makefiles');
		await waitForInferredBrief();

		await chatStore.confirmInferredBrief();
		expect(chatStore.inferredBrief).toBeNull();
		const row = await repos.chats.getById(root.id);
		expect(parseBrief(row?.brief)).not.toBeNull();
		expect(parseBrief(row?.brief)!.goal).toBe('be able to write a Makefile');
	});

	it('confirmInferredBrief(edited) persists the edited value', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockTitleAndBrief();
		await chatStore.load(root.id);
		await chatStore.send('teach me Makefiles');
		await waitForInferredBrief();

		const edited: LearningBrief = { goal: 'write a complex Makefile', mode: 'build' };
		await chatStore.confirmInferredBrief(edited);
		expect(chatStore.inferredBrief).toBeNull();
		const row = await repos.chats.getById(root.id);
		expect(parseBrief(row?.brief)!.goal).toBe('write a complex Makefile');
		expect(parseBrief(row?.brief)!.mode).toBe('build');
	});

	it('dismissInferredBrief clears inferredBrief without persisting', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockDefaultProvider();
		mockStreamReply(['the answer']);
		mockTitleAndBrief();
		await chatStore.load(root.id);
		await chatStore.send('teach me Makefiles');
		await waitForInferredBrief();

		chatStore.dismissInferredBrief();
		expect(chatStore.inferredBrief).toBeNull();
		const row = await repos.chats.getById(root.id);
		expect(row?.brief).toBeNull();
	});

	it('dismiss-race guard: dismiss before inference completes keeps inferredBrief null', async () => {
		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
			if (opts && 'tools' in opts) {
				await new Promise((r) => setTimeout(r, 200));
				return {
					toolCalls: [{ toolName: 'json', input: { goal: 'late brief' } }],
					text: ''
				} as never;
			}
			return { text: 'Title' } as never;
		});

		const root = await repos.chats.createRoot({ title: 'New chat' });
		await chatStore.load(root.id);

		void chatStore.send('first message');

		await vi.waitFor(() => expect(chatStore.inferredBrief).toBeNull());
		chatStore.dismissInferredBrief();

		await new Promise((r) => setTimeout(r, 300));

		expect(chatStore.inferredBrief).toBeNull();
	});

	it('aborts inferController on load() switch', async () => {
		let briefSignal: AbortSignal | undefined;

		mockDefaultProvider();
		mockStreamReply(['reply']);
		mockedGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
			const signal = opts?.abortSignal as AbortSignal | undefined;
			if (opts && 'tools' in opts) {
				briefSignal = signal;
				await new Promise<void>((resolve) => {
					if (signal?.aborted) return resolve();
					signal?.addEventListener('abort', () => resolve(), { once: true });
				});
				return { toolCalls: [{ toolName: 'json', input: { goal: 'brief' } }], text: '' } as never;
			}
			return { text: 'Title' } as never;
		});

		const root = await repos.chats.createRoot({ title: 'New chat' });
		const other = await repos.chats.createRoot({ title: 'Other' });
		await chatStore.load(root.id);

		void chatStore.send('first');
		await vi.waitFor(() => expect(briefSignal).toBeDefined());

		await chatStore.load(other.id);
		expect(briefSignal?.aborted).toBe(true);
	});
});

describe('chatStore approval flow', () => {
	beforeEach(() => {
		chatStore.pendingApprovals = [];
		chatStore.streaming = false;
	});

	function getRequestApprovalImpl() {
		return (
			chatStore as unknown as {
				requestApprovalImpl: (req: {
					toolCallId: string;
					toolName: string;
					description: string;
					args: unknown;
				}) => Promise<{ approved: boolean; aborted?: boolean }>;
			}
		).requestApprovalImpl.bind(chatStore);
	}

	it('requestApprovalImpl populates pendingApprovals; approve resolves and clears', async () => {
		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: { topic: 'X' }
		});
		expect(chatStore.pendingApprovals).toHaveLength(1);
		expect(chatStore.pendingApprovals[0].toolCallId).toBe('tc1');

		chatStore.approve('tc1');
		const result = await promise;
		expect(result).toEqual({ approved: true });
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it('decline resolves and clears entry', async () => {
		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: {}
		});
		expect(chatStore.pendingApprovals).toHaveLength(1);

		chatStore.decline('tc1');
		const result = await promise;
		expect(result).toEqual({ approved: false });
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it('abort resolves pending as aborted', async () => {
		chatStore.streaming = true;
		const ac = new AbortController();
		(chatStore as unknown as { controller: AbortController | null }).controller = ac;

		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: {}
		});
		expect(chatStore.pendingApprovals).toHaveLength(1);

		ac.abort();
		const result = await promise;
		expect(result).toEqual({ approved: false, aborted: true });
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});
});

describe('chatStore reasoning buffer', () => {
	it('reasoningBuffer resets on send() start and in finally', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'reply';
			})(),
			fullStream: (async function* () {
				yield { type: 'reasoning-delta', text: 'thinking' };
				yield { type: 'text-delta', text: 'reply' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: 'reply',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		expect(chatStore.reasoningBuffer).toBe('');

		void chatStore.send('hello');
		expect(chatStore.reasoningBuffer).toBe('');

		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));
		expect(chatStore.reasoningBuffer).toBe('');
	});

	it('reasoningBuffer resets on load()', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		(chatStore as unknown as { reasoningBuffer: string }).reasoningBuffer = 'some reasoning';
		await chatStore.load(root.id);
		expect(chatStore.reasoningBuffer).toBe('');
	});

	it('turn with reasoning writes metadata JSON containing reasoning on assistant row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'reply';
			})(),
			fullStream: (async function* () {
				yield { type: 'reasoning-delta', text: 'thinking…' };
				yield { type: 'text-delta', text: 'Reply text' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: 'Reply text',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.role === 'assistant');
		expect(assistant).toBeDefined();
		expect(assistant!.metadata).not.toBeNull();
		const parsed = JSON.parse(assistant!.metadata!);
		expect(parsed.reasoning).toBe('thinking…');
	});

	it('turn without reasoning writes no metadata on assistant row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['No reasoning reply']);

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.role === 'assistant');
		expect(assistant).toBeDefined();
		expect(assistant!.metadata).toBeNull();
	});
});

describe('disabledToolsForBrief', () => {
	it('returns save_brief when root has a brief', () => {
		const brief: LearningBrief = { goal: 'learn X' };
		expect(disabledToolsForBrief(JSON.stringify(brief))).toEqual(['save_brief']);
	});

	it('returns empty array for null brief', () => {
		expect(disabledToolsForBrief(null)).toEqual([]);
	});

	it('returns empty array for empty string', () => {
		expect(disabledToolsForBrief('')).toEqual([]);
	});

	it('returns empty array for invalid JSON', () => {
		expect(disabledToolsForBrief('not json')).toEqual([]);
	});
});

describe('hidden message metadata', () => {
	it('send with hidden=true stores metadata with hidden:true', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['reply']);

		await chatStore.load(root.id);
		await chatStore.send('hidden prompt', { hidden: true });

		const msgs = await repos.messages.listByChat(root.id);
		const userMsg = msgs.find((m) => m.role === 'user');
		expect(userMsg).toBeDefined();
		expect(userMsg!.metadata).not.toBeNull();
		const parsed = JSON.parse(userMsg!.metadata!);
		expect(parsed.hidden).toBe(true);
	});

	it('send without hidden stores no metadata on user row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['reply']);

		await chatStore.load(root.id);
		await chatStore.send('visible prompt');

		const msgs = await repos.messages.listByChat(root.id);
		const userMsg = msgs.find((m) => m.role === 'user');
		expect(userMsg).toBeDefined();
		expect(userMsg!.metadata).toBeNull();
	});
});

describe('serializeAddFormats / parseAddFormats round-trip', () => {
	it('round-trips toggles through JSON', () => {
		const toggles = ['diagrams', 'tables'] as const;
		const json = serializeAddFormats([...toggles]);
		expect(parseAddFormats(json)).toEqual([...toggles]);
	});

	it('parseAddFormats handles null gracefully', () => {
		expect(parseAddFormats(null)).toEqual([]);
	});

	it('parseAddFormats handles invalid JSON gracefully', () => {
		expect(parseAddFormats('not json')).toEqual([]);
	});

	it('parseAddFormats filters out unknown values', () => {
		expect(parseAddFormats('["diagrams","unknown"]')).toEqual(['diagrams']);
	});
});

describe('branch_sources extra columns', () => {
	it('create with customInstructions and addFormats persists and reads back', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const userMsg = await repos.messages.append(root.id, 'assistant', 'content');
		const _bs = await repos.branchSources.create({
			sourceMessageId: userMsg.id,
			startChar: 0,
			endChar: 5,
			excerpt: 'conte',
			branchChatId: root.id,
			customInstructions: 'explain in detail',
			addFormats: '["diagrams","tables"]'
		});

		const fetched = await repos.branchSources.getByBranchChat(root.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.customInstructions).toBe('explain in detail');
		expect(fetched!.addFormats).toBe('["diagrams","tables"]');
	});

	it('create without extra columns persists nulls', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const userMsg = await repos.messages.append(root.id, 'assistant', 'content');
		await repos.branchSources.create({
			sourceMessageId: userMsg.id,
			startChar: 0,
			endChar: 5,
			excerpt: 'conte',
			branchChatId: root.id
		});

		const fetched = await repos.branchSources.getByBranchChat(root.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.customInstructions).toBeNull();
		expect(fetched!.addFormats).toBeNull();
	});
});

describe('buildCapabilitiesPreamble save_brief wording', () => {
	it('mentions save_brief first-turn-only constraint', async () => {
		const { buildCapabilitiesPreamble } = await import('$lib/chat/brief');
		const preamble = buildCapabilitiesPreamble();
		expect(preamble).toContain('save_brief');
		expect(preamble).toContain('first turn');
		expect(preamble).toContain('no learning goal');
		expect(preamble).toContain('Never rewrite');
	});
});
