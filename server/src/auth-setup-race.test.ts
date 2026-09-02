import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { generateSync } from 'otplib';
import { buildApp } from './server';
import type { PgPoolLike } from './pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

const h = vi.hoisted(() => ({
	armed: false,
	calls: 0,
	deferred: null as null | { promise: Promise<unknown>; resolve: (value: unknown) => void }
}));

vi.mock('otplib', async (importOriginal) => {
	const actual = await importOriginal<typeof import('otplib')>();
	return {
		...actual,
		verify: vi.fn((...args: Parameters<typeof actual.verify>) => {
			h.calls += 1;
			if (h.armed && h.deferred) {
				return h.deferred.promise as ReturnType<typeof actual.verify>;
			}
			return actual.verify(...args);
		})
	};
});

async function createPglitePool(): Promise<PgPoolLike> {
	const client = new PGlite();
	await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
	return {
		query: async (text, params) => {
			const res = await client.query(text, params as unknown[]);
			return {
				rows: res.rows as Record<string, unknown>[],
				fields: res.fields as { name: string }[],
				rowCount: res.affectedRows ?? res.rows.length
			};
		},
		connect: async () => {
			throw new Error('pglite test pool does not support connect()');
		},
		end: async () => {
			await client.close();
		}
	};
}

const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;

function codeFor(secret: string, atMs: number): string {
	return generateSync({ secret, epoch: Math.floor(atMs / 1000) });
}

function secretFromUri(uri: string): string {
	const secret = new URL(uri).searchParams.get('secret');
	expect(secret).toBeTruthy();
	return secret as string;
}

function codeOutsideWindow(secret: string, atMs: number): string {
	const windowCodes = new Set([-1, 0, 1].map((d) => codeFor(secret, atMs + d * STEP_MS)));
	let bad = '000000';
	while (windowCodes.has(bad)) {
		bad = String((Number(bad) + 1) % 1_000_000).padStart(6, '0');
	}
	return bad;
}

interface TestApp {
	app: ReturnType<typeof buildApp>;
	pool: PgPoolLike;
	clock: { now: number };
	close: () => Promise<void>;
}

async function startApp(label: string): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: path.join(
			mkdtempSync(path.join(tmpdir(), `mayon-auth-race-${label}-`)),
			'auth-secret'
		)
	});
	await app.listen({ port: 0, host: '0.0.0.0' });
	return {
		app,
		pool,
		clock,
		close: async () => {
			await app.close();
		}
	};
}

async function beginSetup(ctx: TestApp, label: string): Promise<string> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup',
		body: { label, password: PASSWORD }
	});
	expect(res.statusCode).toBe(200);
	return secretFromUri(res.json().otpauthUri as string);
}

describe('auth setup/confirm — claim-and-clear TOCTOU (F3)', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp('toctou');
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('creates the identity from the claimed enrollment even when a concurrent setup overwrites pending', async () => {
		await beginSetup(ctx, 'real-owner');

		let resolveVerify!: (value: unknown) => void;
		const promise = new Promise<unknown>((resolve) => {
			resolveVerify = resolve;
		});
		h.deferred = { promise, resolve: resolveVerify };
		h.armed = true;
		try {
			const confirmA = ctx.app.inject({
				method: 'POST',
				url: '/api/auth/setup/confirm',
				body: { code: '123456' }
			});
			await vi.waitFor(() => {
				expect(h.calls).toBeGreaterThan(0);
			});

			const confirmB = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/setup/confirm',
				body: { code: '654321' }
			});
			expect(confirmB.statusCode).toBe(409);
			expect(confirmB.body).toBe('{"error":"setup closed"}');

			await beginSetup(ctx, 'sneaky-owner');

			h.deferred.resolve({ valid: true, timeStep: 424242 });
			const resA = await confirmA;
			expect(resA.statusCode).toBe(200);
			expect(resA.json()).toMatchObject({
				authenticated: true,
				identity: { label: 'real-owner', role: 'owner' }
			});
		} finally {
			h.armed = false;
			h.deferred = null;
		}

		const rows = await ctx.pool.query('SELECT label FROM auth_identities', []);
		expect(rows.rows.map((r) => (r as { label: unknown }).label)).toEqual(['real-owner']);

		const again = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: '123456' }
		});
		expect(again.statusCode).toBe(409);
		expect(again.body).toBe('{"error":"setup closed"}');
	});
});

describe('auth setup/confirm — claim semantics', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp('claim');
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('answers 409 when there is nothing pending to claim', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: '123456' }
		});
		expect(res.statusCode).toBe(409);
		expect(res.body).toBe('{"error":"setup closed"}');
	});

	it('keeps the enrollment retryable after a wrong code (claim restored)', async () => {
		const secret = await beginSetup(ctx, 'owner');
		const wrong = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: codeOutsideWindow(secret, ctx.clock.now) }
		});
		expect(wrong.statusCode).toBe(400);
		expect(wrong.body).toBe('{"error":"invalid code"}');

		ctx.clock.now += STEP_MS;
		const good = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(good.statusCode).toBe(200);
		expect(good.json()).toMatchObject({ authenticated: true, identity: { label: 'owner' } });
	});
});
