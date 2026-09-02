import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import type { ProviderConfig } from '$lib/ai/types';
import { MissingKeyError, ProviderHttpError } from '$lib/ai/types';
import type { LanguageModel } from 'ai';
import { chatStore, ExcerptOverlapError } from './chat.svelte';
import { assembleContext } from '$lib/chat/context';
import { buildExpoundPrompt, serializeAddFormats, parseAddFormats } from '$lib/chat/expound';
import { parseBrief, disabledToolsForBrief } from '$lib/chat/brief';
import type { LearningBrief } from '$lib/chat/brief';
import type { ComposerAttachment, ImagePart } from '$lib/chat/kinds';
import { attachmentsOf } from '$lib/chat/kinds';

if (typeof requestAnimationFrame === 'undefined') {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(() => cb(Date.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

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

let lastDisabledToolIds: string[] | undefined;
vi.mock('$lib/agent/loop', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/agent/loop')>();
	return {
		...real,
		runAgentTurn: vi.fn(async (deps) => {
			lastDisabledToolIds = deps.disabledToolIds;
			return real.runAgentTurn(deps);
		})
	};
});

const { getActiveSdkProvider } = await import('$lib/ai/client');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);

const { generateText, generateObject, streamText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);
const mockedGenerateObject = vi.mocked(generateObject);
const mockedStreamText = vi.mocked(streamText);

// Factory implementation of the mocked runAgentTurn, captured before any test
// can clobber it. Some describes (UJ16) mockImplementation without restoring;
// the attachments describe reinstalls this so its turns actually stream.
const { runAgentTurn } = await import('$lib/agent/loop');
const baseRunAgentTurnImpl = vi.mocked(runAgentTurn).getMockImplementation();

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

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
	mockedGetActiveSdkProvider.mockReset();
	mockedGenerateText.mockReset();
	mockedGenerateObject.mockReset();
	mockedStreamText.mockReset();
	chatStore.pendingPrompt = null;
	lastDisabledToolIds = undefined;
});

