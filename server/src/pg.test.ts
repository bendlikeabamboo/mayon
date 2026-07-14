import { describe, expect, it, vi } from 'vitest';
import { pgQueryHandler } from './pg';
import type { PgPoolLike, PgQueryResult } from './pg';

function makeResult(partial: Partial<PgQueryResult>): PgQueryResult {
	return { rows: [], fields: [], rowCount: null, ...partial };
}

function mockPool(): {
	pool: PgPoolLike;
	query: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
} {
	const query = vi.fn();
	const end = vi.fn(async () => {});
	return { pool: { query, end } as unknown as PgPoolLike, query, end };
}

describe('pgQueryHandler', () => {
	describe('op: query', () => {
		it('maps fields/rows to positional DbQueryResult and is idempotent on PG-native $n', async () => {
			const { pool, query } = mockPool();
			query.mockResolvedValue(makeResult({ rows: [{ x: 42 }], fields: [{ name: 'x' }] }));
			const result = await pgQueryHandler(pool, {
				op: 'query',
				sql: 'SELECT $1::int AS x',
				params: [42]
			});
			expect(result).toEqual({ columns: ['x'], rows: [[42]] });
			expect(query).toHaveBeenCalledWith('SELECT $1::int AS x', [42]);
		});

		it('passes SQL and params directly to the pool', async () => {
			const { pool, query } = mockPool();
			query.mockResolvedValue(
				makeResult({ rows: [{ v: 7, doubled: 14 }], fields: [{ name: 'v' }, { name: 'doubled' }] })
			);
			const result = await pgQueryHandler(pool, {
				op: 'query',
				sql: 'SELECT $1 as v, $2 as doubled',
				params: [7, 14]
			});
			expect(result).toEqual({ columns: ['v', 'doubled'], rows: [[7, 14]] });
			expect(query).toHaveBeenCalledWith('SELECT $1 as v, $2 as doubled', [7, 14]);
		});
	});

	describe('op: exec', () => {
		it('maps rowCount to changes and returns null lastInsertRowid', async () => {
			const { pool, query } = mockPool();
			query.mockResolvedValue(makeResult({ rowCount: 3 }));
			const result = await pgQueryHandler(pool, { op: 'exec', sql: 'UPDATE t SET x = 1' });
			expect(result).toEqual({ changes: 3, lastInsertRowid: null });
			expect(query).toHaveBeenCalledWith('UPDATE t SET x = 1');
		});

		it('defaults changes to 0 when rowCount is null', async () => {
			const { pool, query } = mockPool();
			query.mockResolvedValue(makeResult({ rowCount: null }));
			const result = await pgQueryHandler(pool, { op: 'exec', sql: 'CREATE TABLE t(x int)' });
			expect(result).toEqual({ changes: 0, lastInsertRowid: null });
		});
	});

	describe('op: batch', () => {
		it('runs BEGIN/stmts/COMMIT and returns per-statement results', async () => {
			const { pool, query } = mockPool();
			query
				.mockResolvedValueOnce(makeResult({}))
				.mockResolvedValueOnce(makeResult({ rows: [{ id: 1 }], fields: [{ name: 'id' }] }))
				.mockResolvedValueOnce(makeResult({ rowCount: 1 }))
				.mockResolvedValueOnce(makeResult({}));
			const result = await pgQueryHandler(pool, {
				op: 'batch',
				stmts: [{ sql: 'SELECT 1 AS id' }, { sql: 'INSERT INTO t VALUES(1)' }]
			});
			expect(result).toEqual({
				results: [
					{ columns: ['id'], rows: [[1]] },
					{ columns: [], rows: [] }
				]
			});
			expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
			expect(query).toHaveBeenNthCalledWith(2, 'SELECT 1 AS id', []);
			expect(query).toHaveBeenNthCalledWith(3, 'INSERT INTO t VALUES(1)', []);
			expect(query).toHaveBeenNthCalledWith(4, 'COMMIT');
			expect(query).toHaveBeenCalledTimes(4);
		});

		it('rolls back and rethrows when a mid-batch statement fails', async () => {
			const { pool, query } = mockPool();
			query
				.mockResolvedValueOnce(makeResult({}))
				.mockResolvedValueOnce(makeResult({ rows: [{ id: 1 }], fields: [{ name: 'id' }] }))
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce(makeResult({}));
			await expect(
				pgQueryHandler(pool, {
					op: 'batch',
					stmts: [{ sql: 'SELECT 1 AS id' }, { sql: 'BAD' }]
				})
			).rejects.toThrow('boom');
			expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
			expect(query).toHaveBeenNthCalledWith(2, 'SELECT 1 AS id', []);
			expect(query).toHaveBeenNthCalledWith(3, 'BAD', []);
			expect(query).toHaveBeenNthCalledWith(4, 'ROLLBACK');
			expect(query).toHaveBeenCalledTimes(4);
		});
	});
});
