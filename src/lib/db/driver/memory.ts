import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QueryResult, StorageDriver } from './types';

let sqlPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

async function loadSql() {
	if (sqlPromise) return sqlPromise;
	sqlPromise = (async () => {
		const sqljsMain = import.meta.resolve('sql.js');
		const dir = dirname(fileURLToPath(sqljsMain));
		const wasmBinary = readFileSync(join(dir, 'sql-wasm.wasm'));
		return initSqlJs({ wasmBinary: wasmBinary as never });
	})();
	return sqlPromise;
}

/**
 * In-memory SQLite for Vitest (OPFS/Tauri are unavailable under Node/jsdom).
 * Implements the same `StorageDriver` contract and feeds `createDb`, so repository
 * tests exercise the real drizzle proxy path.
 */
export async function createMemoryDriver(): Promise<StorageDriver> {
	const SQL = await loadSql();
	const db = new SQL.Database();
	db.run('PRAGMA foreign_keys = ON');

	function toRows(result: ReturnType<Database['exec']>): SqlValue[][] {
		return result.length > 0 ? result[0].values : [];
	}

	return {
		async query<T>(_sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
			const res = db.exec(_sql, params as SqlValue[]);
			return { rows: toRows(res) as T[] };
		},
		async exec(sql: string): Promise<void> {
			db.run(sql);
		},
		async batch(stmts): Promise<QueryResult[]> {
			db.run('BEGIN');
			try {
				const out = stmts.map((s) => {
					const res = db.exec(s.sql, (s.params ?? []) as SqlValue[]);
					return { rows: toRows(res) };
				});
				db.run('COMMIT');
				return out;
			} catch (err) {
				db.run('ROLLBACK');
				throw err;
			}
		}
	};
}

/** Export the sql.js Database type for callers that need raw access in tests. */
export type { Database };
