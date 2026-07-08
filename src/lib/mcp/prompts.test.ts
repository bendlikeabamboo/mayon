import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { McpClient } from './client';
import type { McpNotification, McpPrompt } from './types';
import type { McpTransport } from './transport';
import {
	mountPrompts,
	unmountPrompts,
	listMountedPrompts,
	renderPrompt,
	PROMPT_SERVERS
} from './prompts';

class PromptFakeTransport implements McpTransport {
	private handlers: Array<(n: McpNotification) => void> = [];
	constructor(
		private opts: {
			prompts?: McpPrompt[];
			promptGetResult?: {
				description?: string;
				messages: Array<{ role: string; content: { type: string; text?: string } }>;
			};
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
		if (method === 'prompts/list') {
			return { prompts: this.opts.prompts ?? [] };
		}
		if (method === 'prompts/get') {
			return this.opts.promptGetResult ?? { messages: [] };
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

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	PROMPT_SERVERS.clear();
});

describe('mountPrompts', () => {
	it('early-returns when client has no prompts capability', async () => {
		const transport = new PromptFakeTransport({ capabilities: {} });
		const client = new McpClient(transport);
		await client.initialize();

		await mountPrompts('srv-1', client);
		expect(listMountedPrompts()).toEqual([]);
	});

	it('stores prompts in the registry', async () => {
		const transport = new PromptFakeTransport({
			prompts: [
				{ name: 'summarize', description: 'Summarize code' },
				{ name: 'explain', description: 'Explain code' }
			],
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();

		await mountPrompts('srv-1', client);
		const mounted = listMountedPrompts();
		expect(mounted).toHaveLength(1);
		expect(mounted[0].serverId).toBe('srv-1');
		expect(mounted[0].prompts).toHaveLength(2);
	});
});

describe('unmountPrompts', () => {
	it('removes the server entry', async () => {
		const transport = new PromptFakeTransport({
			prompts: [{ name: 'p1' }],
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountPrompts('srv-1', client);

		unmountPrompts('srv-1');
		expect(listMountedPrompts()).toEqual([]);
	});
});

describe('renderPrompt', () => {
	it('returns error for unknown server', async () => {
		const result = await renderPrompt('nope', 'summarize');
		expect(result.error).toContain('unknown prompt server');
		expect(result.text).toBe('');
	});

	it('flattens a single message prompt', async () => {
		const transport = new PromptFakeTransport({
			prompts: [{ name: 'summarize' }],
			promptGetResult: {
				messages: [{ role: 'user', content: { type: 'text', text: 'Summarize this code.' } }]
			},
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountPrompts('srv-1', client);

		const result = await renderPrompt('srv-1', 'summarize');
		expect(result.text).toBe('Summarize this code.');
		expect(result.error).toBeUndefined();
	});

	it('flattens multi-message prompts with role labels', async () => {
		const transport = new PromptFakeTransport({
			prompts: [{ name: 'dialog' }],
			promptGetResult: {
				messages: [
					{ role: 'user', content: { type: 'text', text: 'Hello' } },
					{ role: 'assistant', content: { type: 'text', text: 'Hi there!' } }
				]
			},
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountPrompts('srv-1', client);

		const result = await renderPrompt('srv-1', 'dialog');
		expect(result.text).toContain('User: Hello');
		expect(result.text).toContain('Assistant: Hi there!');
	});

	it('handles non-text content with placeholder', async () => {
		const transport = new PromptFakeTransport({
			prompts: [{ name: 'visual' }],
			promptGetResult: {
				messages: [{ role: 'user', content: { type: 'image', text: undefined } }]
			},
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountPrompts('srv-1', client);

		const result = await renderPrompt('srv-1', 'visual');
		expect(result.text).toContain('[unsupported content type: image]');
	});

	it('returns error on failure', async () => {
		const transport = new PromptFakeTransport({
			prompts: [{ name: 'fail' }],
			capabilities: { prompts: {} }
		});
		const client = new McpClient(transport);
		await client.initialize();
		await mountPrompts('srv-1', client);

		transport.request = async (method: string) => {
			if (method === 'prompts/get') throw new Error('server error');
			return {};
		};

		const result = await renderPrompt('srv-1', 'fail');
		expect(result.text).toBe('');
		expect(result.error).toBe('server error');
	});
});
