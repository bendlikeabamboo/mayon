import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { generateSync } from 'otplib';
import { buildApp } from './server';
import { registerAuth } from './auth/index';
import { hashPassword, randomToken, sha256Hex } from './auth/crypto';
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

function findCookie(res: { headers: Record<string, unknown> }, name: string): string | undefined {
	const raw = res.headers['set-cookie'];
	const list = raw == null ? [] : Array.isArray(raw) ? raw : [String(raw)];
	return list.find((c) => c.startsWith(`${name}=`));
}

function cookieToken(header: string): string {
	return header.split(';')[0].split('=').slice(1).join('=');
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
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-mode-')), 'auth-secret')
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

async function enrollOwner(ctx: TestApp): Promise<{ token: string; secret: string }> {
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
	return { token: cookieToken(findCookie(confirm, 'mayon_session') as string), secret };
}

async function loginOwner(ctx: TestApp, secret: string): Promise<string> {
	ctx.clock.now += STEP_MS;
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/login',
		body: { label: 'owner', password: PASSWORD, code: codeFor(secret, ctx.clock.now) }
	});
	expect(res.statusCode).toBe(200);
	return cookieToken(findCookie(res, 'mayon_session') as string);
}

async function readMode(pool: PgPoolLike): Promise<string> {
	const res = await pool.query(`SELECT value FROM settings WHERE key = 'security.mode'`, []);
	const raw = res.rows[0]?.value as string | undefined;
	return raw === undefined ? 'open' : (JSON.parse(raw) as string);
}

async function liveSessionCount(pool: PgPoolLike): Promise<number> {
	const res = await pool.query(
		'SELECT COUNT(*)::int AS count FROM auth_sessions WHERE revoked_at IS NULL',
		[]
	);
	return (res.rows[0] as { count: number }).count;
}

async function sessionStatus(ctx: TestApp, token: string): Promise<Record<string, unknown>> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/session',
		body: {},
		headers: { cookie: `mayon_session=${token}` }
	});
	expect(res.statusCode).toBe(200);
	return res.json();
}

describe('auth mode — disable (open) with password re-verify', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('opens the deployment after password re-verify and revokes every session including the caller', async () => {
		const { token } = await enrollOwner(ctx);
		expect(await readMode(ctx.pool)).toBe('locked');
		expect(await liveSessionCount(ctx.pool)).toBeGreaterThan(0);

		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${token}` },
			body: { mode: 'open', password: PASSWORD }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ mode: 'open' });
		expect(await readMode(ctx.pool)).toBe('open');
		expect(await liveSessionCount(ctx.pool)).toBe(0);
		expect(await sessionStatus(ctx, token)).toMatchObject({ authenticated: false });
	});
});

describe('auth mode — wrong or missing password keeps the lock', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = (await enrollOwner(ctx)).token;
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('answers a wrong password with a uniform 401 and no state change', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${ownerToken}` },
			body: { mode: 'open', password: 'definitely-not-it' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
		expect(await readMode(ctx.pool)).toBe('locked');
		expect(await liveSessionCount(ctx.pool)).toBe(1);
	});

	it('answers a missing password with the same uniform 401', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${ownerToken}` },
			body: { mode: 'open' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
		expect(await readMode(ctx.pool)).toBe('locked');
	});
});

describe('auth mode — validation and role walls', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = (await enrollOwner(ctx)).token;
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('rejects missing and unknown mode values with 400', async () => {
		for (const body of [{}, { mode: 'ajar' }, { mode: 42 }]) {
			const res = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/mode',
				headers: { cookie: `mayon_session=${ownerToken}` },
				body
			});
			expect(res.statusCode).toBe(400);
			expect(res.json()).toEqual({ error: 'invalid mode' });
		}
		expect(await readMode(ctx.pool)).toBe('locked');
	});

	it('answers a session-less caller with 401 unauthenticated while locked', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			body: { mode: 'locked' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"unauthenticated"}');
	});

	it('refuses invitees with a uniform 403', async () => {
		const inviteeId = randomUUID();
		await ctx.store.createIdentity({
			id: inviteeId,
			label: 'friend',
			role: 'invitee',
			status: 'active',
			passwordHash: await hashPassword(PASSWORD)
		});
		const token = randomToken();
		await ctx.store.createSession({
			id: randomUUID(),
			identityId: inviteeId,
			tokenHash: sha256Hex(token),
			expiresAt: ctx.clock.now + 600_000
		});
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${token}` },
			body: { mode: 'locked' }
		});
		expect(res.statusCode).toBe(403);
		expect(res.body).toBe('{"error":"forbidden"}');
	});
});

describe('auth mode — re-lock with an existing owner skips setup', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('locks directly from open mode, reusing existing credentials, without re-running setup', async () => {
		const { token: firstToken, secret } = await enrollOwner(ctx);

		const open = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${firstToken}` },
			body: { mode: 'open', password: PASSWORD }
		});
		expect(open.statusCode).toBe(200);
		expect(await readMode(ctx.pool)).toBe('open');

		const sneaky = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'sneaky', password: PASSWORD }
		});
		expect(sneaky.statusCode).toBe(409);
		expect(sneaky.body).toBe('{"error":"setup closed"}');

		const secondToken = await loginOwner(ctx, secret);
		const lock = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/mode',
			headers: { cookie: `mayon_session=${secondToken}` },
			body: { mode: 'locked' }
		});
		expect(lock.statusCode).toBe(200);
		expect(lock.json()).toEqual({ mode: 'locked' });
		expect(await readMode(ctx.pool)).toBe('locked');

		const status = await sessionStatus(ctx, secondToken);
		expect(status).toMatchObject({ authenticated: true, identity: { label: 'owner' } });
	});
});

describe('auth mode — lock refused without an active owner (store seam)', () => {
	it('answers 409 setup closed when no active owner exists', async () => {
		const app = Fastify();
		await app.register(cookie);
		const sessionLookup = {
			session: {
				id: 's1',
				identityId: 'i1',
				createdAt: 1,
				expiresAt: 9_999,
				lastSeenAt: null,
				label: null
			},
			identity: { id: 'i1', label: 'owner', role: 'owner' as const, status: 'active' as const }
		};
		const store = {
			findValidSessionByTokenHash: async () => sessionLookup,
			findActiveOwner: async () => null
		} as unknown as AuthStore;
		registerAuth(app, {
			store,
			getSecurityMode: async () => 'locked',
			setSecurityMode: async () => undefined,
			getAuthKey: () => Buffer.alloc(32, 7),
			resolveSessionToken: () => 'tok',
			resolveEnrollToken: () => undefined,
			now: () => 1_000
		});
		await app.ready();
		try {
			const res = await app.inject({
				method: 'POST',
				url: '/api/auth/mode',
				body: { mode: 'locked' }
			});
			expect(res.statusCode).toBe(409);
			expect(res.body).toBe('{"error":"setup closed"}');
		} finally {
			await app.close();
		}
	});
});
