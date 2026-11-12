import { describe, expect, it, vi } from 'vitest';

import type { DurableEntry } from '#lib/chat/entries.js';
import type { Message } from '#lib/db/index.js';

import { render } from '../../../../../tests/browser/render';
import ScrollFrame from '../../../../../tests/browser/scroll-frame.svelte';
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

const body = [
	'## Alpha',
	'Alpha body paragraph. '.repeat(20),
	'## Beta',
	'Beta body paragraph. '.repeat(20),
	'## Gamma',
	'Gamma body paragraph. '.repeat(20)
].join('\n\n');

function message(content = body, overrides: Partial<Message> = {}): Message {
	return {
		id: 'msg-1',
		chatId: 'chat-1',
		kind: 'assistant_message',
		role: 'assistant',
		content,
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

function durable(content = body): DurableEntry {
	return {
		source: 'durable',
		entry: message(content),
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

describe('AssistantMessage section strip eligibility', () => {
	it('renders the strip from displayed headings when the durable body overflows', async () => {
		const { getByRole } = await render(AssistantMessage, props(), {
			wrapper: ScrollFrame,
			wrapperProps: { height: '120px' }
		});

		await expect.element(getByRole('navigation', { name: 'Reply sections' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Alpha' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Beta' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Gamma' })).toBeVisible();
	});

	it('threads the jump callback with the message id and section index', async () => {
		const onJumpToSection = vi.fn();
		const { getByRole } = await render(AssistantMessage, props({ onJumpToSection }), {
			wrapper: ScrollFrame,
			wrapperProps: { height: '120px' }
		});

		await expect.element(getByRole('button', { name: 'Beta' })).toBeVisible();
		(getByRole('button', { name: 'Beta' }).element() as HTMLElement).click();

		expect(onJumpToSection).toHaveBeenCalledWith('msg-1', 1);
	});

	it('never renders the strip on the streaming live tail', async () => {
		const { getByRole } = await render(AssistantMessage, {
			live: true,
			buffer: body,
			pending: false
		});

		expect(getByRole('navigation', { name: 'Reply sections' }).query()).toBeNull();
	});

	it('honours the persisted strip preference and the section-count gate', async () => {
		const disabled = await render(AssistantMessage, props({ stripEnabled: false }), {
			wrapper: ScrollFrame,
			wrapperProps: { height: '120px' }
		});
		expect(disabled.getByRole('navigation', { name: 'Reply sections' }).query()).toBeNull();
		disabled.unmount();

		const tooFew = await render(
			AssistantMessage,
			props({ item: durable('## Only\n\nShort body.') }),
			{
				wrapper: ScrollFrame,
				wrapperProps: { height: '120px' }
			}
		);
		expect(tooFew.getByRole('navigation', { name: 'Reply sections' }).query()).toBeNull();
	});
});
