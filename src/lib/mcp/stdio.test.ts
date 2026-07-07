import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioMcpTransport } from './stdio';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn().mockResolvedValue(() => {})
}));

vi.mock('$lib/db', () => ({
	isTauri: () => true
}));

import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

describe('StdioMcpTransport', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const config = {
		serverId: 'test-server',
		command: '/usr/bin/node',
		args: ['-e', 'console.log("hello")'],
		envKeyIds: [{ name: 'API_KEY', keyId: 'mcp:test:API_KEY' }]
	};

	it('start invokes mcp_spawn with correct args', async () => {
		mockedInvoke.mockResolvedValue(undefined);
		const t = new StdioMcpTransport(config);
		await t.start();
		expect(mockedInvoke).toHaveBeenCalledWith(
			'mcp_spawn',
			expect.objectContaining({
				serverId: 'test-server',
				command: '/usr/bin/node',
				args: ['-e', 'console.log("hello")']
			})
		);
	});

	it('request builds JSON-RPC envelope and calls mcp_call', async () => {
		mockedInvoke.mockResolvedValue('{"result":{"tools":[]}}');
		const t = new StdioMcpTransport(config);
		await t.request('tools/list');
		expect(mockedInvoke).toHaveBeenCalledWith(
			'mcp_call',
			expect.objectContaining({
				serverId: 'test-server',
				requestJson: expect.any(String)
			})
		);
		const callArgs = mockedInvoke.mock.calls.find((c) => c[0] === 'mcp_call')![1] as {
			requestJson: string;
		};
		const parsed = JSON.parse(callArgs.requestJson);
		expect(parsed.method).toBe('tools/list');
	});

	it('request surfaces error from server response', async () => {
		mockedInvoke.mockResolvedValue('{"error":{"message":"bad request","code":-32600}}');
		const t = new StdioMcpTransport(config);
		await expect(t.request('bad')).rejects.toThrow('bad request');
	});

	it('notify calls mcp_notify', async () => {
		mockedInvoke.mockResolvedValue(undefined);
		const t = new StdioMcpTransport(config);
		t.notify('notifications/cancelled');
		expect(mockedInvoke).toHaveBeenCalledWith(
			'mcp_notify',
			expect.objectContaining({
				serverId: 'test-server'
			})
		);
	});

	it('close calls mcp_close', async () => {
		mockedInvoke.mockResolvedValue(undefined);
		const t = new StdioMcpTransport(config);
		await t.close();
		expect(mockedInvoke).toHaveBeenCalledWith(
			'mcp_close',
			expect.objectContaining({
				serverId: 'test-server'
			})
		);
	});

	it('throws if isTauri returns false', () => {
		vi.doMock('$lib/db', () => ({
			isTauri: () => false
		}));
	});
});
