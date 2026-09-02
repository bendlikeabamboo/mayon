import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { MODEL_ID, MOCK_BASE_URL, PLACEHOLDER_KEY } from './kitchen-sink';

export interface Onboarded {
	page: Page;
	providerCard: Locator;
}

export const test = base.extend<{ onboarded: Onboarded }>({
	onboarded: [
		async ({ page, request }, use) => {
			await request.post('/api/db/query', {
				data: {
					op: 'exec',
					sql: "DELETE FROM settings WHERE key IN ('providers', 'activeProvider')"
				}
			});
			await page.goto('/settings#providers');
			const addProvider = page.getByRole('button', { name: 'Add provider' });
			await expect(addProvider).toBeEnabled();
			await addProvider.click();
			await page.getByRole('button', { name: /LiteLLM \(self-hosted\)/ }).click();
			const providerCard = page.locator('#providers li').first();
			await expect(providerCard).toBeVisible();
			await providerCard.getByLabel('Base URL').fill(MOCK_BASE_URL);
			await providerCard.getByRole('button', { name: 'Refresh model list' }).click();
			await providerCard.locator('button[aria-haspopup="dialog"]').click();
			await page.getByRole('option', { name: MODEL_ID }).click();
			await providerCard.getByLabel('API key (stored locally)').fill(PLACEHOLDER_KEY);
			await providerCard.getByRole('button', { name: 'Save key' }).click();
			await expect(providerCard.getByLabel(/Replace API key/)).toBeVisible();
			const setActive = providerCard.getByRole('button', { name: 'Set active' });
			if (await setActive.isVisible()) {
				await setActive.click();
			}
			await page.goto('/chat');
			await page.getByRole('button', { name: 'New chat' }).click();
			await page.getByRole('button', { name: /Just start chatting/ }).click();
			await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible();
			await use({ page, providerCard });
		},
		{ timeout: 90_000 }
	]
});

export { expect };
