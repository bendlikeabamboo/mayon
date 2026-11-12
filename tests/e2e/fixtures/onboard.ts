import type { Locator, Page } from '@playwright/test';

import { expect, test as sessionTest } from './session';

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

/**
 * Shared session state (setup project) + the session fixture replace the old
 * per-test onboarding journey. The seeded provider and chat come from the
 * direct `/api/db/query` seam, so this fixture only exposes locators.
 */
export const test = sessionTest.extend<{ onboarded: Onboarded }>({
	onboarded: async ({ session }, use) => {
		await use({
			page: session.page,
			// providerCard resolves lazily: consumers that use it navigate to
			// /settings#providers first, where the seeded card is the only item.
			providerCard: session.page.locator('#providers li').first()
		});
	}
});

export { expect };
