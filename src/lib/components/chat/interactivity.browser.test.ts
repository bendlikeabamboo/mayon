import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { DurableEntry, LiveEntry } from '#lib/chat/entries.js';
import type { Message } from '#lib/db/index.js';

import { render } from '../../../../tests/browser/render';
import Composer from './Composer.svelte';
import MessageList from './MessageList.svelte';
import ChoicesOffer from './rows/ChoicesOffer.svelte';

vi.mock('#lib/db/index.js', () => ({
	uuid: () => crypto.randomUUID(),
	repos: {
		settings: {
			get: async () => null,
			set: async () => {},
			delete: async () => {}
		}
	}
}));

const store = vi.hoisted(() => ({
	send: vi.fn(),
	pendingImageCount: 0
}));

vi.mock('#lib/stores/chat.svelte.js', () => ({ chatStore: store }));

function choicesMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 'choices-1',
		chatId: 'chat-1',
		kind: 'choices',
		role: 'assistant',
		content: '',
		parts: null,
		ord: 2,
		model: null,
		tokens: null,
		toolCallId: 'call-1',
		toolName: 'present_choices',
		metadata: JSON.stringify({
			nextUnit: 'Unit 2',
			options: ['Alpha', 'Beta'],
			progress: '1/3'
		}),
		createdAt: 1_700_000_000_000,
		...overrides
	} as Message;
}

function userMessage(): Message {
	return {
		id: 'user-1',
		chatId: 'chat-1',
		kind: 'user_message',
		role: 'user',
		content: 'Alpha',
		parts: null,
		ord: 3,
		model: null,
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: null,
		createdAt: 1_700_000_001_000
	} as Message;
}

function durableChoices(): DurableEntry {
	return {
		source: 'durable',
		entry: choicesMessage(),
		kind: 'choices',
		lane: 'internal'
	};
}

function composerProps() {
	return {
		onSend: vi.fn(),
		onStop: vi.fn(),
		onBranch: vi.fn(),
		onQuiz: vi.fn(),
		onLab: vi.fn(),
		providerName: 'OpenAI',
		modelId: 'gpt-4o'
	};
}

function messageListProps(messages: Message[]) {
	return {
		messages,
		onExpound: vi.fn(),
		onCopy: vi.fn(),
		onBranchWhole: vi.fn()
	};
}

describe('Composer without suggestion chips or gate progress', () => {
	it('renders the launchers but no suggestion chips or progress affordance', async () => {
		const { getByRole, getByText } = await render(Composer, composerProps());

		await expect.element(getByRole('button', { name: /branch here/i })).toBeVisible();
		expect(getByRole('button', { name: /suggest/i }).query()).toBeNull();
		expect(getByRole('progressbar').query()).toBeNull();
		expect(getByText(/suggested repl/i).query()).toBeNull();
	});
});

describe('ChoicesOffer option wiring', () => {
	it('renders option buttons and reports the clicked option', async () => {
		const onSelect = vi.fn();
		const { getByRole, getByText } = await render(ChoicesOffer, {
			item: durableChoices(),
			onSelect
		});

		await expect.element(getByText(/1\/3/)).toBeVisible();
		await userEvent.click(getByRole('button', { name: 'Alpha' }));
		await userEvent.click(getByRole('button', { name: 'Beta' }));

		expect(onSelect).toHaveBeenNthCalledWith(1, 'Alpha');
		expect(onSelect).toHaveBeenNthCalledWith(2, 'Beta');
	});

	it('renders the taken option as static text instead of a button', async () => {
		const { getByRole, getByText } = await render(ChoicesOffer, {
			item: durableChoices(),
			linkedTakenOption: 'Alpha',
			onSelect: vi.fn()
		});

		await expect.element(getByText('Alpha')).toBeVisible();
		expect(getByRole('button', { name: 'Alpha' }).query()).toBeNull();
		await expect.element(getByRole('button', { name: 'Beta' })).toBeVisible();
	});

	it('renders all options inert when no onSelect handler is provided', async () => {
		const { getByText } = await render(ChoicesOffer, { item: durableChoices() });

		await expect.element(getByText('Alpha')).toBeVisible();
		await expect.element(getByText('Beta')).toBeVisible();
		expect(getByText('Alpha').query()?.closest('button')).toBeNull();
		expect(getByText('Beta').query()?.closest('button')).toBeNull();
	});
});

describe('MessageList active-gate derivation', () => {
	it('offers the trailing choices gate and sends the picked option through the store', async () => {
		store.send.mockClear();
		const { getByRole } = await render(MessageList, messageListProps([choicesMessage()]));

		await userEvent.click(getByRole('button', { name: 'Beta' }));
		expect(store.send).toHaveBeenCalledWith('Beta', { choicesEntryId: 'choices-1' });
	});

	it('drops the gate once a later user turn exists', async () => {
		store.send.mockClear();
		const { getByRole, getByText } = await render(
			MessageList,
			messageListProps([choicesMessage(), userMessage()])
		);

		await expect.element(getByText('Beta')).toBeVisible();
		expect(getByRole('button', { name: 'Beta' }).query()).toBeNull();
		expect(store.send).not.toHaveBeenCalled();
	});
});

describe('MessageList live-block ids', () => {
	it('numbers same-variant live blocks from zero (029 per-block ids)', async () => {
		const liveItems: LiveEntry[] = [
			{ source: 'live', live: 'live_reasoning', buffer: 'thought one', streaming: true },
			{ source: 'live', live: 'live_text', buffer: 'answer part', streaming: true },
			{ source: 'live', live: 'live_reasoning', buffer: 'thought two', streaming: false }
		];
		const { container } = await render(MessageList, {
			...messageListProps([]),
			liveItems,
			streaming: true
		});

		expect(container.querySelector('#msg-live-reasoning-0')).not.toBeNull();
		expect(container.querySelector('#msg-live-reasoning-1')).not.toBeNull();
		expect(container.querySelector('#msg-live-reasoning-2')).toBeNull();
		expect(container.querySelector('#msg-live-text-0')).not.toBeNull();
		expect(container.querySelector('#msg-live-text-1')).toBeNull();
	});
});
