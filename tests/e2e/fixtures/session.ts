import { expect, type Page } from '@playwright/test';

import { createChat } from './seed';
import { test as networkTest } from './network';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';

export interface Session {
	page: Page;
	workerIndex: number;
	/** Worker-scoped provider id for specs that create or mutate their own provider. */
	providerId: string;
	/** A root chat created through the direct DB seam for this test only. */
	chatId: string;
}

export const test = networkTest.extend<{ session: Session }, { providerId: string }>({
	providerId: [
		// eslint-disable-next-line no-empty-pattern -- worker fixture needs only workerInfo
		async ({}, use, workerInfo) => {
			await use(`e2e-provider-${workerInfo.workerIndex}`);
		},
		{ scope: 'worker' }
	],

	session: async ({ page, providerId, baseURL }, use, testInfo) => {
		const url = baseURL ?? DEFAULT_BASE_URL;
		// page.request shares the browser context cookies, so a locked server
		// accepts the DB write when the setup project stored an authenticated
		// session.
		const chatId = await createChat(page.request, url, `E2E chat ${testInfo.workerIndex}`);
		await page.goto(new URL(`/chat/${chatId}`, url).toString());
		await expect(page.getByPlaceholder(/Message the active provider/)).toBeVisible();
		await use({ page, workerIndex: testInfo.workerIndex, providerId, chatId });
	}
});

export { expect };
