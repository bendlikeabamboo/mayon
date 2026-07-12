import { afterEach, describe, expect, it, vi } from 'vitest';
import { sandboxQuery, sandboxExec, sandboxTables } from '$lib/sidecar/sandbox-db';

function mockFetch(response: Response): typeof globalThis.fetch {
	return vi.fn(() => Promise.resolve(response));
}

describe('sandbox-db client', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('sandboxQuery returns columns and rows', async () => {
		globalThis.fetch = mockFetch(
			new Response(JSON.stringify({ columns: ['id', 'name'], rows: [[1, 'test']] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const result = await sandboxQuery('SELECT * FROM t');
		expect(result.columns).toEqual(['id', 'name']);
		expect(result.rows).toEqual([[1, 'test']]);
	});

	it('sandboxExec returns changes and lastInsertRowid', async () => {
		globalThis.fetch = mockFetch(
			new Response(JSON.stringify({ changes: 3, lastInsertRowid: 5 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const result = await sandboxExec('INSERT INTO t DEFAULT VALUES');
		expect(result.changes).toBe(3);
		expect(result.lastInsertRowid).toBe(5);
	});

	it('sandboxTables maps column names from sqlite_master', async () => {
		globalThis.fetch = mockFetch(
			new Response(
				JSON.stringify({
					columns: ['name'],
					rows: [['users'], ['orders']]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		const tables = await sandboxTables();
		expect(tables).toEqual(['users', 'orders']);
	});

	it('throws on non-2xx response', async () => {
		globalThis.fetch = mockFetch(
			new Response(JSON.stringify({ error: 'query failed', detail: 'no such table' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);
		await expect(sandboxQuery('SELECT * FROM nonexistent')).rejects.toThrow('no such table');
	});

	it('throws generic error on non-JSON failure', async () => {
		globalThis.fetch = mockFetch(new Response('internal error', { status: 500 }));
		await expect(sandboxQuery('SELECT 1')).rejects.toThrow('sidecar DB request failed');
	});
});
