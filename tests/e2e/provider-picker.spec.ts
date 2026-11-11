import { expect, test } from './fixtures/onboard';

const GROUP_HEADINGS = ['Local', 'Cloud APIs', 'Gateways', 'Custom'];

async function openPicker(page: import('@playwright/test').Page) {
	await page.goto('/settings#providers');
	await page.getByRole('button', { name: 'Add provider' }).click();
}

test.describe('grouped provider picker', () => {
	test('shows the four groups in order', async ({ onboarded }) => {
		const { page } = onboarded;
		await openPicker(page);
		const headings = page.locator('#providers').getByRole('heading', { level: 3 });
		await expect(headings).toHaveText(GROUP_HEADINGS);
	});

	test('search matches across groups and hides empty groups', async ({ onboarded }) => {
		const { page } = onboarded;
		await openPicker(page);
		const picker = page.locator('#providers');
		await page.getByRole('textbox', { name: 'Search providers' }).fill('open');
		await expect(picker.getByRole('button', { name: /^OpenAI\b/ })).toBeVisible();
		await expect(picker.getByRole('button', { name: /^OpenRouter\b/ })).toBeVisible();
		await expect(picker.getByRole('heading', { name: 'Cloud APIs' })).toBeVisible();
		await expect(picker.getByRole('heading', { name: 'Gateways' })).toBeVisible();
		await expect(picker.getByRole('heading', { name: 'Local' })).toBeHidden();
		await expect(picker.getByRole('heading', { name: 'Custom' })).toBeHidden();
	});

	test('shows an empty state with a clear action when nothing matches', async ({ onboarded }) => {
		const { page } = onboarded;
		await openPicker(page);
		await page.getByRole('textbox', { name: 'Search providers' }).fill('zzz');
		await expect(page.getByText("No providers match 'zzz'.")).toBeVisible();
		await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
	});

	test('clearing the search restores every group', async ({ onboarded }) => {
		const { page } = onboarded;
		await openPicker(page);
		const search = page.getByRole('textbox', { name: 'Search providers' });
		await search.fill('zzz');
		await page.getByRole('button', { name: 'Clear search' }).click();
		await expect(search).toHaveValue('');
		const headings = page.locator('#providers').getByRole('heading', { level: 3 });
		await expect(headings).toHaveText(GROUP_HEADINGS);
		await expect(
			page.locator('#providers').getByRole('button', { name: /^OpenAI\b/ })
		).toBeVisible();
	});
});
