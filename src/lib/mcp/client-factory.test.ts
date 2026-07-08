import { afterEach, describe, expect, it, vi } from 'vitest';

const mockIsTauri = vi.fn();
vi.mock('$lib/db', () => ({
	isTauri: () => mockIsTauri()
}));

vi.mock('$lib/ai/keystore/browser', () => ({
	createBrowserKeyStore: () => ({
		get: vi.fn(),
		has: vi.fn(),
		set: vi.fn(),
		delete: vi.fn()
	})
}));

import { createMcpTransport } from './client-factory';
import { HttpMcpTransport } from './http';
import { StdioMcpTransport } from './stdio';

describe('createMcpTransport', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns StdioMcpTransport for stdio config (desktop)', () => {
		mockIsTauri.mockReturnValue(true);
		const transport = createMcpTransport({
			id: 's1',
			name: 'Test',
			transport: 'stdio',
			command: 'node',
			args: ['-e', '1'],
			enabled: false,
			createdAt: Date.now()
		});
		expect(transport).toBeInstanceOf(StdioMcpTransport);
	});

	it('returns HttpMcpTransport for http config with url (browser)', () => {
		mockIsTauri.mockReturnValue(false);
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

	it('returns HttpMcpTransport for http config on desktop (secretRef will fail at request time)', () => {
		mockIsTauri.mockReturnValue(true);
		const transport = createMcpTransport({
			id: 'h2',
			name: 'HTTP Desktop',
			transport: 'http',
			url: 'https://mcp.example.com/mcp',
			enabled: false,
			createdAt: Date.now()
		});
		expect(transport).toBeInstanceOf(HttpMcpTransport);
	});

	it('throws when http config has no url', () => {
		mockIsTauri.mockReturnValue(false);
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
		mockIsTauri.mockReturnValue(false);
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
