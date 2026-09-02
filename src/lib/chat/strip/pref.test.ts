import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb, type FileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { STRIP_ENABLED_KEY, isStripEnabled, setStripEnabled } from './pref';

const testDb = useFileTestDb();
let fileDb: FileTestDb;
beforeAll(async () => {
	fileDb = await testDb.setup();
});
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('strip pref — key identity', () => {
	it('uses exactly the sectionStripEnabled settings key', () => {
		expect(STRIP_ENABLED_KEY).toBe('sectionStripEnabled');
	});
});

describe('strip pref — round-trip persistence', () => {
	it('round-trips setStripEnabled(false) to false', async () => {
		await setStripEnabled(false);
		await expect(isStripEnabled()).resolves.toBe(false);
	});

	it('round-trips setStripEnabled(true) to true', async () => {
		await setStripEnabled(true);
		await expect(isStripEnabled()).resolves.toBe(true);
	});
});

describe('strip pref — defensive defaults', () => {
	it('defaults to true when the key is missing', async () => {
		await expect(isStripEnabled()).resolves.toBe(true);
	});

	it('defaults to true for corrupt JSON without throwing', async () => {
		await setStripEnabled(false);
		await fileDb.driver.exec(
			`UPDATE settings SET value = '{not json' WHERE key = '${STRIP_ENABLED_KEY}'`
		);
		await expect(isStripEnabled()).resolves.toBe(true);
	});

	it('defaults to true for wrong-typed values', async () => {
		await repos.settings.set(STRIP_ENABLED_KEY, 'false' as unknown as boolean);
		await expect(isStripEnabled()).resolves.toBe(true);

		await repos.settings.set(STRIP_ENABLED_KEY, 0 as unknown as boolean);
		await expect(isStripEnabled()).resolves.toBe(true);

		await repos.settings.set(STRIP_ENABLED_KEY, null as unknown as boolean);
		await expect(isStripEnabled()).resolves.toBe(true);
	});
});
