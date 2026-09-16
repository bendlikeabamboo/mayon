import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { fileURLToPath } from 'node:url';
import type { Message } from '$lib/db/schema';
import type { ProviderConfig } from '$lib/ai/types';
import type { TraceEvent } from '$lib/agent/trace';
import type { McpServerConfig } from './types';

vi.mock('$lib/services/status.svelte', () => ({
	serverStatus: {
		has: vi.fn().mockReturnValue(true),
		connected: true,
		caps: ['stdio-mcp'],
		version: '0.0.1',
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

vi.mock('$lib/ai/keystore/browser', () => ({
	createBrowserKeyStore: vi.fn().mockReturnValue({
		get: vi.fn().mockResolvedValue('secret-value'),
		has: vi.fn(),
		set: vi.fn(),
		delete: vi.fn()
	})
}));

const wsState: { url: string } = { url: 'ws://127.0.0.1:1/ws/mcp' };

vi.mock('$lib/services/client', () => ({
	serverClient: {
		http: vi.fn(),
		ws: (): WebSocket => new WebSocket(wsState.url)
	}
}));

vi.mock('ai', () => {
	return {
		streamText: vi.fn(),
		tool: vi.fn(() => ({})),
		jsonSchema: vi.fn((s) => s),
		APICallError: class APICallError extends Error {
			statusCode: number;
			constructor(msg: string, opts?: { statusCode?: number }) {
				super(msg);
				this.statusCode = opts?.statusCode ?? 0;
			}
		}
	};
});

const { streamText } = await import('ai');
const mockedStreamText = vi.mocked(streamText);

const { connectSession } = await import('./lifecycle');
const { getToolDefinitions } = await import('$lib/agent/registry');
const { runAgentTurn } = await import('$lib/agent/loop');
const { trustNow } = await import('./trust');

// Server-package modules: outside the app tsconfig root, so svelte-check
// cannot resolve them — vitest resolves and transforms them at runtime.
// @ts-expect-error server-package module (see note above)
const { registerMcpBridge } = await import('../../../../server/src/mcp');
// @ts-expect-error server-package dependency (see note above)
const fastifyMod = await import('../../../../server/node_modules/fastify');
// @ts-expect-error server-package dependency (see note above)
const wsPluginMod = await import('../../../../server/node_modules/@fastify/websocket');
const fastify = fastifyMod.default;
const websocketPlugin = wsPluginMod.default;

const HANG_FIXTURE = fileURLToPath(
	new URL('../../../tests/fixtures/hang-mcp-server.mjs', import.meta.url)
);
const DIE_FIXTURE = fileURLToPath(
	new URL('../../../tests/fixtures/die-on-call-mcp-server.mjs', import.meta.url)
);
const STUB_FIXTURE = fileURLToPath(
	new URL('../../../tests/fixtures/stub-mcp-server.mjs', import.meta.url)
);

/** Structural slice of the fastify app the bridge + test harness rely on. */
interface BridgeApp {
	register(plugin: unknown): Promise<void>;
	listen(opts: { port: number; host: string }): Promise<void>;
	close(): Promise<void>;
	server: { address(): { port: number } | string | null };
}

let app: BridgeApp;

function scriptedFullStream(parts: Array<Record<string, unknown>>): AsyncIterable<unknown> {
	return (async function* () {
		for (const p of parts) yield p;
	})();
}

/** Queue of scripted streamText calls; exhausted queue falls back to plain text. */
function scriptStreams(calls: Array<Array<Record<string, unknown>>>): void {
	const queue = [...calls];
	mockedStreamText.mockImplementation((() => {
		const parts = queue.shift() ?? [
			{ type: 'text-delta', text: 'fallback reply' },
			{ type: 'finish', finishReason: 'stop', usage: {} }
		];
		return { fullStream: scriptedFullStream(parts) };
	}) as never);
}

function mcpConfig(
	id: string,
	command: string,
	args: string[],
	callTimeoutMs = 800
): Promise<McpServerConfig> {
	return trustNow({
		id,
		name: id,
		transport: 'stdio',
		command,
		args,
		enabled: true,
		callTimeoutMs,
		createdAt: Date.now()
	});
}

interface RecordedTurn {
	messages: Message[];
	traces: TraceEvent[];
}

function turnDeps(chatId: string): {
	deps: import('$lib/agent/loop').AgentTurnDeps;
	rec: RecordedTurn;
} {
	const rec: RecordedTurn = { messages: [], traces: [] };
	let ord = 0;
	function row(partial: Record<string, unknown>): Message {
		return {
			id: crypto.randomUUID(),
			chatId,
			role: 'assistant',
			content: '',
			ord: ord++,
			model: null,
			createdAt: Date.now(),
			tokens: null,
			toolCallId: null,
			toolName: null,
			metadata: null,
			...partial
		} as unknown as Message;
	}
	const deps: import('$lib/agent/loop').AgentTurnDeps = {
		model: {} as LanguageModel,
		config: {
			id: 'test',
			kind: 'openai-compatible',
			name: 'T',
			baseUrl: '',
			defaultModel: 'm',
			models: ['m']
		} as ProviderConfig,
		chatId,
		rootChatId: chatId,
		signal: new AbortController().signal,
		effort: 'on',
		updateStreamBuffer: vi.fn(),
		updateReasoningBuffer: vi.fn(),
		appendAssistantText: vi.fn(async (content) => {
			const m = row({ content });
			rec.messages.push(m);
			return m;
		}),
		appendAssistantToolCall: vi.fn(async (p) => {
			const m = row({ toolCallId: p.toolCallId, toolName: p.toolName });
			rec.messages.push(m);
			return m;
		}),
		appendToolResult: vi.fn(async (r) => {
			const m = row({
				role: 'tool',
				content: r.summary,
				toolCallId: r.toolCallId,
				toolName: r.toolName
			});
			rec.messages.push(m);
			return m;
		}),
		reassembleContext: vi.fn(async () => []),
		requestApproval: vi.fn(async () => ({ approved: true })),
		notifyLowRisk: vi.fn(),
		appendReasoning: vi.fn(async (text) => {
			rec.messages.push(row({ kind: 'reasoning', content: text }));
		}),
		onTrace: (e) => rec.traces.push(e)
	};
	return { deps, rec };
}

beforeAll(async () => {
	app = fastify({ logger: false }) as unknown as BridgeApp;
	await app.register(websocketPlugin);
	registerMcpBridge(app as never);
	await app.listen({ port: 0, host: '127.0.0.1' });
	const addr = app.server.address();
	const port = typeof addr === 'object' && addr ? addr.port : 0;
	wsState.url = `ws://127.0.0.1:${port}/ws/mcp`;
});

afterAll(async () => {
	await app.close();
});

describe('agent turn over the real stdio MCP bridge', () => {
	it(
		'completes the turn when the MCP tool never answers (tool result timeout)',
		{ timeout: 20_000 },
		async () => {
			const config = await mcpConfig('hangsrv', 'node', [HANG_FIXTURE]);
			const traces: TraceEvent[] = [];
			const session = await connectSession([config], (e) => traces.push(e));

			try {
				expect(session.clients.has('hangsrv')).toBe(true);
				expect(getToolDefinitions().some((d) => d.id === 'mcp.hangsrv.stuck')).toBe(true);

				scriptStreams([
					[
						{ type: 'reasoning-delta', text: 'let me search' },
						{
							type: 'tool-call',
							toolCallId: 'tc1',
							toolName: 'mcp.hangsrv.stuck',
							input: { message: 'q' }
						},
						{ type: 'finish', finishReason: 'tool-calls', usage: {} }
					],
					[
						{ type: 'text-delta', text: 'Recovered after tool failure.' },
						{ type: 'finish', finishReason: 'stop', usage: {} }
					]
				]);

				const { deps, rec } = turnDeps('chat-hang');
				const result = await runAgentTurn(deps);

				expect(result.aborted).toBe(false);
				const kinds = rec.messages.map((m) => (m as unknown as { kind?: string }).kind ?? m.role);
				expect(kinds).toContain('reasoning');
				const toolResult = rec.messages.find((m) => m.role === 'tool');
				expect(toolResult?.content).toMatch(/timed out/i);
				const final = rec.messages.filter((m) => m.role === 'assistant' && m.content);
				expect(final.at(-1)?.content).toBe('Recovered after tool failure.');
			} finally {
				session.unmountAll();
			}
		}
	);

	it(
		'fails the tool fast with the real reason when the MCP child dies mid-turn',
		{ timeout: 20_000 },
		async () => {
			const config = await mcpConfig('diesrv', 'node', [DIE_FIXTURE]);
			const traces: TraceEvent[] = [];
			const session = await connectSession([config], (e) => traces.push(e));

			try {
				expect(session.clients.has('diesrv')).toBe(true);
				expect(getToolDefinitions().some((d) => d.id === 'mcp.diesrv.die')).toBe(true);

				scriptStreams([
					[
						{ type: 'reasoning-delta', text: 'searching' },
						{
							type: 'tool-call',
							toolCallId: 'tc1',
							toolName: 'mcp.diesrv.die',
							input: { message: 'q' }
						},
						{ type: 'finish', finishReason: 'tool-calls', usage: {} }
					],
					[
						{ type: 'text-delta', text: 'Recovered after server crash.' },
						{ type: 'finish', finishReason: 'stop', usage: {} }
					]
				]);

				const { deps, rec } = turnDeps('chat-die');
				const started = Date.now();
				const result = await runAgentTurn(deps);

				expect(result.aborted).toBe(false);
				const toolResult = rec.messages.find((m) => m.role === 'tool');
				expect(toolResult?.content).toMatch(/MCP server exited \(code 7\)/);
				// The exit frame must reject the pending call immediately, not wait
				// out the 800ms callTimeoutMs (let alone the 30s default).
				expect(Date.now() - started).toBeLessThan(700);
				const final = rec.messages.filter((m) => m.role === 'assistant' && m.content);
				expect(final.at(-1)?.content).toBe('Recovered after server crash.');
			} finally {
				session.unmountAll();
			}
		}
	);

	it(
		'fails the spawn fast when a bare command is not on PATH (no absolute-path requirement)',
		{ timeout: 20_000 },
		async () => {
			const config = await mcpConfig(
				'npxsrv',
				'mayon-definitely-not-a-command',
				[],
				5000 // generous: the failure must be immediate, not a timeout
			);
			const traces: TraceEvent[] = [];
			const started = Date.now();
			const session = await connectSession([config], (e) => traces.push(e));

			try {
				expect(session.clients.has('npxsrv')).toBe(false);
				const lifecycle = traces.filter((e) => e.kind === 'mcp-lifecycle');
				expect(lifecycle).toHaveLength(1);
				const err = lifecycle[0] as { action?: string; detail?: string };
				expect(err.action).toBe('error');
				expect(err.detail).toMatch(/command not found in PATH: mayon-definitely-not-a-command/);
				expect(Date.now() - started).toBeLessThan(2500);
			} finally {
				session.unmountAll();
			}
		}
	);

	it(
		'resolves a bare command (node) through PATH and completes a real tool round-trip',
		{ timeout: 20_000 },
		async () => {
			const config = await mcpConfig('stubsrv', 'node', [STUB_FIXTURE]);
			const traces: TraceEvent[] = [];
			const session = await connectSession([config], (e) => traces.push(e));

			try {
				expect(session.clients.has('stubsrv')).toBe(true);
				expect(getToolDefinitions().some((d) => d.id === 'mcp.stubsrv.echo')).toBe(true);

				scriptStreams([
					[
						{ type: 'reasoning-delta', text: 'echoing' },
						{
							type: 'tool-call',
							toolCallId: 'tc1',
							toolName: 'mcp.stubsrv.echo',
							input: { message: 'round-trip' }
						},
						{ type: 'finish', finishReason: 'tool-calls', usage: {} }
					],
					[
						{ type: 'text-delta', text: 'Echo came back.' },
						{ type: 'finish', finishReason: 'stop', usage: {} }
					]
				]);

				const { deps, rec } = turnDeps('chat-stub');
				const result = await runAgentTurn(deps);

				expect(result.aborted).toBe(false);
				const toolResult = rec.messages.find((m) => m.role === 'tool');
				expect(toolResult?.content).toContain('round-trip');
				const final = rec.messages.filter((m) => m.role === 'assistant' && m.content);
				expect(final.at(-1)?.content).toBe('Echo came back.');
			} finally {
				session.unmountAll();
			}
		}
	);

	it(
		'completes the turn when the MCP child dies at spawn (connect fails, tool unknown)',
		{ timeout: 20_000 },
		async () => {
			const config = await mcpConfig('deadsrv', 'node', ['-e', 'process.exit(3)']);
			const traces: TraceEvent[] = [];
			const started = Date.now();
			const session = await connectSession([config], (e) => traces.push(e));

			try {
				expect(session.clients.has('deadsrv')).toBe(false);
				expect(getToolDefinitions().some((d) => d.id === 'mcp.deadsrv.stuck')).toBe(false);
				const lifecycle = traces.filter((e) => e.kind === 'mcp-lifecycle');
				expect(lifecycle).toHaveLength(1);
				expect((lifecycle[0] as { action?: string }).action).toBe('error');
				// Bounded by callTimeoutMs, not an unbounded wait.
				expect(Date.now() - started).toBeLessThan(10_000);

				scriptStreams([
					[
						{ type: 'reasoning-delta', text: 'want to search' },
						{
							type: 'tool-call',
							toolCallId: 'tc1',
							toolName: 'mcp.deadsrv.stuck',
							input: { message: 'q' }
						},
						{ type: 'finish', finishReason: 'tool-calls', usage: {} }
					],
					[
						{ type: 'text-delta', text: 'Reply without the tool.' },
						{ type: 'finish', finishReason: 'stop', usage: {} }
					]
				]);

				const { deps, rec } = turnDeps('chat-dead');
				const result = await runAgentTurn(deps);

				expect(result.aborted).toBe(false);
				const toolResult = rec.messages.find((m) => m.role === 'tool');
				expect(toolResult?.content).toMatch(/unknown tool/i);
				const final = rec.messages.filter((m) => m.role === 'assistant' && m.content);
				expect(final.at(-1)?.content).toBe('Reply without the tool.');
			} finally {
				session.unmountAll();
			}
		}
	);
});
