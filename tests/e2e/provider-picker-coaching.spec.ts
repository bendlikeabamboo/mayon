import net from 'node:net';
import { expect, test } from './fixtures/onboard';
import { MOCK_BASE_URL, MODEL_ID } from './fixtures/kitchen-sink';
import { modelListFooter, settledModelFooter } from './fixtures/onboard';
import type { Locator, Page } from '@playwright/test';

// Split from provider-picker.spec.ts along its describe boundaries (issue #75
// / feature 038 shard rebalance): the coaching pair moved first, and the
// tool-capability describe followed after measurement — Playwright shards
// whole files, and this placement balances the listing to 17/16. The coaching
// tests are byte-identical to their originals; the capability test now owns
// its provider so the suite can share one stack.

// CI now runs the whole suite on one stack with parallel workers, so this
// file's provider mutations must not race each other. The capability test
// below also owns a provider of its own instead of mutating the shared seeded
// one, and every other spec treats that seeded provider as read-only.
test.describe.configure({ mode: 'serial' });

/** Read the persisted providers map from the direct DB seam. */
async function readProviders(page: Page): Promise<Record<string, Record<string, unknown>>> {
	const res = await page.request.post('/api/db/query', {
		data: { op: 'query', sql: "SELECT value FROM settings WHERE key = 'providers'" }
	});
	expect(res.ok(), `providers read failed: ${res.status()}`).toBeTruthy();
	const { rows } = (await res.json()) as { rows: Array<[string]> };
	return rows.length > 0
		? (JSON.parse(rows[0]![0]) as Record<string, Record<string, unknown>>)
		: {};
}

/**
 * Merge one provider row idempotently into the stored map: the seeded provider
 * keeps its position, and repeated runs overwrite only this row. Never touches
 * `activeProvider`.
 */
async function mergeProvider(
	page: Page,
	id: string,
	config: Record<string, unknown>
): Promise<void> {
	const providers = await readProviders(page);
	const res = await page.request.post('/api/db/query', {
		data: {
			op: 'query',
			sql: "INSERT INTO settings (key, value) VALUES ('providers', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
			params: [JSON.stringify({ ...providers, [id]: config })]
		}
	});
	expect(res.ok(), `providers write failed: ${res.status()}`).toBeTruthy();
}

/** Overwrite one existing provider row in place (order and active id unchanged). */
async function updateProvider(
	page: Page,
	id: string,
	patch: Record<string, unknown>
): Promise<void> {
	const providers = await readProviders(page);
	const res = await page.request.post('/api/db/query', {
		data: {
			op: 'query',
			sql: "UPDATE settings SET value = $1 WHERE key = 'providers'",
			params: [JSON.stringify({ ...providers, [id]: { ...providers[id]!, ...patch } })]
		}
	});
	expect(res.ok(), `providers update failed: ${res.status()}`).toBeTruthy();
}

test.describe('tool capability toggle', () => {
	// What the loop offered to the endpoint per capability state is proven in
	// src/lib/agent/loop.test.ts (031 parity); the spec keeps the card UI,
	// its persistence, and the legacy display contract.
	test('Enabled default renders the option pair with its hint, flips to Disabled, and the state persists', async ({
		session
	}) => {
		const { page, providerId, workerIndex } = session;
		await mergeProvider(page, providerId, {
			id: providerId,
			kind: 'openai-compatible',
			name: `E2E tool capability ${workerIndex}`,
			baseUrl: MOCK_BASE_URL,
			defaultModel: MODEL_ID,
			models: [MODEL_ID, 'gpt-4o-mini', 'claude-sonnet-4-5'],
			discoverable: false,
			requiresKey: false,
			toolCapability: 'on'
		});

		// Card contract: two explicit options, Enabled default, plain-language hint.
		await page.goto('/settings#providers');
		const providerCard = page.locator(`#providers li[data-provider-id="${providerId}"]`);
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
		// behavior, made explicit. Only this test's own row is rewritten.
		await updateProvider(page, providerId, {
			toolCapability: 'auto',
			baseUrl: 'http://localhost:9999/v1'
		});
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
