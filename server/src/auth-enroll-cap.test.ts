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
import { hashPassword } from './auth/crypto';
import { createAuthStore } from './auth/store';
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

function enrollCookieToken(res: { headers: Record<string, unknown> }): string {
	const cookie = findCookie(res, 'mayon_enroll');
	expect(cookie).toBeDefined();
	return (cookie as string).split(';')[0].split('=').slice(1).join('=');
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

async function startApp(): Promise<TestApp> {
	const pool = await createPglitePool();
	const clock = { now: Date.now() };
	const app = buildApp(':memory:', {
		pgPool: pool,
		authNow: () => clock.now,
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-enrollcap-')), 'auth-secret')
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

async function enrollOwner(ctx: TestApp): Promise<void> {
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
}

interface EnrollSession {
	enrollToken: string;
	secret: string;
}

describe('auth enroll — brute-force cap (F4)', () => {
	let ctx: TestApp;
	beforeAll(async () => {
		ctx = await startApp();
		await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	async function beginEnrollment(label: string, password: string): Promise<EnrollSession> {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { label, password }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().status).toBe('mfa_enrollment_required');
		return {
			enrollToken: enrollCookieToken(res),
			secret: secretFromUri(res.json().otpauthUri as string)
		};
	}

	async function invite(label: string): Promise<void> {
		const store = createAuthStore(ctx.pool, () => ctx.clock.now);
		await store.createIdentity({
			id: randomUUID(),
			label,
			role: 'invitee',
			status: 'invited',
			passwordHash: await hashPassword(PASSWORD)
		});
	}

	it('expires the enrollment after five failed codes, refusing even the correct one', async () => {
		await invite('capped');
		const { enrollToken, secret } = await beginEnrollment('capped', PASSWORD);
		const headers = { cookie: `mayon_enroll=${enrollToken}` };

		for (let i = 0; i < 4; i++) {
			const res = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/enroll',
				headers,
				body: { code: codeOutsideWindow(secret, ctx.clock.now) }
			});
			expect(res.statusCode).toBe(400);
			expect(res.body).toBe('{"error":"invalid code"}');
		}

		const fifth = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers,
			body: { code: codeOutsideWindow(secret, ctx.clock.now) }
		});
		expect(fifth.statusCode).toBe(401);
		expect(fifth.body).toBe('{"error":"enrollment expired"}');

		ctx.clock.now += STEP_MS;
		const sixth = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers,
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(sixth.statusCode).toBe(401);
		expect(sixth.body).toBe('{"error":"enrollment expired"}');

		const status = await ctx.pool.query(
			`SELECT status, mfa_enrolled_at FROM auth_identities WHERE label = 'capped'`,
			[]
		);
		expect(status.rows[0]).toMatchObject({ status: 'invited', mfa_enrolled_at: null });
	});

	it('leaves a correct first-try code unaffected by the cap', async () => {
		await invite('lucky');
		const { enrollToken, secret } = await beginEnrollment('lucky', PASSWORD);
		ctx.clock.now += STEP_MS;
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers: { cookie: `mayon_enroll=${enrollToken}` },
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({
			authenticated: true,
			identity: { label: 'lucky', role: 'invitee' }
		});
	});
});
