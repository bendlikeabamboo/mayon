import Database from '@tauri-apps/plugin-sql';
import type { QueryResult, StorageDriver } from './types';

/**
 * Desktop storage driver over `@tauri-apps/plugin-sql` (native SQLite). Wraps
 * `select`/`execute` to the same `StorageDriver` contract.
 *
 * - plugin-sql's `select` returns rows as objects; drizzle's proxy consumes
 *   positional arrays, so each row is flattened with `Object.values`. This relies
 *   on the plugin returning columns in SELECT order (the documented manual gate).
 * - Writes (and RETURNING) are routed via `select`; plain mutations via `execute`.
 *
 * (Cannot be exercised in the headless CI sandbox — manual gate, see AGENTS.md
 * "Desktop (native SQLite)".)
 */
const READ_PATTERN = /^\s*(SELECT|WITH|VALUES|PRAGMA)\b/i;

function isRead(sql: string): boolean {
	return READ_PATTERN.test(sql) || /\bRETURNING\b/i.test(sql);
}

export async function createTauriDriver(): Promise<StorageDriver> {
	const db = await Database.load('sqlite:mayon.db');
	await db.execute('PRAGMA foreign_keys = ON');

	return {
		async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
			if (isRead(sql)) {
				const rows = (await db.select(sql, params)) as Record<string, unknown>[];
				return { rows: rows.map((r) => Object.values(r)) as T[] };
			}
			await db.execute(sql, params);
			return { rows: [] as T[] };
		},
		async exec(sql: string): Promise<void> {
			await db.execute(sql);
		},
		async batch(stmts): Promise<QueryResult[]> {
			const out: QueryResult[] = [];
			for (const s of stmts) {
				if (isRead(s.sql)) {
					const rows = (await db.select(s.sql, s.params ?? [])) as Record<string, unknown>[];
					out.push({ rows: rows.map((r) => Object.values(r)) });
				} else {
					await db.execute(s.sql, s.params ?? []);
					out.push({ rows: [] });
				}
			}
			return out;
		}
	};
}
