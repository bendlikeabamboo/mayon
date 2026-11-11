import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '#lib/db/driver/pg-test.js';
import { repos } from '#lib/db/index.js';
import type { ProviderConfig } from '#lib/ai/types.js';
import type { LanguageModel } from 'ai';
import { fileURLToPath } from 'node:url';
import { chatStore } from '../stores/chat.svelte';
import { toastState } from '../stores/toasts.svelte';

// The composed backprop end-states migrated from
// tests/e2e/backprop-tool.spec.ts (specs/031-split-text-e2e-tests T007–T009):
// seed via repos, drive the real store turn pipeline with a scripted model,
// assert the persisted rows/traces. Fixture texts come from the single-source
// strings module (contracts/shared-fixtures.md) — never re-typed here.

if (typeof requestAnimationFrame === 'undefined') {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(() => cb(Date.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
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

vi.mock('#lib/ai/client.js', () => ({
	getActiveSdkProvider: vi.fn()
}));

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

// toolsRun is spied with call-through so the declined-turn test can prove the
// tool executor is never entered (the loop synthesizes the declined result
// without running the tool).
vi.mock('#lib/agent/registry.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/agent/registry.js')>();
	return { ...actual, toolsRun: vi.fn(actual.toolsRun) };
});

const { getActiveSdkProvider } = await import('#lib/ai/client.js');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);
const { streamText, generateObject } = await import('ai');
const mockedStreamText = vi.mocked(streamText);
const mockedGenerateObject = vi.mocked(generateObject);
const { toolsRun } = await import('#lib/agent/registry.js');
const mockedToolsRun = vi.mocked(toolsRun);

// Fixture strings module lives under tsconfig-excluded tests/ — load by file
// URL (precedent: src/lib/ai/generate/classification-markers.test.ts).
const strings = await import(
	fileURLToPath(new URL('../../../tests/fixtures/mock-llm/strings.mjs', import.meta.url))
);

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
	toolCapability: 'on'
};

function mockToolsProvider(): void {
	mockedGetActiveSdkProvider.mockResolvedValue({
		model: {} as LanguageModel,
		config: stubConfig,
		toolCapability: true
	});
}

function scriptedFullStream(
	parts: Array<{ type: string; [k: string]: unknown }>
): AsyncIterable<unknown> {
	return (async function* () {
		for (const p of parts) yield p;
	})();
}

function mockStreamReply(text: string): void {
	mockedStreamText.mockReturnValue({
		fullStream: scriptedFullStream([
			{ type: 'text-delta', text },
			{ type: 'finish', finishReason: 'stop' }
		])
	} as never);
}

function mockStreamToolCallThenReply(toolName: string, args: unknown, continuation: string): void {
	mockedStreamText
		.mockReturnValueOnce({
			fullStream: scriptedFullStream([
				{ type: 'tool-call', toolCallId: 'tc-prop', toolName, args },
				{ type: 'finish', finishReason: 'tool-calls' }
			])
		} as never)
		.mockReturnValueOnce({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: continuation },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);
}

beforeEach(() => {
	mockedGetActiveSdkProvider.mockReset();
	mockedStreamText.mockReset();
	mockedGenerateObject.mockReset();
	mockedToolsRun.mockClear();
	connectSessionMock.mockReset();
	connectSessionMock.mockImplementation(async () => ({ clients: new Map(), unmountAll: () => {} }));
});

async function countRows(chatId: string): Promise<number> {
	return (await repos.messages.listByChat(chatId)).length;
}

/** Root with one exchange, plus a branch child carrying its own exchange. */
async function seedBranchWithExchange(): Promise<{ parentId: string; childId: string }> {
	const parent = await repos.chats.createRoot({ title: 'Root' });
	await repos.messages.append(parent.id, 'user', 'root question');
	await repos.messages.append(parent.id, 'assistant', 'root answer');
	const child = await repos.chats.createChild({ parentId: parent.id, title: 'Branch' });
	await repos.messages.append(child.id, 'user', 'branch question');
	await repos.messages.append(child.id, 'assistant', 'branch answer');
	await chatStore.load(child.id);
	return { parentId: parent.id, childId: child.id };
}

