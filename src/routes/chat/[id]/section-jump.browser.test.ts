import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { Chat, Message } from '#lib/db/index.js';
import type { ProviderConfig } from '#lib/ai/types.js';

import { render } from '../../../../tests/browser/render';
import ScrollFrame from '../../../../tests/browser/scroll-frame.svelte';
import '../../../app.css';

const state = vi.hoisted(() => ({
	config: null as unknown,
	messages: [] as unknown[],
	chat: null as unknown
}));

vi.mock('#lib/ai/client.js', () => ({
	getActiveSdkProvider: async () => ({ config: state.config, model: {}, toolCapability: false }),
	getAmbientEffort: async () => 'on',
	listProviders: async () => [state.config]
}));

vi.mock('#lib/db/index.js', () => ({
	uuid: () => 'test-uuid',
	repos: {
		chats: {
			getById: async (id: string) => ((state.chat as Chat | null)?.id === id ? state.chat : null),
			listSubtree: async () => [state.chat],
			listChildren: async () => [],
			listRoots: async () => [state.chat],
			createChild: async () => state.chat,
			touch: async () => {},
			deleteSubtree: async () => {}
		},
		messages: {
			listByChat: async () => state.messages,
			delete: async () => {}
		},
		settings: {
			get: async () => null,
			set: async () => {},
			delete: async () => {}
		},
		labs: { listByChat: async () => [], listAll: async () => [] },
		quizzes: { listByChat: async () => [], listAll: async () => [] },
		branchSources: {
			getByBranchChat: async () => null,
			listBySourceMessage: async () => []
		},
		agentTraces: { listByChat: async () => [] },
		crossLinks: {
			listForChat: async () => [],
			create: async () => {},
			delete: async () => {}
		},
		mcp: {
			listServers: async () => [],
			getChatMcpConfig: async () => null,
			listAttachments: async () => []
		}
	}
}));

vi.mock('#lib/chat/strip/pref.js', () => ({ isStripEnabled: async () => true }));
vi.mock('#lib/chat/streaming/pref.js', () => ({ getStreamPreset: async () => 'standard' }));
vi.mock('#lib/chat/uiState.js', () => ({
	isBriefExpanded: async () => false,
	setBriefExpanded: async () => {}
}));

const { page } = await import('$app/state');
const { chatStore } = await import('#lib/stores/chat.svelte.js');
const { default: ChatPage } = await import('./+page.svelte');

const chat: Chat = {
	id: 'chat-1',
	parentId: null,
	rootId: 'chat-1',
	branchPointMessageId: null,
	title: 'Section jump chat',
	depth: 0,
	provider: null,
	model: null,
	brief: null,
	mcpConfig: null,
	createdAt: 1,
	updatedAt: 1
};

function config(): ProviderConfig {
	return {
		id: 'provider-1',
		kind: 'openai-compatible',
		name: 'Mock Provider',
		baseUrl: 'https://example.test/v1',
		defaultModel: 'mock-model',
		models: ['mock-model']
	};
}

function message(id: string, content: string): Message {
	return {
		id,
		chatId: chat.id,
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
		createdAt: 1_700_000_000_000
	} as Message;
}

const body = [
	'> ## Quoted heading',
	'> Quoted body.',
	'',
	'## Alpha',
	'Alpha paragraph. '.repeat(40),
	'',
	'## Beta',
	'Beta paragraph. '.repeat(40),
	'',
	'## Gamma',
	'Gamma paragraph. '.repeat(40)
].join('\n');

function renderOptions() {
	return { wrapper: ScrollFrame, wrapperProps: { height: '420px' } };
}

beforeEach(() => {
	state.chat = chat;
	state.config = config();
	state.messages = [message('msg-1', body)];
	page.params.id = chat.id;
});

describe('chat route section jump', () => {
	it('jumps to the filtered heading index and flashes the landing anchor', async () => {
		const { getByRole } = await render(ChatPage, {}, renderOptions());
		const strip = getByRole('navigation', { name: 'Reply sections' });
		await expect.element(strip.getByRole('button', { name: 'Alpha' })).toBeVisible();
		await expect.element(strip.getByRole('button', { name: 'Gamma' })).toBeVisible();

		const scrollIntoView = vi
			.spyOn(Element.prototype, 'scrollIntoView')
			.mockImplementation(() => {});
		await userEvent.click(strip.getByRole('button', { name: 'Alpha' }));

		await vi.waitFor(() =>
			expect(
				scrollIntoView.mock.instances.some((target) => target instanceof HTMLHeadingElement)
			).toBe(true)
		);
		const anchor = scrollIntoView.mock.instances.find(
			(target) => target instanceof HTMLHeadingElement
		) as HTMLElement;
		expect(anchor.textContent).toContain('Alpha');
		expect(anchor.textContent).not.toContain('Quoted');
		expect(anchor.closest('blockquote')).toBeNull();
		expect(anchor.classList.contains('section-flash')).toBe(true);
	});

	it('keeps stick suppression until the next send re-enables follow', async () => {
		const send = vi.spyOn(chatStore, 'send').mockResolvedValue(undefined as never);
		const { getByRole, getByPlaceholder } = await render(ChatPage, {}, renderOptions());
		const strip = getByRole('navigation', { name: 'Reply sections' });
		await expect.element(strip.getByRole('button', { name: 'Alpha' })).toBeVisible();

		const viewport = document
			.getElementById('msg-msg-1')
			?.closest('.overflow-y-auto') as HTMLElement;
		vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
		await userEvent.click(strip.getByRole('button', { name: 'Alpha' }));
		viewport.scrollTop = 0;

		chatStore.messages = [
			...chatStore.messages,
			message('msg-2', '## Delta\n\n' + 'Delta paragraph. '.repeat(50))
		];
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(viewport.scrollTop).toBe(0);

		await userEvent.fill(getByPlaceholder(/Message the active provider/), 'next turn');
		await userEvent.click(getByRole('button', { name: 'Send' }));
		await vi.waitFor(() => expect(send).toHaveBeenCalled());

		chatStore.messages = [
			...chatStore.messages,
			message('msg-3', '## Epsilon\n\n' + 'Epsilon paragraph. '.repeat(50))
		];
		await vi.waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
	});

	it('clears the landing flash timer on teardown', async () => {
		const { getByRole, unmount } = await render(ChatPage, {}, renderOptions());
		const strip = getByRole('navigation', { name: 'Reply sections' });
		await expect.element(strip.getByRole('button', { name: 'Alpha' })).toBeVisible();

		const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
		await userEvent.click(strip.getByRole('button', { name: 'Alpha' }));

		const flashIndex = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 1600);
		expect(flashIndex, 'landing flash timer not scheduled').toBeGreaterThanOrEqual(0);
		const flashTimer = setTimeoutSpy.mock.results[flashIndex]!.value;

		unmount();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(flashTimer);
	});
});
