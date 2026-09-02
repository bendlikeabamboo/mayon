import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { generateSync } from 'otplib';
import { buildApp } from './server';
import { createAuthStore, type AuthStore } from './auth/store';
import { createRateLimiter, DEFAULT_RATE_WINDOW_MS } from './auth/ratelimit';
import type { PgPoolLike } from './pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

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
const LOCKED_SOURCE = '203.0.113.9';
const FREE_SOURCE = '203.0.113.8';

function codeFor(secret: string, atMs: number): string {
	return generateSync({ secret, epoch: Math.floor(atMs / 1000) });
}

function secretFromUri(uri: string): string {
	const secret = new URL(uri).searchParams.get('secret');
	expect(secret).toBeTruthy();
	return secret as string;
}

function sessionCookieHeader(res: { headers: Record<string, unknown> }): string | undefined {
	const raw = res.headers['set-cookie'];
	const list = raw == null ? [] : Array.isArray(raw) ? raw : [String(raw)];
	return list.find((c) => c.startsWith('mayon_session='));
}

function cookieToken(header: string): string {
	return header.split(';')[0].slice('mayon_session='.length);
}

interface TestApp {
	app: ReturnType<typeof buildApp>;
	pool: PgPoolLike;
	store: AuthStore;
	clock: { now: number };
	sleepCalls: number[];
	close: () => Promise<void>;
}

interface StartOptions {
	windowMs?: number;
	ladderBase?: number;
	sleep?: (ms: number) => Promise<void>;
}

async function startApp(opts: StartOptions = {}): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const sleepCalls: number[] = [];
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: path.join(
			mkdtempSync(path.join(tmpdir(), 'mayon-auth-ratelimit-')),
			'auth-secret'
		),
		authRateWindowMs: opts.windowMs,
		authRateLadderBase: opts.ladderBase,
		authRateSleep:
			opts.sleep ??
			(async (ms: number) => {
				sleepCalls.push(ms);
			})
	});
	await app.listen({ port: 0, host: '0.0.0.0' });
	return {
		app,
		pool,
		store: createAuthStore(pool, () => clock.now),
		clock,
		sleepCalls,
		close: async () => {
			await app.close();
		}
	};
}

type InjectResult = {
	statusCode: number;
	body: string;
	json: () => Record<string, unknown>;
	headers: Record<string, unknown>;
};

async function loginPost(
	ctx: TestApp,
	body: Record<string, unknown>,
	remoteAddress?: string
): Promise<InjectResult> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/login',
		body,
		remoteAddress
	});
	return {
		statusCode: res.statusCode,
		body: res.body,
		json: () => res.json(),
		headers: res.headers
	};
}

async function enrollOwner(ctx: TestApp): Promise<string> {
	const setup = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup',
		body: { label: 'owner', password: PASSWORD }
	});
	expect(setup.statusCode).toBe(200);
	const secret = secretFromUri(setup.json().otpauthUri as string);
	const confirm = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup/confirm',
		body: { code: codeFor(secret, ctx.clock.now) }
	});
	expect(confirm.statusCode).toBe(200);
	return secret;
}

async function hammer(
	ctx: TestApp,
	count: number,
	remoteAddress?: string
): Promise<InjectResult[]> {
	const results: InjectResult[] = [];
	for (let i = 0; i < count; i++) {
		results.push(await loginPost(ctx, { password: 'not-the-password' }, remoteAddress));
	}
	return results;
}

function stubStore(failures: number, oldestAt: number | null): AuthStore {
	return {
		countRecentFailures: async () => failures,
		oldestRecentFailureAt: async () => oldestAt
	} as unknown as AuthStore;
}

