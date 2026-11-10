import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '#lib/db/driver/pg-test.js';
import { repos } from '#lib/db/index.js';
import type { ProviderConfig } from '#lib/ai/types.js';
import { MissingKeyError, NetworkError, ProviderHttpError } from '#lib/ai/types.js';
import type { LanguageModel } from 'ai';
import { chatStore, ExcerptOverlapError } from './chat.svelte';
import { assembleContext } from '#lib/chat/context.js';
import { deriveContextGauge } from '#lib/chat/context-usage.js';
import { projectEntries } from '#lib/chat/projection.js';
import { assembleTimeline, isDurableEntry } from '#lib/chat/entries.js';
import { buildExpoundPrompt, serializeAddFormats, parseAddFormats } from '#lib/chat/expound.js';
import { parseBrief, disabledToolsForBrief } from '#lib/chat/brief.js';
import type { LearningBrief } from '#lib/chat/brief.js';
import type {
	ComposerAttachment,
	ImagePart,
	BranchArtifactMetadata,
	MessagePart,
	TextPart
} from '#lib/chat/kinds.js';
import { attachmentsOf, partsOf } from '#lib/chat/kinds.js';
import { acquirePropagationLatch, releasePropagationLatch } from '#lib/chat/propagation.js';
import { toolsRun } from '#lib/agent/registry.js';
import type { ToolContext } from '#lib/agent/registry.js';

if (typeof requestAnimationFrame === 'undefined') {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(() => cb(Date.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

vi.mock('#lib/ai/client.js', () => ({
	getActiveSdkProvider: vi.fn()
}));

// Real lifecycle module except connectSession, which tests override to emit
// mcp-lifecycle events (or stay benign with no servers).
type ConnectSession = (typeof import('#lib/mcp/lifecycle.js'))['connectSession'];
const connectSessionMock = vi.fn<ConnectSession>(async () => ({
	clients: new Map(),
	unmountAll: () => {}
}));
vi.mock('#lib/mcp/lifecycle.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/mcp/lifecycle.js')>();
	return {
		...actual,
		connectSession: (...args: Parameters<ConnectSession>) => connectSessionMock(...args)
	};
});

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	// Tool-bearing turns build SDK tools via jsonSchema (loop buildSdkTools).
	jsonSchema: vi.fn((schema: unknown) => schema),
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
vi.mock('#lib/agent/loop.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('#lib/agent/loop.js')>();
	return {
		...real,
		runAgentTurn: vi.fn(async (deps) => {
			lastDisabledToolIds = deps.disabledToolIds;
			return real.runAgentTurn(deps);
		})
	};
});

// Real critic except validateTurn, which tests override per-call (delegates to
// the real implementation by default, so unmocked suites keep native behavior).
vi.mock('#lib/agent/critic.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('#lib/agent/critic.js')>();
	return {
		...real,
		validateTurn: vi.fn((markdown: string) => real.validateTurn(markdown))
	};
});

const { validateTurn } = await import('#lib/agent/critic.js');

const { getActiveSdkProvider } = await import('#lib/ai/client.js');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);

// T009: image materialization at finalize rides the provider fetch built by
// sdk-factory; tests swap `materializeState.fetch` to stub the remote fetch.
const materializeState = vi.hoisted(() => ({
	fetch: undefined as typeof globalThis.fetch | undefined
}));
vi.mock('#lib/ai/sdk-factory.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/ai/sdk-factory.js')>();
	return { ...actual, providerFetchFor: () => materializeState.fetch };
});

const { generateText, generateObject, streamText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);
const mockedGenerateObject = vi.mocked(generateObject);
const mockedStreamText = vi.mocked(streamText);

// Factory implementation of the mocked runAgentTurn, captured before any test
// can clobber it. Some describes (UJ16) mockImplementation without restoring;
// the attachments describe reinstalls this so its turns actually stream.
const { runAgentTurn } = await import('#lib/agent/loop.js');
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
	models: ['stub-model'],
	// These tests exercise the plain chat path; tool gating is covered in
	// capability.test.ts. Explicit off models a toolless endpoint (the
	// pre-021 allowlist default for unknown URLs).
	toolCapability: 'off'
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

describe('root chat never offers propagation (027 FR-001, data layer)', () => {
	// Byte-matches tests/e2e/fixtures/kitchen-sink.ts PROPAGATE_TRIGGER /
	// PROPAGATE_UNAVAILABLE_REPLY and tests/fixtures/mock-llm/server.mjs, the
	// way the suite's e2e deck exercises the same journey; the data-layer
	// invariant under test is the tool-set exclusion plus plain-reply
	// persistence, independent of the mock's string matching.
	const PROPAGATE_TRIGGER = 'backpropagate this branch';
	const PROPAGATE_UNAVAILABLE_REPLY =
		'This conversation is a root chat, so it cannot back-propagate; use the manual back-propagate control in the message menu instead.';

	function mockToolsOnProvider(): void {
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: { ...stubConfig, toolCapability: 'on' },
			toolCapability: true
		});
	}

	it('root trigger turn: propagate_to_parent excluded from the tool set, one request, plain reply persisted, no asks', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockToolsOnProvider();
		mockStreamReply(['First reply.']);

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const callsAfterTurn1 = mockedStreamText.mock.calls.length;
		mockStreamReply([PROPAGATE_UNAVAILABLE_REPLY]);
		await chatStore.send(`Wrap up — ${PROPAGATE_TRIGGER}.`);
		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));

		// The trigger wording must never re-request or continue: the plain
		// reply ends the turn after exactly one LLM call.
		expect(mockedStreamText.mock.calls.length - callsAfterTurn1).toBe(1);
		const turnRequest = mockedStreamText.mock.calls[mockedStreamText.mock.calls.length - 1][0] as {
			tools: Record<string, unknown>;
		};
		expect(Object.keys(turnRequest.tools)).toContain('branch_chat');
		expect(Object.keys(turnRequest.tools)).not.toContain('propagate_to_parent');

		// Persisted transcript: exactly user+assistant per turn, no reasoning,
		// no tool result, no approval rows — the reply text survives verbatim.
		const msgs = await repos.messages.listByChat(root.id);
		expect(msgs).toHaveLength(4);
		expect(msgs[2]!.role).toBe('user');
		expect(msgs[2]!.content).toBe(`Wrap up — ${PROPAGATE_TRIGGER}.`);
		expect(msgs[3]!.role).toBe('assistant');
		expect(msgs[3]!.kind).toBe('assistant_message');
		expect(msgs[3]!.content).toBe(PROPAGATE_UNAVAILABLE_REPLY);
		for (const m of msgs) {
			expect(['user_message', 'assistant_message']).toContain(m.kind ?? m.role);
		}

		// No approval ask ever entered the live pipeline, and the turn closed
		// its live blocks.
		expect(chatStore.pendingApprovals).toHaveLength(0);
		expect(chatStore.liveItems).toHaveLength(0);
	});

	it('branch with own messages keeps propagate_to_parent available (FR-001 complement)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockToolsOnProvider();
		mockStreamReply(['Root reply.']);
		await chatStore.load(root.id);
		await chatStore.send('hello');

		const child = await repos.chats.createChild({ parentId: root.id, title: 'Branch' });
		mockStreamReply(['Branch first turn.']);
		await chatStore.load(child.id);
		await chatStore.send('branch first turn');
		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));
		// A branch's first own turn still excludes propagate (hadMessages was
		// false at send time); the second turn — the branch now having its own
		// transcript — must keep the tool available.
		mockStreamReply(['Branch second turn.']);
		await chatStore.send(`Wrap up — ${PROPAGATE_TRIGGER}.`);
		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));
		expect(lastDisabledToolIds).not.toContain('propagate_to_parent');
	});
});

describe('chatStore MCP connect notices', () => {
	beforeEach(() => {
		connectSessionMock.mockReset();
		connectSessionMock.mockImplementation(async () => ({
			clients: new Map(),
			unmountAll: () => {}
		}));
	});

	it('surfaces enabled-server connect failures as mcpNotices during the turn', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.mcp.upsertServer({
			id: 'srv-1',
			name: 'Brave Search',
			transport: 'stdio',
			command: 'npx',
			args: [],
			enabled: true,
			createdAt: Date.now()
		});
		mockDefaultProvider();
		mockStreamReply(['ok']);
		connectSessionMock.mockImplementation(async (_configs, onTrace) => {
			onTrace?.({
				kind: 'mcp-lifecycle',
				serverId: 'srv-1',
				serverName: 'Brave Search',
				action: 'error',
				detail: 'command not found in PATH: npx'
			});
			return { clients: new Map(), unmountAll: () => {} };
		});

		await chatStore.load(root.id);
		await chatStore.send('hello');

		expect(chatStore.mcpNotices).toEqual(['Brave Search: command not found in PATH: npx']);
	});

	it('clears mcpNotices at the start of the next send', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['ok']);

		await chatStore.load(root.id);
		(chatStore as unknown as { mcpNotices: string[] }).mcpNotices = ['stale note'];
		await chatStore.send('hello');

		expect(chatStore.mcpNotices).toEqual([]);
	});
});

