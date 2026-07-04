import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver, getDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { runMigrations } from '$lib/db/driver/migrator';
import migrations from '$lib/db/driver/migrations';
import {
	checkBackup,
	validateBackupBytes,
	REQUIRED_TABLES,
	maxKnownMigrationMillis
} from '$lib/db/backup';

const ALL_TABLES = new Set(REQUIRED_TABLES);

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

describe('maxKnownMigrationMillis', () => {
	it('equals Math.max of bundled migration folderMillis', () => {
		const expected = Math.max(...migrations.map((m) => m.folderMillis));
		expect(maxKnownMigrationMillis()).toBe(expected);
	});
});

describe('checkBackup (pure)', () => {
	it('ok for valid input', () => {
		expect(checkBackup({ headerOk: true, tables: ALL_TABLES, maxAppliedMillis: null })).toEqual({
			ok: true
		});
	});

	it('rejects when headerOk is false', () => {
		const r = checkBackup({ headerOk: false, tables: ALL_TABLES, maxAppliedMillis: null });
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('SQLite');
	});

	it('rejects when a required table is missing', () => {
		const tables = new Set(REQUIRED_TABLES);
		tables.delete('chats');
		const r = checkBackup({ headerOk: true, tables, maxAppliedMillis: null });
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('chats');
	});

	it('rejects when maxAppliedMillis exceeds maxKnown', () => {
		const r = checkBackup({
			headerOk: true,
			tables: ALL_TABLES,
			maxAppliedMillis: maxKnownMigrationMillis() + 1000
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('newer app version');
	});

	it('ok when maxAppliedMillis is null (legacy DB)', () => {
		expect(checkBackup({ headerOk: true, tables: ALL_TABLES, maxAppliedMillis: null })).toEqual({
			ok: true
		});
	});

	it('ok when maxAppliedMillis equals maxKnown', () => {
		expect(
			checkBackup({
				headerOk: true,
				tables: ALL_TABLES,
				maxAppliedMillis: maxKnownMigrationMillis()
			})
		).toEqual({ ok: true });
	});

	it('ok when maxAppliedMillis is less than maxKnown', () => {
		expect(
			checkBackup({
				headerOk: true,
				tables: ALL_TABLES,
				maxAppliedMillis: maxKnownMigrationMillis() - 1
			})
		).toEqual({ ok: true });
	});
});

describe('validateBackupBytes', () => {
	it('round-trips a memory-driver snapshot', async () => {
		const bytes = await getDriver().snapshot!();
		const r = await validateBackupBytes(bytes);
		expect(r.ok).toBe(true);
	});

	it('rejects corrupt bytes', async () => {
		const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
		const r = await validateBackupBytes(bytes);
		expect(r.ok).toBe(false);
	});

	it('rejects random bytes that are too short', async () => {
		const bytes = new Uint8Array([0x53, 0x51]);
		const r = await validateBackupBytes(bytes);
		expect(r.ok).toBe(false);
	});
});

describe('snapshot/restore round-trip (memory driver)', () => {
	it('preserves chats and settings after restore', async () => {
		const driver = getDriver();
		await driver.exec(
			"INSERT INTO chats (id, root_id, title, depth, created_at, updated_at) VALUES ('c1', 'c1', 'Test Chat', 0, 1, 1)"
		);
		await driver.exec("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"')");

		const bytes = await driver.snapshot!();

		const freshDriver = await createMemoryDriver();
		await freshDriver.restore!(bytes);
		await bootstrapWithDriver(freshDriver);

		const chatRows = await getDriver().query("SELECT title FROM chats WHERE id = 'c1'");
		expect(chatRows.rows).toHaveLength(1);
		expect((chatRows.rows[0] as unknown[])[0]).toBe('Test Chat');

		const settingRows = await getDriver().query("SELECT value FROM settings WHERE key = 'theme'");
		expect(settingRows.rows).toHaveLength(1);
		expect((settingRows.rows[0] as unknown[])[0]).toBe('"dark"');

		const keyRows = await getDriver().query(
			"SELECT key FROM settings WHERE key LIKE 'providerKey:%'"
		);
		expect(keyRows.rows).toHaveLength(0);
	});
});

describe('migrate-forward', () => {
	it('applies pending migrations after restoring an older backup', async () => {
		const oldDriver = await createMemoryDriver();
		await runMigrations(oldDriver, migrations.slice(0, -1));
		await oldDriver.exec(
			"INSERT INTO chats (id, root_id, title, depth, created_at, updated_at) VALUES ('c1', 'c1', 'Old DB', 0, 1, 1)"
		);
		const bytes = await oldDriver.snapshot!();

		const freshDriver = await createMemoryDriver();
		await freshDriver.restore!(bytes);
		await bootstrapWithDriver(freshDriver);

		const migRows = await getDriver().query('SELECT COUNT(*) as cnt FROM __drizzle_migrations');
		expect(Number((migRows.rows[0] as unknown[])[0])).toBe(migrations.length);

		const chatRows = await getDriver().query("SELECT title FROM chats WHERE id = 'c1'");
		expect(chatRows.rows).toHaveLength(1);
	});
});
