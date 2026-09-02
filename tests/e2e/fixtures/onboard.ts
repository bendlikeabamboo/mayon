import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { MODEL_ID, MOCK_BASE_URL, PLACEHOLDER_KEY } from './kitchen-sink';

export interface Onboarded {
	page: Page;
	providerCard: Locator;
}

/**
 * The card footer that reports the known model count and discovery state.
 * Whitespace is matched flexibly: Svelte preserves the template newline
 * between "N models" and the "· …" suffix in the raw DOM text.
 */
export function modelListFooter(providerCard: Locator): Locator {
	return providerCard.locator('p').filter({ hasText: /models\s*·/ });
}

/** The settled footer text for a card whose catalog holds `count` models. */
export function settledModelFooter(count: number): RegExp {
	return new RegExp(`^${count} models\\s*·\\s*click ⟳ to refresh$`);
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
			// First-run security setup gate (skippable): boot does not start until
			// dismissed, and the prompt renders after the async auth check — wait
			// for either the gate or the app shell before proceeding.
			await expect(
				page
					.getByRole('button', { name: 'Skip' })
					.or(page.getByRole('button', { name: 'Add provider' }))
			).toBeVisible({ timeout: 15_000 });
			const skipSetup = page.getByRole('button', { name: 'Skip' });
			if (await skipSetup.isVisible()) {
				await skipSetup.click();
			}
			const addProvider = page.getByRole('button', { name: 'Add provider' });
			await expect(addProvider).toBeVisible();
			await addProvider.click();
			await page.getByRole('button', { name: /LiteLLM \(self-hosted\)/ }).click();
			const providerCard = page.locator('#providers li').first();
			await expect(providerCard).toBeVisible();

			// Commit the endpoint edit with an explicit blur before any card
			// clicks: the commit re-renders the card, and a physical click that
			// straddles that re-render is silently lost (mousedown hits the old
			// node, mouseup lands on its parent).
			const baseUrl = providerCard.getByLabel('Base URL');
			await baseUrl.fill(MOCK_BASE_URL);
			await baseUrl.press('Tab');
			const footer = modelListFooter(providerCard);
			// The add-time discovery failed against the template URL, so the
			// template's 2 fallback models are all the card knows.
			await expect(footer).toHaveText(settledModelFooter(2));

			await providerCard.getByRole('button', { name: 'Refresh model list' }).click();
			// This exact state only renders once the mock catalog has been
			// discovered and merged over the template's 2 fallback models.
			await expect(footer).toHaveText(settledModelFooter(3));
			await providerCard.locator('button[aria-haspopup="dialog"]').click();
			await page.getByRole('option', { name: MODEL_ID }).click();

			await providerCard.getByLabel('API key (stored locally)').fill(PLACEHOLDER_KEY);
			await providerCard.getByRole('button', { name: 'Save key' }).click();
			await expect(providerCard.getByLabel(/Replace API key/)).toBeVisible();
			// Saving a key re-runs discovery; let it settle before more clicks.
			await expect(footer).toHaveText(settledModelFooter(3));

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