describe('chatStore reasoning buffer', () => {
	it('liveBlocks reset on send() start and in finally', async () => {
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
		expect(chatStore.liveBlocks).toEqual([]);

		void chatStore.send('hello');
		expect(chatStore.liveBlocks).toEqual([]);

		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));
		expect(chatStore.liveBlocks).toEqual([]);
	});

	it('liveBlocks reset on load()', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		(chatStore as unknown as { liveBlocks: unknown[] }).liveBlocks = [
			{ kind: 'reasoning', text: 'some reasoning', open: true }
		];
		await chatStore.load(root.id);
		expect(chatStore.liveBlocks).toEqual([]);
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

describe('029 live blocks (T010)', () => {
	afterEach(() => {
		vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl!);
	});

	it('interleaved turn produces ordered liveBlocks and per-block liveItems; blocks clear on teardown', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('thought one');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('answer part 1');
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('thought two');
			deps.onTextSegmentStart?.('answer part 1'.length);
			deps.updateStreamBuffer('answer part 1answer part 2');
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.liveBlocks).toHaveLength(4));
		// 035 US2 amendment: blocks close at the next segment/text start, so the
		// earlier reasoning blocks are no longer open once a later segment began.
		expect(chatStore.liveBlocks).toEqual([
			{ kind: 'reasoning', text: 'thought one', open: false },
			{ kind: 'text', start: 0, open: false },
			{ kind: 'reasoning', text: 'thought two', open: false },
			{ kind: 'text', start: 13, open: true }
		]);

		await new Promise((r) => setTimeout(r, 100));
		expect(chatStore.liveItems).toEqual([
			{ source: 'live', live: 'live_reasoning', buffer: 'thought one', streaming: false },
			{ source: 'live', live: 'live_text', buffer: 'answer part 1', pending: false },
			{ source: 'live', live: 'live_reasoning', buffer: 'thought two', streaming: false },
			{ source: 'live', live: 'live_text', buffer: 'answer part 2', pending: false }
		]);

		resolveTurn();
		await sendP;
		expect(chatStore.liveBlocks).toEqual([]);
	});

	it('error path leaves no open live block and no live entries', async () => {
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('mid-thought');
			deps.updateStreamBuffer('partial');
			throw new Error('provider exploded');
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		await chatStore.send('hello');

		expect(chatStore.error).not.toBeNull();
		for (const b of chatStore.liveBlocks) expect(b.open).toBe(false);
		expect(chatStore.liveItems).toEqual([]);
	});

	it('abort path leaves no open live block and no live entries', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('mid-thought');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('partial');
			await turnBlocked;
			return { aborted: true };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.liveBlocks).toHaveLength(2));
		chatStore.stop();
		resolveTurn();
		await sendP;

		for (const b of chatStore.liveBlocks) expect(b.open).toBe(false);
		expect(chatStore.liveItems).toEqual([]);
	});

	// 035 US2 (T006a): at an iteration boundary the store clears liveBlocks, so
	// iteration 2's reasoning streams alone — iteration 1's blocks are durable
	// rows by then (contracts/iteration-boundary.md).
	function mockTwoIterationTurn(blocked: Promise<void>): void {
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			// iteration 1: reasoning + text, then the loop's interim persist
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('iter-one thought');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('iter-one answer');
			await deps.appendReasoning?.('iter-one thought', 0);
			await deps.appendAssistantText('iter-one answer');
			// post-T007 the loop fires the boundary here, after the interim persist
			deps.onIterationBoundary?.();
			// iteration 2: reasoning streams
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('iter-two thought');
			await blocked;
			return { aborted: false };
		});
	}

	it('two-iteration turn: iteration 2 reasoning streams alone, no stale live rows from iteration 1 (T006a)', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		mockTwoIterationTurn(turnBlocked);

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() =>
			expect(
				chatStore.liveBlocks.some((b) => b.kind === 'reasoning' && b.text === 'iter-two thought')
			).toBe(true)
		);
		await new Promise((r) => setTimeout(r, 100));

		// exactly ONE live reasoning entry (iteration 2's), and no stale
		// empty-buffer live text entry from iteration 1
		expect(chatStore.liveItems).toEqual([
			{ source: 'live', live: 'live_reasoning', buffer: 'iter-two thought', streaming: true }
		]);

		resolveTurn();
		await sendP;
	});

	it('streaming flag: earlier reasoning block closes at the next text segment start and stops streaming (T006b)', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('early thought');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('answer');
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.liveBlocks).toHaveLength(2));

		const reasoning = chatStore.liveBlocks.find((b) => b.kind === 'reasoning');
		expect(reasoning?.open).toBe(false);
		const reasoningItems = chatStore.liveItems.filter((i) => i.live === 'live_reasoning');
		expect(reasoningItems).toHaveLength(1);
		expect(reasoningItems[0]).toEqual({
			source: 'live',
			live: 'live_reasoning',
			buffer: 'early thought',
			streaming: false
		});

		resolveTurn();
		await sendP;
	});

	it('turn teardown still closes and clears all live blocks after iteration boundaries (T006c)', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		mockTwoIterationTurn(turnBlocked);

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() =>
			expect(
				chatStore.liveBlocks.some((b) => b.kind === 'reasoning' && b.text === 'iter-two thought')
			).toBe(true)
		);
		resolveTurn();
		await sendP;

		expect(chatStore.liveBlocks).toEqual([]);
		expect(chatStore.liveItems).toEqual([]);
	});
});

// T017 (029 US2): an interleaved turn persisted through the real store path
// must survive reload with the live block sequence intact — rows in arrival
// order, `anchored: true` on reasoning rows, and canonical entries keeping
// reasoning at their persisted positions (reorderTurn v2 semantics).
describe('029 reload fidelity (T017)', () => {
	afterEach(() => {
		vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl!);
	});

	it('interleaved turn reload reproduces the live block sequence exactly', async () => {
		let liveKinds: string[] = [];
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			// One iteration, segments interleaved: R → T → R → T.
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('thought one');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('answer one');
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('thought two');
			deps.onTextSegmentStart?.('answer one'.length);
			deps.updateStreamBuffer('answer oneanswer two');
			liveKinds = chatStore.liveBlocks.map((b) => b.kind);
			// Iteration-end block walk (post-T012): persist in arrival order.
			await deps.appendReasoning?.('thought one', 0);
			await deps.appendAssistantText('answer one', {});
			await deps.appendReasoning?.('thought two', 0);
			await deps.appendAssistantText('answer two', {});
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);
		await chatStore.send('hello');

		expect(liveKinds).toEqual(['reasoning', 'text', 'reasoning', 'text']);

		await chatStore.load(root.id);

		const turn = chatStore.messages.filter((m) => m.role === 'assistant');
		expect(turn.map((m) => [m.kind, m.content])).toEqual([
			['reasoning', 'thought one'],
			['assistant_message', 'answer one'],
			['reasoning', 'thought two'],
			['assistant_message', 'answer two']
		]);
		const storedKinds = turn.map((m) => (m.kind === 'reasoning' ? 'reasoning' : 'text'));
		expect(storedKinds).toEqual(liveKinds);

		const reasoningRows = turn.filter((m) => m.kind === 'reasoning');
		expect(JSON.parse(reasoningRows[0]!.metadata!)).toEqual({ iteration: 0, anchored: true });
		expect(JSON.parse(reasoningRows[1]!.metadata!)).toEqual({ iteration: 0, anchored: true });
		const textRows = turn.filter((m) => m.kind === 'assistant_message');
		expect(textRows[0]!.metadata).toBeNull();
		expect(textRows[1]!.metadata).toBeNull();

		// Canonical rebuild (post-T014): anchored reasoning rows stay at their
		// persisted positions — NOT hoisted before the turn's assistant row.
		const kinds = assembleTimeline(chatStore.messages)
			.filter(isDurableEntry)
			.map((t) => t.kind);
		expect(kinds).toEqual([
			'user_message',
			'reasoning',
			'assistant_message',
			'reasoning',
			'assistant_message'
		]);
	});

	it('single-segment turn reload keeps the [reasoning, assistant_message] shapes', async () => {
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onReasoningSegmentStart?.();
			deps.updateReasoningBuffer('solo thought');
			deps.onTextSegmentStart?.(0);
			deps.updateStreamBuffer('solo answer');
			await deps.appendReasoning?.('solo thought', 0);
			await deps.appendAssistantText('solo answer', {});
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);
		await chatStore.send('hello');
		await chatStore.load(root.id);

		const turn = chatStore.messages.filter((m) => m.role === 'assistant');
		expect(turn.map((m) => [m.kind, m.content])).toEqual([
			['reasoning', 'solo thought'],
			['assistant_message', 'solo answer']
		]);
		expect(JSON.parse(turn[0]!.metadata!).iteration).toBe(0);
		expect(turn[1]!.metadata).toBeNull();

		const kinds = assembleTimeline(chatStore.messages)
			.filter(isDurableEntry)
			.map((t) => t.kind);
		expect(kinds).toEqual(['user_message', 'reasoning', 'assistant_message']);
	});
});

