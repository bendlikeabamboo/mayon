/**
 * One-time migration of legacy plaintext provider keys into the runtime
 * `KeyStore` (OS keychain on desktop, IndexedDB in the browser).
 *
 * Pre-P5, API keys lived as plaintext in the `settings` KV under
 * `providerKey:<id>` (the now-removed `TODO(P5)` debt in `client.ts`). P5 moves
 * them out of the database into the secret store. This runs at boot, guarded by
 * the `settings.keysMigrated` flag, so it executes once and is idempotent:
 * migrated rows are deleted, so a partial pass only leaves the failing rows
 * behind for the next boot to retry. Invoked from the app layer
 * (`+layout.svelte`) rather than the data-layer `bootstrapDb`, keeping the
 * keystore (an AI-layer concern) out of the `src/lib/db` import graph.
 */
import { repos } from '$lib/db';
import { createKeyStore } from './client';

const LEGACY_PREFIX = 'providerKey:';

/**
 * Move every `providerKey:<id>` settings row into the runtime key store, then
 * delete it. Skipped once `keysMigrated` is set. A per-key failure (e.g. the OS
 * keychain is unavailable on a headless Linux box) never aborts the rest and
 * never deletes the failing row, so the next boot can retry it; the flag is set
 * only when every key migrated cleanly.
 */
export async function migrateLegacyKeys(): Promise<void> {
	if (await repos.settings.get<boolean>('keysMigrated')) return;

	const keyStore = createKeyStore();
	const keys = await repos.settings.keys();

	let failures = 0;
	for (const key of keys) {
		if (!key.startsWith(LEGACY_PREFIX)) continue;
		const id = key.slice(LEGACY_PREFIX.length);
		try {
			const value = await repos.settings.get<string>(key);
			if (value !== null && value !== '') {
				await keyStore.set(id, value);
			}
			await repos.settings.delete(key);
		} catch {
			// Leave this row in place so a later boot retries it; only count
			// the failure so the flag stays unset until every key migrates.
			failures += 1;
		}
	}

	if (failures === 0) {
		await repos.settings.set('keysMigrated', true);
	}
}
