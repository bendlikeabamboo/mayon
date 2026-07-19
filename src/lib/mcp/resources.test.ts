import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());
import { getToolDefinition, deregisterTool, toolsRun } from '$lib/agent/registry';
import type { ToolContext } from '$lib/agent/registry';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';
import type { McpNotification, McpResource } from './types';
import { McpClient } from './client';
import type { McpTransport } from './transport';
import {
	mountResources,
	unmountResources,
	readResource,
	listMountedResources,
	resourceServerIds,
	RESOURCE_SERVERS
} from './resources';

class ResourceFakeTransport implements McpTransport {
	private handlers: Array<(n: McpNotification) => void> = [];
	constructor(
		private opts: {
			resources?: McpResource[];
			resourceReadResult?: { contents: Array<{ uri: string; type: string; text?: string }> };
			capabilities?: Record<string, unknown>;
		} = {}
	) {}

	async start() {
		return { name: 'fake', version: '1.0.0' };
	}

	async request(method: string, _params?: unknown): Promise<unknown> {
		if (method === 'initialize') {
			return {
				protocolVersion: '2025-06-18',
				capabilities: this.opts.capabilities ?? {},
				serverInfo: { name: 'fake', version: '1.0.0' }
			};
		}
		if (method === 'resources/list') {
			return { resources: this.opts.resources ?? [] };
		}
		if (method === 'resources/read') {
			return this.opts.resourceReadResult ?? { contents: [] };
		}
		return {};
	}

	onNotification(handler: (n: McpNotification) => void): void {
		this.handlers.push(handler);
	}
	removeNotification(handler: (n: McpNotification) => void): void {
		const idx = this.handlers.indexOf(handler);
		if (idx >= 0) this.handlers.splice(idx, 1);
	}
	emitNotification(n: McpNotification): void {
		for (const h of this.handlers) h(n);
	}
	async close() {}
}

function fakeCtx(): ToolContext {
	return {
		chatId: 'test-chat',
		rootChatId: 'test-chat',
		budget: { subCalls: 0, maxSubCalls: 0 },
		model: null as unknown as LanguageModel,
		config: null as unknown as ProviderConfig
	};
}

beforeEach(async () => {
	deregisterTool('mcp_read_resource');
	RESOURCE_SERVERS.clear();
});

describe('mountResources', () => {
	it('early-returns when client has no resources capability', async () => {
		const transport = new ResourceFakeTransport({ capabilities: {} });
		const client = new McpClient(transport);
		await client.initialize();

		await mountResources('srv-1', client);
		expect(resourceServerIds()).toEqual(new Set());
		expect(getToolDefinition('mcp_read_resource')).toBeUndefined();
	});

	it('registers mcp_read_resource when a resource-capable server mounts', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();

		await mountResources('srv-1', client);
		expect(resourceServerIds()).toEqual(new Set(['srv-1']));
		expect(getToolDefinition('mcp_read_resource')).toBeDefined();
		expect(getToolDefinition('mcp_read_resource')!.risk).toBe('readonly');
	});

	it('registers tool only once (idempotent)', async () => {
		const t1 = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const c1 = new McpClient(t1);
		await c1.initialize();
		await mountResources('srv-1', c1);

		const t2 = new ResourceFakeTransport({
			resources: [{ uri: 'file:///b.txt', name: 'b.txt' }],
			capabilities: { resources: {} }
		});
		const c2 = new McpClient(t2);
		await c2.initialize();
		await mountResources('srv-2', c2);

		expect(getToolDefinition('mcp_read_resource')).toBeDefined();
		expect(resourceServerIds().size).toBe(2);
	});

	it('stores resources in the registry', async () => {
		const transport = new ResourceFakeTransport({
			resources: [
				{ uri: 'file:///a.txt', name: 'a.txt' },
				{ uri: 'file:///b.txt', name: 'b.txt' }
			],
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();

		await mountResources('srv-1', client);
		const mounted = listMountedResources();
		expect(mounted).toHaveLength(1);
		expect(mounted[0].resources).toHaveLength(2);
	});
});

describe('unmountResources', () => {
	it('removes the server entry', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client);

		unmountResources('srv-1');
		expect(resourceServerIds()).toEqual(new Set());
	});

	it('deregisters mcp_read_resource when last resource server unmounts', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client);
		expect(getToolDefinition('mcp_read_resource')).toBeDefined();

		unmountResources('srv-1');
		expect(getToolDefinition('mcp_read_resource')).toBeUndefined();
	});

	it('keeps mcp_read_resource when other resource servers remain', async () => {
		const t1 = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const c1 = new McpClient(t1);
		await c1.initialize();
		await mountResources('srv-1', c1);

		const t2 = new ResourceFakeTransport({
			resources: [{ uri: 'file:///b.txt', name: 'b.txt' }],
			capabilities: { resources: {} }
		});
		const c2 = new McpClient(t2);
		await c2.initialize();
		await mountResources('srv-2', c2);

		unmountResources('srv-1');
		expect(getToolDefinition('mcp_read_resource')).toBeDefined();
	});
});

describe('readResource', () => {
	it('returns ok:false for unknown server', async () => {
		const result = await readResource('nope', 'file:///x.txt');
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('unknown resource server');
	});

	it('returns truncated text content on success', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			resourceReadResult: {
				contents: [{ uri: 'file:///a.txt', type: 'text', text: 'Hello world' }]
			},
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client, { resultCapBytes: 8192 });

		const result = await readResource('srv-1', 'file:///a.txt');
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('Hello world');
	});

	it('truncates to resultCapBytes', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			resourceReadResult: {
				contents: [{ uri: 'file:///a.txt', type: 'text', text: 'x'.repeat(200) }]
			},
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client, { resultCapBytes: 20 });

		const result = await readResource('srv-1', 'file:///a.txt');
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('…[truncated]');
	});

	it('handles non-text content with placeholder', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///img.png', name: 'img.png' }],
			resourceReadResult: {
				contents: [{ uri: 'file:///img.png', type: 'blob' }]
			},
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client);

		const result = await readResource('srv-1', 'file:///img.png');
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('[unsupported content type: blob]');
	});

	it('works through the tool registry', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			resourceReadResult: {
				contents: [{ uri: 'file:///a.txt', type: 'text', text: 'tool test' }]
			},
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client);

		const result = await toolsRun(
			'mcp_read_resource',
			{ serverId: 'srv-1', uri: 'file:///a.txt' },
			fakeCtx()
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('tool test');
	});

	it('tool returns ok:false for invalid args', async () => {
		const transport = new ResourceFakeTransport({
			resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
			capabilities: { resources: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountResources('srv-1', client);

		const result = await toolsRun('mcp_read_resource', null, fakeCtx());
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('rejected: invalid args');
	});
});
