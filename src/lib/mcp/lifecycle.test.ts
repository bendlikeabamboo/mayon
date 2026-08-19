import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpNotification, McpServerConfig, McpTool } from './types';
import type { McpTransport } from './transport';

vi.mock('./trust', () => ({
	isTrusted: vi.fn(async () => true),
	trustNow: vi.fn()
}));

const createMcpTransportMock = vi.fn();

vi.mock('./client-factory', () => ({
	createMcpTransport: (...args: unknown[]) => createMcpTransportMock(...args)
}));

vi.mock('$lib/services/status.svelte', () => ({
	serverStatus: { has: vi.fn(() => true) }
}));

vi.mock('$lib/db', () => ({
	repos: {}
}));

const { connectSession } = await import('./lifecycle');

function fakeTransport(opts: { fail?: Error; tools?: McpTool[] } = {}): McpTransport {
	return {
		start: async () => ({ name: 'fake', version: '1.0.0' }),
		request: async (method: string) => {
			if (method === 'initialize') {
				if (opts.fail) throw opts.fail;
				return {
					protocolVersion: '2025-06-18',
					capabilities: {},
					serverInfo: { name: 'fake', version: '1.0.0' }
				};
			}
			if (method === 'tools/list') return { tools: opts.tools ?? [] };
			return {};
		},
		notify: () => {},
		respond: async () => {},
		onNotification: (_h: (n: McpNotification) => void) => {},
		removeNotification: () => {},
		onRequest: () => {},
		removeRequest: () => {},
		close: async () => {}
	} satisfies McpTransport;
}

function config(id: string): McpServerConfig {
	return {
		id,
		name: `srv-${id}`,
		transport: 'http',
		url: '/api/brave-search/mcp',
		enabled: true,
		createdAt: Date.now()
	};
}

describe('connectSession recovery', () => {
	const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('a failed transport in one turn does not prevent a fresh healthy connect the next turn', async () => {
		// Turn 1: upstream down — connect fails, session still returns (graceful).
		createMcpTransportMock.mockReturnValueOnce(
			fakeTransport({ fail: new Error('brave-search upstream unreachable') })
		);
		const turn1 = await connectSession([config('brave-1')]);
		expect(turn1.clients.size).toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('failed to connect server'),
			expect.any(String)
		);
		turn1.unmountAll();

		// Turn 2: no cached failure — a fresh transport connects and mounts tools.
		const tool: McpTool = {
			name: 'brave_web_search',
			description: 'web search',
			inputSchema: { type: 'object' }
		};
		createMcpTransportMock.mockReturnValueOnce(fakeTransport({ tools: [tool] }));
		const turn2 = await connectSession([config('brave-1')]);
		expect(turn2.clients.size).toBe(1);
		const client = turn2.clients.get('brave-1')!;
		const tools = await client.toolsList();
		expect(tools.map((t) => t.name)).toContain('brave_web_search');
		turn2.unmountAll();

		// Turn 2 created a brand-new transport (nothing reused from the failure).
		expect(createMcpTransportMock).toHaveBeenCalledTimes(2);
	});
});