describe('chatStore branching round-trip', () => {
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
			formats: [
				{ name: 'diagrams' },
				{ name: 'code', description: 'Show runnable code the learner can paste' }
			]
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{ startChar: start, endChar: end, excerpt: 'powerhouse of the cell' },
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
		const sel = { startChar: start, endChar: end, excerpt: 'powerhouse of the cell' };

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
			{ startChar: start, endChar: end, excerpt: 'powerhouse of the cell' },
			'p'
		);

		const s2 = reply.indexOf('the cell');
		const e2 = s2 + 'the cell. Remember'.length;
		await expect(
			chatStore.createExpoundBranch(
				assistant.id,
				reply,
				{ startChar: s2, endChar: e2, excerpt: 'the cell. Remember' },
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
			{ startChar: s1, endChar: e1, excerpt: 'Alpha beta gamma' },
			'p1'
		);

		const s2 = e1 + 1;
		const e2 = s2 + 'delta epsilon zeta'.length;
		const childId2 = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{ startChar: s2, endChar: e2, excerpt: 'delta epsilon zeta' },
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
			formats: [{ name: 'tables' }]
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{ startChar: start, endChar: end, excerpt: 'powerhouse of the cell' },
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

	it('carries selected instruction names into add_formats and the hidden prompt', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const opts = {
			excerpt: 'powerhouse of the cell',
			customInstructions: 'use plain language',
			formats: [
				{ name: 'Mermaid Diagram', description: 'Render flows as fenced Mermaid code blocks' },
				{ name: 'Real-world Analogies' }
			]
		};
		const prompt = buildExpoundPrompt(opts);

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{ startChar: start, endChar: end, excerpt: 'powerhouse of the cell' },
			prompt,
			opts
		);

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.addFormats).toBe('["Mermaid Diagram","Real-world Analogies"]');

		mockDefaultProvider();
		mockStreamReply(['Expanded.']);

		await chatStore.load(childId);
		const drained = chatStore.pendingPrompt;
		if (drained) {
			chatStore.clearPendingPrompt();
			await chatStore.send(drained.text, { hidden: drained.hidden });
		}

		const msgs = await repos.messages.listByChat(childId);
		const firstUser = msgs.find((m) => m.role === 'user');
		expect(firstUser?.content).toContain('Extra formats to include in this reply:');
		expect(firstUser?.content).toContain(
			'- Mermaid Diagram: Render flows as fenced Mermaid code blocks'
		);
		expect(firstUser?.content).toContain('- Real-world Analogies');
		expect(firstUser?.metadata).toContain('"hidden":true');
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

		await chatStore.send('hello', { effort: 'off' });

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
	beforeEach(async () => {
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
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: { topic: 'X' }
		});
		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));
		expect(chatStore.pendingApprovals[0].toolCallId).toBe('tc1');

		chatStore.approve('tc1');
		const result = await promise;
		expect(result).toEqual({ approved: true });
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it('decline resolves and clears entry', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: {}
		});
		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));

		chatStore.decline('tc1');
		const result = await promise;
		expect(result).toEqual({ approved: false });
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it('abort resolves pending as aborted', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		chatStore.streaming = true;
		const ac = new AbortController();
		(chatStore as unknown as { controller: AbortController | null }).controller = ac;

		const promise = getRequestApprovalImpl()({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: {}
		});
		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));

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

	it('turn with reasoning persists a separate reasoning entry and no reasoning metadata on assistant row', async () => {
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
		const reasoning = msgs.find((m) => m.kind === 'reasoning');
		expect(reasoning).toBeDefined();
		expect(reasoning!.content).toBe('thinking…');
		const parsed = JSON.parse(reasoning!.metadata!);
		expect(parsed.iteration).toBe(0);

		const assistant = msgs.find((m) => m.role === 'assistant' && m.kind === 'assistant_message');
		expect(assistant).toBeDefined();
		expect(assistant!.metadata).toBeNull();
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
	it('round-trips instruction names through JSON', () => {
		const names = ['Mermaid Diagram', 'Focus Callouts'];
		const json = serializeAddFormats(names);
		expect(json).toBe('["Mermaid Diagram","Focus Callouts"]');
		expect(parseAddFormats(json)).toEqual(names);
	});

	it('parseAddFormats handles null gracefully', () => {
		expect(parseAddFormats(null)).toEqual([]);
	});

	it('parseAddFormats handles invalid JSON gracefully', () => {
		expect(parseAddFormats('not json')).toEqual([]);
	});

	it('parseAddFormats keeps unknown values verbatim', () => {
		expect(parseAddFormats('["diagrams","unknown"]')).toEqual([
			'Diagrams (prompt diagrams)',
			'unknown'
		]);
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
			addFormats: '["Mermaid Diagram","Focus Callouts"]'
		});

		const fetched = await repos.branchSources.getByBranchChat(root.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.customInstructions).toBe('explain in detail');
		expect(fetched!.addFormats).toBe('["Mermaid Diagram","Focus Callouts"]');
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

describe('chatStore provider error surfacing (T015)', () => {
	it('surfaces a Copilot MissingKeyError as add-key guidance, not a stack trace', async () => {
		mockedGetActiveSdkProvider.mockRejectedValue(new MissingKeyError(undefined, 'cop-1'));

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		await chatStore.send('hello');

		expect(chatStore.error).toEqual({
			title: 'Missing API key',
			message: 'No API key configured for this provider.',
			hint: 'Add an API key for this provider in Settings.'
		});
		expect(chatStore.lastFailedPrompt).toBe('hello');
	});
});

describe('chatStore durable asks (reload-honesty)', () => {
	beforeEach(() => {
		chatStore.pendingApprovals = [];
		chatStore.pendingMcpSampling = [];
		chatStore.pendingElicitations = [];
		chatStore.streaming = false;
	});

	it('approval: row persisted with outcome null, then updated to approved on approve()', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const requestApprovalImpl = (
			chatStore as unknown as {
				requestApprovalImpl: (req: {
					toolCallId: string;
					toolName: string;
					description: string;
					args: unknown;
				}) => Promise<{ approved: boolean; aborted?: boolean }>;
			}
		).requestApprovalImpl.bind(chatStore);

		const promise = requestApprovalImpl({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: { topic: 'X' }
		});

		await vi.waitFor(async () => {
			const rows = await repos.messages.listByChat(root.id);
			expect(rows.find((m) => m.kind === 'approval')).toBeDefined();
		});
		const approvalRows = await repos.messages.listByChat(root.id);
		const pendingRow = approvalRows.find((m) => m.kind === 'approval');
		expect(pendingRow!.content).toContain('branch_chat');
		const pendingMeta = JSON.parse(pendingRow!.metadata!);
		expect(pendingMeta.outcome).toBeNull();

		chatStore.approve('tc1');
		await promise;

		await vi.waitFor(async () => {
			const rows = await repos.messages.listByChat(root.id);
			const r = rows.find((m) => m.kind === 'approval' && m.id === pendingRow!.id);
			expect(JSON.parse(r!.metadata!).outcome).toEqual({ decision: 'approved' });
		});

		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it('approval: abort sweeps pending to declined+aborted', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		(chatStore as unknown as { controller: AbortController | null }).controller =
			new AbortController();

		const requestApprovalImpl = (
			chatStore as unknown as {
				requestApprovalImpl: (req: {
					toolCallId: string;
					toolName: string;
					description: string;
					args: unknown;
				}) => Promise<{ approved: boolean; aborted?: boolean }>;
			}
		).requestApprovalImpl.bind(chatStore);

		const promise = requestApprovalImpl({
			toolCallId: 'tc2',
			toolName: 'create_lab',
			description: 'Create a lab',
			args: {}
		});

		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));
		chatStore.stop();
		await promise;

		await vi.waitFor(async () => {
			const msgs = await repos.messages.listByChat(root.id);
			const r = msgs.find((m) => m.kind === 'approval');
			expect(r).toBeDefined();
			expect(JSON.parse(r!.metadata!).outcome).toEqual({ decision: 'declined', aborted: true });
		});
	});
});

