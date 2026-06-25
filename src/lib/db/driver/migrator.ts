import type { MigrationMeta, StorageDriver } from './types';

const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Run pending migrations against a `StorageDriver` using the bundled journal —
 * no runtime `fs`, so it works in the browser/worker.
 *
 * This mirrors drizzle's own proxy `migrate()` (`__drizzle_migrations` table, ordering
 * by the journal `when` timestamp) but reads from a build-time-bundled module instead of
 * the filesystem. The on-disk drizzle migrator cannot be used directly: it imports
 * `node:fs` / `node:crypto` and reads `meta/_journal.json` at call time.
 */
export async function runMigrations(
	driver: StorageDriver,
	migrations: MigrationMeta[]
): Promise<void> {
	await driver.exec(
		`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} ` +
			'(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
	);

	const { rows } = await driver.query<[number, string, number]>(
		`SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`
	);
	const last = rows[0];
	const lastTs = last ? Number(last[2]) : -1;

	const pending = migrations.filter((m) => lastTs < m.folderMillis);
	if (pending.length === 0) return;

	for (const m of pending) {
		for (const stmt of m.sql) {
			const trimmed = stmt.trim();
			if (trimmed) await driver.exec(trimmed);
		}
		// hash is sha256-hex, folderMillis is a number — safe to inline.
		await driver.exec(
			`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) ` +
				`VALUES ('${m.hash}', ${m.folderMillis})`
		);
	}
}