// 035 US1 (T003): the critic-corrected turn persists the ORIGINAL stream's
// reasoning row before the corrected text row and survives a fresh load
// (contracts/corrected-persist.md).
describe('035 corrected-persist round-trip (T003)', () => {
	afterEach(() => {
		vi.mocked(validateTurn).mockClear();
	});

	it('critic-corrected turn persists [reasoning(anchored), assistant(corrected)], identical after fresh load', async () => {
		vi.mocked(validateTurn)
			.mockResolvedValueOnce([{ type: 'mermaid', message: 'parse error' }])
			.mockResolvedValueOnce([]);

		const original = '```mermaid\nbad';
		const corrected = '```mermaid\ngraph TD\nA-->B\n```';
		mockedStreamText
			.mockReturnValueOnce({
				textStream: (async function* () {
					yield original;
				})(),
				fullStream: (async function* () {
					yield { type: 'reasoning-start', id: 'r' };
					yield { type: 'reasoning-delta', text: 'thinking…' };
					yield { type: 'reasoning-end', id: 'r' };
					yield { type: 'text-delta', text: original };
					yield { type: 'finish', finishReason: 'stop' };
				})(),
				text: original,
				response: { id: 'test' }
			} as never)
			.mockReturnValueOnce({
				textStream: (async function* () {
					yield corrected;
				})(),
				fullStream: (async function* () {
					yield { type: 'text-delta', text: corrected };
					yield { type: 'finish', finishReason: 'stop' };
				})(),
				text: corrected,
				response: { id: 'test' }
			} as never);

		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const turn = msgs.filter((m) => m.role === 'assistant');
		// self_corrected label first (loop call site precedes the persist branch),
		// then the flushed original-stream reasoning, then the corrected text row
		expect(turn.map((m) => [m.kind, m.content])).toEqual([
			['self_corrected', expect.any(String)],
			['reasoning', 'thinking…'],
			['assistant_message', corrected]
		]);
		const reasoning = turn.find((m) => m.kind === 'reasoning')!;
		expect(JSON.parse(reasoning.metadata!)).toEqual({ iteration: 0, anchored: true });
		expect(msgs.find((m) => m.role === 'user')!.content).toBe('hello');

		await chatStore.load(root.id);
		const reloaded = chatStore.messages
			.filter((m) => m.role === 'assistant')
			.map((m) => [m.kind, m.content]);
		expect(reloaded).toEqual(turn.map((m) => [m.kind, m.content]));
	});
});

// 035 US3 (T010, contracts/regenerate-scope.md): deleteLastAssistantTurn
// removes the WHOLE assistant turn — every row strictly after the previous
// user row (reasoning + text + trailing reasoning, all kinds) — and returns
// the re-send payload. A whole-turn delete avoids orphan tool-result rows.
describe('035 deleteLastAssistantTurn (T010)', () => {
	it('deletes all non-user rows of an interleaved turn, keeps the user row, returns the resend payload', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const user = await repos.messages.append(root.id, 'user', 'hi');
		const r1 = await repos.messages.append(root.id, 'assistant', 'think one', {
			kind: 'reasoning',
			metadata: JSON.stringify({ iteration: 0, anchored: true })
		});
		const a1 = await repos.messages.append(root.id, 'assistant', 'ans');
		const r2 = await repos.messages.append(root.id, 'assistant', ' done thinking.', {
			kind: 'reasoning',
			metadata: JSON.stringify({ iteration: 0, anchored: true })
		});
		await chatStore.load(root.id);
		expect(chatStore.messages.map((m) => m.id)).toEqual([user.id, r1.id, a1.id, r2.id]);

		const payload = await chatStore.deleteLastAssistantTurn(a1.id);

		expect(payload).toEqual({ userText: 'hi', attachments: [] });
		const after = await repos.messages.listByChat(root.id);
		expect(after.map((m) => m.id)).toEqual([user.id]);
		expect(chatStore.messages.map((m) => m.id)).toEqual([user.id]);
	});

	it('returns null (no-op) for an unknown row id', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(root.id, 'user', 'hi');
		await chatStore.load(root.id);

		const payload = await chatStore.deleteLastAssistantTurn('no-such-row');

		expect(payload).toBeNull();
		expect(await repos.messages.listByChat(root.id)).toHaveLength(1);
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
		const loop = await import('#lib/agent/loop.js');
		originalImpl = (
			vi.mocked(loop.runAgentTurn) as unknown as {
				getMockImplementation(): (...args: unknown[]) => unknown;
			}
		).getMockImplementation();
	});

	afterEach(async () => {
		if (originalImpl) {
			const loop = await import('#lib/agent/loop.js');
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

		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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
		const { buildCapabilitiesPreamble } = await import('#lib/chat/brief.js');
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
		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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

		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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

		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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

		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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

// 030 image replies (T004 — specs/030-image-generation US1): recognized stream
// images land on the assistant row as ordered parts in the same atomic append
// that records the model. Prescribes the store contract for T008.
describe('chatStore image reply persistence (T004 — specs/030 US1)', () => {
	const PNG_B64 = 'QUFB'; // "AAA"

	function imageReplyStream(text: string): void {
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield text;
			})(),
			fullStream: (async function* () {
				yield { type: 'text-delta', text };
				yield {
					type: 'file',
					file: { base64: PNG_B64, uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
				};
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text,
			response: { id: 'test' }
		} as never);
	}

	beforeEach(() => {
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('(a) an image reply persists ONE assistant row: ordered text+image parts with the model, atomically', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		imageReplyStream('Here you go');

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');

		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);

		const row = assistantRows[0]!;
		expect(row.content).toBe('Here you go');
		expect(row.model).toBe('stub-model');
		const parts = JSON.parse(row.parts!);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({ type: 'text', text: 'Here you go' });
		expect(parts[1].type).toBe('image');
		expect(parts[1].data).toBe(`data:image/png;base64,${PNG_B64}`);
		expect(parts[1].mimeType).toBe('image/png');
	});

	// 033 T010 (FR-008): exercise the REAL loop abort path (research D3) —
	// issue #70's core complaint is that the mocked-turn version of this test
	// never drove the actual consumeStream abort, so the images were lost.
	// Scripted image stream → chatStore.stop() mid-stream → the interrupted
	// row reloaded from the DB carries the image parts.
	it('(b) abort after an image arrives persists it on the interrupted row (real loop path)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();

		mockedStreamText.mockImplementation((opts?: Record<string, unknown>) => {
			const signal = opts?.abortSignal as AbortSignal | undefined;
			return {
				fullStream: (async function* () {
					yield { type: 'text-delta', text: 'painting partial…' };
					yield {
						type: 'file',
						file: {
							base64: PNG_B64,
							uint8Array: new Uint8Array([1, 2, 3]),
							mediaType: 'image/png'
						}
					};
					await new Promise<void>((resolve) =>
						signal?.addEventListener('abort', () => resolve(), { once: true })
					);
					// the stream dies with the abort: nothing after the stop point
				})(),
				text: '',
				response: { id: 'test' }
			} as never;
		});

		await chatStore.load(root.id);
		const sendP = chatStore.send('draw a quokka');
		await vi.waitFor(() => expect(chatStore.streamBuffer).toBe('painting partial…'));
		chatStore.stop();
		await sendP;

		const interrupted = (await repos.messages.listByChat(root.id)).find(
			(m) => m.role === 'assistant' && m.metadata && JSON.parse(m.metadata).interrupted === true
		);
		expect(interrupted).toBeDefined();
		expect(interrupted!.content).toBe('painting partial…');
		const parts = JSON.parse(interrupted!.parts!);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({ type: 'text', text: 'painting partial…' });
		expect(parts[1]).toMatchObject({ type: 'image', data: `data:image/png;base64,${PNG_B64}` });

		// the reloaded chat shows the interrupted image-bearing row
		await chatStore.load(root.id);
		const reloaded = chatStore.messages.find(
			(m) => m.role === 'assistant' && m.metadata && JSON.parse(m.metadata).interrupted === true
		);
		expect(reloaded).toBeDefined();
		expect(reloaded!.id).toBe(interrupted!.id);
		expect(JSON.parse(reloaded!.parts!)).toHaveLength(2);
	});

	it('(c) pendingImages never leak: the next image-less turn persists a parts-less assistant row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();

		await chatStore.load(root.id);
		imageReplyStream('Here you go');
		await chatStore.send('draw a quokka');

		mockStreamReply(['plain reply']);
		await chatStore.send('now some text');

		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(2);
		const second = assistantRows[1]!;
		expect(second.content).toBe('plain reply');
		expect(second.parts).toBeNull();
		expect(chatStore.lastFailedPrompt).toBeNull();
		expect(chatStore.lastFailedAttachments).toBeNull();
	});

	// Reload-serves-from-row (031 T013, e2e image-round-trip reload twin):
	// re-hydrating the chat after the image turn yields the stored image part
	// through the same helper the renderer reads (partsOf) — the image is
	// served from the persisted row, with no provider round-trip.
	it('(d) reload hydration serves the image from the persisted row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		imageReplyStream('Here you go');

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');
		const callsAfterTurn = mockedStreamText.mock.calls.length;

		// Hydration (the load() a chat switch / reload performs) issues no
		// provider request — the image comes back from the row.
		await chatStore.load(root.id);
		expect(mockedStreamText.mock.calls).toHaveLength(callsAfterTurn);

		const assistant = chatStore.messages.find((m) => m.role === 'assistant');
		expect(assistant).toBeDefined();
		expect(assistant!.content).toBe('Here you go');
		const parts = partsOf(assistant!);
		expect(parts[0]).toEqual({ type: 'text', text: 'Here you go' });
		expect(parts[1]).toMatchObject({
			type: 'image',
			data: `data:image/png;base64,${PNG_B64}`,
			mimeType: 'image/png'
		});
	});

	// 033 T007 (research D2, finalize-composition §2): an images-with-no-text
	// reply persists the contract-legal image-only row (content '', image
	// parts only) through the REAL loop's finalize fallback, and the row is
	// present after reload. Today the turn persists nothing.
	it('(e) an image-only stream persists ONE assistant row with only image parts, surviving reload', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield {
					type: 'file',
					file: { base64: PNG_B64, uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
				};
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: '',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');

		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);
		const row = assistantRows[0]!;
		expect(row.content).toBe('');
		expect(row.model).toBe('stub-model');
		const parts = JSON.parse(row.parts!);
		expect(parts).toHaveLength(1);
		expect(parts[0].type).toBe('image');
		expect(parts[0].data).toBe(`data:image/png;base64,${PNG_B64}`);
		expect(parts[0].mimeType).toBe('image/png');

		// the image-only row survives a reload (data-level)
		await chatStore.load(root.id);
		const reloaded = chatStore.messages.find((m) => m.role === 'assistant');
		expect(reloaded).toBeDefined();
		expect(reloaded!.id).toBe(row.id);
		expect(reloaded!.content).toBe('');
		const reloadedParts = partsOf(reloaded!);
		expect(reloadedParts).toHaveLength(1);
		expect(reloadedParts[0]).toMatchObject({
			type: 'image',
			data: `data:image/png;base64,${PNG_B64}`,
			mimeType: 'image/png'
		});
	});

	// 033 T012 (research D4, finalize-composition §2 cap rule 2): over-cap
	// finalize degrades gracefully — the first MAX_IMAGES_PER_MESSAGE (8) images
	// keep the row, the rest drop with a bracketed notice, and nothing throws.
	// Today the ninth image makes repos.messages.append's validateParts reject
	// the append, so the turn is lost entirely.
	it('(f) nine base64 candidates finalize capped: one row, exactly 8 image parts, a bracketed drop notice, no throw (033 T012)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'Nine images' };
				for (let n = 0; n < 9; n++) {
					yield {
						type: 'file',
						file: {
							base64: PNG_B64,
							uint8Array: new Uint8Array([1, 2, 3]),
							mediaType: 'image/png'
						}
					};
				}
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: '',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('draw nine quokkas');

		expect(chatStore.error).toBeNull();
		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);
		const row = assistantRows[0]!;
		expect(row.content).toBe(
			'Nine images\n\n[1 image was dropped: at most 8 images can be attached per message.]'
		);
		const parts = JSON.parse(row.parts!) as MessagePart[];
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(8);
		expect(parts.filter((p) => p.type === 'text')).toEqual([
			{ type: 'text', text: 'Nine images' },
			{
				type: 'text',
				text: '\n\n[1 image was dropped: at most 8 images can be attached per message.]'
			}
		]);
	});

	// 033 T015 (research D5, finalize-composition §2 arrival order): a
	// `text → image → text` stream persists ONE row whose parts run
	// [text-a, image, text-b] — the row text split at the image's arrival
	// offset — and reload reproduces that order. Text parts concatenate
	// byte-for-byte to `content`. Today all images ride the single text row's
	// tail: parts come out [full-text, image].
	it('(g) text → image → text persists one row with parts [text-a, image, text-b], surviving reload (033 T015)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'Halfway' };
				yield {
					type: 'file',
					file: {
						base64: PNG_B64,
						uint8Array: new Uint8Array([1, 2, 3]),
						mediaType: 'image/png'
					}
				};
				yield { type: 'text-delta', text: ' and done.' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: '',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('draw one quokka');

		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);
		const row = assistantRows[0]!;
		expect(row.content).toBe('Halfway and done.');
		const parts = JSON.parse(row.parts!) as MessagePart[];
		expect(parts[0]).toEqual({ type: 'text', text: 'Halfway' });
		expect(parts[1]).toMatchObject({
			type: 'image',
			data: `data:image/png;base64,${PNG_B64}`,
			mimeType: 'image/png'
		});
		expect(parts[2]).toEqual({ type: 'text', text: ' and done.' });

		// reload reproduces the parts order (data-level; renderer interleaves)
		await chatStore.load(root.id);
		const reloaded = chatStore.messages.find((m) => m.role === 'assistant');
		expect(reloaded).toBeDefined();
		expect(reloaded!.id).toBe(row.id);
		const reloadedParts = partsOf(reloaded!);
		expect(reloadedParts[0]).toEqual({ type: 'text', text: 'Halfway' });
		expect(reloadedParts[1]).toMatchObject({
			type: 'image',
			data: `data:image/png;base64,${PNG_B64}`
		});
		expect(reloadedParts[2]).toEqual({ type: 'text', text: ' and done.' });
	});

	// 033 T018 (research D6, finalize-composition §2 cap rule 1): a corrupt
	// candidate is contained per image — the sniff gate (magic bytes, node-safe)
	// drops it with a bracketed notice while the valid image and the text
	// persist. Today the garbage base64 makes candidateToImagePart's atob
	// throw, the compose rejects, and the whole turn is lost as "Network error".
	it('(h) a garbage-base64 candidate drops with a bracketed notice; valid image and text persist (033 T018)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'Here' };
				yield {
					type: 'file',
					file: { base64: PNG_B64, uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
				};
				yield {
					type: 'file',
					file: {
						base64: '!!!garbage!!!',
						uint8Array: new Uint8Array([9, 9, 9]),
						mediaType: 'image/png'
					}
				};
				yield { type: 'text-delta', text: ' and text' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: '',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('draw two quokkas');

		expect(chatStore.error).toBeNull();
		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);
		const row = assistantRows[0]!;
		expect(row.content).toBe(
			'Here and text\n\n[1 image was dropped: the image data was not a valid image.]'
		);
		const parts = JSON.parse(row.parts!) as MessagePart[];
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(1);
		expect(parts[0]).toEqual({ type: 'text', text: 'Here' });
		expect(parts[1]).toMatchObject({
			type: 'image',
			data: `data:image/png;base64,${PNG_B64}`,
			mimeType: 'image/png'
		});
		expect(parts[2]).toEqual({ type: 'text', text: ' and text' });
		expect(parts[3]).toEqual({
			type: 'text',
			text: '\n\n[1 image was dropped: the image data was not a valid image.]'
		});
	});
});

