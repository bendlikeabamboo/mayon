import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface TestApp {
	app: ReturnType<typeof buildApp>;
	pool: PgPoolLike;
	clock: { now: number };
	close: () => Promise<void>;
}

async function startApp(): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-setup-')), 'auth-secret')
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

async function beginSetup(ctx: TestApp): Promise<{ uri: string; secret: string }> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup',
		body: { label: 'owner', password: PASSWORD }
	});
	expect(res.statusCode).toBe(200);
	const uri = res.json().otpauthUri as string;
	return { uri, secret: secretFromUri(uri) };
}

describe('auth setup — happy path to locked', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('advertises open mode with setup required before enrollment', async () => {
		const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/session', body: {} });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			mode: 'open',
			setupRequired: true,
			authenticated: false,
			identity: null,
			session: null
		});
	});

	it('enrolls the owner, issues a session, and locks the mode', async () => {
		const { uri, secret } = await beginSetup(ctx);
		expect(uri.startsWith('otpauth://totp/mayon:owner')).toBe(true);
		expect(uri).toContain('issuer=mayon');

		const confirm = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(confirm.statusCode).toBe(200);
		const body = confirm.json();
		expect(body).toMatchObject({
			authenticated: true,
			identity: { label: 'owner', role: 'owner' }
		});
		expect(body.session.expiresAt).toBeGreaterThan(ctx.clock.now);

		const cookie = sessionCookieHeader(confirm);
		expect(cookie).toBeDefined();
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');

		const status = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/session',
			body: {},
			headers: { cookie: `mayon_session=${cookie?.split(';')[0].split('=')[1]}` }
		});
		expect(status.statusCode).toBe(200);
		expect(status.json()).toEqual({
			mode: 'locked',
			setupRequired: false,
			authenticated: true,
			identity: { label: 'owner', role: 'owner' },
			session: { expiresAt: body.session.expiresAt }
		});
	});

	it('refuses a second setup once locked', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'owner', password: PASSWORD }
		});
		expect(res.statusCode).toBe(409);
		expect(res.json()).toEqual({ error: 'setup closed' });
	});

	it('refuses confirm-after-close (replayed enrollment code)', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: '000000' }
		});
		expect(res.statusCode).toBe(409);
		expect(res.json()).toEqual({ error: 'setup closed' });
	});
});

describe('auth setup — wrong confirm code activates nothing', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('refuses a far-future code and leaves no owner, no mode change', async () => {
		const { secret } = await beginSetup(ctx);
		let offset = 10 * STEP_MS;
		let futureCode = codeFor(secret, ctx.clock.now + offset);
		while (futureCode === codeFor(secret, ctx.clock.now)) {
			offset += STEP_MS;
			futureCode = codeFor(secret, ctx.clock.now + offset);
		}

		const confirm = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: futureCode }
		});
		expect(confirm.statusCode).toBe(400);
		expect(confirm.json()).toEqual({ error: 'invalid code' });
		expect(sessionCookieHeader(confirm)).toBeUndefined();

		const status = await ctx.app.inject({ method: 'POST', url: '/api/auth/session', body: {} });
		expect(status.statusCode).toBe(200);
		expect(status.json()).toEqual({
			mode: 'open',
			setupRequired: true,
			authenticated: false,
			identity: null,
			session: null
		});

		const rows = await ctx.pool.query('SELECT COUNT(*)::int AS count FROM auth_identities');
		expect((rows.rows[0] as { count: number }).count).toBe(0);
	});
});

describe('auth setup — validation bounds', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('rejects labels over 64 characters', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'x'.repeat(65), password: PASSWORD }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json()).toEqual({ error: 'invalid label' });
	});

	it('rejects empty and out-of-range passwords', async () => {
		for (const password of ['', 'short12', 'x'.repeat(1025)]) {
			const res = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/setup',
				body: { label: 'owner', password }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json()).toEqual({ error: 'invalid password' });
		}
	});

	it('persists nothing from rejected attempts', async () => {
		const status = await ctx.app.inject({ method: 'POST', url: '/api/auth/session', body: {} });
		expect(status.json()).toMatchObject({ mode: 'open', setupRequired: true });
		const rows = await ctx.pool.query('SELECT COUNT(*)::int AS count FROM auth_identities');
		expect((rows.rows[0] as { count: number }).count).toBe(0);
	});
});

describe('auth setup — endpoints reachable without a session while open', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('serves session, setup, and confirm without any cookie', async () => {
		const status = await ctx.app.inject({ method: 'POST', url: '/api/auth/session', body: {} });
		expect(status.statusCode).toBe(200);

		const { secret } = await beginSetup(ctx);

		const windowCodes = new Set(
			[-1, 0, 1].map((d) => codeFor(secret, ctx.clock.now + d * STEP_MS))
		);
		let bad = '000000';
		while (windowCodes.has(bad)) {
			bad = String((Number(bad) + 1) % 1_000_000).padStart(6, '0');
		}
		const confirm = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup/confirm',
			body: { code: bad }
		});
		expect(confirm.statusCode).toBe(400);
		expect(confirm.json()).toEqual({ error: 'invalid code' });
	});
});
