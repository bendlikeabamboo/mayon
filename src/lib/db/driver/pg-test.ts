import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { FTS_BOOTSTRAP_SQL } from '@mayon/shared';
import type { StorageDriver, QueryResult, BatchStatement } from './types';
import type { Db } from './proxy';
import { createDb } from './proxy';
import { bootstrapWithDriver } from './client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../../../drizzle');

export interface FileTestDb {
	db: Db;
	driver: StorageDriver;
}

export function useFileTestDb(): {
	setup(): Promise<FileTestDb>;
	reset(): Promise<void>;
	teardown(): Promise<void>;
} {
	let handle: FileTestDb | null = null;

	return {
		async setup() {
			if (handle) return handle;
			const driver = createPgTestDriver();
			await driver.init!();
			handle = { db: createDb(driver), driver };
			await bootstrapWithDriver(driver, 'pg');
			return handle;
		},
		async reset() {
			if (!handle) return;
			const res = await handle.driver.query(`
				SELECT string_agg(format('%I.%I', table_schema, table_name), ', ')
				FROM information_schema.tables
				WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`);
			const list = (res.rows[0] as unknown[])[0] as string | null;
			if (list) await handle.driver.exec(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
		},
		async teardown() {
			try {
				await handle?.driver.dispose?.();
			} catch {
				/* best-effort */
			}
			handle = null;
		}
	};
}

function createPgTestDriver(): StorageDriver {
	const client = new PGlite();

	async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
		const res = await client.query(sql, params);
		const cols = (res.fields as Array<{ name: string }>).map((f) => f.name);
		const rawRows = res.rows as Record<string, unknown>[];
		const rows = rawRows.map((r) => cols.map((c) => r[c]));
		return { columns: cols, rows: rows as unknown as T[] };
	}

	async function batch(stmts: BatchStatement[]): Promise<QueryResult[]> {
		const results: QueryResult[] = [];
		for (const stmt of stmts) {
			const res = await client.query(stmt.sql, stmt.params ?? []);
			const cols = (res.fields as Array<{ name: string }>).map((f) => f.name);
			const rawRows = res.rows as Record<string, unknown>[];
			const rows = rawRows.map((r) => cols.map((c) => r[c]));
			results.push({ columns: cols, rows });
		}
		return results;
	}

	async function exec(sql: string): Promise<void> {
		await client.exec(sql);
	}

	return {
		query,
		batch,
		exec,
		async init() {
			const db = drizzle(client);
			await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
			for (const sql of FTS_BOOTSTRAP_SQL) {
				await client.exec(sql);
			}
		},
		async dispose() {
			await client.close();
		}
	};
}

export async function bootstrapTestDb() {
	const driver = createPgTestDriver();
	await driver.init!();
	const db = createDb(driver);
	return { db, driver };
}