describe('FR-001 boundary persist clears live buffers (T004)', () => {
	let originalImpl: ((...args: unknown[]) => unknown) | undefined;

	beforeEach(async () => {
		const loop = await import('$lib/agent/loop');
		originalImpl = (
			vi.mocked(loop.runAgentTurn) as unknown as {
				getMockImplementation(): (...args: unknown[]) => unknown;
			}
		).getMockImplementation();
	});

	afterEach(async () => {
		if (originalImpl) {
			const loop = await import('$lib/agent/loop');
			(
				vi.mocked(loop.runAgentTurn) as unknown as {
					mockImplementation(fn: (...args: unknown[]) => unknown): unknown;
				}
			).mockImplementation(originalImpl);
		}
	});

	it('appendAssistantText dep clears streamBuffer and streamBufferRender while streaming', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));

		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});

		const runAgentTurn = (await import('$lib/agent/loop')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.updateStreamBuffer('pre-tool text');
			await deps.appendAssistantText('pre-tool text', {});
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');

		await vi.waitFor(() => expect(chatStore.messages.length).toBe(2));
		expect(chatStore.streaming).toBe(true);
		expect(chatStore.streamBuffer).toBe('');
		expect(chatStore.streamBufferRender).toBe('');

		resolveTurn();
		await sendP;

		const msgs = await repos.messages.listByChat(root.id);
		const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
		expect(assistantMsgs).toHaveLength(1);
		expect(assistantMsgs[0].content).toBe('pre-tool text');
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

describe('branch_chat first-turn suppression (UX1a)', () => {
	it('suppresses branch_chat on the first send after createExpoundBranch, but not on the second', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{ startChar: 0, endChar: reply.length, excerpt: 'powerhouse of the cell' },
			'Explain this excerpt'
		);

		mockDefaultProvider();
		mockStreamReply(['Explanation']);
		await chatStore.load(childId);
		const drained = chatStore.pendingPrompt;
		chatStore.clearPendingPrompt();
		if (drained) await chatStore.send(drained.text, { hidden: drained.hidden });

		expect(lastDisabledToolIds).toContain('branch_chat');

		mockStreamReply(['Follow up']);
		await chatStore.send('next');

		expect(lastDisabledToolIds).not.toContain('branch_chat');
	});

	it('suppresses branch_chat on the first send after branchFromMessage, but not on the second', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'hello');
		const assistant = await repos.messages.append(parent.id, 'assistant', 'hi there');
		await chatStore.load(parent.id);

		const childId = await chatStore.branchFromMessage(assistant.id);

		mockDefaultProvider();
		mockStreamReply(['Reply']);
		await chatStore.load(childId);
		await chatStore.send('continue');

		expect(lastDisabledToolIds).toContain('branch_chat');

		mockStreamReply(['Second reply']);
		await chatStore.send('again');

		expect(lastDisabledToolIds).not.toContain('branch_chat');
	});

	it('clears suppression after stop (abort)', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'hello');
		const assistant = await repos.messages.append(parent.id, 'assistant', 'hi there');
		await chatStore.load(parent.id);

		await chatStore.branchFromMessage(assistant.id);

		mockDefaultProvider();
		let resolveStream!: () => void;
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'token';
				await new Promise<void>((r) => (resolveStream = r));
			})(),
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'token' };
				await new Promise<void>((r) => (resolveStream = r));
			})(),
			text: 'token',
			response: { id: 'test' }
		} as never);

		await chatStore.load(parent.id);
		const childId = (await repos.chats.listChildren(parent.id))[0].id;
		await chatStore.load(childId);
		void chatStore.send('test');

		await vi.waitFor(() => expect(lastDisabledToolIds).toContain('branch_chat'), { timeout: 2000 });
		chatStore.stop();
		resolveStream();

		await vi.waitFor(() => expect(chatStore.streaming).toBe(false), { timeout: 2000 });

		mockStreamReply(['After abort']);
		await chatStore.send('after stop');

		expect(lastDisabledToolIds).not.toContain('branch_chat');
	});

	it('normal root send never suppresses branch_chat (regression guard)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['Normal reply']);
		await chatStore.load(root.id);
		await chatStore.send('hello');

		expect(lastDisabledToolIds).not.toContain('branch_chat');
	});
});

