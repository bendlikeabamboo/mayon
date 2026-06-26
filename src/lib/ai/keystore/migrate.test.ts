import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { KeyStore } from './types';

// In-memory stand-in for the runtime KeyStore. Created via `vi.hoisted` so it is
// available inside the (hoisted) `vi.mock('./client')` factory below.
const mocks = vi.hoisted(() => {
	const store = new Map<string, string>();
	const setCalls: Array<[id: string, key: string]> = [];
	// `null` = accept all; a specific id = make `set` reject for that id only.
	let rejectId: string | null = null;
	return {
		setCalls,
		setRejectId(id: string | null): void {
			rejectId = id;
		},
		reset(): void {
			store.clear();
			setCalls.length = 0;
			rejectId = null;
		},
		fakeStore: {
			set: async (id: string, key: string): Promise<void> => {
				setCalls.push([id, key]);
				if (rejectId !== null && id === rejectId) throw new Error(`boom for ${id}`);
				store.set(id, key);
			},
			has: async (id: string): Promise<boolean> => store.has(id),
			delete: async (id: string): Promise<void> => {
				store.delete(id);
			}
		} satisfies KeyStore
	};
});

// Mock the keystore selector relative to migrate.ts (`./client`); the real
// desktop/browser stores (and their Tauri/IDB deps) never load.
vi.mock('./client', () => ({ createKeyStore: () => mocks.fakeStore }));

import { migrateLegacyKeys } from './migrate';

describe('migrateLegacyKeys', () => {
	beforeEach(async () => {
		mocks.reset();
		// Fresh in-memory DB per test (same bootstrap pattern as repositories.test.ts).
		await bootstrapWithDriver(await createMemoryDriver());
		// Seed legacy rows + an unrelated key. No `keysMigrated` flag yet.
		await repos.settings.set('providerKey:p1', 'secret-1');
		await repos.settings.set('providerKey:p2', 'secret-2');
		await repos.settings.set('theme', 'dark');
	});

	it('moves providerKey rows into the key store, deletes them, and sets the flag', async () => {
		await migrateLegacyKeys();

		expect(mocks.setCalls).toContainEqual(['p1', 'secret-1']);
		expect(mocks.setCalls).toContainEqual(['p2', 'secret-2']);

		const keys = await repos.settings.keys();
		expect(keys).not.toContain('providerKey:p1');
		expect(keys).not.toContain('providerKey:p2');
		expect(keys).toContain('theme');
		expect(await repos.settings.get<boolean>('keysMigrated')).toBe(true);
	});

	it('is idempotent: a second run is a no-op once the flag is set', async () => {
		await migrateLegacyKeys();
		mocks.setCalls.length = 0;

		await migrateLegacyKeys();

		expect(mocks.setCalls).toHaveLength(0);
		expect(await repos.settings.get<boolean>('keysMigrated')).toBe(true);
	});

	it('keeps a failing row and leaves keysMigrated unset so the next boot retries', async () => {
		mocks.setRejectId('p2');

		await migrateLegacyKeys();

		// p1 migrated + deleted; p2 failed so its row stays in settings.
		expect(mocks.setCalls).toContainEqual(['p1', 'secret-1']);
		const keys = await repos.settings.keys();
		expect(keys).not.toContain('providerKey:p1');
		expect(keys).toContain('providerKey:p2');
		// Flag NOT set → retried on the next boot.
		expect(await repos.settings.get<boolean>('keysMigrated')).toBeNull();
	});
});
