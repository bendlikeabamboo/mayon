import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../../../tests/browser/render';
import { diagnosticsStore } from '#lib/stores/diagnostics.svelte.js';
import DiagnosticsPanel from './DiagnosticsPanel.svelte';

vi.mock('#lib/db/index.js', () => ({
	repos: {
		agentTraces: {
			listByChat: async () => [],
			listByLab: async () => [],
			listByQuiz: async () => [],
			deleteByChat: async () => {},
			deleteByLab: async () => {},
			deleteByQuiz: async () => {}
		}
	}
}));

function resetStore() {
	diagnosticsStore.open = false;
	diagnosticsStore.liveEvents = [];
	diagnosticsStore.traces = [];
	diagnosticsStore.selectedTurnId = null;
	diagnosticsStore.kinds = null;
}

afterEach(resetStore);

describe('DiagnosticsPanel sheet layout', () => {
	it('opens a right-side sheet with the console title', async () => {
		diagnosticsStore.open = true;

		const { getByRole } = await render(DiagnosticsPanel, { chatId: 'chat-1' });

		const dialog = getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		expect(dialog.element().getAttribute('data-side')).toBe('right');
		await expect.element(getByRole('heading', { name: 'Mayon console' })).toBeVisible();
	});

	it('keeps the kind filters and the clear action in the same header row', async () => {
		diagnosticsStore.open = true;

		const { getByRole } = await render(DiagnosticsPanel, { chatId: 'chat-1' });

		const clear = getByRole('button', { name: /clear/i });
		await expect.element(clear).toBeVisible();
		const all = getByRole('button', { name: 'All' });
		await expect.element(all).toBeVisible();
		await expect.element(getByRole('button', { name: 'Chat' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Title' })).toBeVisible();

		const headerRow = clear.element().parentElement;
		expect(headerRow).not.toBeNull();
		expect(headerRow?.contains(all.element())).toBe(true);
	});

	it('hides the clear action when no entity is selected and shows the empty trace count', async () => {
		diagnosticsStore.open = true;

		const { getByText, getByRole } = await render(DiagnosticsPanel, {});

		await expect.element(getByText('0 traces')).toBeVisible();
		await expect.element(getByRole('heading', { name: 'Mayon console' })).toBeVisible();
		expect(getByRole('button', { name: /clear/i }).query()).toBeNull();
	});
});