// T009 (specs/030 US1, contract stream-image-parts.md §1): URL-only candidates
// materialize through the provider fetch at finalize; an un-fetchable link
// becomes a contained inline notice in the text content — never a broken
// frame, never a dropped message.
describe('chatStore URL-image materialization at finalize (T009 — specs/030 US1)', () => {
	const IMAGE_URL = 'https://img.example/generations/abc.png';
	const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);

	function imageReplyUrlStream(text: string): void {
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield text;
			})(),
			fullStream: (async function* () {
				yield { type: 'text-delta', text };
				// SDK caveat shape (loop.ts candidateFromFile): url-typed file data
				// lands in the base64 slot → a URL candidate for the store.
				yield { type: 'file', file: { base64: IMAGE_URL, mediaType: 'image/png' } };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text,
			response: { id: 'test' }
		} as never);
	}

	beforeEach(() => {
		materializeState.fetch = undefined;
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('materializes a URL candidate through the provider fetch and persists an image part', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		materializeState.fetch = vi.fn(
			async () =>
				new Response(PNG_BYTES as BodyInit, {
					status: 200,
					headers: { 'content-type': 'image/png' }
				})
		) as unknown as typeof globalThis.fetch;
		imageReplyUrlStream('Here you go');

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');

		expect(materializeState.fetch).toHaveBeenCalledWith(
			IMAGE_URL,
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		const msgs = await repos.messages.listByChat(root.id);
		const row = msgs.find((m) => m.role === 'assistant');
		expect(row).toBeDefined();
		expect(row!.content).toBe('Here you go');
		expect(row!.model).toBe('stub-model');
		const parts = JSON.parse(row!.parts!);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({ type: 'text', text: 'Here you go' });
		expect(parts[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
		expect(parts[1].data).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`);
	});

	it('an un-fetchable URL persists the row with a contained notice in the text content', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		materializeState.fetch = vi.fn(
			async () => new Response('gone', { status: 404 })
		) as unknown as typeof globalThis.fetch;
		imageReplyUrlStream('Here you go');

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');

		const msgs = await repos.messages.listByChat(root.id);
		const row = msgs.find((m) => m.role === 'assistant');
		expect(row).toBeDefined();
		expect(row!.content).toBe(
			"Here you go\n\n[Image could not be loaded: the provider's link is no longer available.]"
		);
		expect(row!.parts).toBeNull();
		expect(chatStore.error).toBeNull();
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

// T018 (specs/030 US2): a failed image turn — stream images were handed to
// finalize but never persisted — is refined into a typed, plain-language
// notice naming the "Image output" capability toggle, never a raw provider
// dump (contract image-output-capability.md "Failure refinement", FR-007).
describe('chatStore image-output failure refinement (T018 — specs/030 US2)', () => {
	const PNG_B64 = 'QUFB'; // "AAA"

	/**
	 * Turn mock: recognizes an image on the stream (033 T022 — the refinement
	 * keys on the turn-scoped recognized count, finalize-composition §4),
	 * hands it to finalize, whose assistant append then fails.
	 */
	function imageTurnFailingAtFinalize(): void {
		vi.mocked(runAgentTurn).mockImplementationOnce(async (deps) => {
			deps.onImageRecognized?.({ mediaType: 'image/png', base64: PNG_B64 });
			await deps.appendAssistantText('drawing your quokka', {
				images: [{ mediaType: 'image/png', base64: PNG_B64 }]
			} as unknown as Parameters<typeof deps.appendAssistantText>[1]);
			return { aborted: false };
		});
	}

	/** Fail only the assistant-row append (the user row must persist). */
	function failAssistantAppendWith(err: Error): void {
		const originalAppend = repos.messages.append.bind(repos.messages);
		vi.spyOn(repos.messages, 'append').mockImplementation(async (chatId, role, content, opts) => {
			if (role === 'assistant') throw err;
			return originalAppend(chatId, role, content, opts);
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

	it('failed image turn surfaces the contained "No image produced" notice naming the toggle', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		imageTurnFailingAtFinalize();
		failAssistantAppendWith(
			new ProviderHttpError('Provider returned HTTP 400', 400, 'image request rejected')
		);
		await chatStore.load(root.id);

		await chatStore.send('draw a quokka');

		expect(chatStore.error).toEqual({
			title: 'No image produced',
			message: 'stub-model did not produce an image.',
			hint: 'Set "Image output" to "On" in provider settings to force the attempt, or switch to a model that produces images.'
		});
	});

	it('failed image turn with a non-provider error keeps that error\u2019s own notice', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		imageTurnFailingAtFinalize();
		failAssistantAppendWith(new NetworkError('offline'));
		await chatStore.load(root.id);

		await chatStore.send('draw a quokka');

		expect(chatStore.error?.title).toBe('Network error');
		expect(chatStore.error?.message).toBe('offline');
	});
});

// 033 T021 (US7, contract finalize-composition.md §4): the failure refinement
// keys on the turn-scoped recognized-image counter (the stream died before any
// finalize append, so pendingImages is empty — today unreachable), and a
// successful image-expecting turn that produced zero images carries the
// bracketed no-image notice on its final row.
describe('chatStore zero-image refinement + notice (T021 — specs/033 US7)', () => {
	const PNG_B64 = 'QUFB'; // "AAA"
	const NO_IMAGE_NOTICE =
		'[No image was produced this turn. Set "Image output" to "On" in provider settings, or switch to a model that produces images.]';

	beforeEach(() => {
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('(a) stream recognized an image, then failed with a ProviderHttpError 4xx → typed "No image produced" notice, not the raw error', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield {
					type: 'file',
					file: { base64: PNG_B64, uint8Array: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
				};
				yield {
					type: 'error',
					error: new ProviderHttpError('Provider returned HTTP 400', 400, 'image rejected')
				};
			})(),
			text: '',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('draw a quokka');

		expect(chatStore.error).toEqual({
			title: 'No image produced',
			message: 'stub-model did not produce an image.',
			hint: 'Set "Image output" to "On" in provider settings to force the attempt, or switch to a model that produces images.'
		});
		expect(chatStore.error?.title).not.toBe('Network error');
		expect(chatStore.error?.title).not.toBe('Provider error (400)');
	});

	it('(b) a successful text-only turn against an image-output-expected model carries the bracketed no-image notice on the final row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: { ...stubConfig, imageOutput: 'on' },
			toolCapability: true
		});
		mockStreamReply(['Here is your answer']);

		await chatStore.load(root.id);
		await chatStore.send('tell me about quokkas');

		expect(chatStore.error).toBeNull();
		const msgs = await repos.messages.listByChat(root.id);
		const assistantRows = msgs.filter((m) => m.role === 'assistant');
		expect(assistantRows).toHaveLength(1);
		const row = assistantRows[0]!;
		expect(row.content).toBe(`Here is your answer\n\n${NO_IMAGE_NOTICE}`);
		expect(row.parts).toBeNull();

		// reload serves the notice from the persisted row
		await chatStore.load(root.id);
		const reloaded = chatStore.messages.find((m) => m.role === 'assistant');
		expect(reloaded!.content).toBe(`Here is your answer\n\n${NO_IMAGE_NOTICE}`);
	});

	it('(c) the same successful text-only turn against a non-expected model carries no notice', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider(); // stubConfig has no imageOutput → 'auto' → non-expected model
		mockStreamReply(['Here is your answer']);

		await chatStore.load(root.id);
		await chatStore.send('tell me about quokkas');

		const msgs = await repos.messages.listByChat(root.id);
		const row = msgs.find((m) => m.role === 'assistant')!;
		expect(row.content).toBe('Here is your answer');
		expect(row.content).not.toContain('[No image was produced');
	});
});

describe('chatStore.propagateToParent (020 US1)', () => {
	beforeEach(() => {
		chatStore.propagationStatus = 'idle';
		chatStore.propagationError = null;
		chatStore.lastPropagation = null;
	});

	afterEach(() => {
		releasePropagationLatch();
	});

	/** Raw SQL escape hatch for timestamp seeding (setup() is idempotent). */
	async function handleExec(sql: string): Promise<void> {
		const handle = await testDb.setup();
		await handle.driver.exec(sql);
	}

	/** Parent with ords 0/1 and a recorded child branch off the first row, with two own turns. */
	async function seedBranch() {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const b = await repos.messages.append(parent.id, 'assistant', 'world');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a.id,
			title: 'Branch of Root'
		});
		await repos.messages.append(child.id, 'user', 'branch question');
		await repos.messages.append(child.id, 'assistant', 'branch answer');
		return { parent, a, b, child };
	}

	it('raw propagation inserts exactly one branch_artifact row at the midpoint with correct metadata', async () => {
		const { parent, a, b, child } = await seedBranch();
		await chatStore.load(child.id);

		await chatStore.propagateToParent('raw');

		const rows = await repos.messages.listByChat(parent.id);
		const artifacts = rows.filter((m) => m.kind === 'branch_artifact');
		expect(artifacts).toHaveLength(1);
		const art = artifacts[0]!;
		expect(rows.map((m) => m.id)).toEqual([a.id, art.id, b.id]);
		expect(art.ord).toBe((a.ord + b.ord) / 2);
		expect(art.role).toBe('user');
		expect(art.content).toBe(
			[
				'[excerpt]',
				'hello',
				'[/excerpt]',
				'',
				'[user] branch question',
				'[assistant] branch answer'
			].join('\n')
		);
		const meta = JSON.parse(art.metadata!) as BranchArtifactMetadata;
		expect(meta).toEqual({
			mode: 'raw',
			sourceChatId: child.id,
			sourceChatTitle: 'Branch of Root',
			branchPointMessageId: a.id,
			anchor: 'recorded',
			summaryTraceId: null,
			regeneratedAt: null
		});
		expect(chatStore.lastPropagation).toEqual({ parentChatId: parent.id, mode: 'raw' });
		expect(chatStore.propagationStatus).toBe('idle');
		expect(chatStore.propagationError).toBeNull();
	});

	it('summary success generates first, persists the summary, and records the trace id', async () => {
		const { parent, a, b, child } = await seedBranch();
		mockDefaultProvider();
		mockedGenerateText.mockResolvedValue({ text: 'Branch summary text' } as never);
		await chatStore.load(child.id);

		await chatStore.propagateToParent('summary');

		const rows = await repos.messages.listByChat(parent.id);
		const artifacts = rows.filter((m) => m.kind === 'branch_artifact');
		expect(artifacts).toHaveLength(1);
		const art = artifacts[0]!;
		expect(art.content).toBe('Branch summary text');
		expect(art.ord).toBe((a.ord + b.ord) / 2);
		const meta = JSON.parse(art.metadata!) as BranchArtifactMetadata;
		expect(meta.mode).toBe('summary');
		expect(meta.summaryTraceId).not.toBeNull();
		const trace = await repos.agentTraces.getById(meta.summaryTraceId!);
		expect(trace?.kind).toBe('branch_artifact_summary');
		expect(trace?.chatId).toBe(child.id);
		expect(chatStore.lastPropagation).toEqual({ parentChatId: parent.id, mode: 'summary' });
		// b is the last parent row in ord, but the artifact anchors at a (midpoint).
		expect(rows.map((m) => m.id)).toEqual([a.id, art.id, b.id]);
	});

	it('summary generation failure inserts NOTHING and sets the error state (FR-013)', async () => {
		const { parent, child } = await seedBranch();
		const before = await repos.messages.listByChat(parent.id);
		mockDefaultProvider();
		mockedGenerateText.mockRejectedValue(new Error('provider down'));
		await chatStore.load(child.id);

		await chatStore.propagateToParent('summary');

		const after = await repos.messages.listByChat(parent.id);
		expect(after.map((m) => [m.id, m.ord, m.content, m.kind])).toEqual(
			before.map((m) => [m.id, m.ord, m.content, m.kind])
		);
		expect(chatStore.propagationStatus).toBe('error');
		expect(chatStore.propagationError).toContain('provider down');
		expect(chatStore.lastPropagation).toBeNull();
	});

	it('propagation rewrites nothing: every pre-existing parent and branch row keeps identical ord/content (FR-005, FR-011, SC-003)', async () => {
		const { parent, child } = await seedBranch();
		const parentBefore = await repos.messages.listByChat(parent.id);
		const branchBefore = await repos.messages.listByChat(child.id);

		mockDefaultProvider();
		mockedGenerateText.mockResolvedValue({ text: 'Second artifact summary' } as never);
		await chatStore.load(child.id);
		await chatStore.propagateToParent('raw');
		await chatStore.propagateToParent('summary');
		// (two propagations landed two artifacts; neither rewrote anything)

		const parentAfter = await repos.messages.listByChat(parent.id);
		expect(parentAfter.filter((m) => m.kind === 'branch_artifact')).toHaveLength(2);
		for (const before of parentBefore) {
			const after = parentAfter.find((m) => m.id === before.id);
			expect(after).toEqual(before);
		}
		expect(await repos.messages.listByChat(child.id)).toEqual(branchBefore);
	});

	it('raw propagation with image-bearing turns stores the collected parts on the artifact (030 T021)', async () => {
		const { parent, child } = await seedBranch();
		const image: ImagePart = {
			type: 'image',
			data: 'data:image/png;base64,Zm9v',
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 8
		};
		await repos.messages.append(child.id, 'assistant', 'see  pic', {
			parts: [{ type: 'text', text: 'see ' }, image, { type: 'text', text: ' pic' }]
		});
		await chatStore.load(child.id);

		await chatStore.propagateToParent('raw');

		const art = (await repos.messages.listByChat(parent.id)).find(
			(m) => m.kind === 'branch_artifact'
		)!;
		expect(art.content).toContain('[assistant] see [image] pic');
		const parts = JSON.parse(art.parts!) as MessagePart[];
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(1);
		expect(
			parts
				.filter((p): p is TextPart => p.type === 'text')
				.map((p) => p.text)
				.join('')
		).toBe(art.content);
		expect(chatStore.propagationStatus).toBe('idle');
	});

	it('raw propagation on a derived branch (null branch point) anchors by createdAt', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const b = await repos.messages.append(parent.id, 'assistant', 'world');
		const child = await repos.chats.createChild({ parentId: parent.id, title: 'Composer branch' });
		await repos.messages.append(child.id, 'user', 'only turn');
		// Force branch.createdAt between a and b.
		await handleExec(`UPDATE chats SET created_at = ${a.createdAt + 5} WHERE id = '${child.id}'`);
		await handleExec(`UPDATE messages SET created_at = ${a.createdAt} WHERE id = '${a.id}'`);
		await handleExec(`UPDATE messages SET created_at = ${a.createdAt + 10} WHERE id = '${b.id}'`);
		await chatStore.load(child.id);

		await chatStore.propagateToParent('raw');

		const rows = await repos.messages.listByChat(parent.id);
		const art = rows.find((m) => m.kind === 'branch_artifact')!;
		expect(art.ord).toBe((a.ord + b.ord) / 2);
		const meta = JSON.parse(art.metadata!) as BranchArtifactMetadata;
		expect(meta.anchor).toBe('derived');
		expect(meta.branchPointMessageId).toBeNull();
		// No branch_source and no anchor row → no excerpt section.
		expect(art.content).not.toContain('[excerpt]');
		expect(art.content).toBe('[user] only turn');
	});

	it('refuses to propagate from a root chat and inserts nothing', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(root.id, 'user', 'hi');
		await chatStore.load(root.id);

		await expect(chatStore.propagateToParent('raw')).rejects.toThrow('not a branch');
		expect(chatStore.propagationStatus).toBe('idle');
		expect(
			(await repos.messages.listByChat(root.id)).filter((m) => m.kind === 'branch_artifact')
		).toHaveLength(0);
	});

	it('refuses to propagate a branch with zero own messages', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await repos.chats.createChild({ parentId: parent.id, title: 'Empty branch' });
		await chatStore.load(child.id);

		await expect(chatStore.propagateToParent('raw')).rejects.toThrow('no messages yet');
		expect(
			(await repos.messages.listByChat(parent.id)).filter((m) => m.kind === 'branch_artifact')
		).toHaveLength(0);
	});

	// ── Shared in-flight latch, cross-path (027 D5 / T012) ──

	/** Minimal tool context, mirroring deterministic-tools.test.ts. */
	function toolCtx(chatId: string, rootChatId: string): ToolContext {
		return {
			chatId,
			rootChatId,
			budget: { subCalls: 0, maxSubCalls: 0 },
			model: null as unknown as LanguageModel,
			config: null as unknown as ProviderConfig
		};
	}

	it('manual propagation is silently refused while the tool path holds the latch (027 D5)', async () => {
		const { parent, child } = await seedBranch();
		const before = await repos.messages.listByChat(parent.id);
		expect(acquirePropagationLatch()).toBe(true);
		await chatStore.load(child.id);

		await chatStore.propagateToParent('raw');

		const after = await repos.messages.listByChat(parent.id);
		expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
		expect(chatStore.propagationStatus).not.toBe('running');
		expect(chatStore.lastPropagation).toBeNull();
		// The refusing call did not steal or free the foreign path's latch.
		expect(acquirePropagationLatch()).toBe(false);
	});

	it('tool path is refused while a manual propagation is in flight (027 D5)', async () => {
		const { parent, child } = await seedBranch();
		mockDefaultProvider();
		let resolveSummary!: (v: unknown) => void;
		mockedGenerateText.mockReturnValueOnce(
			new Promise((resolve) => (resolveSummary = resolve)) as never
		);
		await chatStore.load(child.id);
		const before = await repos.messages.listByChat(parent.id);

		const manual = chatStore.propagateToParent('summary');
		// The manual path's synchronous prefix already holds the latch.
		const toolResult = await toolsRun('propagate_to_parent', {}, toolCtx(child.id, parent.id));
		expect(toolResult.ok).toBe(false);
		expect(toolResult.summary).toContain('already running');
		expect((await repos.messages.listByChat(parent.id)).map((m) => m.id)).toEqual(
			before.map((m) => m.id)
		);

		resolveSummary({ text: 'Deferred summary' });
		await manual;

		const rows = await repos.messages.listByChat(parent.id);
		expect(rows.filter((m) => m.kind === 'branch_artifact')).toHaveLength(1);
		expect(chatStore.propagationStatus).toBe('idle');
		expect(chatStore.lastPropagation).toEqual({ parentChatId: parent.id, mode: 'summary' });
	});

	it('gate misuse throws but still releases the latch (027 D5)', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		await expect(chatStore.propagateToParent('raw')).rejects.toThrow('not a branch');

		expect(acquirePropagationLatch()).toBe(true);
	});
});

describe('propagate_to_parent availability gating (027 V4)', () => {
	it('root chat turn disables propagate_to_parent', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		mockStreamReply(['Reply']);
		await chatStore.load(root.id);
		await chatStore.send('hello');

		expect(lastDisabledToolIds).toContain('propagate_to_parent');
	});

	it('branch with messages does not disable propagate_to_parent', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a.id,
			title: 'Branch of Root'
		});
		await repos.messages.append(child.id, 'user', 'branch question');
		await repos.messages.append(child.id, 'assistant', 'branch answer');

		mockDefaultProvider();
		mockStreamReply(['Reply']);
		await chatStore.load(child.id);
		await chatStore.send('branch turn');

		expect(lastDisabledToolIds).not.toContain('propagate_to_parent');
	});

	it('empty branch disables propagate_to_parent', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a.id,
			title: 'Empty branch'
		});

		mockDefaultProvider();
		mockStreamReply(['Reply']);
		await chatStore.load(child.id);
		await chatStore.send('first branch turn');

		expect(lastDisabledToolIds).toContain('propagate_to_parent');
	});
});

describe('chatStore artifact management (020 US3)', () => {
	beforeEach(() => {
		chatStore.propagationStatus = 'idle';
		chatStore.propagationError = null;
		chatStore.lastPropagation = null;
	});

	/**
	 * Parent with ords 0/1, a recorded child branch with two own turns, and one
	 * propagated `branch_artifact` anchored in the parent. Ends with the parent
	 * loaded — artifact management acts on the parent's view.
	 */
	async function seedArtifact(mode: 'summary' | 'raw') {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const b = await repos.messages.append(parent.id, 'assistant', 'world');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a.id,
			title: 'Branch of Root'
		});
		await repos.messages.append(child.id, 'user', 'branch question');
		await repos.messages.append(child.id, 'assistant', 'branch answer');
		await chatStore.load(child.id);
		if (mode === 'summary') {
			mockDefaultProvider();
			mockedGenerateText.mockResolvedValueOnce({ text: 'First summary' } as never);
			await chatStore.propagateToParent('summary');
		} else {
			await chatStore.propagateToParent('raw');
		}
		const art = (await repos.messages.listByChat(parent.id)).find(
			(m) => m.kind === 'branch_artifact'
		)!;
		await chatStore.load(parent.id);
		return { parent, a, b, child, art };
	}

	it('regenerate replaces summary content in place — same id and ord — and stamps regeneratedAt', async () => {
		const { parent, art } = await seedArtifact('summary');
		mockedGenerateText.mockResolvedValueOnce({ text: 'Regenerated summary' } as never);

		await chatStore.regenerateArtifact(art.id);

		const rows = await repos.messages.listByChat(parent.id);
		expect(rows.filter((m) => m.kind === 'branch_artifact')).toHaveLength(1);
		const updated = rows.find((m) => m.id === art.id)!;
		expect(updated.ord).toBe(art.ord);
		expect(updated.content).toBe('Regenerated summary');
		const meta = JSON.parse(updated.metadata!) as BranchArtifactMetadata;
		expect(meta.mode).toBe('summary');
		expect(meta.summaryTraceId).not.toBeNull();
		expect(meta.regeneratedAt).not.toBeNull();
		expect(Number.isNaN(Date.parse(meta.regeneratedAt!))).toBe(false);
		expect(chatStore.propagationStatus).toBe('idle');
		expect(chatStore.propagationError).toBeNull();
		// Store replaced the row at its original position (same id, same ord).
		const storeIdx = chatStore.messages.findIndex((m) => m.id === art.id);
		expect(storeIdx).toBe(rows.findIndex((m) => m.id === art.id));
		expect(chatStore.messages[storeIdx]!.content).toBe('Regenerated summary');
	});

	it('regenerate refuses a raw-mode artifact — nothing changes', async () => {
		const { art } = await seedArtifact('raw');
		const before = await repos.messages.getById(art.id);

		await chatStore.regenerateArtifact(art.id);

		expect(await repos.messages.getById(art.id)).toEqual(before);
		expect(mockedGenerateText).not.toHaveBeenCalled();
		expect(chatStore.propagationStatus).toBe('error');
		expect(chatStore.propagationError).toContain('summary');
	});

	it('delete removes only the artifact row; parent composition no longer contains it', async () => {
		const { parent, a, b, art } = await seedArtifact('summary');
		const ctxBefore = await assembleContext(parent.id);
		expect(ctxBefore.some((m) => m.content.includes('First summary'))).toBe(true);
		const rowsBefore = await repos.messages.listByChat(parent.id);
		const projectedBefore = JSON.stringify(projectEntries(rowsBefore));
		expect(projectedBefore).toContain('Back-propagated from');
		expect(projectedBefore).toContain('First summary');

		await chatStore.deleteArtifact(art.id);

		const rows = await repos.messages.listByChat(parent.id);
		expect(rows.map((m) => m.id)).toEqual([a.id, b.id]);
		expect(chatStore.messages.map((m) => m.id)).toEqual([a.id, b.id]);
		expect(chatStore.propagationStatus).toBe('idle');
		for (const row of rowsBefore) {
			if (row.id === art.id) continue;
			expect(rows.find((m) => m.id === row.id)).toEqual(row);
		}
		const ctx = await assembleContext(parent.id);
		expect(ctx.some((m) => m.content.includes('First summary'))).toBe(false);
		const projected = JSON.stringify(projectEntries(rows));
		expect(projected).not.toContain('First summary');
		expect(projected).not.toContain('Back-propagated from');
	});

	it('regenerate failure leaves content and regeneratedAt untouched and surfaces the error state', async () => {
		const { art } = await seedArtifact('summary');
		const before = await repos.messages.getById(art.id);
		mockedGenerateText.mockRejectedValueOnce(new Error('provider down'));

		await chatStore.regenerateArtifact(art.id);

		expect(await repos.messages.getById(art.id)).toEqual(before);
		expect(chatStore.messages.find((m) => m.id === art.id)?.content).toBe(before!.content);
		expect(chatStore.propagationStatus).toBe('error');
		expect(chatStore.propagationError).toContain('provider down');
	});

	it('regenerate refuses when the source branch no longer exists — content untouched, nothing generated', async () => {
		const { parent, child, art } = await seedArtifact('summary');
		const before = await repos.messages.getById(art.id);
		const generateCallsAtSeed = mockedGenerateText.mock.calls.length;
		await repos.chats.deleteBranch(child.id);

		await chatStore.regenerateArtifact(art.id);

		// The artifact itself survives branch deletion (spec edge case), but a
		// regeneration attempt must not overwrite it with a vacuous summary.
		expect(await repos.messages.getById(art.id)).toEqual(before);
		expect(mockedGenerateText.mock.calls.length).toBe(generateCallsAtSeed);
		expect(chatStore.propagationStatus).toBe('error');
		expect(chatStore.propagationError).toContain('no longer exists');
		expect(
			(await repos.messages.listByChat(parent.id)).some((m) => m.kind === 'branch_artifact')
		).toBe(true);
	});

	it('delete is atomic — exactly one row gone, every other row identical', async () => {
		const { parent, art } = await seedArtifact('summary');
		const before = await repos.messages.listByChat(parent.id);

		await chatStore.deleteArtifact(art.id);

		const after = await repos.messages.listByChat(parent.id);
		expect(after).toHaveLength(before.length - 1);
		expect(after.some((m) => m.id === art.id)).toBe(false);
		for (const row of before) {
			if (row.id === art.id) continue;
			expect(after.find((m) => m.id === row.id)).toEqual(row);
		}
	});
});

describe('chatStore paced streaming (022 US1)', () => {
	beforeEach(() => {
		// Minimal fake set: timers drive the rAF polyfill + drain wait, Date
		// drives the flush gate and pacer clock; everything else stays real.
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
		});
	});

	afterEach(() => {
		vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl!);
		chatStore.setStreamPreset('standard');
		vi.useRealTimers();
	});

	function wordSafe(rendered: string, raw: string): boolean {
		if (rendered === raw) return true;
		if (rendered.length === 0) return true;
		const word = /[A-Za-z0-9]/;
		return !(
			word.test(rendered[rendered.length - 1]!) &&
			raw[rendered.length] !== undefined &&
			word.test(raw[rendered.length]!)
		);
	}

	it('paced streaming releases the render copy steadily and word-safe', async () => {
		chatStore.setStreamPreset('expressive');
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		let capturedUpdate: ((n: string) => void) | null = null;
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			capturedUpdate = deps.updateStreamBuffer;
			await turnBlocked;
			return { aborted: false };
		});

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(capturedUpdate).not.toBeNull());

		capturedUpdate!('alpha beta ');
		expect(chatStore.streamBufferRender).toBe('');
		await vi.advanceTimersByTimeAsync(80);
		const first = chatStore.streamBufferRender;
		expect(first.length).toBeGreaterThan(0);
		expect(first.length).toBeLessThan(chatStore.streamBuffer.length);
		expect(wordSafe(first, chatStore.streamBuffer)).toBe(true);
		expect(chatStore.streamPhase).toBe('streaming');

		capturedUpdate!(chatStore.streamBuffer + 'gamma delta epsilon ');
		let released = first.length;
		let grew = 0;
		for (let i = 0; i < 8; i++) {
			await vi.advanceTimersByTimeAsync(80);
			const next = chatStore.streamBufferRender;
			expect(next.length).toBeGreaterThanOrEqual(released);
			if (next.length > released) grew++;
			expect(wordSafe(next, chatStore.streamBuffer)).toBe(true);
			released = next.length;
		}
		expect(grew).toBeGreaterThan(1);

		resolveTurn();
		await vi.advanceTimersByTimeAsync(2000);
		await sendP;
		expect(chatStore.streamPhase).toBe('idle');
	});

	it('standard preset keeps verbatim behavior — finalize without any drain wait', async () => {
		chatStore.setStreamPreset('standard');
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		mockDefaultProvider();
		mockStreamReply(['Standard reply ']);

		const sendP = chatStore.send('hello');
		await sendP;

		expect(chatStore.streaming).toBe(false);
		expect(chatStore.streamPhase).toBe('idle');
		const msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.role === 'assistant');
		expect(assistant!.content).toBe('Standard reply ');
		expect(assistant!.metadata).toBeNull();
	});

	it('defers finalize until the drain completes, walking streaming → draining', async () => {
		chatStore.setStreamPreset('calm');
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		mockDefaultProvider();
		mockStreamReply(['Deferred drain reply ']);

		const sendP = chatStore.send('hello');
		const phases = new Set<string>();
		for (let i = 0; i < 2000 && chatStore.streamPhase !== 'draining'; i++) {
			phases.add(chatStore.streamPhase);
			await vi.advanceTimersByTimeAsync(1);
		}
		phases.add(chatStore.streamPhase);
		expect(chatStore.streaming).toBe(true);

		let msgs = await repos.messages.listByChat(root.id);
		expect(msgs.some((m) => m.role === 'assistant')).toBe(false);

		for (let i = 0; i < 2000 && chatStore.streaming; i++) {
			phases.add(chatStore.streamPhase);
			await vi.advanceTimersByTimeAsync(1);
		}
		expect(phases.has('draining')).toBe(true);

		await sendP;
		expect(chatStore.streaming).toBe(false);
		msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.role === 'assistant');
		expect(assistant!.content).toBe('Deferred drain reply ');
		expect(chatStore.streamPhase).toBe('idle');
	});

	it('interleaved text blocks: the second durable row lands without the drain deadline (035 US4 T013)', async () => {
		chatStore.setStreamPreset('calm');
		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);
		mockDefaultProvider();
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'First block answer. ';
				yield 'Second block answer. ';
			})(),
			fullStream: (async function* () {
				yield { type: 'text-start', id: 't1' };
				yield { type: 'text-delta', id: 't1', text: 'First block answer. ' };
				yield { type: 'text-end', id: 't1' };
				yield { type: 'reasoning-start', id: 'r1' };
				yield { type: 'reasoning-delta', id: 'r1', text: 'mid thought. ' };
				yield { type: 'reasoning-end', id: 'r1' };
				yield { type: 'text-start', id: 't2' };
				yield { type: 'text-delta', id: 't2', text: 'Second block answer. ' };
				yield { type: 'text-end', id: 't2' };
				yield { type: 'finish', finishReason: 'stop' };
			})(),
			text: 'First block answer. Second block answer. ',
			response: { id: 'test' }
		} as never);

		const sendP = chatStore.send('hello');
		// Block 1 keeps its eased drain: advance until the first durable
		// assistant row lands (walk order: text row, reasoning row, text row).
		let firstLanded = false;
		for (let i = 0; i < 300 && !firstLanded; i++) {
			await vi.advanceTimersByTimeAsync(16);
			firstLanded = (await repos.messages.listByChat(root.id)).some((m) => m.role === 'assistant');
		}
		expect(firstLanded).toBe(true);

		// Drain-once (contracts/drain-once.md): the second finalize block has
		// nothing left to release (the first append cleared streamBuffer and
		// reset the pacer), so it must persist WITHOUT burning the 1200 ms
		// DRAIN_DEADLINE_MS — 40 × 16 ms (640 ms) stays strictly below it.
		let secondLanded = false;
		for (let i = 0; i < 40 && !secondLanded; i++) {
			await vi.advanceTimersByTimeAsync(16);
			secondLanded = (await repos.messages.listByChat(root.id)).some(
				(m) => m.role === 'assistant' && m.content === 'Second block answer. '
			);
		}
		expect(secondLanded).toBe(true);

		await vi.advanceTimersByTimeAsync(50);
		await sendP;
		expect(chatStore.streamPhase).toBe('idle');
		const msgs = await repos.messages.listByChat(root.id);
		const rows = msgs.map((m) => [m.role, m.kind, m.content]);
		expect(rows[0]![0]).toBe('user');
		expect(rows.slice(1)).toEqual([
			['assistant', 'assistant_message', 'First block answer. '],
			['assistant', 'reasoning', 'mid thought. '],
			['assistant', 'assistant_message', 'Second block answer. ']
		]);
		const thought = msgs.find((m) => m.kind === 'reasoning');
		expect(JSON.parse(thought!.metadata ?? '{}')).toEqual({ iteration: 0, anchored: true });
	});

	it('abort during a paced stream persists the raw buffer immediately with interrupted:true', async () => {
		chatStore.setStreamPreset('expressive');
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
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
		await vi.advanceTimersByTimeAsync(100);
		await sendP;

		const msgs = await repos.messages.listByChat(root.id);
		const interrupted = msgs.find(
			(m) => m.role === 'assistant' && m.metadata && JSON.parse(m.metadata).interrupted === true
		);
		expect(interrupted).toBeDefined();
		expect(interrupted!.content).toBe('partial reply');
		expect(chatStore.streamPhase).toBe('idle');
	});

	it('critic-style buffer clear resets the release position without throwing', async () => {
		chatStore.setStreamPreset('expressive');
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
		let capturedUpdate: ((n: string) => void) | null = null;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			capturedUpdate = deps.updateStreamBuffer;
			capturedUpdate('hello world this is text ');
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.streamBufferRender.length).toBeGreaterThan(0));
		await vi.advanceTimersByTimeAsync(80);

		capturedUpdate!('');
		await vi.advanceTimersByTimeAsync(80);

		expect(chatStore.streamBuffer).toBe('');
		expect(chatStore.streamBufferRender).toBe('');

		resolveTurn();
		await vi.advanceTimersByTimeAsync(2000);
		await sendP;
		expect(chatStore.streamPhase).toBe('idle');
	});

	it('switching presets mid-stream never rewinds already-visible text', async () => {
		let resolveTurn!: () => void;
		const turnBlocked = new Promise<void>((r) => (resolveTurn = r));
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		const runAgentTurn = (await import('#lib/agent/loop.js')).runAgentTurn;
		let capturedUpdate: ((n: string) => void) | null = null;
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			capturedUpdate = deps.updateStreamBuffer;
			await turnBlocked;
			return { aborted: false };
		});

		const root = await repos.chats.createRoot({ title: 'Root' });
		await chatStore.load(root.id);

		// Stream starts under the default Standard preset (verbatim render).
		const sendP = chatStore.send('hello');
		await vi.waitFor(() => expect(capturedUpdate).not.toBeNull());
		const text = 'word '.repeat(40);
		capturedUpdate!(text);
		await vi.advanceTimersByTimeAsync(80);
		expect(chatStore.streamBufferRender).toBe(text);

		// Preset loads/switches to a paced preset mid-stream: the pacer has
		// never ticked, so it must fast-forward past the visible text.
		chatStore.setStreamPreset('expressive');
		await vi.advanceTimersByTimeAsync(80);
		expect(chatStore.streamBufferRender.length).toBeGreaterThanOrEqual(text.length - 12);
		expect(chatStore.streamBuffer.length).toBe(text.length);

		resolveTurn();
		await vi.advanceTimersByTimeAsync(2000);
		await sendP;
		expect(chatStore.streamPhase).toBe('idle');
	});
});

describe('chatStore usage persistence (023 T006+T016)', () => {
	afterEach(() => {
		if (baseRunAgentTurnImpl) {
			vi.mocked(runAgentTurn).mockImplementation(baseRunAgentTurnImpl);
		}
	});

	it('completed turn persists the provider-reported usage on the final assistant row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: { modelId: 'stub-model' } as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		mockedStreamText.mockReturnValue({
			textStream: (async function* () {
				yield 'Hello ';
				yield 'world';
			})(),
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'Hello ' };
				yield { type: 'text-delta', text: 'world' };
				yield {
					type: 'finish',
					finishReason: 'stop',
					totalUsage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 }
				};
			})(),
			text: 'Hello world',
			response: { id: 'test' }
		} as never);

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.kind === 'assistant_message');
		expect(assistant).toBeDefined();
		expect(assistant!.tokens).toBe(165);
		const meta = JSON.parse(assistant!.metadata!);
		expect(meta.usage).toEqual({
			promptTokens: 120,
			completionTokens: 45,
			totalTokens: 165,
			modelId: 'stub-model'
		});
	});

	it('aborted turn that never emitted usage writes nothing onto the assistant row', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
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

		await chatStore.load(root.id);
		void chatStore.send('hello');
		await vi.waitFor(() => expect(chatStore.streaming).toBe(true));
		chatStore.stop();
		resolveStream();
		await vi.waitFor(() => expect(chatStore.streaming).toBe(false));

		const msgs = await repos.messages.listByChat(root.id);
		const assistant = msgs.find((m) => m.kind === 'assistant_message');
		expect(assistant).toBeDefined();
		expect(assistant!.tokens).toBeNull();
		expect(assistant!.metadata).toBeNull();
	});

	it('multi-row turn persists usage on the final assistant_message, not an earlier one', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			await deps.appendAssistantText('first iteration', {});
			await deps.appendAssistantText('final iteration', {});
			deps.onTrace?.({
				kind: 'usage',
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				modelId: 'stub-model'
			});
			return { aborted: false };
		});

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		const assistants = msgs.filter((m) => m.kind === 'assistant_message');
		expect(assistants).toHaveLength(2);
		expect(assistants[0]!.content).toBe('first iteration');
		expect(assistants[0]!.tokens).toBeNull();
		expect(assistants[0]!.metadata).toBeNull();
		expect(assistants[1]!.content).toBe('final iteration');
		expect(assistants[1]!.tokens).toBe(15);
		expect(JSON.parse(assistants[1]!.metadata!).usage).toEqual({
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			modelId: 'stub-model'
		});
	});

	it('usage event without any assistant text row writes nothing', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockDefaultProvider();
		vi.mocked(runAgentTurn).mockImplementation(async (deps) => {
			deps.onTrace?.({
				kind: 'usage',
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				modelId: 'stub-model'
			});
			return { aborted: false };
		});

		await chatStore.load(root.id);
		await chatStore.send('hello');

		const msgs = await repos.messages.listByChat(root.id);
		expect(msgs.some((m) => m.kind === 'assistant_message')).toBe(false);
		expect(msgs.every((m) => m.tokens === null)).toBe(true);
	});

	it('a second turn moves the anchor: latest assistant row carries the new usage', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: { modelId: 'stub-model' } as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		const replyWithUsage = (totalTokens: number) =>
			mockedStreamText.mockReturnValue({
				textStream: (async function* () {
					yield 'reply';
				})(),
				fullStream: (async function* () {
					yield { type: 'text-delta', text: 'reply' };
					yield {
						type: 'finish',
						finishReason: 'stop',
						totalUsage: { promptTokens: totalTokens - 10, completionTokens: 10, totalTokens }
					};
				})(),
				text: 'reply',
				response: { id: 'test' }
			} as never);

		await chatStore.load(root.id);
		replyWithUsage(100);
		await chatStore.send('first');
		replyWithUsage(200);
		await chatStore.send('second');

		const msgs = await repos.messages.listByChat(root.id);
		const assistants = msgs.filter((m) => m.kind === 'assistant_message');
		expect(assistants).toHaveLength(2);
		expect(assistants[0]!.tokens).toBe(100);
		expect(JSON.parse(assistants[0]!.metadata!).usage.totalTokens).toBe(100);
		expect(assistants[1]!.tokens).toBe(200);
		expect(JSON.parse(assistants[1]!.metadata!).usage.totalTokens).toBe(200);

		await chatStore.load(root.id);
		const input = chatStore.contextGaugeInput;
		const usageCandidates = input.candidates.filter((c) => c.kind === 'assistant_message');
		expect(usageCandidates).toHaveLength(2);
		const gauge = deriveContextGauge({
			...input,
			activeModelId: 'stub-model',
			declaredWindow: null
		});
		expect(gauge.anchorMessageId).toBe(assistants[1]!.id);
		expect(gauge.usedTokens).toBe(200);
		expect(gauge.provenance).toBe('reported');
	});
});
