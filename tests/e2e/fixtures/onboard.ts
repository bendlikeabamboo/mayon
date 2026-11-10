import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { MODEL_ID, MOCK_BASE_URL } from './kitchen-sink';

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
			const cleared = await request.post('/api/db/query', {
				data: {
					op: 'exec',
					sql: "DELETE FROM settings WHERE key IN ('providers', 'activeProvider')"
				}
			});
			expect(
				cleared.ok(),
				`seed failed (delete): ${cleared.status()} ${await cleared.text()}`
			).toBeTruthy();
			// Seed the exact settings rows the old UI journey produced: a
			// LiteLLM (self-hosted) card (registry.ts template fallbacks are
			// ['gpt-4o-mini', 'claude-sonnet-4-5']) whose catalog settled to the
			// mock discovery merge (discovered ids first) with 'mock-sink'
			// picked and active. Written through the same /api/db/query seam as
			// the provider-picker legacy writes; `settingsRepo.set` stores
			// JSON.stringify of the value under each key.
			const providerId = 'e2e-litellm-mock';
			const providers = {
				[providerId]: {
					id: providerId,
					kind: 'openai-compatible',
					name: 'LiteLLM (self-hosted)',
					baseUrl: MOCK_BASE_URL,
					defaultModel: MODEL_ID,
					models: [MODEL_ID, 'gpt-4o-mini', 'claude-sonnet-4-5'],
					discoverable: true,
					group: 'gateway',
					requiresKey: false,
					toolCapability: 'on'
				}
			};
			// op 'query' (not 'exec'): the server passes params only for the query
			// op — exec drops them, and request.post does not throw on 400, so an
			// exec INSERT would silently no-op and leave providers unseeded.
			const seeded = await request.post('/api/db/query', {
				data: {
					op: 'query',
					sql: 'INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4)',
					params: [
						'providers',
						JSON.stringify(providers),
						'activeProvider',
						JSON.stringify(providerId)
					]
				}
			});
			expect(
				seeded.ok(),
				`seed failed (insert): ${seeded.status()} ${await seeded.text()}`
			).toBeTruthy();
			await page.goto('/chat');
			// First-run security setup gate (skippable): boot does not start until
			// dismissed, and the prompt renders after the async auth check — wait
			// for either the gate or the app shell before proceeding. Auth
			// fail-closes boot on a dropped session fetch, so retry boot once
			// through a reload before giving up.
			const bootGate = page
				.getByRole('button', { name: 'Skip' })
				.or(page.getByRole('button', { name: 'New chat' }));
			try {
				await expect(bootGate).toBeVisible({ timeout: 15_000 });
			} catch {
				await page.reload();
				await expect(bootGate).toBeVisible({ timeout: 15_000 });
			}
			const skipSetup = page.getByRole('button', { name: 'Skip' });
			if (await skipSetup.isVisible()) {
				await skipSetup.click();
			}
			await page.getByRole('button', { name: 'New chat' }).click();
			await page.getByRole('button', { name: /Just start chatting/ }).click();
			await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible();
			// providerCard resolves lazily: consumers that use it navigate to
			// /settings#providers first, where the seeded card is the only item.
			await use({ page, providerCard: page.locator('#providers li').first() });
		},
		{ timeout: 90_000 }
	]
});

export { expect };
