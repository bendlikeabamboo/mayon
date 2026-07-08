import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import {
	getToolDefinitions,
	getToolDefinition,
	registerTool,
	deregisterTool,
	toolsRun
} from '$lib/agent/registry';
import type { ToolContext } from '$lib/agent/registry';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';
import type { McpNotification, McpTool, McpToolCallResult, McpResource, McpPrompt } from './types';
import { truncateResult } from './caps';
import { annotationsToRisk } from './risk';
import { mountMcpServer } from './mount';
import { McpClient } from './client';
import type { McpTransport } from './transport';
import { RESOURCE_SERVERS } from './resources';
import { PROMPT_SERVERS } from './prompts';
import { listMountedResources } from './resources';
import { listMountedPrompts as listPromptsFromModule } from './prompts';

class FakeMcpTransport implements McpTransport {
	private handlers: Array<(n: McpNotification) => void> = [];

	constructor(
		private opts: {
			tools?: McpTool[];
			resources?: McpResource[];
			prompts?: McpPrompt[];
			callHandler?: (name: string, args: unknown) => McpToolCallResult | Promise<McpToolCallResult>;
			requestOverride?: (method: string, params?: unknown) => Promise<unknown>;
			capabilities?: Record<string, unknown>;
		} = {}
	) {}

	async start() {
		return { name: 'fake', version: '1.0.0' };
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (this.opts.requestOverride) return this.opts.requestOverride(method, params);
		if (method === 'initialize') {
			return {
				protocolVersion: '2025-06-18',
				capabilities: this.opts.capabilities ?? {},
				serverInfo: { name: 'fake', version: '1.0.0' }
			};
		}
		if (method === 'tools/list') {
			return { tools: this.opts.tools ?? [] };
		}
		if (method === 'tools/call') {
			const p = params as { name: string; arguments: unknown };
			if (this.opts.callHandler) {
				return this.opts.callHandler(p.name, p.arguments);
			}
			return { content: [{ type: 'text', text: JSON.stringify(p.arguments) }], isError: false };
		}
		if (method === 'resources/list') {
			return { resources: this.opts.resources ?? [] };
		}
		if (method === 'prompts/list') {
			return { prompts: this.opts.prompts ?? [] };
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
	await bootstrapWithDriver(await createMemoryDriver());
	RESOURCE_SERVERS.clear();
	PROMPT_SERVERS.clear();
	deregisterTool('mcp_read_resource');
});

describe('truncateResult', () => {
	it('returns text unchanged if under cap', () => {
		expect(truncateResult('hello', 100)).toBe('hello');
	});

	it('truncates at byte boundary and appends note', () => {
		const long = 'x'.repeat(20);
		const result = truncateResult(long, 10);
		expect(result.endsWith('\n…[truncated]')).toBe(true);
	});
});

describe('annotationsToRisk', () => {
	it('returns readonly for readOnlyHint true', () => {
		expect(annotationsToRisk({ readOnlyHint: true })).toBe('readonly');
	});

	it('returns high for destructiveHint true', () => {
		expect(annotationsToRisk({ destructiveHint: true })).toBe('high');
	});

	it('returns high for openWorldHint true', () => {
		expect(annotationsToRisk({ openWorldHint: true })).toBe('high');
	});

	it('returns high for absent annotations', () => {
		expect(annotationsToRisk(undefined)).toBe('high');
	});

	it('returns high for empty annotations', () => {
		expect(annotationsToRisk({})).toBe('high');
	});

	it('returns high when readOnly + destructive (destructive wins)', () => {
		expect(annotationsToRisk({ readOnlyHint: true, destructiveHint: true })).toBe('high');
	});
});

describe('mountMcpServer', () => {
	it('mounts tools with mcp.<serverId>.<toolName> namespace', async () => {
		const transport = new FakeMcpTransport({
			tools: [
				{
					name: 'search',
					description: 'Search the web',
					inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
					annotations: { readOnlyHint: true }
				}
			]
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('brave', client);

		const defs = getToolDefinitions();
		const found = defs.find((d) => d.id === 'mcp.brave.search');
		expect(found).toBeDefined();
		expect(found!.risk).toBe('readonly');
		expect(found!.generative).toBe(false);

		unmount();
		expect(getToolDefinition('mcp.brave.search')).toBeUndefined();
	});

	it('skips colliding ids', async () => {
		registerTool({
			def: {
				id: 'mcp.brave.search',
				description: 'existing',
				parameters: { type: 'object', properties: {} },
				risk: 'high',
				generative: false
			},
			async run() {
				return { ok: true, summary: 'noop' };
			}
		});

		const transport = new FakeMcpTransport({
			tools: [
				{
					name: 'search',
					description: 'New search',
					inputSchema: { type: 'object', properties: {} },
					annotations: { readOnlyHint: true }
				}
			]
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('brave', client);

		const def = getToolDefinition('mcp.brave.search');
		expect(def).toBeDefined();
		expect(def!.description).toBe('existing');

		unmount();
		deregisterTool('mcp.brave.search');
	});

	it('skips tools with invalid schema', async () => {
		const transport = new FakeMcpTransport({
			tools: [
				{
					name: 'bad',
					description: 'Bad schema',
					inputSchema: { type: 'array', items: {} }
				}
			]
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('test', client);

		expect(getToolDefinition('mcp.test.bad')).toBeUndefined();
		unmount();
	});

	it('maps annotations to risk correctly', async () => {
		const tools: McpTool[] = [
			{
				name: 'ro',
				inputSchema: { type: 'object', properties: {} },
				annotations: { readOnlyHint: true }
			},
			{
				name: 'hi',
				inputSchema: { type: 'object', properties: {} },
				annotations: { readOnlyHint: true, destructiveHint: true }
			},
			{
				name: 'ow',
				inputSchema: { type: 'object', properties: {} },
				annotations: { openWorldHint: true }
			},
			{ name: 'def', inputSchema: { type: 'object', properties: {} } }
		];

		const transport = new FakeMcpTransport({ tools });
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('srv', client);

		expect(getToolDefinition('mcp.srv.ro')!.risk).toBe('readonly');
		expect(getToolDefinition('mcp.srv.hi')!.risk).toBe('high');
		expect(getToolDefinition('mcp.srv.ow')!.risk).toBe('high');
		expect(getToolDefinition('mcp.srv.def')!.risk).toBe('high');

		unmount();
	});

	it('truncates results at capBytes', async () => {
		const bigResult = 'x'.repeat(100);
		const transport = new FakeMcpTransport({
			tools: [
				{ name: 'echo', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }
			],
			callHandler: () => ({ content: [{ type: 'text', text: bigResult }], isError: false })
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('cap', client, { resultCapBytes: 20 });

		const result = await toolsRun('mcp.cap.echo', { q: 'test' }, fakeCtx());

		expect(result.ok).toBe(true);
		expect(result.summary).toContain('…[truncated]');

		unmount();
	});

	it('returns ok:false on timeout', async () => {
		let resolveCall: () => void = () => {};
		const transport = new FakeMcpTransport({
			tools: [{ name: 'slow', inputSchema: { type: 'object', properties: {} } }],
			callHandler: () =>
				new Promise<McpToolCallResult>((resolve) => {
					resolveCall = () =>
						resolve({ content: [{ type: 'text', text: 'done' }], isError: false });
				})
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('slow', client, { callTimeoutMs: 10 });

		const result = await toolsRun('mcp.slow.slow', {}, fakeCtx());

		expect(result.ok).toBe(false);
		expect(result.summary).toBe('tool timed out');
		resolveCall();

		unmount();
	});

	it('returns ok:false on invalid args', async () => {
		const transport = new FakeMcpTransport({
			tools: [
				{ name: 'echo', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }
			]
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('t', client);

		const result = await toolsRun('mcp.t.echo', null, fakeCtx());

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('rejected: invalid args');

		unmount();
	});

	it('remounts on tools/list_changed notification', async () => {
		const toolState = {
			current: [{ name: 'tool_a', inputSchema: { type: 'object', properties: {} } }] as McpTool[]
		};
		const transport = new FakeMcpTransport({
			tools: toolState.current,
			requestOverride: async (method: string) => {
				if (method === 'tools/list') return { tools: toolState.current };
				return {};
			}
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('dynamic', client);

		expect(getToolDefinition('mcp.dynamic.tool_a')).toBeDefined();

		toolState.current = [{ name: 'tool_b', inputSchema: { type: 'object', properties: {} } }];
		transport.emitNotification({ method: 'notifications/tools/list_changed' });

		await vi.waitFor(() => {
			expect(getToolDefinition('mcp.dynamic.tool_a')).toBeUndefined();
			expect(getToolDefinition('mcp.dynamic.tool_b')).toBeDefined();
		});

		unmount();
		expect(getToolDefinition('mcp.dynamic.tool_b')).toBeUndefined();
	});

	it('unmount removes all registered tools', async () => {
		const transport = new FakeMcpTransport({
			tools: [
				{ name: 'a', inputSchema: { type: 'object', properties: {} } },
				{ name: 'b', inputSchema: { type: 'object', properties: {} } }
			]
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('srv', client);

		expect(getToolDefinition('mcp.srv.a')).toBeDefined();
		expect(getToolDefinition('mcp.srv.b')).toBeDefined();

		unmount();

		expect(getToolDefinition('mcp.srv.a')).toBeUndefined();
		expect(getToolDefinition('mcp.srv.b')).toBeUndefined();
	});

	it('returns ok:false when server isError is true', async () => {
		const transport = new FakeMcpTransport({
			tools: [{ name: 'fail', inputSchema: { type: 'object', properties: {} } }],
			callHandler: () => ({
				content: [{ type: 'text', text: 'server error' }],
				isError: true
			})
		});
		const client = new McpClient(transport);
		await client.initialize();

		const unmount = await mountMcpServer('err', client);

		const result = await toolsRun('mcp.err.fail', {}, fakeCtx());

		expect(result.ok).toBe(false);
		expect(result.summary).toBe('tool returned error');

		unmount();
	});

	describe('resource + prompt mounting integration', () => {
		it('mounts resources when server advertises resources capability', async () => {
			const transport = new FakeMcpTransport({
				tools: [],
				resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
				capabilities: { resources: {} }
			});
			const client = new McpClient(transport);
			await client.initialize();

			const unmount = await mountMcpServer('res-srv', client);
			expect(listMountedResources()).toHaveLength(1);
			expect(getToolDefinition('mcp_read_resource')).toBeDefined();

			unmount();
			expect(listMountedResources()).toHaveLength(0);
			expect(getToolDefinition('mcp_read_resource')).toBeUndefined();
		});

		it('mounts prompts when server advertises prompts capability', async () => {
			const transport = new FakeMcpTransport({
				tools: [],
				prompts: [{ name: 'summarize', description: 'Summarize' }],
				capabilities: { prompts: {} }
			});
			const client = new McpClient(transport);
			await client.initialize();

			const unmount = await mountMcpServer('prompt-srv', client);
			expect(listPromptsFromModule()).toHaveLength(1);

			unmount();
			expect(listPromptsFromModule()).toHaveLength(0);
		});

		it('no-op for resources/prompts when capabilities are empty', async () => {
			const transport = new FakeMcpTransport({
				tools: [{ name: 'x', inputSchema: { type: 'object', properties: {} } }],
				capabilities: {}
			});
			const client = new McpClient(transport);
			await client.initialize();

			const unmount = await mountMcpServer('tools-only', client);
			expect(listMountedResources()).toHaveLength(0);
			expect(listPromptsFromModule()).toHaveLength(0);
			expect(getToolDefinition('mcp_read_resource')).toBeUndefined();

			unmount();
		});

		it('mounts tools + resources + prompts together', async () => {
			const transport = new FakeMcpTransport({
				tools: [{ name: 'search', inputSchema: { type: 'object', properties: {} } }],
				resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
				prompts: [{ name: 'explain', description: 'Explain' }],
				capabilities: { resources: {}, prompts: {} }
			});
			const client = new McpClient(transport);
			await client.initialize();

			const unmount = await mountMcpServer('full', client);
			expect(getToolDefinition('mcp.full.search')).toBeDefined();
			expect(listMountedResources()).toHaveLength(1);
			expect(listPromptsFromModule()).toHaveLength(1);
			expect(getToolDefinition('mcp_read_resource')).toBeDefined();

			unmount();
			expect(getToolDefinition('mcp.full.search')).toBeUndefined();
			expect(listMountedResources()).toHaveLength(0);
			expect(listPromptsFromModule()).toHaveLength(0);
			expect(getToolDefinition('mcp_read_resource')).toBeUndefined();
		});
	});
});
