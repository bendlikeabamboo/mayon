import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../../tests/browser/render';
import ModelSelect from './model-select.svelte';

describe('ModelSelect', () => {
	it('shows the selected model and opens the model dialog', async () => {
		const { getByRole, getByPlaceholder } = await render(ModelSelect, {
			models: ['gpt-4o', 'claude-x'],
			value: 'gpt-4o'
		});

		await userEvent.click(getByRole('button', { name: /gpt-4o/ }));
		const dialog = getByRole('dialog', { name: 'Select a model' });
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByRole('option', { name: /claude-x/ })).toBeVisible();
		await expect.element(getByPlaceholder('Search models…')).toBeVisible();
	});

	it('renders the context-window hint only for models with a known window', async () => {
		const { getByRole, getByText } = await render(ModelSelect, {
			models: ['gpt-4o', 'claude-x'],
			value: 'gpt-4o',
			contextWindows: { 'gpt-4o': 128_000 }
		});

		await userEvent.click(getByRole('button', { name: /gpt-4o/ }));
		const hint = getByText('128K');
		await expect.element(hint).toBeVisible();
		await expect.element(hint).toHaveAttribute('title', '128000 tokens');

		const claude = getByRole('option', { name: /claude-x/ }).element();
		expect(claude.textContent).not.toContain('128K');
	});

	it('calls onselect with the clicked model and closes the dialog', async () => {
		const onselect = vi.fn();
		const { getByRole } = await render(ModelSelect, {
			models: ['gpt-4o', 'claude-x'],
			value: 'gpt-4o',
			onselect
		});

		await userEvent.click(getByRole('button', { name: /gpt-4o/ }));
		const dialog = getByRole('dialog', { name: 'Select a model' });
		await userEvent.click(dialog.getByRole('option', { name: /claude-x/ }));

		expect(onselect).toHaveBeenCalledWith('claude-x');
		await vi.waitFor(() => expect(dialog.query()).toBeNull());
	});

	it('filters the model list through the search input', async () => {
		const { getByRole, getByPlaceholder } = await render(ModelSelect, {
			models: ['gpt-4o', 'claude-x'],
			value: 'gpt-4o'
		});

		await userEvent.click(getByRole('button', { name: /gpt-4o/ }));
		await userEvent.fill(getByPlaceholder('Search models…'), 'claude');

		const dialog = getByRole('dialog', { name: 'Select a model' });
		await expect.element(dialog.getByRole('option', { name: /claude-x/ })).toBeVisible();
		expect(dialog.getByRole('option', { name: /gpt-4o/ }).query()).toBeNull();
	});

	it('offers an accessible refresh action when discovery is enabled', async () => {
		const onrefresh = vi.fn();
		const { getByRole } = await render(ModelSelect, {
			models: ['gpt-4o'],
			value: 'gpt-4o',
			discoverable: true,
			onrefresh
		});

		await userEvent.click(getByRole('button', { name: 'Refresh model list' }));
		expect(onrefresh).toHaveBeenCalledTimes(1);
	});
});
