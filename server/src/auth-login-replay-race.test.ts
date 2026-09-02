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
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-replay-')), 'auth-secret')
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
	body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
	const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', body });
	return { statusCode: res.statusCode, body: res.body };
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

describe('auth store — advanceTotpStep compare-and-set semantics (F6)', () => {
	let pool: PgPoolLike;
	let store: AuthStore;
	const base = 1_756_000_000_000;

	beforeAll(async () => {
		pool = await createPglitePool();
		store = createAuthStore(pool, () => base);
	});
	afterAll(async () => {
		await pool.end();
	});

	it('advances only forward: null accepts any step, then strictly increasing steps win', async () => {
		const id = randomUUID();
		await store.createIdentity({
			id,
			label: 'cas',
			role: 'invitee',
			status: 'active',
			passwordHash: 'x'
		});
		await expect(store.advanceTotpStep(id, 100)).resolves.toBe(true);
		await expect(store.advanceTotpStep(id, 100)).resolves.toBe(false);
		await expect(store.advanceTotpStep(id, 99)).resolves.toBe(false);
		await expect(store.advanceTotpStep(id, 101)).resolves.toBe(true);
		const identity = await store.findIdentityById(id);
		expect(identity?.totpLastStep).toBe(101);
	});

	it('leaves other identities untouched', async () => {
		const a = randomUUID();
		const b = randomUUID();
		for (const id of [a, b]) {
			await store.createIdentity({
				id,
				label: `cas-${id.slice(0, 6)}`,
				role: 'invitee',
				status: 'active',
				passwordHash: 'x'
			});
		}
		await expect(store.advanceTotpStep(a, 5)).resolves.toBe(true);
		const other = await store.findIdentityById(b);
		expect(other?.totpLastStep).toBeNull();
	});
});

describe('auth login — concurrent replay of one code (F6)', () => {
	let ctx: TestApp;
	let secret: string;
	beforeAll(async () => {
		ctx = await startApp();
		secret = await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('lets exactly one of two same-code logins through and refuses the other', async () => {
		ctx.clock.now += STEP_MS;
		const code = codeFor(secret, ctx.clock.now);

		const [a, b] = await Promise.all([
			loginPost(ctx, { password: PASSWORD, code }),
			loginPost(ctx, { password: PASSWORD, code })
		]);
		const statuses = [a.statusCode, b.statusCode].sort();
		expect(statuses).toEqual([200, 401]);
		const loser = a.statusCode === 401 ? a : b;
		const winner = a.statusCode === 200 ? a : b;
		expect(loser.body).toBe('{"error":"invalid credentials"}');
		expect(winner.body).toContain('"authenticated":true');
	});

	it('accepts a fresh code afterwards, so the loser was the replay, not the identity', async () => {
		ctx.clock.now += STEP_MS;
		const res = await loginPost(ctx, {
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(res.statusCode).toBe(200);
	});
});