describe('backprop offer-turn end-state (031 US1)', () => {
	it('offer trigger turn persists exactly +2 durable rows (user + plain offer reply), zero approval asks, nothing in the parent', async () => {
		const { parentId, childId } = await seedBranchWithExchange();
		mockToolsProvider();
		const rowsBefore = await countRows(childId);

		mockStreamReply(strings.OFFER_REPLY);
		await chatStore.send(`Wrapping up — ${strings.OFFER_TRIGGER}.`);

		const rows = await repos.messages.listByChat(childId);
		expect(rows).toHaveLength(rowsBefore + 2);
		expect(rows.slice(rowsBefore).map((r) => r.kind)).toEqual([
			'user_message',
			'assistant_message'
		]);
		expect(rows[rowsBefore + 1]!.content).toBe(strings.OFFER_REPLY);

		// The offer is plain prose: no approval ask row, no tool rows of any
		// kind, and nothing pending.
		for (const r of rows) {
			expect(r.kind).not.toBe('approval');
			expect(r.kind).not.toBe('tool_call');
			expect(r.kind).not.toBe('tool_result');
		}
		expect(chatStore.pendingApprovals).toHaveLength(0);

		// Parent chat untouched: its transcript is unchanged and no
		// branch_artifact row landed there.
		const parentRows = await repos.messages.listByChat(parentId);
		expect(parentRows.map((r) => r.content)).toEqual(['root question', 'root answer']);
		expect(parentRows.some((r) => r.kind === 'branch_artifact')).toBe(false);
	});

	it('a following plain turn never re-emits the offer: the transcript keeps exactly one offer row', async () => {
		const { childId } = await seedBranchWithExchange();
		mockToolsProvider();

		mockStreamReply(strings.OFFER_REPLY);
		await chatStore.send(`Wrapping up — ${strings.OFFER_TRIGGER}.`);

		const rowsBeforeFollowUp = await countRows(childId);
		mockStreamReply('Plain follow-up reply.');
		await chatStore.send('continue please');

		const rows = await repos.messages.listByChat(childId);
		expect(rows).toHaveLength(rowsBeforeFollowUp + 2);
		expect(rows.slice(rowsBeforeFollowUp).map((r) => r.kind)).toEqual([
			'user_message',
			'assistant_message'
		]);
		// Exactly one offer row survives the follow-up turn, and the follow-up
		// reply itself is not a second offer.
		expect(rows.filter((r) => r.content === strings.OFFER_REPLY)).toHaveLength(1);
		expect(rows[rows.length - 1]!.content).not.toBe(strings.OFFER_REPLY);
		expect(rows.some((r) => r.kind === 'approval')).toBe(false);
	});
});

describe('backprop declined-turn end-state (031 US1)', () => {
	it('declined propagate call persists the declined tool result and ask decision without ever invoking toolsRun', async () => {
		const { parentId, childId } = await seedBranchWithExchange();
		mockToolsProvider();
		const rowsBefore = await countRows(childId);
		const streamCallsBefore = mockedStreamText.mock.calls.length;

		// 038 US3 (FR-005): the toast layer must stay empty across the whole
		// declined journey — the store tier is the authoritative no-toast proof
		// (037's "toast never lies" guarantee), observed on the same
		// `toastState` singleton the store pushes into.
		toastState.clear();
		expect(toastState.toasts).toHaveLength(0);

		mockStreamToolCallThenReply(
			strings.PROPAGATE_TOOL_NAME,
			JSON.parse(strings.PROPAGATE_TOOL_ARGS),
			'Continuing without propagating.'
		);
		const turn = chatStore.send(`I'm done here — ${strings.PROPAGATE_TRIGGER}.`);
		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));
		expect(toastState.toasts).toHaveLength(0);
		chatStore.decline(chatStore.pendingApprovals[0]!.toolCallId);
		await turn;

		// Declining pushed nothing: no toast at ask time, and none after the
		// continuation settles the turn.
		expect(toastState.toasts).toHaveLength(0);

		// The tool executor was never entered: the loop synthesized the
		// declined result itself.
		expect(mockedToolsRun).not.toHaveBeenCalled();

		const rows = await repos.messages.listByChat(childId);
		expect(rows).toHaveLength(rowsBefore + 5);
		expect(rows.slice(rowsBefore).map((r) => r.kind)).toEqual([
			'user_message',
			'tool_call',
			'approval',
			'tool_result',
			'assistant_message'
		]);

		// The ask row persisted the declined decision (no undecided ask).
		const ask = rows.find((r) => r.kind === 'approval')!;
		expect(ask.toolName).toBe(strings.PROPAGATE_TOOL_NAME);
		expect(JSON.parse(ask.metadata!).outcome).toEqual({ decision: 'declined' });

		// The declined tool result is the durable row: tool identity + the
		// loop's synthesized summary.
		const declined = rows.find((r) => r.kind === 'tool_result')!;
		expect(declined.toolName).toBe(strings.PROPAGATE_TOOL_NAME);
		expect(declined.content).toBe('user declined');

		// Exactly two LLM calls: the tool-call iteration and the continuation
		// off the declined result — a re-run would need a third.
		expect(mockedStreamText.mock.calls.length - streamCallsBefore).toBe(2);
		expect(chatStore.pendingApprovals).toHaveLength(0);

		// Nothing landed in the parent.
		const parentRows = await repos.messages.listByChat(parentId);
		expect(parentRows.map((r) => r.content)).toEqual(['root question', 'root answer']);
		expect(parentRows.some((r) => r.kind === 'branch_artifact')).toBe(false);
	});

	it('the loop is never re-asked: one decided ask row and no ask after the continuation settles', async () => {
		const { childId } = await seedBranchWithExchange();
		mockToolsProvider();

		mockStreamToolCallThenReply(
			strings.PROPAGATE_TOOL_NAME,
			JSON.parse(strings.PROPAGATE_TOOL_ARGS),
			'Continuing without propagating.'
		);
		const turn = chatStore.send(`I'm done here — ${strings.PROPAGATE_TRIGGER}.`);
		await vi.waitFor(() => expect(chatStore.pendingApprovals).toHaveLength(1));
		chatStore.decline(chatStore.pendingApprovals[0]!.toolCallId);
		await turn;

		const rows = await repos.messages.listByChat(childId);
		const asks = rows.filter((r) => r.kind === 'approval');
		expect(asks).toHaveLength(1);
		expect(JSON.parse(asks[0]!.metadata!).outcome).toEqual({ decision: 'declined' });
		expect(chatStore.pendingApprovals).toHaveLength(0);
		expect(chatStore.liveItems).toHaveLength(0);
	});
});