// H2 regression guard (Phase 4): asserts streamBufferRender does not update
// until the RENDER_INTERVAL_MS (80 ms) throttle has elapsed. Prevents removal
// or weakening of the rAF throttle in startRenderFlush.
describe('chatStore rAF stream throttle (UJ13)', () => {
	it('streamBufferRender lags behind streamBuffer until the rAF setTimeout fires', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));

		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});

		let capturedUpdate: ((n: string) => void) | null = null;
		const runAgentTurn = (await import('$lib/agent/loop')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			capturedUpdate = deps.updateStreamBuffer;
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(capturedUpdate).not.toBeNull());

		capturedUpdate!('a');
		capturedUpdate!('ab');
		capturedUpdate!('abc');

		expect(chatStore.streamBuffer).toBe('abc');
		expect(chatStore.streamBufferRender).toBe('');
		expect(chatStore.showLiveBubble).toBe(false);

		await new Promise((r) => setTimeout(r, 90));

		expect(chatStore.streamBufferRender).toBe('abc');
		expect(chatStore.showLiveBubble).toBe(true);

		resolveTurn();
		await sendP;

		expect(chatStore.streamBuffer).toBe('');
		expect(chatStore.streamBufferRender).toBe('');
		expect(chatStore.showLiveBubble).toBe(false);
	});

	it('streamBufferRender resets on load()', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));

		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});

		const runAgentTurn = (await import('$lib/agent/loop')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.updateStreamBuffer('content');
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		void chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.streamBuffer).toBe('content'));
		await new Promise((r) => setTimeout(r, 20));

		expect(chatStore.streamBufferRender).toBe('content');

		resolveTurn();
		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));

		await chatStore.load(root.id);
		expect(chatStore.streamBufferRender).toBe('');
	});
});

