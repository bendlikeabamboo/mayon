import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../schema';
import type { StorageDriver, QueryResult } from './types';
import { createDb } from './proxy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../../drizzle');

let pool: pg.Pool | null = null;

export async function setupGlobalTestPg(): Promise<void> {
	if (pool) return;
	pool = new pg.Pool({
		connectionString:
			process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/test'
	});
	try {
		await pool.connect();
		const db = drizzle(pool, { schema });
		await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
		console.log('[pg-test] migrations applied (template)');
	} catch (err) {
		console.error('[pg-test] globalSetup failed —', err);
		await pool.end();
		pool = null;
		throw err;
	}
}

export async function teardownGlobalTestPg(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

function createPgTestDriver(): StorageDriver {
	if (!pool) throw new Error('Test PG pool not initialized. Call setupGlobalTestPg() first.');
	const client = new pg.Client({
		connectionString:
			process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/test'
	});
	const schemaName = `t${Math.random().toString(36).slice(2)}`;

	async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
		await client.query(`SET search_path TO "${schemaName}"`);
		const res = await client.query(sql, params);
		const columns = res.fields.map((f) => f.name);
		const rows = res.rows.map((r) => res.fields.map((f) => r[f.name])) as T[][];
		return { columns, rows: rows as T[] };
	}

	async function batch(stmts: Array<{ sql: string; params?: unknown[] }>): Promise<QueryResult[]> {
		await client.query('BEGIN');
		await client.query(`SET search_path TO "${schemaName}"`);
		const results: QueryResult[] = [];
		try {
			for (const stmt of stmts) {
				const res = await client.query(stmt.sql, stmt.params);
				if (res.fields.length > 0) {
					const columns = res.fields.map((f) => f.name);
					const rows = res.rows.map((r: Record<string, unknown>) =>
						res.fields.map((f) => r[f.name])
					);
					results.push({ columns, rows });
				} else {
					results.push({ columns: [], rows: [] });
				}
			}
			await client.query('COMMIT');
			return results;
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		}
	}

	async function exec(sql: string): Promise<void> {
		await client.query(`SET search_path TO "${schemaName}"`);
		await client.query(sql);
	}

	return {
		query,
		batch,
		exec,
		async init() {
			await client.connect();
			await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
			await client.query(`SET search_path TO "${schemaName}"`);
			const db = drizzle(client, { schema });
			await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
		},
		async dispose() {
			if (schemaName) {
				await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
			}
			await client.end();
		}
	};
}

export async function bootstrapTestDb() {
	const driver = createPgTestDriver();
	await driver.init!();
	const db = createDb(driver);
	return { db, driver };
}
