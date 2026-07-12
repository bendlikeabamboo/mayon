import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './server';
import type { PgPoolLike, PgQueryResult } from './pg';

const BASE_CAPS = ['stdio-mcp', 'llm-proxy', 'sandbox-db', 'backup'];

function mockPool(): {
	pool: PgPoolLike;
	query: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
} {
	const query = vi.fn();
	const end = vi.fn(async () => {});
	return { pool: { query, end } as unknown as PgPoolLike, query, end };
}

describe('server (pg-down default)', () => {
	let app: ReturnType<typeof buildApp>;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	describe('GET /api/health', () => {
		it('returns 200 with ok:true, version, the four base caps (no pg), and sandboxDbPath', async () => {
			const res = await app.inject({ method: 'GET', url: '/api/health' });
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			expect(body.version).toBe('0.0.1');
			expect(body.caps).toEqual(expect.arrayContaining(BASE_CAPS));
			expect(body.caps).not.toContain('pg');
			expect(typeof body.sandboxDbPath).toBe('string');
			expect(body.sandboxDbPath.length).toBeGreaterThan(0);
		});
	});
});

describe('server with a pg pool (pgReady: true)', () => {
	let app: ReturnType<typeof buildApp>;
	let pool: ReturnType<typeof mockPool>;

	beforeAll(async () => {
		pool = mockPool();
		app = buildApp(':memory:', { pgPool: pool.pool, pgReady: true });
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	it('advertises the pg cap in health', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().caps).toEqual(expect.arrayContaining([...BASE_CAPS, 'pg']));
	});

	it('delegates POST /api/db/query (query) through the pg pool', async () => {
		pool.query.mockResolvedValueOnce({
			rows: [{ x: 42 }],
			fields: [{ name: 'x' }],
			rowCount: 1
		} as PgQueryResult);
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			body: { op: 'query', sql: 'SELECT $1::int AS x', params: [42] }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ columns: ['x'], rows: [[42]] });
		expect(pool.query).toHaveBeenCalledWith('SELECT $1::int AS x', [42]);
	});

	it('closes the pg pool on shutdown', async () => {
		const local = mockPool();
		const shutdownApp = buildApp(':memory:', { pgPool: local.pool, pgReady: true });
		await shutdownApp.listen({ port: 0, host: '0.0.0.0' });
		await shutdownApp.close();
		expect(local.end).toHaveBeenCalledTimes(1);
	});
});

describe('server without a pg pool (pgReady: false)', () => {
	let app: ReturnType<typeof buildApp>;

	beforeAll(async () => {
		app = buildApp(':memory:', { pgReady: false });
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	it('health is 200 ok:true with the four base caps and no pg', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.caps).toEqual(expect.arrayContaining(BASE_CAPS));
		expect(body.caps).not.toContain('pg');
	});

	it('POST /api/db/query returns 503 when no pool is configured', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(503);
		expect(res.json().error).toBe('pg not configured');
	});
});
