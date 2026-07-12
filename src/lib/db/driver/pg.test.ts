import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { chats } from '$lib/db/schema';
import { createDb } from '$lib/db/driver/proxy';
import { runMigrations } from '$lib/db/driver/migrator';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { createRemotePgDriver } from '$lib/db/driver/pg';
import migrations from '$lib/db/driver/migrations';
import type { BatchStatement, StorageDriver } from '$lib/db/driver/types';

function mockFetch(
	responses: Record<string, Response> & { _default?: Response }
): typeof globalThis.fetch {
	return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input.toString();
		const key = init?.method ? `${init.method}:${url}` : url;
		return Promise.resolve(
			responses[key] ?? responses._default ?? new Response('not found', { status: 404 })
		);
	});
}

describe('RemotePgDriver', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('query maps wire response to positional rows', async () => {
		globalThis.fetch = mockFetch({
			_default: new Response(JSON.stringify({ columns: ['a', 'b'], rows: [[1, 'x']] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		});
		const driver = createRemotePgDriver();
		const result = await driver.query('SELECT 1 as a, 2 as b');
		expect(result.rows).toEqual([[1, 'x']]);
	});

	it('batch maps wire response to per-statement rows', async () => {
		globalThis.fetch = mockFetch({
			_default: new Response(
				JSON.stringify({
					results: [
						{ columns: ['c'], rows: [[10]] },
						{ columns: ['c'], rows: [[20]] }
					]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		});
		const driver = createRemotePgDriver();
		const result = await driver.batch([{ sql: 'SELECT 10 as c' }, { sql: 'SELECT 20 as c' }]);
		expect(result).toHaveLength(2);
		expect(result[0].rows).toEqual([[10]]);
		expect(result[1].rows).toEqual([[20]]);
	});

	it('exec returns void on success', async () => {
		globalThis.fetch = mockFetch({
			_default: new Response(JSON.stringify({ changes: 1, lastInsertRowid: 1 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		});
		const driver = createRemotePgDriver();
		await expect(driver.exec('CREATE TABLE t(x)')).resolves.toBeUndefined();
	});

	it('throws on non-2xx response', async () => {
		globalThis.fetch = mockFetch({
			_default: new Response(
				JSON.stringify({ error: 'query failed', detail: 'near "X": syntax error' }),
				{
					status: 400,
					headers: { 'content-type': 'application/json' }
				}
			)
		});
		const driver = createRemotePgDriver();
		await expect(driver.query('SELECT X')).rejects.toThrow('query failed');
	});
});

describe('RemotePgDriver contract proof (drizzle round-trip)', () => {
	let memoryDriver: StorageDriver;
	let remotePgDriver: StorageDriver;
	let intercepted: { sql: string; params?: unknown[] }[] = [];

	beforeEach(async () => {
		memoryDriver = await createMemoryDriver();
		intercepted = [];

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse((init?.body as string) ?? '{}');
			const driver = memoryDriver;

			if (body.op === 'query') {
				intercepted.push({ sql: body.sql as string, params: body.params as unknown[] });
				const result = await driver.query(body.sql as string, body.params as unknown[]);
				return new Response(JSON.stringify({ columns: [], rows: result.rows }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			if (body.op === 'batch') {
				const results = await driver.batch(body.stmts as BatchStatement[]);
				return new Response(
					JSON.stringify({ results: results.map((r) => ({ columns: [], rows: r.rows })) }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			if (body.op === 'exec') {
				await driver.exec(body.sql as string);
				return new Response(JSON.stringify({ changes: 0, lastInsertRowid: null }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({ error: 'unknown op' }), { status: 400 });
		});

		remotePgDriver = createRemotePgDriver();
		await runMigrations(remotePgDriver, migrations);
	});

	afterEach(() => {
		(memoryDriver as unknown as { dispose?: () => Promise<void> }).dispose?.();
	});

	it('runs migrations through the remote Pg driver', () => {
		expect(intercepted.length).toBeGreaterThan(0);
	});

	it('inserts and reads a chats row via drizzle proxy', async () => {
		const db = createDb(remotePgDriver);
		const now = Date.now();

		await db
			.insert(chats)
			.values({
				id: 'contract-test-1',
				parentId: null,
				rootId: 'contract-test-1',
				branchPointMessageId: null,
				title: 'Contract proof',
				depth: 0,
				provider: 'test',
				model: 'test-model',
				createdAt: now,
				updatedAt: now
			})
			.run();

		const result = await db.select().from(chats).where(eq(chats.id, 'contract-test-1')).all();
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe('Contract proof');
		expect(result[0].rootId).toBe('contract-test-1');
	});
});
