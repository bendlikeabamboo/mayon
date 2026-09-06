import { expect, test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	LAB_CHECKLIST_TEXTS,
	LAB_STEPS,
	LAB_TITLE,
	LATE_MARKER
} from './fixtures/kitchen-sink';
import type { Page } from '@playwright/test';

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering. Generation buttons need a non-empty conversation: lab
 * generation derives its context from the chat transcript (the store fails
 * fast before any request when the chat has no turns), so every generation
 * journey starts here. (Same pattern as mock-classification.spec.ts.)
 */
async function chatRoundTrip(page: Page): Promise<void> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Explain the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.locator('#msg-live-text')).toContainText(EARLY_MARKER);
	await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible();
	await expect(page.locator('#msg-live-text')).toHaveCount(0);
}

test.describe('lab RC verification deck', () => {
	test('generates a lab from the deterministic reply and steps it to completion', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await chatRoundTrip(page);

		// lab_generation through the real proxy path: /lab/[id] renders the
		// fixture payload — title as a level-1 heading and every step in the
		// markdown body.
		await page.locator('button[aria-label="Generate lab"]').click();
		await expect(page).toHaveURL(/\/lab\//, { timeout: 30_000 });
		await expect(page.getByRole('heading', { level: 1, name: LAB_TITLE })).toBeVisible();
		for (const step of LAB_STEPS) {
			await expect(page.getByText(step)).toBeVisible();
		}

		const total = LAB_CHECKLIST_TEXTS.length;
		// Check every checklist item; the header progress reaches full. Each
		// click's persist must settle before the next: the checklist persists
		// as ONE JSON document, so overlapping read-modify-write toggles can
		// lose an update (machine-speed clicking exposes what human pacing
		// never would — a latent product race, out of this feature's scope).
		// Waiting for the row-count state to settle per click keeps the deck
		// deterministic without changing the product.
		for (const [i, item] of LAB_CHECKLIST_TEXTS.entries()) {
			await page.getByLabel(item).check();
			await expect(page.getByText(`${i + 1}/${total} done`)).toBeVisible();
			await expect(page.getByLabel(item)).toBeChecked();
		}
		await expect(page.getByText(`${total}/${total} done`)).toBeVisible();

		// Optimistic toggles persist via labsStore: after a reload every item
		// is still done. Let in-flight persists drain before reloading.
		await page.waitForLoadState('networkidle');
		await page.reload();
		await expect(page.getByRole('heading', { level: 1, name: LAB_TITLE })).toBeVisible();
		for (const item of LAB_CHECKLIST_TEXTS) {
			await expect(page.getByLabel(item)).toBeChecked();
		}
	});
});
