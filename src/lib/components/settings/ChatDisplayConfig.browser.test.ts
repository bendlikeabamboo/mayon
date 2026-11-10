import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../tests/browser/render';
import ChatDisplayConfig from './ChatDisplayConfig.svelte';

const settings = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	failSet: new Set<string>()
}));

vi.mock('#lib/db/index.js', () => ({
	repos: {
		settings: {
			get: async (key: string) => settings.values.get(key) ?? null,
			set: async (key: string, value: unknown) => {
				if (settings.failSet.has(key)) throw new Error('save failed');
				settings.values.set(key, value);
			},
			delete: async (key: string) => {
				settings.values.delete(key);
			}
		}
	}
}));

beforeEach(() => {
	settings.values.clear();
	settings.failSet.clear();
});

afterEach(() => {
	settings.values.clear();
	settings.failSet.clear();
});

describe('ChatDisplayConfig streaming-look select', () => {
	it('renders a labelled select with every preset and the behavior helper text', async () => {
		const { getByLabelText, getByText } = await render(ChatDisplayConfig);

		const select = getByLabelText('Streaming look');
		await expect.element(select).toHaveValue('standard');

		const options = Array.from((select.element() as HTMLSelectElement).options).map(
			(option) => option.textContent
		);
		expect(options).toEqual(['Calm', 'Standard', 'Expressive']);
		await expect.element(getByText(/Calm = steady cadence/)).toBeVisible();
	});

	it('loads the persisted preset on mount', async () => {
		settings.values.set('streamPreset', 'calm');

		const { getByLabelText } = await render(ChatDisplayConfig);

		await expect.element(getByLabelText('Streaming look')).toHaveValue('calm');
	});

	it('saves the selected preset optimistically', async () => {
		const { getByLabelText } = await render(ChatDisplayConfig);
		const select = getByLabelText('Streaming look');

		await userEvent.selectOptions(select, 'expressive');

		await vi.waitFor(() => expect(settings.values.get('streamPreset')).toBe('expressive'));
		await expect.element(select).toHaveValue('expressive');
	});

	it('reverts the select when the optimistic save fails', async () => {
		settings.failSet.add('streamPreset');

		const { getByLabelText } = await render(ChatDisplayConfig);
		const select = getByLabelText('Streaming look');

		await userEvent.selectOptions(select, 'calm');

		await expect.element(select).toHaveValue('standard');
		expect(settings.values.has('streamPreset')).toBe(false);
	});

	it('toggles the section strip preference through its pressed button', async () => {
		const { getByRole } = await render(ChatDisplayConfig);

		const toggle = getByRole('button', { name: 'On' });
		await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');

		await userEvent.click(toggle);

		await vi.waitFor(() => expect(settings.values.get('sectionStripEnabled')).toBe(false));
		await expect
			.element(getByRole('button', { name: 'Off' }))
			.toHaveAttribute('aria-pressed', 'false');
	});
});
