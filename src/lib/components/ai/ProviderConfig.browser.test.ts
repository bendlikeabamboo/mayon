import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../tests/browser/render';
import ProviderConfig from './ProviderConfig.svelte';

type StoredProvider = {
	id: string;
	kind: string;
	name: string;
	baseUrl: string;
	defaultModel: string;
	models: string[];
	discoverable?: boolean;
	group?: string;
	requiresKey?: boolean;
	toolCapability?: 'on' | 'off';
};

const state = vi.hoisted(() => ({
	providers: [] as StoredProvider[],
	activeId: null as string | null,
	saves: [] as StoredProvider[][],
	connection: { ok: true, models: ['mock-sink'] } as {
		ok: boolean;
		models?: string[];
		failure?: { title: string; message: string; hint?: string };
	},
	discovered: [{ id: 'mock-sink' }] as Array<{ id: string; contextWindow?: number }>
}));

vi.mock('#lib/db/index.js', () => ({
	uuid: () => 'generated-provider-id'
}));

vi.mock('#lib/stores/chat.svelte.js', () => ({
	chatStore: {
		lastMappedError: null,
		clearAuthRequiredError: () => {}
	}
}));

vi.mock('#lib/ai/client.js', () => ({
	listProviders: async () => state.providers,
	getActiveProviderId: async () => state.activeId,
	hasProviderKey: async () => false,
	saveProviders: async (next: StoredProvider[]) => {
		state.saves.push(next);
		state.providers = next;
	},
	setActiveProvider: async (id: string | null) => {
		state.activeId = id;
	},
	deleteProviderKey: async () => {},
	setProviderKey: async () => {},
	kindRequiresKey: (config: { requiresKey?: boolean; kind?: string }) =>
		config.requiresKey ?? config.kind !== 'ollama',
	discoverProviderModelEntries: async () => state.discovered,
	discoverProviderModels: async () => state.discovered.map((entry) => entry.id)
}));

vi.mock('#lib/ai/connection-test.js', () => ({
	testProviderConnection: async () => state.connection
}));

function localProvider(overrides: Partial<StoredProvider> = {}): StoredProvider {
	return {
		id: 'local-provider',
		kind: 'ollama',
		name: 'LM Studio (local)',
		baseUrl: 'http://127.0.0.1:1234/v1',
		defaultModel: 'llama3',
		models: ['llama3'],
		discoverable: false,
		group: 'local',
		requiresKey: false,
		toolCapability: 'on',
		...overrides
	};
}

function discoverableLocal(overrides: Partial<StoredProvider> = {}): StoredProvider {
	return localProvider({
		id: 'discoverable-local',
		kind: 'openai-compatible',
		baseUrl: 'http://mock-llm:9999/v1',
		defaultModel: 'mock-sink',
		models: ['mock-sink'],
		discoverable: true,
		...overrides
	});
}

async function renderSettings() {
	const result = await render(ProviderConfig);
	await expect.element(result.getByRole('button', { name: 'Add provider' })).toBeVisible();
	return result;
}

function selectValue(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
	state.providers = [];
	state.activeId = null;
	state.saves = [];
	state.connection = { ok: true, models: ['mock-sink'] };
	state.discovered = [{ id: 'mock-sink' }];
});

afterEach(() => {
	state.providers = [];
	state.saves = [];
});

describe('ProviderConfig tool capability', () => {
	it('renders the Enabled/Disabled option pair with its hint and the Enabled default', async () => {
		state.providers = [localProvider()];
		state.activeId = 'local-provider';

		const { getByLabelText, getByText } = await renderSettings();

		const capability = getByLabelText(/Tool capability/);
		await expect.element(capability).toHaveValue('on');
		const options = Array.from((capability.element() as HTMLSelectElement).options).map(
			(option) => option.textContent
		);
		expect(options).toEqual(['Enabled', 'Disabled']);
		await expect
			.element(getByText("Tools let the agent call Mayon's tools through this provider."))
			.toBeVisible();
	});

	it('persists a flip to Disabled', async () => {
		state.providers = [localProvider()];
		state.activeId = 'local-provider';

		const { getByLabelText, getByText } = await renderSettings();
		selectValue(getByLabelText(/Tool capability/).element() as HTMLSelectElement, 'off');

		await vi.waitFor(() => {
			expect(state.saves.at(-1)?.[0]?.toolCapability).toBe('off');
		});
		await expect.element(getByText('Saved.')).toBeVisible();
	});

	it('renders a normalized legacy config as Disabled', async () => {
		state.providers = [localProvider({ toolCapability: 'off' })];
		state.activeId = 'local-provider';

		const { getByLabelText } = await renderSettings();
		await expect.element(getByLabelText(/Tool capability/)).toHaveValue('off');
	});
});

describe('ProviderConfig connection coaching', () => {
	it('reports a successful test, merges the discovered catalog, and keeps keyless locals keyless', async () => {
		state.providers = [discoverableLocal({ models: [] })];
		state.activeId = 'discoverable-local';
		state.connection = { ok: true, models: ['mock-sink'] };
		state.discovered = [{ id: 'mock-sink' }];

		const { getByRole, getByText, getByLabelText, container } = await renderSettings();

		await userEvent.click(getByRole('button', { name: 'Test connection' }));

		await expect.element(getByRole('status')).toHaveTextContent('Connection OK — 1 model found.');
		await expect.element(getByText(/1 models\s*·/)).toBeVisible();
		expect(container.querySelector('input[type="password"]')).toBeNull();
		await expect.element(getByLabelText(/API key/)).not.toBeInTheDocument();
		await vi.waitFor(() => {
			expect(state.saves.at(-1)?.[0]?.models).toContain('mock-sink');
		});
	});

	it('renders the classified failure remedy when the endpoint is not running', async () => {
		state.providers = [discoverableLocal()];
		state.activeId = 'discoverable-local';
		state.connection = {
			ok: false,
			failure: {
				title: 'Server not running',
				message: 'Nothing is listening at http://127.0.0.1:9/v1'
			}
		};

		const { getByRole } = await renderSettings();
		await userEvent.click(getByRole('button', { name: 'Test connection' }));

		const status = getByRole('status');
		await expect.element(status).toHaveTextContent('Server not running');
		await expect.element(status).toHaveTextContent('Nothing is listening at http://127.0.0.1:9/v1');
	});

	it('refreshes the live catalog and merges the discovered models', async () => {
		state.providers = [discoverableLocal({ models: [] })];
		state.activeId = 'discoverable-local';
		state.discovered = [{ id: 'mock-sink' }, { id: 'alt-model' }, { id: 'third-model' }];

		const { getByRole, getByText } = await renderSettings();

		await userEvent.click(getByRole('button', { name: 'Refresh model list' }));

		await expect.element(getByText(/3 models\s*·/)).toBeVisible();
		await vi.waitFor(() => {
			const saved = state.saves.at(-1)?.[0];
			expect(saved?.models).toEqual(
				expect.arrayContaining(['mock-sink', 'alt-model', 'third-model'])
			);
		});
	});
});
