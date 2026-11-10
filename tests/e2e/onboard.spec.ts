import { expect, test } from './fixtures/onboard';
import { liveText } from './fixtures/render';
import { EARLY_MARKER, HEADING_PROBE, LATE_MARKER, PROSE_PROBE } from './fixtures/kitchen-sink';

test.describe('mock-llm onboarding and round trip', () => {
	test('onboards the mock provider and completes a deterministic round trip', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill('Explain the kitchen sink');
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		const live = liveText(page);
		await expect(live.first()).toContainText(EARLY_MARKER);
		expect(await live.first().innerText()).not.toContain(LATE_MARKER);

		const reply = page.locator('.markdown-body', { hasText: LATE_MARKER });
		await expect(reply).toBeVisible();
		await expect(live).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1, name: HEADING_PROBE })).toBeVisible();
		await expect(page.locator('.markdown-body', { hasText: PROSE_PROBE })).toBeVisible();
		await expect(page.locator('div[class*="border-red-500/40"]')).toHaveCount(0);
	});
});
