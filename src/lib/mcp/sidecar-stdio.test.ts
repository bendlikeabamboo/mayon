import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ai/keystore/browser', () => ({
	createBrowserKeyStore: vi.fn().mockReturnValue({
		get: vi.fn().mockResolvedValue('secret-value'),
		has: vi.fn(),
		set: vi.fn(),
		delete: vi.fn()
	})
}));

vi.mock('$lib/sidecar/status.svelte', () => ({
	sidecarStatus: {
		has: vi.fn().mockReturnValue(true),
		connected: true,
		caps: ['stdio-mcp'],
		version: '0.0.1',
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

import { SidecarStdioMcpTransport } from './sidecar-stdio';
import { createBrowserKeyStore } from '$lib/ai/keystore/browser';
import { sidecarStatus } from '$lib/sidecar/status.svelte';
import { MissingKeyError } from '$lib/ai/types';

class FakeWS extends EventTarget {
	send = vi.fn();
	close = vi.fn();
}

function makeConfig(
	overrides?: Partial<import('./types').McpServerConfig>
): import('./types').McpServerConfig {
	return {
		id: 'test-server',
		name: 'Test',
		transport: 'stdio',
		command: 'node',
		args: ['-e', '1'],
		env: { KEY: { secretRef: 'mcp:test-server:KEY' } },
		enabled: true,
		callTimeoutMs: 5000,
		createdAt: Date.now(),
		...overrides
	};
}

function getStore() {
	return createBrowserKeyStore() as ReturnType<typeof createBrowserKeyStore> & {
		get: ReturnType<typeof vi.fn>;
	};
}

function dispatch(ws: FakeWS, data: Record<string, unknown>) {
	ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
}

describe('SidecarStdioMcpTransport', () => {
	let ws: FakeWS;

	beforeEach(() => {
		ws = new FakeWS();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('start() resolves env secrets and sends spawn frame', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		const startPromise = transport.start();
		await new Promise<void>((r) => setTimeout(r, 0));

		const store = getStore();
		expect(store.get).toHaveBeenCalledWith('mcp:test-server:KEY');

		expect(ws.send).toHaveBeenCalled();
		const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
		expect(sent.kind).toBe('spawn');
		expect(sent.spawn.env.KEY).toBe('secret-value');

		dispatch(ws, { kind: 'spawned', serverId: 'test-server' });

		const info = await startPromise;
		expect(info).toEqual({ name: 'stdio-server', version: '0.0.0' });
	});

	it('start() throws MissingKeyError when secret is missing', async () => {
		const store = getStore();
		store.get.mockResolvedValueOnce(null);

		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await expect(transport.start()).rejects.toThrow(MissingKeyError);
	});

	it('start() rejects on exit frame', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		const startPromise = transport.start();
		await new Promise<void>((r) => setTimeout(r, 0));

		dispatch(ws, {
			kind: 'exit',
			serverId: 'test-server',
			code: -1,
			data: 'ENOENT'
		});

		await expect(startPromise).rejects.toThrow('ENOENT');
	});

	it('start() throws when sidecar not connected', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValueOnce(false);

		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await expect(transport.start()).rejects.toThrow('stdio MCP servers require the Mayon sidecar');
	});

	it('request() resolves on matching stdout frame', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await completeStart(transport);

		const requestPromise = transport.request('initialize', {
			protocolVersion: '2025-06-18'
		});

		const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1];
		const sent = JSON.parse(lastCall[0] as string);
		expect(sent.kind).toBe('stdin');
		const envelope = JSON.parse(sent.data as string);
		expect(envelope.method).toBe('initialize');
		const requestId = envelope.id;

		dispatch(ws, {
			kind: 'stdout',
			serverId: 'test-server',
			data: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId,
				result: { serverInfo: { name: 'test', version: '1.0' } }
			})
		});

		const result = await requestPromise;
		expect((result as Record<string, unknown>).serverInfo).toBeDefined();
	});

	it('request() rejects on error response', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await completeStart(transport);

		const requestPromise = transport.request('tools/call', {
			name: 'echo',
			arguments: {}
		});

		const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1];
		const sent = JSON.parse(lastCall[0] as string);
		const envelope = JSON.parse(sent.data as string);
		const requestId = envelope.id;

		dispatch(ws, {
			kind: 'stdout',
			serverId: 'test-server',
			data: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId,
				error: { code: -32601, message: 'Method not found' }
			})
		});

		await expect(requestPromise).rejects.toThrow('Method not found');
	});

	it('notification routing: no id -> onNotification', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		const notifHandler = vi.fn();
		transport.onNotification(notifHandler);

		await completeStart(transport);

		dispatch(ws, {
			kind: 'stdout',
			serverId: 'test-server',
			data: JSON.stringify({
				jsonrpc: '2.0',
				method: 'notifications/tools/list_changed'
			})
		});

		expect(notifHandler).toHaveBeenCalledWith({
			method: 'notifications/tools/list_changed',
			params: undefined
		});
	});

	it('server request: id + method -> onRequest', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		const reqHandler = vi.fn();
		transport.onRequest(reqHandler);

		await completeStart(transport);

		dispatch(ws, {
			kind: 'stdout',
			serverId: 'test-server',
			data: JSON.stringify({
				jsonrpc: '2.0',
				id: 99,
				method: 'ping',
				params: {}
			})
		});

		expect(reqHandler).toHaveBeenCalledWith({
			id: 99,
			method: 'ping',
			params: {}
		});
	});

	it('respond() writes JSON-RPC reply to stdin', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await completeStart(transport);
		ws.send.mockClear();

		transport.respond(99, { pong: true });

		expect(ws.send).toHaveBeenCalledTimes(1);
		const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
		expect(sent.kind).toBe('stdin');
		const envelope = JSON.parse(sent.data as string);
		expect(envelope.id).toBe(99);
		expect(envelope.result).toEqual({ pong: true });
	});

	it('callTimeoutMs expiry rejects pending request', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig({ callTimeoutMs: 100 }),
			wsFactory: () => ws as unknown as WebSocket
		});

		await completeStart(transport);

		await expect(transport.request('slow/method')).rejects.toThrow('request timeout: slow/method');

		await transport.close();
	});

	it('close() sends kill, closes WS, rejects remaining pending', async () => {
		const transport = new SidecarStdioMcpTransport({
			config: makeConfig(),
			wsFactory: () => ws as unknown as WebSocket
		});

		await completeStart(transport);
		ws.send.mockClear();

		const pending = transport.request('tools/call', {
			name: 'echo',
			arguments: { message: 'hi' }
		});

		await transport.close();

		expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ kind: 'kill', serverId: 'test-server' }));
		expect(ws.close).toHaveBeenCalled();

		await expect(pending).rejects.toThrow('transport closed');
	});

	async function completeStart(transport: SidecarStdioMcpTransport): Promise<void> {
		const p = transport.start();
		await new Promise<void>((r) => setTimeout(r, 0));
		dispatch(ws, { kind: 'spawned', serverId: 'test-server' });
		await p;
	}
});
