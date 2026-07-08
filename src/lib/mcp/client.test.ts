import { describe, expect, it, vi } from 'vitest';
import type { McpTool, McpResource, McpPrompt } from './types';
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
const fakeResources: McpResource[] = [
	{ uri: 'file:///a.txt', name: 'a.txt', description: 'File A' }
];
const fakePrompts: McpPrompt[] = [{ name: 'summarize', description: 'Summarize code' }];

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

	describe('capability getters', () => {
		it('hasResources is false when capabilities is empty', async () => {
			const { client } = makeClient();
			await client.initialize();
			expect(client.hasResources).toBe(false);
		});

		it('hasResources is true when capabilities.resources is set', async () => {
			const { client } = makeClient({ capabilities: { resources: {} } });
			await client.initialize();
			expect(client.hasResources).toBe(true);
		});

		it('hasPrompts is false when capabilities is empty', async () => {
			const { client } = makeClient();
			await client.initialize();
			expect(client.hasPrompts).toBe(false);
		});

		it('hasPrompts is true when capabilities.prompts is set', async () => {
			const { client } = makeClient({ capabilities: { prompts: {} } });
			await client.initialize();
			expect(client.hasPrompts).toBe(true);
		});
	});

	describe('resourcesList', () => {
		it('returns scripted resources', async () => {
			const { client } = makeClient({ resources: fakeResources, capabilities: { resources: {} } });
			await client.initialize();
			const resources = await client.resourcesList();
			expect(resources).toEqual(fakeResources);
		});

		it('returns empty array when server returns no resources field', async () => {
			const { client, transport } = makeClient({ capabilities: { resources: {} } });
			await client.initialize();
			transport.request = async (method: string) => {
				if (method === 'resources/list') return {};
				return transport.request.bind(transport)(method);
			};
			const resources = await client.resourcesList();
			expect(resources).toEqual([]);
		});
	});

	describe('resourcesRead', () => {
		it('returns contents from the server', async () => {
			const { client } = makeClient({
				capabilities: { resources: {} },
				resourceReadHandler: (uri) => ({
					contents: [{ uri, type: 'text', text: `content of ${uri}` }]
				})
			});
			await client.initialize();
			const result = await client.resourcesRead('file:///a.txt');
			expect(result.contents).toHaveLength(1);
			expect(result.contents[0].text).toBe('content of file:///a.txt');
		});

		it('returns empty contents when server returns nothing', async () => {
			const { client, transport } = makeClient({ capabilities: { resources: {} }, resources: [] });
			await client.initialize();
			transport.request = async (method: string) => {
				if (method === 'resources/read') return {};
				return transport.request.bind(transport)(method);
			};
			const result = await client.resourcesRead('file:///missing');
			expect(result.contents).toEqual([]);
		});
	});

	describe('promptsList', () => {
		it('returns scripted prompts', async () => {
			const { client } = makeClient({ prompts: fakePrompts, capabilities: { prompts: {} } });
			await client.initialize();
			const prompts = await client.promptsList();
			expect(prompts).toEqual(fakePrompts);
		});

		it('returns empty array when server returns no prompts field', async () => {
			const { client, transport } = makeClient({ capabilities: { prompts: {} } });
			await client.initialize();
			transport.request = async (method: string) => {
				if (method === 'prompts/list') return {};
				return transport.request.bind(transport)(method);
			};
			const prompts = await client.promptsList();
			expect(prompts).toEqual([]);
		});
	});

	describe('promptsGet', () => {
		it('returns messages from the server', async () => {
			const { client } = makeClient({
				capabilities: { prompts: {} },
				promptGetHandler: (name) => ({
					description: `Prompt ${name}`,
					messages: [{ role: 'user', content: { type: 'text', text: `Run ${name}` } }]
				})
			});
			await client.initialize();
			const result = await client.promptsGet('summarize');
			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].content.text).toBe('Run summarize');
		});
	});

	describe('subscribeResourcesListChanged', () => {
		it('fires callback on resources/list_changed', async () => {
			const { client, transport } = makeClient({ capabilities: { resources: {} } });
			await client.initialize();
			const cb = vi.fn();
			client.subscribeResourcesListChanged(cb);
			transport.emitNotification({ method: 'notifications/resources/list_changed' });
			expect(cb).toHaveBeenCalledTimes(1);
			transport.emitNotification({ method: 'some/other' });
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});

	describe('subscribePromptsListChanged', () => {
		it('fires callback on prompts/list_changed', async () => {
			const { client, transport } = makeClient({ capabilities: { prompts: {} } });
			await client.initialize();
			const cb = vi.fn();
			client.subscribePromptsListChanged(cb);
			transport.emitNotification({ method: 'notifications/prompts/list_changed' });
			expect(cb).toHaveBeenCalledTimes(1);
			transport.emitNotification({ method: 'some/other' });
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});
});