describe('backprop root-trigger end-state (031 US1)', () => {
	it('root trigger turn persists the propagate_unavailable plain reply with zero ask rows', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(root.id, 'user', 'first question');
		await repos.messages.append(root.id, 'assistant', 'first answer');
		mockToolsProvider();
		mockStreamReply('First reply.');
		await chatStore.load(root.id);
		await chatStore.send('hello');

		const rowsBeforeTrigger = await countRows(root.id);
		mockStreamReply(strings.PROPAGATE_UNAVAILABLE_REPLY);
		const streamCallsBefore = mockedStreamText.mock.calls.length;
		await chatStore.send(`Wrap up — ${strings.PROPAGATE_TRIGGER}.`);

		// The manual-control sentence is a plain reply that ends the turn in
		// one LLM call — no tool round trip, no continuation.
		expect(mockedStreamText.mock.calls.length - streamCallsBefore).toBe(1);

		const rows = await repos.messages.listByChat(root.id);
		expect(rows).toHaveLength(rowsBeforeTrigger + 2);
		expect(rows.slice(rowsBeforeTrigger).map((r) => r.kind)).toEqual([
			'user_message',
			'assistant_message'
		]);
		expect(rows[rows.length - 1]!.content).toBe(strings.PROPAGATE_UNAVAILABLE_REPLY);
		for (const r of rows) {
			expect(r.kind).not.toBe('approval');
		}
		expect(chatStore.pendingApprovals).toHaveLength(0);
	});

	it("the trigger turn's request carries a tool set that excludes propagate_to_parent", async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(root.id, 'user', 'first question');
		await repos.messages.append(root.id, 'assistant', 'first answer');
		mockToolsProvider();
		mockStreamReply('First reply.');
		await chatStore.load(root.id);
		await chatStore.send('hello');

		mockStreamReply(strings.PROPAGATE_UNAVAILABLE_REPLY);
		await chatStore.send(`Wrap up — ${strings.PROPAGATE_TRIGGER}.`);

		const replyRow = (await repos.messages.listByChat(root.id)).find(
			(r) => r.content === strings.PROPAGATE_UNAVAILABLE_REPLY
		)!;

		// Persisted agent trace (current post-rebase shape): the trigger turn's
		// single iteration requests tools, and propagate_to_parent is absent
		// while the rest of the standard set is present.
		const traces = await repos.agentTraces.listByChat(root.id);
		// Trigger-turn chat trace: linked by the persisted event's messageId
		// inside the trace JSON (the assistantMessageId column is best-effort).
		const turnTrace = JSON.parse(
			traces.find((t) => {
				if (t.kind !== 'chat') return false;
				const parsed = JSON.parse(t.trace) as { persisted?: { messageId?: string } | null };
				return parsed.persisted?.messageId === replyRow.id;
			})!.trace
		) as {
			iterations: Array<{ request: { tools: string[] }; toolCalls: unknown[] }>;
		};
		expect(turnTrace.iterations).toHaveLength(1);
		const tools = turnTrace.iterations[0]!.request.tools;
		expect(tools.length).toBeGreaterThan(0);
		expect(tools).not.toContain(strings.PROPAGATE_TOOL_NAME);
		expect(turnTrace.iterations[0]!.toolCalls).toHaveLength(0);

		// Same exclusion on the actual SDK wire call.
		const wireTools = Object.keys(
			mockedStreamText.mock.calls[mockedStreamText.mock.calls.length - 1]![0].tools as object
		);
		expect(wireTools.length).toBeGreaterThan(0);
		expect(wireTools).not.toContain(strings.PROPAGATE_TOOL_NAME);
	});
});