describe('rate limiter policy (R7)', () => {
	it('delays nothing for failures 1–4 and climbs min(2^(n−4), 60)s for 5+', () => {
		const limiter = createRateLimiter(stubStore(0, null));
		expect(limiter.delayMsFor(0)).toBe(0);
		expect(limiter.delayMsFor(1)).toBe(0);
		expect(limiter.delayMsFor(4)).toBe(0);
		expect(limiter.delayMsFor(5)).toBe(2000);
		expect(limiter.delayMsFor(6)).toBe(4000);
		expect(limiter.delayMsFor(7)).toBe(8000);
		expect(limiter.delayMsFor(8)).toBe(16000);
		expect(limiter.delayMsFor(9)).toBe(32000);
		expect(limiter.delayMsFor(10)).toBe(60000);
		expect(limiter.delayMsFor(25)).toBe(60000);
	});

	it('honors a custom ladder base', () => {
		const limiter = createRateLimiter(stubStore(0, null), { ladderBase: 3 });
		expect(limiter.delayMsFor(5)).toBe(3000);
		expect(limiter.delayMsFor(6)).toBe(9000);
	});

	it('passes with the ordinal delay when failures are below the lockout threshold', async () => {
		const now = 1_000_000;
		const limiter = createRateLimiter(stubStore(4, null), { now: () => now });
		await expect(limiter.check('1.2.3.4')).resolves.toEqual({ ok: true, delayMs: 2000 });

		const fresh = createRateLimiter(stubStore(0, null), { now: () => now });
		await expect(fresh.check('1.2.3.4')).resolves.toEqual({ ok: true, delayMs: 0 });
	});

	it('refuses once the window holds ten failures and reports time to the oldest exiting', async () => {
		const now = 1_000_000;
		const oldest = 500_000;
		const limiter = createRateLimiter(stubStore(9, oldest), { now: () => now });
		await expect(limiter.check('1.2.3.4')).resolves.toEqual({
			ok: false,
			retryAfterMs: oldest + DEFAULT_RATE_WINDOW_MS - now
		});

		const headless = createRateLimiter(stubStore(12, null), { now: () => now });
		await expect(headless.check('1.2.3.4')).resolves.toEqual({
			ok: false,
			retryAfterMs: DEFAULT_RATE_WINDOW_MS
		});
	});

	it('honors a custom window for the retry hint', async () => {
		const now = 1_000_000;
		const oldest = 997_000;
		const limiter = createRateLimiter(stubStore(9, oldest), {
			now: () => now,
			windowMs: 5_000
		});
		await expect(limiter.check('1.2.3.4')).resolves.toEqual({ ok: false, retryAfterMs: 2_000 });
	});
});

describe('login rate-limit ladder over HTTP', () => {
	let ctx: TestApp;
	let secret: string;
	let hammerStart: number;

	beforeAll(async () => {
		ctx = await startApp();
		secret = await enrollOwner(ctx);
		hammerStart = ctx.clock.now;
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('runs attempts 1–4 instant, 5–9 progressively delayed, and 429s the tenth', async () => {
		const instant = await hammer(ctx, 4);
		for (const res of instant) {
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"invalid credentials"}');
		}
		expect(ctx.sleepCalls).toEqual([]);

		const delayed = await hammer(ctx, 5);
		for (const res of delayed) {
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"invalid credentials"}');
		}
		expect(ctx.sleepCalls).toEqual([2000, 4000, 8000, 16000, 32000]);

		const locked = await loginPost(ctx, { password: 'not-the-password' });
		expect(locked.statusCode).toBe(429);
		expect(locked.body).toBe('{"error":"too many attempts","retryAfter":600}');
		expect(ctx.sleepCalls).toEqual([2000, 4000, 8000, 16000, 32000]);

		const rows = await ctx.store.listRecentAttempts(50);
		expect(rows).toHaveLength(9);
		expect(rows.every((r) => r.outcome === 'bad_password' && r.source === '127.0.0.1')).toBe(true);
	});

	it('holds the lock against correct credentials and counts down to the oldest failure', async () => {
		ctx.clock.now += STEP_MS;
		const good = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(good.statusCode).toBe(429);
		expect(good.body).toBe('{"error":"too many attempts","retryAfter":570}');
		expect(ctx.sleepCalls).toHaveLength(5);

		ctx.clock.now = hammerStart + 300_000;
		const half = await loginPost(ctx, { password: 'not-the-password' });
		expect(half.statusCode).toBe(429);
		expect(half.body).toBe('{"error":"too many attempts","retryAfter":300}');

		const rows = await ctx.store.listRecentAttempts(50);
		expect(rows).toHaveLength(9);
	});

	it('releases oldest-first and lets correct credentials through without residual delay', async () => {
		ctx.clock.now = hammerStart + DEFAULT_RATE_WINDOW_MS + 1_000;
		ctx.clock.now += STEP_MS;
		const freed = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(freed.statusCode).toBe(200);
		expect(freed.json()).toMatchObject({ authenticated: true, identity: { label: 'owner' } });
		expect(ctx.sleepCalls).toHaveLength(5);

		const rows = await ctx.store.listRecentAttempts(50);
		expect(rows.filter((r) => r.outcome === 'success')).toHaveLength(1);
	});
});

