import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { StorageDriver, QueryResult, BatchStatement } from './types';
import { createDb } from './proxy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../../../drizzle');

/**
 * Convert SQLite-style `?` / `?n` placeholders to PG-native `$n`.
 * Idempotent: existing `$n` passes through untouched.
 * Mirrors `server/src/pg.ts:translatePlaceholders` (kept in sync until P-pg-4
 * ports the last raw-`?` caller).
 */
function translatePlaceholders(sql: string): string {
	let n = 0;
	return sql.replace(
		/\?(\d+)?|\$(\d+)/g,
		(match, qDigits: string | undefined, dollarDigits: string | undefined) => {
			if (dollarDigits !== undefined) {
				return match;
			}
			if (qDigits !== undefined) {
				const num = parseInt(qDigits, 10);
				if (num > n) n = num;
				return `$${num}`;
			}
			n += 1;
			return `$${n}`;
		}
	);
}

function createPgTestDriver(): StorageDriver {
	const client = new PGlite();

	async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
		const res = await client.query(translatePlaceholders(sql), params);
		const cols = (res.fields as Array<{ name: string }>).map((f) => f.name);
		const rawRows = res.rows as Record<string, unknown>[];
		const rows = rawRows.map((r) => cols.map((c) => r[c]));
		return { columns: cols, rows: rows as unknown as T[] };
	}

	async function batch(stmts: BatchStatement[]): Promise<QueryResult[]> {
		const results: QueryResult[] = [];
		for (const stmt of stmts) {
			const res = await client.query(translatePlaceholders(stmt.sql), stmt.params ?? []);
			const cols = (res.fields as Array<{ name: string }>).map((f) => f.name);
			const rawRows = res.rows as Record<string, unknown>[];
			const rows = rawRows.map((r) => cols.map((c) => r[c]));
			results.push({ columns: cols, rows });
		}
		return results;
	}

	async function exec(sql: string): Promise<void> {
		await client.exec(translatePlaceholders(sql));
	}

	return {
		query,
		batch,
		exec,
		async init() {
			const db = drizzle(client);
			await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
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