describe('chatStore interrupted row persistence (UJ16)', () => {
	it('aborted after buffer accumulates persists an assistant row with interrupted metadata', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));

		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});

		const runAgentTurn = (await import('$lib/agent/loop')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.updateStreamBuffer('partial reply');
			await turnBlocked;
			return { aborted: true };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.streamBuffer).toBe('partial reply'));

		chatStore.stop();
		resolveTurn();
		await sendP;

		const msgs = await repos.messages.listByChat(root.id);
		const interrupted = msgs.find(
			(m) => m.role === 'assistant' && m.metadata && JSON.parse(m.metadata).interrupted === true
		);
		expect(interrupted).toBeDefined();
		expect(interrupted!.content).toBe('partial reply');
	});

	it('normal completion does not create an interrupted row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['Full reply']);

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const interrupted = msgs.find(
			(m) => m.role === 'assistant' && m.metadata && JSON.parse(m.metadata).interrupted === true
		);
		expect(interrupted).toBeUndefined();
	});

	it('aborted with empty buffer does not create an interrupted row', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));

		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});

		const runAgentTurn = (await import('$lib/agent/loop')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async () => {
			await turnBlocked;
			return { aborted: true };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		chatStore.stop();
		resolveTurn();
		await sendP;

		const msgs = await repos.messages.listByChat(root.id);
		const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
		expect(assistantMsgs).toHaveLength(0);
	});
});

