import { describe, expect, it } from 'vitest';
import { runFtsBootstrap } from './fts';
import type { PgPoolLike } from './pg';

describe('runFtsBootstrap', () => {
	it('executes one query per FTS_BOOTSTRAP_SQL entry', async () => {
		const { FTS_BOOTSTRAP_SQL } = await import('@mayon/shared');
		const queries: string[] = [];
		const mockPool = {
			async query(text: string) {
				queries.push(text);
				return { rows: [], fields: [], rowCount: 0 };
			},
			async end() {}
		} satisfies PgPoolLike;

		await runFtsBootstrap(mockPool);
		expect(queries.length).toBe(FTS_BOOTSTRAP_SQL.length);
		for (let i = 0; i < queries.length; i++) {
			expect(queries[i]).toBe(FTS_BOOTSTRAP_SQL[i]);
		}
	});

	it('calling twice does not throw (idempotent DDL)', async () => {
		const mockPool = {
			async query() {
				return { rows: [], fields: [], rowCount: 0 };
			},
			async end() {}
		} satisfies PgPoolLike;

		await runFtsBootstrap(mockPool);
		await expect(runFtsBootstrap(mockPool)).resolves.toBeUndefined();
	});
});
