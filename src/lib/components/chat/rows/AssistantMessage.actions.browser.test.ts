import { describe, expect, it, vi } from 'vitest';

import type { DurableEntry } from '#lib/chat/entries.js';
import type { Message } from '#lib/db/index.js';

import { render } from '../../../../../tests/browser/render';
import AssistantMessage from './AssistantMessage.svelte';

vi.mock('#lib/db/index.js', () => ({
	uuid: () => crypto.randomUUID(),
	repos: {
		branchSources: { listBySourceMessage: async () => [] },
		chats: { getById: async () => null },
		settings: { get: async () => null, set: async () => {}, delete: async () => {} }
	}
}));

vi.mock('#lib/stores/chat.svelte.js', () => ({
	chatStore: {
		send: vi.fn(),
		streamPreset: 'standard',
		streamPhase: 'idle',
		pendingImageCount: 0
	}
}));

function message(overrides: Partial<Message> = {}): Message {
	return {
		id: 'assistant-1',
		chatId: 'chat-1',
		kind: 'assistant_message',
		role: 'assistant',
		content: 'A finished answer.',
		parts: null,
		ord: 2,
		model: 'gpt-4o',
		tokens: 12,
		toolCallId: null,
		toolName: null,
		metadata: null,
		createdAt: 1_700_000_000_000,
		...overrides
	} as Message;
}

function durable(overrides: Partial<Message> = {}): DurableEntry {
	return {
		source: 'durable',
		entry: message(overrides),
		kind: 'assistant_message',
		lane: 'external'
	};
}

function props(overrides: Record<string, unknown> = {}) {
	return {
		item: durable(),
		onExpound: vi.fn(),
		onCopy: vi.fn(),
		onBranchWhole: vi.fn(),
		...overrides
	};
}

describe('AssistantMessage hover-revealed action row', () => {
	it('exposes copy, branch, and regenerate actions with accessible labels', async () => {
		const { getByRole } = await render(
			AssistantMessage,
			props({ onRegenerate: vi.fn(), canRegenerate: true })
		);

		await expect.element(getByRole('button', { name: 'Copy message' })).toBeVisible();
		await expect
			.element(getByRole('button', { name: 'Branch a new chat from this whole message' }))
			.toBeVisible();
		await expect.element(getByRole('button', { name: 'Regenerate response' })).toBeVisible();
	});

	it('routes copy and branch clicks to the owning callbacks', async () => {
		const provided = props();
		const { getByRole } = await render(AssistantMessage, provided);
		const copy = getByRole('button', { name: 'Copy message' }).element() as HTMLElement;
		const branch = getByRole('button', {
			name: 'Branch a new chat from this whole message'
		}).element() as HTMLElement;

		copy.click();
		branch.click();

		expect(provided.onCopy).toHaveBeenCalledWith('A finished answer.');
		expect(provided.onBranchWhole).toHaveBeenCalledWith('assistant-1');
	});

	it('gates regenerate to the newest assistant turn', async () => {
		const older = props({ onRegenerate: vi.fn(), canRegenerate: false });
		const olderRender = await render(AssistantMessage, older);
		expect(olderRender.getByRole('button', { name: 'Regenerate response' }).query()).toBeNull();
		olderRender.unmount();

		const onRegenerate = vi.fn();
		const newestRender = await render(
			AssistantMessage,
			props({ onRegenerate, canRegenerate: true })
		);
		(
			newestRender.getByRole('button', { name: 'Regenerate response' }).element() as HTMLElement
		).click();
		expect(onRegenerate).toHaveBeenCalledWith('assistant-1');
	});

	it('keeps the interrupted notice while consolidating regenerate into the action row', async () => {
		const { getByRole, getByText } = await render(
			AssistantMessage,
			props({
				item: durable({ metadata: JSON.stringify({ interrupted: true }) }),
				onRegenerate: vi.fn(),
				canRegenerate: true
			})
		);

		await expect.element(getByText('This reply was interrupted.')).toBeVisible();
		expect(getByRole('button', { name: 'Regenerate response' }).all()).toHaveLength(1);
	});
});
