import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

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

function callMessage(overrides: Partial<Message> = {}): Message {
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

function resultMessage(content: string, overrides: Partial<Message> = {}): Message {
	return {
		id: 'result-1',
		chatId: 'chat-1',
		kind: 'tool_result',
		role: 'tool',
		content,
		parts: null,
		ord: 4,
		model: null,
		tokens: null,
		toolCallId: 'call-1',
		toolName: 'web_search',
		metadata: null,
		createdAt: 1_700_000_001_000,
		...overrides
	} as Message;
}

function recordsGroup(): ToolGroup {
	const content = JSON.stringify([
		{ title: 'Alpha result', url: 'https://alpha.example/a', description: 'First hit' },
		{ title: 'Beta result', url: 'https://beta.example/b', description: 'Second hit' }
	]);
	return {
		source: 'durable',
		group: true,
		call: callMessage(),
		result: resultMessage(content)
	};
}

describe('ToolActivity collapse behavior', () => {
	it('uses a collapsible header trigger instead of a Show/Hide result control', async () => {
		const { getByRole } = await render(ToolActivity, { item: recordsGroup() });
		const trigger = getByRole('button', { name: /web_search/i });

		await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(getByRole('button', { name: /show result|hide result/i }).query()).toBeNull();
	});

	it('expands to the delegated ToolResultBody and collapses again from the header', async () => {
		const { getByRole } = await render(ToolActivity, { item: recordsGroup() });
		const trigger = getByRole('button', { name: /web_search/i });

		expect(getByRole('link', { name: /Alpha result/i }).query()).toBeNull();
		await userEvent.click(trigger);
		await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect.element(getByRole('link', { name: /Alpha result/i })).toBeVisible();
		await expect.element(getByRole('link', { name: /Beta result/i })).toBeVisible();
	});

	it('bounds the expanded records body', async () => {
		const { getByRole } = await render(ToolActivity, { item: recordsGroup() });
		await userEvent.click(getByRole('button', { name: /web_search/i }));
		await expect.element(getByRole('link', { name: /Alpha result/i })).toBeVisible();

		const bounded = (getByRole('link', { name: /Alpha result/i }).element() as HTMLElement).closest(
			'.max-h-60'
		);
		expect(bounded).not.toBeNull();
		expect(bounded!.classList.contains('overflow-y-auto')).toBe(true);
	});

	it('keeps entries without content as a plain, non-collapsible header', async () => {
		const { getByRole, getByText } = await render(ToolActivity, {
			item: { source: 'durable', group: true, call: callMessage(), result: null }
		});

		await expect.element(getByText('web_search')).toBeVisible();
		expect(getByRole('button', { name: /web_search/i }).query()).toBeNull();
	});
});