describe('chatStore send with attachments (T010 — specs/018 User Story 1)', () => {
	const IMAGE_A = 'data:image/png;base64,AAAA';
	const IMAGE_B = 'data:image/jpeg;base64,BBBB';

	function makeAttachment(dataUrl: string, name?: string): ComposerAttachment {
		const part: ImagePart = {
			type: 'image',
			data: dataUrl,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 3,
			...(name ? { name } : {})
		};
		return { part, thumbnailDataUrl: dataUrl };
	}

	function mockStreamCapture(order: string[], reply = 'ok'): void {
		mockedStreamText.mockImplementation(() => {
			order.push('stream');
			return {
				textStream: (async function* () {
					yield reply;
				})(),
				fullStream: (async function* () {
					yield { type: 'text-delta', text: reply };
					yield { type: 'finish', finishReason: 'stop' };
				})(),
				text: reply,
				response: { id: 'test' }
			} as never;
		});
	}

	beforeEach(() => {
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('(a) send(text, { effort, attachments }) persists ONE user row with parts BEFORE the LLM call', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		const order: string[] = [];
		mockStreamCapture(order);

		const dbAppend = repos.messages.append;
		const appendSpy = vi
			.spyOn(repos.messages, 'append')
			.mockImplementation(async (...args: Parameters<typeof dbAppend>) => {
				order.push('append');
				return dbAppend(...args);
			});

		const attachments = [makeAttachment(IMAGE_A, 'shot.png'), makeAttachment(IMAGE_B)];
		await chatStore.load(root.id);
		await chatStore.send('look at these', { effort: 'on', attachments });

		// The user-row append (the first append of the turn) precedes streamText.
		expect(order[0]).toBe('append');
		expect(order.indexOf('append')).toBeLessThan(order.indexOf('stream'));

		const firstCall = appendSpy.mock.calls[0]!;
		expect(firstCall[0]).toBe(root.id);
		expect(firstCall[1]).toBe('user');
		expect(firstCall[2]).toBe('look at these');
		expect(firstCall[3]?.parts).toEqual([
			{ type: 'text', text: 'look at these' },
			attachments[0]!.part,
			attachments[1]!.part
		]);

		// Exactly ONE user row, persisted atomically with its parts.
		const msgs = await repos.messages.listByChat(root.id);
		const userRows = msgs.filter((m) => m.role === 'user');
		expect(userRows).toHaveLength(1);
		expect(userRows[0]!.content).toBe('look at these');
		expect(JSON.parse(userRows[0]!.parts!)).toEqual([
			{ type: 'text', text: 'look at these' },
			attachments[0]!.part,
			attachments[1]!.part
		]);
		expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
	});

	it('(a′) image-less sends keep the row shape unchanged (parts stays NULL)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamCapture([]);

		await chatStore.load(root.id);
		await chatStore.send('plain text');

		const userRow = (await repos.messages.listByChat(root.id)).find((m) => m.role === 'user');
		expect(userRow).toBeDefined();
		expect(userRow!.content).toBe('plain text');
		expect(userRow!.parts).toBeNull();
	});

	it('(b) a failed send with attachments leaves no assistant row and arms the retry state', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockedGetActiveSdkProvider.mockRejectedValue(new Error('boom'));
		await chatStore.load(root.id);

		const attachments = [makeAttachment(IMAGE_A)];
		await chatStore.send('look at this', { effort: 'on', attachments });

		expect(chatStore.error).not.toBeNull();
		expect(chatStore.lastFailedPrompt).toBe('look at this');
		expect(chatStore.lastFailedAttachments).toEqual(attachments);

		const msgs = await repos.messages.listByChat(root.id);
		expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(0);
		const userRow = msgs.find((m) => m.role === 'user');
		expect(userRow).toBeDefined();
		expect(JSON.parse(userRow!.parts!)).toEqual([
			{ type: 'text', text: 'look at this' },
			attachments[0]!.part
		]);
	});

	it('(c) retry re-sends with text AND attachments restored, deleting the dangling user row first', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockedGetActiveSdkProvider.mockRejectedValue(new Error('boom'));
		await chatStore.load(root.id);

		const attachments = [makeAttachment(IMAGE_A, 'retry.png'), makeAttachment(IMAGE_B)];
		await chatStore.send('look at this', { effort: 'on', attachments });

		// Route onRetry: restore from the store's retry state, then delete the
		// dangling user row, then send again with both restored.
		const restoredText = chatStore.lastFailedPrompt;
		const restoredAttachments = chatStore.lastFailedAttachments;
		expect(restoredText).toBe('look at this');
		expect(restoredAttachments).toEqual(attachments);

		await chatStore.deleteLastDanglingUser();
		expect(await repos.messages.listByChat(root.id)).toEqual([]);

		mockDefaultProvider();
		mockStreamCapture([]);
		await chatStore.send(restoredText!, { effort: 'on', attachments: restoredAttachments! });

		const msgs = await repos.messages.listByChat(root.id);
		expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
		const userRow = msgs.find((m) => m.role === 'user')!;
		expect(userRow.content).toBe('look at this');
		expect(JSON.parse(userRow.parts!)).toEqual([
			{ type: 'text', text: 'look at this' },
			attachments[0]!.part,
			attachments[1]!.part
		]);
		expect(chatStore.error).toBeNull();
		expect(chatStore.lastFailedPrompt).toBeNull();
		expect(chatStore.lastFailedAttachments).toBeNull();
	});

	it("(d) image-only send (empty text, 1 attachment) persists content='' with a single image part", async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamCapture([]);

		await chatStore.load(root.id);
		const attachment = makeAttachment(IMAGE_A);
		await chatStore.send('', { effort: 'on', attachments: [attachment] });

		const msgs = await repos.messages.listByChat(root.id);
		const userRow = msgs.find((m) => m.role === 'user');
		expect(userRow).toBeDefined();
		expect(userRow!.content).toBe('');
		expect(JSON.parse(userRow!.parts!)).toEqual([attachment.part]);
		expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
	});

	it('(e) regenerate after an image turn re-sends text AND attachments from the prior user row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamCapture([]);

		const attachments = [makeAttachment(IMAGE_A, 'regen.png'), makeAttachment(IMAGE_B)];
		await chatStore.load(root.id);
		await chatStore.send('look at this', { effort: 'on', attachments });

		// Route onRegenerate: source the last user row's parts via partsOf,
		// delete the interrupted assistant row, then re-send with both restored.
		const msgs = await repos.messages.listByChat(root.id);
		const userRow = msgs.find((m) => m.role === 'user')!;
		const assistantRow = msgs.find((m) => m.role === 'assistant')!;

		const restoredText = userRow.content;
		const restoredAttachments = attachmentsOf(userRow);
		expect(restoredText).toBe('look at this');
		expect(restoredAttachments.map((a) => a.part)).toEqual(attachments.map((a) => a.part));

		await repos.messages.delete(assistantRow.id);
		chatStore.messages = chatStore.messages.filter((m) => m.id !== assistantRow.id);
		await chatStore.send(restoredText, { effort: 'on', attachments: restoredAttachments });

		const after = await repos.messages.listByChat(root.id);
		const userRows = after.filter((m) => m.role === 'user');
		expect(userRows).toHaveLength(2);
		expect(JSON.parse(userRows[1]!.parts!)).toEqual([
			{ type: 'text', text: 'look at this' },
			attachments[0]!.part,
			attachments[1]!.part
		]);
		expect(after.some((m) => m.role === 'assistant')).toBe(true);
	});

	it('(f) regenerate of an image-only turn re-sends with the image parts (empty text)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamCapture([]);

		const attachment = makeAttachment(IMAGE_A);
		await chatStore.load(root.id);
		await chatStore.send('', { effort: 'on', attachments: [attachment] });

		// Route onRegenerate against an image-only turn: text is '' but the
		// restored attachments must still trigger the re-send.
		const msgs = await repos.messages.listByChat(root.id);
		const userRow = msgs.find((m) => m.role === 'user')!;
		const assistantRow = msgs.find((m) => m.role === 'assistant')!;
		const restoredAttachments = attachmentsOf(userRow);
		expect(restoredAttachments.map((a) => a.part)).toEqual([attachment.part]);

		await repos.messages.delete(assistantRow.id);
		chatStore.messages = chatStore.messages.filter((m) => m.id !== assistantRow.id);
		await chatStore.send(userRow.content, { effort: 'on', attachments: restoredAttachments });

		const after = await repos.messages.listByChat(root.id);
		const userRows = after.filter((m) => m.role === 'user');
		expect(userRows).toHaveLength(2);
		expect(JSON.parse(userRows[1]!.parts!)).toEqual([attachment.part]);
		expect(after.some((m) => m.role === 'assistant')).toBe(true);
	});
});

