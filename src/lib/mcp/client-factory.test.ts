import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ai/keystore/browser', () => ({
	createBrowserKeyStore: () => ({
		get: vi.fn(),
		has: vi.fn(),
		set: vi.fn(),
		delete: vi.fn()
	})
}));

vi.mock('$lib/sidecar/status.svelte', () => ({
	sidecarStatus: { has: vi.fn().mockReturnValue(false) }
}));

import { createMcpTransport } from './client-factory';
import { HttpMcpTransport } from './http';
import { SidecarStdioMcpTransport } from './sidecar-stdio';
import { sidecarStatus } from '$lib/sidecar/status.svelte';

describe('createMcpTransport', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('throws "requires sidecar" for stdio config when sidecar not connected', () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(false);
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
		).toThrow('stdio MCP servers require the Mayon sidecar');
	});

	it('returns SidecarStdioMcpTransport for stdio config when sidecar connected', () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(true);
		const transport = createMcpTransport({
			id: 's1',
			name: 'Test',
			transport: 'stdio',
			command: 'node',
			args: ['-e', '1'],
			enabled: false,
			createdAt: Date.now()
		});
		expect(transport).toBeInstanceOf(SidecarStdioMcpTransport);
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
