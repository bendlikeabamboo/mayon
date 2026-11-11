import net from 'node:net';
import { expect, test } from './fixtures/onboard';
import { MOCK_BASE_URL } from './fixtures/kitchen-sink';
import { modelListFooter, settledModelFooter } from './fixtures/onboard';
import type { Locator, Page } from '@playwright/test';

// Split from provider-picker.spec.ts along its describe boundaries (issue #75
// / feature 038 shard rebalance): the coaching pair moved first, and the
// tool-capability describe followed after measurement — Playwright shards
// whole files, and this placement balances the listing to 17/16. Tests are
// byte-identical to their originals.

test.describe('tool capability toggle', () => {
	// What the loop offered to the endpoint per capability state is proven in
	// src/lib/agent/loop.test.ts (031 parity); the spec keeps the card UI,
	// its persistence, and the legacy display contract.
	test('Enabled default renders the option pair with its hint, flips to Disabled, and the state persists', async ({
		onboarded
	}) => {
		const { page, providerCard } = onboarded;

		// Card contract: two explicit options, Enabled default, plain-language hint.
		await page.goto('/settings#providers');
		const capability = providerCard.getByLabel('Tool capability');
		await expect(capability).toHaveValue('on');
		await expect(capability.locator('option')).toHaveText(['Enabled', 'Disabled']);
		await expect(
			providerCard.getByText("Tools let the agent call Mayon's tools through this provider.")
		).toBeVisible();

		// Disabled: flip and let the existing updateField/commit save settle.
		await capability.selectOption('off');
		await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
		await expect(capability).toHaveValue('off');

		// Reload: the Disabled assertion persisted.
		await page.goto('/settings#providers');
		await expect(providerCard.getByLabel('Tool capability')).toHaveValue('off');

		// Legacy normalization display: stored 'auto' (pre-upgrade data) on this
		// non-allowlisted custom URL displays as Disabled — the prior effective
		// behavior, made explicit (write pattern mirrors the onboarded fixture's
		// direct /api/db/query access).
		const provRes = await page.request.post('/api/db/query', {
			data: { op: 'query', sql: "SELECT value FROM settings WHERE key = 'providers'" }
		});
		const { rows } = (await provRes.json()) as { rows: Array<[string]> };
		const stored = JSON.parse(rows[0]![0]) as Record<string, Record<string, unknown>>;
		const providerId = Object.keys(stored)[0]!;
		stored[providerId] = {
			...stored[providerId]!,
			toolCapability: 'auto',
			baseUrl: 'http://localhost:9999/v1'
		};
		const legacyRes = await page.request.post('/api/db/query', {
			data: {
				op: 'query',
				sql: "UPDATE settings SET value = $1 WHERE key = 'providers'",
				params: [JSON.stringify(stored)]
			}
		});
		expect(legacyRes.ok(), `legacy write failed: ${legacyRes.status()}`).toBeTruthy();
		await page.goto('/settings#providers');
		await expect(providerCard.getByLabel('Tool capability')).toHaveValue('off');
	});
});

test.describe('connection coaching', () => {
	/** Add an LM Studio (local) card pointed at `url`, blur-committed and save-settled. */
	async function addLocalProvider(page: Page, url: string): Promise<Locator> {
		await page.goto('/settings#providers');
		await page.getByRole('button', { name: 'Add provider' }).click();
		await page.getByRole('button', { name: /LM Studio \(local\)/ }).click();
		const card = page.locator('#providers li').last();
		await expect(card).toBeVisible();
		const baseUrl = card.getByLabel('Base URL');
		await baseUrl.fill(url);
		// Tab-commit like the onboarded fixture: the commit re-renders the card,
		// so settle the save before the next physical click on it.
		await baseUrl.press('Tab');
		await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
		return card;
	}

	test('dead port classifies as Server not running with a start-the-server remedy', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		// A listener that accepts and immediately destroys guarantees a fast,
		// unambiguous connection-level failure in every environment: a fully
		// closed port can be silently dropped by restrictive networks, which
		// would classify as timeout instead of not-running.
		const killer = net.createServer((socket) => socket.destroy());
		const port = await new Promise<number>((resolve) => {
			killer.listen(0, '127.0.0.1', () => resolve((killer.address() as net.AddressInfo).port));
		});
		try {
			const card = await addLocalProvider(page, `http://127.0.0.1:${port}/v1`);
			await card.getByRole('button', { name: 'Test connection' }).click();
			const status = page.getByRole('status');
			await expect(status).toContainText('Server not running');
			await expect(status).toContainText(`Nothing is listening at http://127.0.0.1:${port}/v1`);
		} finally {
			killer.close();
		}
	});

	test('live endpoint reports Connection OK with the discovered model count', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		const card = await addLocalProvider(page, MOCK_BASE_URL);
		await card.getByRole('button', { name: 'Test connection' }).click();
		await expect(page.getByRole('status')).toContainText('Connection OK — 1 model found.');
		// The discovered catalog merges into the card (discovery-first local
		// template ships no fallback models).
		await expect(modelListFooter(card)).toHaveText(settledModelFooter(1), { timeout: 20_000 });
	});
});
