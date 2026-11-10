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
		model: null,
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: null,
		createdAt: 1_700_000_000_000,
		...overrides
	} as Message;
}

function durable(): DurableEntry {
	return {
		source: 'durable',
		entry: message(),
		kind: 'assistant_message',
		lane: 'external'
	};
}

const callbacks = {
	onExpound: vi.fn(),
	onCopy: vi.fn(),
	onBranchWhole: vi.fn()
};

describe('AssistantMessage spinner is live-only', () => {
	it('shows the Thinking… pulse while a live reply is pending', async () => {
		const { getByText, container } = await render(AssistantMessage, {
			live: true,
			buffer: 'Working on it',
			pending: true,
			...callbacks
		});

		await expect.element(getByText('Thinking…')).toBeVisible();
		expect(container.querySelectorAll('.mayon-spinner').length).toBeGreaterThan(0);
		expect(container.querySelector('.mayon-spinner svg')).toBeNull();
	});

	it('shows the orbit spinner on a live reply with buffered text', async () => {
		const { getByText, container } = await render(AssistantMessage, {
			live: true,
			buffer: 'Streaming answer',
			pending: false,
			...callbacks
		});

		await expect.element(getByText('Streaming answer')).toBeVisible();
		expect(container.querySelector('.mayon-spinner svg')).not.toBeNull();
	});

	it('never spins on a durable row and keeps its finished body', async () => {
		const { getByText, container } = await render(AssistantMessage, {
			item: durable(),
			...callbacks
		});

		await expect.element(getByText('A finished answer.')).toBeVisible();
		expect(container.querySelector('.mayon-spinner')).toBeNull();
		expect(container.textContent).not.toContain('Thinking…');
	});
});
