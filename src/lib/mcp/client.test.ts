import { describe, expect, it, vi } from 'vitest';
import type { McpTool } from './types';
import { McpClient } from './client';
import { FakeMcpTransport } from './fake-transport';

const fakeServerInfo = { name: 'test-server', version: '1.0.0' };
const fakeTools: McpTool[] = [
	{
		name: 'echo',
		description: 'Echoes input',
		inputSchema: { type: 'object', properties: { msg: { type: 'string' } } }
	}
];

function makeClient(opts: ConstructorParameters<typeof FakeMcpTransport>[0] = {}) {
	const transport = new FakeMcpTransport({ serverInfo: fakeServerInfo, tools: fakeTools, ...opts });
	const client = new McpClient(transport);
	return { client, transport };
}

describe('McpClient', () => {
	it('initialize handshake stores server info', async () => {
		const { client } = makeClient();
		expect(client.state).toBe('idle');

		const info = await client.initialize();
		expect(info).toEqual(fakeServerInfo);
		expect(client.serverInfo).toEqual(fakeServerInfo);
		expect(client.state).toBe('connected');
	});

	it('toolsList returns scripted tools', async () => {
		const { client } = makeClient();
		await client.initialize();
		const tools = await client.toolsList();
		expect(tools).toEqual(fakeTools);
	});

	it('toolsCall round-trips and returns content', async () => {
		const { client } = makeClient({
			callHandler: (name, args) => ({
				content: [{ type: 'text', text: `received ${name}(${JSON.stringify(args)})` }]
			})
		});
		await client.initialize();
		const result = await client.toolsCall('echo', { msg: 'hello' });
		expect(result.content).toEqual([{ type: 'text', text: 'received echo({"msg":"hello"})' }]);
		expect(result.isError).toBeUndefined();
	});

	it('tools/list_changed notification fires callback', async () => {
		const { client, transport } = makeClient();
		await client.initialize();
		const cb = vi.fn();
		client.subscribeToolsListChanged(cb);
		transport.emitNotification({ method: 'notifications/tools/list_changed' });
		expect(cb).toHaveBeenCalledTimes(1);
		transport.emitNotification({ method: 'some/other' });
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('request rejection propagates as error', async () => {
		const transport = new FakeMcpTransport({ serverInfo: fakeServerInfo, tools: fakeTools });
		const originalRequest = transport.request.bind(transport);
		transport.request = vi.fn(async (method) => {
			if (method === 'tools/list') throw new Error('server unavailable');
			return originalRequest(method);
		});
		const client = new McpClient(transport);
		await client.initialize();
		await expect(client.toolsList()).rejects.toThrow('server unavailable');
	});

	it('state transitions: idle → connected → closed', async () => {
		const { client } = makeClient();
		expect(client.state).toBe('idle');
		await client.initialize();
		expect(client.state).toBe('connected');
		await client.close();
		expect(client.state).toBe('closed');
	});
});
