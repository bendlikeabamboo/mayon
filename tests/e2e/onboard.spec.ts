import { expect } from './fixtures/onboard';
import { test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	HEADING_PROBE,
	LATE_MARKER,
	MOCK_BASE_URL,
	MODEL_ID,
	PROSE_PROBE
} from './fixtures/kitchen-sink';

test.describe('mock-llm onboarding and round trip', () => {
	test('onboards the mock provider and completes a deterministic round trip', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill('Explain the kitchen sink');
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		const live = page.locator('#msg-live-text');
		await expect(live).toContainText(EARLY_MARKER);
		expect(await live.innerText()).not.toContain(LATE_MARKER);

		const reply = page.locator('.markdown-body', { hasText: LATE_MARKER });
		await expect(reply).toBeVisible();
		await expect(live).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1, name: HEADING_PROBE })).toBeVisible();
		await expect(page.locator('.markdown-body', { hasText: PROSE_PROBE })).toBeVisible();
		await expect(page.locator('div[class*="border-red-500/40"]')).toHaveCount(0);
	});

	test('discovers the mock catalog through the proxy', async ({ onboarded }) => {
		const { page, providerCard } = onboarded;
		await page.goto('/settings#providers');
		await expect(providerCard.getByLabel('Base URL')).toHaveValue(MOCK_BASE_URL);
		await providerCard.getByRole('button', { name: 'Refresh model list' }).click();
		await providerCard.locator('button[aria-haspopup="dialog"]').click();
		await expect(page.getByRole('option', { name: MODEL_ID })).toBeVisible();
		await page.keyboard.press('Escape');
	});
});
