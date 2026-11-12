import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chat, Message } from '#lib/db/index.js';
import type { ProviderConfig } from '#lib/ai/types.js';

import { render } from '../../../../tests/browser/render';

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
		branchSources: { getByBranchChat: async () => null },
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
const { default: ChatPage } = await import('./+page.svelte');

const chat: Chat = {
	id: 'chat-1',
	parentId: null,
	rootId: 'chat-1',
	branchPointMessageId: null,
	title: 'Vision gate chat',
	depth: 0,
	provider: null,
	model: null,
	brief: null,
	mcpConfig: null,
	createdAt: 1,
	updatedAt: 1
};

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: 'provider-1',
		kind: 'openai-compatible',
		name: 'Mock Provider',
		baseUrl: 'https://example.test/v1',
		defaultModel: 'mock-model',
		models: ['mock-model'],
		...overrides
	};
}

beforeEach(() => {
	state.chat = chat;
	state.messages = [] as Message[];
	page.params.id = chat.id;
});

describe('chat route vision gate', () => {
	it('passes the derived vision gate to the Composer', async () => {
		state.config = config({ vision: 'on', imageOutput: 'off' });
		const { getByText, getByRole } = await render(ChatPage);

		await expect.element(getByRole('button', { name: 'Attach image' })).toBeVisible();
		expect(getByText('image output', { exact: true }).query()).toBeNull();
	});

	it('hides the paperclip when the active model is not vision capable', async () => {
		state.config = config({ vision: 'off', imageOutput: 'on' });
		const { getByText, getByRole } = await render(ChatPage);

		await expect.element(getByText('image output', { exact: true })).toBeVisible();
		expect(getByRole('button', { name: 'Attach image' }).query()).toBeNull();
	});
});