describe('chatStore image-unsupported error wiring (T021 — specs/018 User Story 2)', () => {
	const IMAGE_A = 'data:image/png;base64,AAAA';

	function makeAttachment(dataUrl: string): ComposerAttachment {
		const part: ImagePart = {
			type: 'image',
			data: dataUrl,
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 3
		};
		return { part, thumbnailDataUrl: dataUrl };
	}

	function mockStreamReplyOk(): void {
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'ok';
			})(),
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'ok' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: 'ok',
			response: { id: 'test' }
		} as never);
	}

	function failTurnWithHttp400(): void {
		vi.mocked(runAgentTurn).mockRejectedValueOnce(
			new ProviderHttpError('Provider returned HTTP 400', 400, 'image input not accepted')
		);
	}

	beforeEach(() => {
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('image-bearing send failing with ProviderHttpError 400 surfaces the dedicated "Images not supported" error', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		failTurnWithHttp400();
		await chatStore.load(root.id);

		const attachments = [makeAttachment(IMAGE_A)];
		await chatStore.send('look at this', { effort: 'on', attachments });

		expect(chatStore.error).toEqual({
			title: 'Images not supported',
			message: "stub-model doesn't accept images.",
			hint: 'Remove the attachment or switch to a vision-capable model.'
		});

		// Retry still restores text + attachments alongside the dedicated error.
		expect(chatStore.lastFailedPrompt).toBe('look at this');
		expect(chatStore.lastFailedAttachments).toEqual(attachments);
	});

	it('retry after the image-unsupported failure restores attachments and clears the dedicated error', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		failTurnWithHttp400();
		await chatStore.load(root.id);

		const attachments = [makeAttachment(IMAGE_A)];
		await chatStore.send('look at this', { effort: 'on', attachments });
		expect(chatStore.error?.title).toBe('Images not supported');

		// Route onRetry: restore from the store's retry state, delete the
		// dangling user row, re-send with both restored.
		const restoredText = chatStore.lastFailedPrompt!;
		const restoredAttachments = chatStore.lastFailedAttachments!;
		mockDefaultProvider();
		mockStreamReplyOk();
		await chatStore.deleteLastDanglingUser();
		await chatStore.send(restoredText, { effort: 'on', attachments: restoredAttachments });

		expect(chatStore.error).toBeNull();
		expect(chatStore.lastFailedPrompt).toBeNull();
		expect(chatStore.lastFailedAttachments).toBeNull();
		const msgs = await repos.messages.listByChat(root.id);
		expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
	});

	it('non-image failures keep the existing pipeline (image-less 400 stays a generic provider error)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		failTurnWithHttp400();
		await chatStore.load(root.id);

		await chatStore.send('plain text');

		expect(chatStore.error).toEqual({
			title: 'Provider error (400)',
			message: 'image input not accepted',
			hint: undefined
		});
		expect(chatStore.lastFailedAttachments).toBeNull();
	});
});
