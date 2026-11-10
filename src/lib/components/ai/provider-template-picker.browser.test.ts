import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../tests/browser/render';
import ProviderTemplatePicker from './provider-template-picker.svelte';

const GROUP_HEADINGS = ['Local', 'Cloud APIs', 'Gateways', 'Custom'];

function headingTexts(elements: Element[]): string[] {
	return elements.map((element) => element.textContent?.trim() ?? '');
}

describe('grouped provider template picker', () => {
	it('shows the four groups in order', async () => {
		const { getByRole } = await render(ProviderTemplatePicker, { onselect: vi.fn() });

		const headings = getByRole('heading', { level: 3 }).all();
		expect(headingTexts(headings.map((heading) => heading.element()))).toEqual(GROUP_HEADINGS);
	});

	it('search matches across groups and hides empty groups', async () => {
		const { getByRole } = await render(ProviderTemplatePicker, { onselect: vi.fn() });

		const search = getByRole('textbox', { name: 'Search providers' });
		await userEvent.fill(search, 'open');
		await expect.element(search).toHaveValue('open');

		await expect.element(getByRole('button', { name: /^OpenAI\b/ })).toBeVisible();
		await expect.element(getByRole('button', { name: /^OpenRouter\b/ })).toBeVisible();
		await expect.element(getByRole('heading', { name: 'Cloud APIs' })).toBeVisible();
		await expect.element(getByRole('heading', { name: 'Gateways' })).toBeVisible();
		await vi.waitFor(() => {
			expect(getByRole('heading', { name: 'Local' }).all()).toHaveLength(0);
			expect(getByRole('heading', { name: 'Custom' }).all()).toHaveLength(0);
		});
	});

	it('shows an empty state with a clear action when nothing matches', async () => {
		const { getByRole, getByText } = await render(ProviderTemplatePicker, {
			onselect: vi.fn()
		});

		await userEvent.fill(getByRole('textbox', { name: 'Search providers' }), 'zzz');

		await expect.element(getByText("No providers match 'zzz'.")).toBeVisible();
		await expect.element(getByRole('button', { name: 'Clear search' })).toBeVisible();
	});

	it('clearing the search restores every group and selection delegates the template', async () => {
		const onselect = vi.fn();
		const { getByRole } = await render(ProviderTemplatePicker, { onselect });

		const search = getByRole('textbox', { name: 'Search providers' });
		await userEvent.fill(search, 'zzz');
		await userEvent.click(getByRole('button', { name: 'Clear search' }));
		await expect.element(search).toHaveValue('');

		const headings = getByRole('heading', { level: 3 }).all();
		expect(headingTexts(headings.map((heading) => heading.element()))).toEqual(GROUP_HEADINGS);

		await userEvent.click(getByRole('button', { name: /^OpenAI\b/ }));
		expect(onselect).toHaveBeenCalledTimes(1);
		expect(onselect.mock.calls[0]![0]).toMatchObject({ label: 'OpenAI' });
	});
});
