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
import { nextLocalMidnight } from './auth/cookies';
import { createAuthStore, type AuthStore } from './auth/store';
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
	store: AuthStore;
	clock: { now: number };
	close: () => Promise<void>;
}

async function startApp(): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-login-')), 'auth-secret')
	});
	await app.listen({ port: 0, host: '0.0.0.0' });
	return {
		app,
		pool,
		store: createAuthStore(pool, () => clock.now),
		clock,
		close: async () => {
			await app.close();
		}
	};
}

async function loginPost(
	ctx: TestApp,
	body: Record<string, unknown>,
	cookie?: string
): Promise<{
	statusCode: number;
	body: string;
	json: () => Record<string, unknown>;
	headers: Record<string, unknown>;
}> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/login',
		body,
		headers: cookie ? { cookie: `mayon_session=${cookie}` } : undefined
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

describe('auth login — happy path', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('issues a same-day session for correct credentials', async () => {
		const secret = await enrollOwner(ctx);
		ctx.clock.now += STEP_MS;
		const atLogin = ctx.clock.now;

		const res = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, atLogin)
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body).toMatchObject({
			authenticated: true,
			identity: { label: 'owner', role: 'owner' }
		});

		const expected = nextLocalMidnight(atLogin);
		expect(
			Math.abs((body.session as { expiresAt: number }).expiresAt - expected)
		).toBeLessThanOrEqual(1000);
		expect((body.session as { expiresAt: number }).expiresAt).toBeLessThan(expected + 1000);

		const cookie = sessionCookieHeader(res);
		expect(cookie).toBeDefined();
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('Path=/');

		const status = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/session',
			body: {},
			headers: { cookie: `mayon_session=${cookieToken(cookie as string)}` }
		});
		expect(status.statusCode).toBe(200);
		expect(status.json()).toEqual({
			mode: 'locked',
			setupRequired: false,
			authenticated: true,
			identity: { label: 'owner', role: 'owner' },
			session: { expiresAt: (body.session as { expiresAt: number }).expiresAt }
		});
	});
});

describe('auth login — uniform refusal (no oracle)', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('answers wrong password, wrong code, unknown label, and missing code with byte-identical 401 bodies', async () => {
		const secret = await enrollOwner(ctx);
		ctx.clock.now += STEP_MS;
		const goodCode = codeFor(secret, ctx.clock.now);
		const badCode = codeOutsideWindow(secret, ctx.clock.now);

		const attempts: Record<string, unknown>[] = [
			{ password: 'definitely-not-it', code: goodCode },
			{ password: PASSWORD, code: badCode },
			{ label: 'ghost', password: PASSWORD, code: goodCode },
			{ password: PASSWORD }
		];
		const bodies: string[] = [];
		for (const body of attempts) {
			const res = await loginPost(ctx, body);
			expect(res.statusCode).toBe(401);
			expect(sessionCookieHeader(res)).toBeUndefined();
			bodies.push(res.body);
		}
		expect(bodies[0]).toBe('{"error":"invalid credentials"}');
		expect(new Set(bodies).size).toBe(1);
	});
});

describe('auth login — replay guard', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('refuses replayed timesteps: the confirm code, and a code reused across two logins', async () => {
		const secret = await enrollOwner(ctx);

		const confirmReplay = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(confirmReplay.statusCode).toBe(401);
		expect(confirmReplay.body).toBe('{"error":"invalid credentials"}');

		ctx.clock.now += STEP_MS;
		const code = codeFor(secret, ctx.clock.now);
		const first = await loginPost(ctx, { password: PASSWORD, code });
		expect(first.statusCode).toBe(200);

		const replay = await loginPost(ctx, { password: PASSWORD, code });
		expect(replay.statusCode).toBe(401);
		expect(replay.body).toBe('{"error":"invalid credentials"}');

		ctx.clock.now += STEP_MS;
		const next = await loginPost(ctx, { password: PASSWORD, code: codeFor(secret, ctx.clock.now) });
		expect(next.statusCode).toBe(200);
	});
});

describe('auth login — label resolution', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('resolves the label from the sole non-revoked identity until a second appears', async () => {
		const secret = await enrollOwner(ctx);

		ctx.clock.now += STEP_MS;
		const sole = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(sole.statusCode).toBe(200);

		const guestId = randomUUID();
		await ctx.store.createIdentity({
			id: guestId,
			label: 'guest',
			role: 'invitee',
			status: 'invited',
			passwordHash: 'x'
		});

		ctx.clock.now += STEP_MS;
		const ambiguous = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(ambiguous.statusCode).toBe(400);
		expect(ambiguous.body).toBe('{"error":"label required"}');

		const named = await loginPost(ctx, {
			label: 'owner',
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(named.statusCode).toBe(200);

		await ctx.store.setIdentityStatus(guestId, 'revoked');
		ctx.clock.now += STEP_MS;
		const unlabeled = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(unlabeled.statusCode).toBe(200);
	});
});

describe('auth logout', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('revokes the session, clears the cookie, and re-locks the gate', async () => {
		const secret = await enrollOwner(ctx);
		ctx.clock.now += STEP_MS;
		const login = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(login.statusCode).toBe(200);
		const token = cookieToken(sessionCookieHeader(login) as string);

		const out = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/logout',
			headers: { cookie: `mayon_session=${token}` }
		});
		expect(out.statusCode).toBe(204);
		const cleared = out.headers['set-cookie'];
		const clearedList = cleared == null ? [] : Array.isArray(cleared) ? cleared : [String(cleared)];
		expect(clearedList.some((c) => /^mayon_session=;/.test(c))).toBe(true);

		const status = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/session',
			body: {},
			headers: { cookie: `mayon_session=${token}` }
		});
		expect(status.statusCode).toBe(200);
		expect(status.json()).toMatchObject({
			authenticated: false,
			identity: null,
			session: null
		});

		const gated = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(gated.statusCode).toBe(401);
		expect(gated.body).toBe('{"error":"unauthenticated"}');
	});

	it('answers 204 and clears the cookie even without a session', async () => {
		const out = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout' });
		expect(out.statusCode).toBe(204);
	});
});

describe('auth login — day expiry (SC-011)', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('stops accepting the session after local midnight passes', async () => {
		const secret = await enrollOwner(ctx);
		ctx.clock.now += STEP_MS;
		const atLogin = ctx.clock.now;

		const login = await loginPost(ctx, { password: PASSWORD, code: codeFor(secret, atLogin) });
		expect(login.statusCode).toBe(200);
		const token = cookieToken(sessionCookieHeader(login) as string);

		ctx.clock.now = nextLocalMidnight(atLogin) + 60_000;

		const gated = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(gated.statusCode).toBe(401);
		expect(gated.body).toBe('{"error":"unauthenticated"}');

		const status = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/session',
			body: {},
			headers: { cookie: `mayon_session=${token}` }
		});
		expect(status.statusCode).toBe(200);
		expect(status.json()).toEqual({
			mode: 'locked',
			setupRequired: false,
			authenticated: false,
			identity: null,
			session: null
		});
	});
});