describe('per-source isolation', () => {
	let ctx: TestApp;
	let secret: string;

	beforeAll(async () => {
		ctx = await startApp();
		secret = await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('locks only the hammered source', async () => {
		const hammered = await hammer(ctx, 10, LOCKED_SOURCE);
		expect(hammered.slice(0, 9).every((r) => r.statusCode === 401)).toBe(true);
		expect(hammered[9].statusCode).toBe(429);
		expect(hammered[9].body).toBe('{"error":"too many attempts","retryAfter":600}');
		const sleepsFromLockout = ctx.sleepCalls.length;

		const other = await loginPost(ctx, { password: 'not-the-password' }, FREE_SOURCE);
		expect(other.statusCode).toBe(401);
		expect(other.body).toBe('{"error":"invalid credentials"}');
		expect(ctx.sleepCalls).toHaveLength(sleepsFromLockout);

		ctx.clock.now += STEP_MS;
		const legit = await loginPost(
			ctx,
			{ password: PASSWORD, code: codeFor(secret, ctx.clock.now) },
			FREE_SOURCE
		);
		expect(legit.statusCode).toBe(200);

		const still = await loginPost(ctx, { password: 'not-the-password' }, LOCKED_SOURCE);
		expect(still.statusCode).toBe(429);
	});
});

describe('successes are never delayed and add no failure weight', () => {
	let ctx: TestApp;
	let secret: string;

	beforeAll(async () => {
		ctx = await startApp();
		secret = await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('answers a mid-ladder success instantly while failures keep aging', async () => {
		await hammer(ctx, 6);
		expect(ctx.sleepCalls).toEqual([2000, 4000]);

		ctx.clock.now += STEP_MS;
		const ok = await loginPost(ctx, { password: PASSWORD, code: codeFor(secret, ctx.clock.now) });
		expect(ok.statusCode).toBe(200);
		expect(ctx.sleepCalls).toEqual([2000, 4000]);

		const again = await loginPost(ctx, { password: 'not-the-password' });
		expect(again.statusCode).toBe(401);
		expect(ctx.sleepCalls).toEqual([2000, 4000, 8000]);

		const outcomes = (await ctx.store.listRecentAttempts(50)).map((r) => r.outcome);
		expect(outcomes.filter((o) => o === 'success')).toHaveLength(1);
		expect(outcomes.filter((o) => o === 'bad_password')).toHaveLength(7);
	});
});

describe('attempt visibility and pruning (owner surface)', () => {
	let ctx: TestApp;
	let ownerCookie: string;

	beforeAll(async () => {
		ctx = await startApp();
		const setup = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'owner', password: PASSWORD }
		});
		const secret = secretFromUri(setup.json().otpauthUri as string);
		const confirm = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		ownerCookie = cookieToken(sessionCookieHeader(confirm) as string);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('lists recorded failures with outcomes and sources; 429s add no rows', async () => {
		await hammer(ctx, 9, '198.51.100.7');
		const refused = await loginPost(ctx, { password: 'not-the-password' }, '198.51.100.7');
		expect(refused.statusCode).toBe(429);

		const list = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/attempts?limit=50',
			headers: { cookie: `mayon_session=${ownerCookie}` }
		});
		expect(list.statusCode).toBe(200);
		const attempts = list.json().attempts as {
			identityLabel: string | null;
			source: string;
			outcome: string;
			at: number;
		}[];
		const fromAttacker = attempts.filter((a) => a.source === '198.51.100.7');
		expect(fromAttacker).toHaveLength(9);
		expect(
			fromAttacker.every((a) => a.identityLabel === 'owner' && a.outcome === 'bad_password')
		).toBe(true);
	});

	it('prunes attempts older than 30 days on the next write', async () => {
		ctx.clock.now += 40 * 24 * 60 * 60 * 1000;
		await ctx.pool.query(
			'INSERT INTO auth_login_attempts (id, identity_label, source, outcome, at) VALUES ($1, $2, $3, $4, $5)',
			[
				randomUUID(),
				'ghost',
				'backdated-src',
				'bad_password',
				ctx.clock.now - 31 * 24 * 60 * 60 * 1000
			]
		);
		await ctx.store.recordAttempt({
			identityLabel: 'owner',
			source: 'fresh-src',
			outcome: 'success',
			at: ctx.clock.now
		});

		const rows = await ctx.store.listRecentAttempts(50);
		expect(rows.some((r) => r.source === 'backdated-src')).toBe(false);
		expect(rows.some((r) => r.source === 'fresh-src')).toBe(true);
	});
});

describe('window override via BuildAppOptions', () => {
	let ctx: TestApp;
	let secret: string;

	beforeAll(async () => {
		ctx = await startApp({ windowMs: 60_000 });
		secret = await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('unlocks once the shortened window passes even though the default would not', async () => {
		await hammer(ctx, 9);
		const locked = await loginPost(ctx, { password: 'not-the-password' });
		expect(locked.statusCode).toBe(429);
		expect(locked.body).toBe('{"error":"too many attempts","retryAfter":60}');

		ctx.clock.now += 61_000;
		ctx.clock.now += STEP_MS;
		const freed = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(freed.statusCode).toBe(200);
	});
});

describe('ladder base override via BuildAppOptions', () => {
	let ctx: TestApp;

	beforeAll(async () => {
		ctx = await startApp({ ladderBase: 3 });
		await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('scales the fifth-failure delay by the configured base', async () => {
		await hammer(ctx, 4);
		const fifth = await loginPost(ctx, { password: 'not-the-password' });
		expect(fifth.statusCode).toBe(401);
		expect(ctx.sleepCalls).toEqual([3000]);
	});
});

describe('delayed responses wait in real time', () => {
	let ctx: TestApp;

	beforeAll(async () => {
		ctx = await startApp({
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20)))
		});
		await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('makes the fifth failure measurably slower while keeping the 401 body intact', async () => {
		await hammer(ctx, 4);
		const start = Date.now();
		const fifth = await loginPost(ctx, { password: 'not-the-password' });
		const elapsed = Date.now() - start;
		expect(fifth.statusCode).toBe(401);
		expect(fifth.body).toBe('{"error":"invalid credentials"}');
		expect(elapsed).toBeGreaterThanOrEqual(15);
	});
});

describe('enroll endpoint is not rate-limited', () => {
	let ctx: TestApp;

	beforeAll(async () => {
		ctx = await startApp();
		await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('answers repeated unauthenticated enroll calls without 429 or recording', async () => {
		for (let i = 0; i < 3; i++) {
			const res = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/enroll',
				body: { code: '000000' }
			});
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"enrollment expired"}');
		}
		expect(ctx.sleepCalls).toEqual([]);
		expect(await ctx.store.listRecentAttempts(50)).toEqual([]);
	});
});
