import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

describe('POST /api/db/query', () => {
	let app: ReturnType<typeof buildApp>;
	let memApp: ReturnType<typeof buildApp>;
	let tmpDir: string;
	let dbPath: string;

	beforeAll(async () => {
		memApp = buildApp(':memory:');
		await memApp.listen({ port: 0, host: '0.0.0.0' });

		tmpDir = mkdtempSync(join(tmpdir(), 'sandbox-db-test-'));
		dbPath = join(tmpDir, 'test.sqlite');
		app = buildApp(dbPath);
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await memApp.close();
		await app.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe('op: query', () => {
		it('returns columns and rows for a CREATE + INSERT + SELECT', async () => {
			const appRef = memApp;
			await appRef.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'CREATE TABLE test_query(id INTEGER PRIMARY KEY, name TEXT)' }
			});
			await appRef.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: "INSERT INTO test_query(name) VALUES('alice')" }
			});
			const res = await appRef.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT * FROM test_query' }
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.columns).toEqual(['id', 'name']);
			expect(body.rows).toEqual([[1, 'alice']]);
		});

		it('round-trips bound ? params', async () => {
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT ? as v, ? as doubled', params: [7, 14] }
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.rows).toEqual([[7, 14]]);
		});
	});

	describe('op: exec', () => {
		it('reports changes and lastInsertRowid', async () => {
			await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'CREATE TABLE test_exec(x INTEGER)' }
			});
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'INSERT INTO test_exec(x) VALUES(42)' }
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.changes).toBe(1);
			expect(body.lastInsertRowid).toBeGreaterThanOrEqual(1);
		});
	});

	describe('op: batch', () => {
		it('runs all statements in a transaction and returns per-statement results', async () => {
			await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'CREATE TABLE test_batch(id INTEGER PRIMARY KEY, v TEXT)' }
			});
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: {
					op: 'batch',
					stmts: [
						{ sql: "INSERT INTO test_batch(v) VALUES('a')" },
						{ sql: "INSERT INTO test_batch(v) VALUES('b')" },
						{ sql: 'SELECT * FROM test_batch ORDER BY id' }
					]
				}
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.results).toHaveLength(3);
			expect(body.results[2].rows).toEqual([
				[1, 'a'],
				[2, 'b']
			]);
		});

		it('rolls back on a failing statement', async () => {
			await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'CREATE TABLE test_rollback(id INTEGER PRIMARY KEY)' }
			});
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: {
					op: 'batch',
					stmts: [
						{ sql: 'INSERT INTO test_rollback(id) VALUES(1)' },
						{ sql: 'INVALID SQL' },
						{ sql: 'INSERT INTO test_rollback(id) VALUES(2)' }
					]
				}
			});
			expect(res.statusCode).toBe(400);
			const body = res.json();
			expect(body.error).toBeDefined();

			const check = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT count(*) FROM test_rollback' }
			});
			expect(check.json().rows[0][0]).toBe(0);
		});
	});

	describe('error handling', () => {
		it('returns 400-class on malformed body (no content-type → 415)', async () => {
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				payload: 'not json'
			});
			expect(res.statusCode).toBeGreaterThanOrEqual(400);
		});

		it('returns 400 on missing op (schema validation)', async () => {
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { sql: 'SELECT 1' }
			});
			expect(res.statusCode).toBe(400);
		});

		it('returns 400 on bad SQL', async () => {
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT FROM nowhere' }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toBeDefined();
		});

		it('returns 400 on unknown op', async () => {
			const res = await memApp.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'explode' }
			});
			expect(res.statusCode).toBe(400);
		});
	});

	describe('persistence across connections (temp file)', () => {
		it('rows survive a separate connection to the same file', async () => {
			const res = await app.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: 'CREATE TABLE persist_test(id INTEGER PRIMARY KEY, v TEXT)' }
			});
			expect(res.statusCode).toBe(200);

			const ins = await app.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'exec', sql: "INSERT INTO persist_test(v) VALUES('survived')" }
			});
			expect(ins.statusCode).toBe(200);

			const externalDb = new Database(dbPath, { readonly: true });
			const rows = externalDb.prepare('SELECT v FROM persist_test').raw().all() as unknown[][];
			externalDb.close();
			expect(rows).toEqual([['survived']]);
		});
	});
});
