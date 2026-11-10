import { describe, expect, it, vi } from 'vitest';

import type { ToolGroup } from '#lib/chat/entries.js';
import type { Message } from '#lib/db/index.js';

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

function message(overrides: Partial<Message> = {}): Message {
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
		toolName: 'web_search',
		metadata: null,
		createdAt: 1_700_000_000_000,
		...overrides
	} as Message;
}

function group(overrides: Partial<ToolGroup> = {}): ToolGroup {
	return {
		source: 'durable',
		group: true,
		call: message(),
		result: null,
		...overrides
	};
}

function result(content: string, overrides: Partial<Message> = {}): Message {
	return message({
		id: 'result-1',
		kind: 'tool_result',
		role: 'tool',
		content,
		ord: 4,
		createdAt: 1_700_000_001_000,
		...overrides
	});
}

describe('ToolActivity status-driven presentation', () => {
	it('shows a waiting presentation for an undecided approval without claiming a gap', async () => {
		const { container, getByText } = await render(ToolActivity, {
			item: group({ awaitingDecision: true })
		});

		await expect.element(getByText('Waiting for your approval')).toBeVisible();
		expect(container.querySelector('svg.lucide-hourglass')).not.toBeNull();
		expect(getByText('No result recorded').query()).toBeNull();
	});

	it('uses the destructive failure vocabulary for a failed result', async () => {
		const { container, getByText } = await render(ToolActivity, {
			item: group({ result: result('boom'), failed: true })
		});

		await expect.element(getByText('Failed')).toBeVisible();
		expect(container.querySelector('svg.lucide-circle-x')).not.toBeNull();
	});

	it('labels declined and aborted decisions distinctly', async () => {
		const declined = await render(ToolActivity, { item: group({ declined: true }) });
		await expect.element(declined.getByText('Declined')).toBeVisible();
		expect(declined.container.querySelector('svg.lucide-circle-slash')).not.toBeNull();
		declined.unmount();

		const aborted = await render(ToolActivity, { item: group({ aborted: true }) });
		await expect.element(aborted.getByText('Aborted')).toBeVisible();
		expect(aborted.container.querySelector('svg.lucide-circle-slash')).not.toBeNull();
	});

	it('shows a pulsing neutral circle while running and a gap notice only for gaps', async () => {
		const running = await render(ToolActivity, { item: group({ running: true }) });
		expect(running.container.querySelector('svg.lucide-circle')).not.toBeNull();
		expect(running.getByText('No result recorded').query()).toBeNull();
		running.unmount();

		const gap = await render(ToolActivity, { item: group() });
		await expect.element(gap.getByText('No result recorded')).toBeVisible();
	});

	it('labels a completed result as succeeded', async () => {
		const { container, getByText } = await render(ToolActivity, {
			item: group({ result: result('done') })
		});

		await expect.element(getByText('Succeeded')).toBeVisible();
		expect(container.querySelector('svg.lucide-circle-check')).not.toBeNull();
	});
});
