import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolGroup } from '#lib/chat/entries.js';
import type { Message } from '#lib/db/index.js';
import { deregisterTool, registerTool } from '#lib/agent/registry.js';

import { render } from '../../../../../tests/browser/render';
import ToolActivity from './ToolActivity.svelte';

vi.mock('#lib/db/index.js', () => ({
	uuid: () => crypto.randomUUID(),
	repos: {
		branchSources: { listBySourceMessage: async () => [] },
		chats: { getById: async () => null },
		settings: { get: async () => null, set: async () => {}, delete: async () => {} }
	}
}));

const TERMINAL_TOOL = 'browser_terminal_tool';
const PLAIN_TOOL = 'browser_plain_tool';

function register(id: string, terminal: boolean) {
	registerTool({
		def: {
			id,
			description: 'browser test tool',
			parameters: {},
			risk: 'readonly',
			generative: false,
			...(terminal ? { terminal: true } : {})
		},
		run: async () => ({ ok: true, summary: '' })
	});
}

function callMessage(toolName: string): Message {
	return {
		id: 'call-1',
		chatId: 'chat-1',
		kind: 'tool_call',
		role: 'assistant',
		content: '',
		parts: null,
		ord: 3,
		model: null,
		tokens: null,
		toolCallId: 'call-1',
		toolName,
		metadata: null,
		createdAt: 1_700_000_000_000
	} as Message;
}

function group(toolName: string, overrides: Partial<ToolGroup> = {}): ToolGroup {
	return {
		source: 'durable',
		group: true,
		call: callMessage(toolName),
		result: null,
		...overrides
	};
}

afterEach(() => {
	deregisterTool(TERMINAL_TOOL);
	deregisterTool(PLAIN_TOOL);
});

describe('ToolActivity terminal presentation', () => {
	it('classifies terminality from the tool registry and uses the neutral circle glyph', async () => {
		register(TERMINAL_TOOL, true);
		const { container, getByText } = await render(ToolActivity, {
			item: group(TERMINAL_TOOL)
		});

		await expect.element(getByText(TERMINAL_TOOL)).toBeVisible();
		expect(container.querySelector('svg.lucide-circle')).not.toBeNull();
		expect(container.querySelector('svg.lucide-circle-x')).toBeNull();
		expect(getByText('No result recorded').query()).toBeNull();
	});

	it('keeps the failure mark for an unpaired non-terminal call', async () => {
		register(PLAIN_TOOL, false);
		const { container, getByText } = await render(ToolActivity, {
			item: group(PLAIN_TOOL)
		});

		await expect.element(getByText('No result recorded')).toBeVisible();
		expect(container.querySelector('svg.lucide-circle-x')).not.toBeNull();
		expect(container.querySelector('svg.lucide-circle')).toBeNull();
	});

	it('lets terminal classification win over a stale running flag', async () => {
		register(TERMINAL_TOOL, true);
		const { container, getByText } = await render(ToolActivity, {
			item: group(TERMINAL_TOOL, { running: true })
		});

		await expect.element(getByText(TERMINAL_TOOL)).toBeVisible();
		expect(container.querySelector('svg.lucide-circle')).not.toBeNull();
		expect(container.querySelector('svg.lucide-circle-x')).toBeNull();
	});
});
