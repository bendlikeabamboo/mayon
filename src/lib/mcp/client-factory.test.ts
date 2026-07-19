import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ai/keystore/browser', () => ({
	createBrowserKeyStore: () => ({
		get: vi.fn(),
		has: vi.fn(),
		set: vi.fn(),
		delete: vi.fn()
	})
}));

vi.mock('$lib/services/status.svelte', () => ({
	serverStatus: { has: vi.fn().mockReturnValue(false) }
}));

import { createMcpTransport } from './client-factory';
import { HttpMcpTransport } from './http';
import { ServerStdioMcpTransport } from './server-stdio';
import { serverStatus } from '$lib/services/status.svelte';

describe('createMcpTransport', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('throws "requires server" for stdio config when server not connected', () => {
		vi.mocked(serverStatus.has).mockReturnValue(false);
		expect(() =>
			createMcpTransport({
				id: 's1',
				name: 'Test',
				transport: 'stdio',
				command: 'node',
				args: ['-e', '1'],
				enabled: false,
				createdAt: Date.now()
			})
		).toThrow('stdio MCP servers require the Mayon server');
	});

	it('returns ServerStdioMcpTransport for stdio config when server connected', () => {
		vi.mocked(serverStatus.has).mockReturnValue(true);
		const transport = createMcpTransport({
			id: 's1',
			name: 'Test',
			transport: 'stdio',
			command: 'node',
			args: ['-e', '1'],
			enabled: false,
			createdAt: Date.now()
		});
		expect(transport).toBeInstanceOf(ServerStdioMcpTransport);
	});

	it('returns HttpMcpTransport for http config with url', () => {
		const transport = createMcpTransport({
			id: 'h1',
			name: 'HTTP Server',
			transport: 'http',
			url: 'https://mcp.example.com/mcp',
			enabled: false,
			createdAt: Date.now()
		});
		expect(transport).toBeInstanceOf(HttpMcpTransport);
	});

	it('throws when http config has no url', () => {
		expect(() =>
			createMcpTransport({
				id: 'h3',
				name: 'No URL',
				transport: 'http',
				enabled: false,
				createdAt: Date.now()
			})
		).toThrow('MCP server URL is required');
	});

	it('throws for unsupported transport', () => {
		expect(() =>
			createMcpTransport({
				id: 'x1',
				name: 'Bad',
				transport: 'websocket' as 'stdio' | 'http',
				enabled: false,
				createdAt: Date.now()
			})
		).toThrow('Unsupported transport: websocket');
	});
});
