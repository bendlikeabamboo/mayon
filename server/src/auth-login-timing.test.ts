import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { createAuthStore, type AuthStore } from './auth/store';
import type { PgPoolLike } from './pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

const h = vi.hoisted(() => ({ verifyCalls: 0 }));

vi.mock('@node-rs/argon2', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@node-rs/argon2')>();
	return {
		...actual,
		verify: vi.fn(async (hash: string, password: string) => {
			h.verifyCalls += 1;
			return actual.verify(hash, password);
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
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-timing-')), 'auth-secret')
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

describe('auth login — argon2 runs on every credential-refusal path (F5)', () => {
	let ctx: TestApp;
	let secret: string;
	beforeAll(async () => {
		ctx = await startApp();
		secret = await enrollOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('burns argon2 for unknown labels while keeping the uniform 401 body', async () => {
		const before = h.verifyCalls;
		const res = await loginPost(ctx, { label: 'ghost', password: 'whatever-input' });
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
		expect(h.verifyCalls).toBeGreaterThan(before);
	});

	it('burns argon2 for revoked identities', async () => {
		const id = randomUUID();
		await ctx.store.createIdentity({
			id,
			label: 'doomed',
			role: 'invitee',
			status: 'active',
			passwordHash: await hashPassword(PASSWORD)
		});
		await ctx.store.setIdentityStatus(id, 'revoked');
		const before = h.verifyCalls;
		const res = await loginPost(ctx, { label: 'doomed', password: PASSWORD });
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
		expect(h.verifyCalls).toBeGreaterThan(before);
	});

	it('burns argon2 for active identities without an enrolled secret', async () => {
		await ctx.store.createIdentity({
			id: randomUUID(),
			label: 'bare',
			role: 'invitee',
			status: 'active',
			passwordHash: await hashPassword(PASSWORD)
		});
		const before = h.verifyCalls;
		const res = await loginPost(ctx, { label: 'bare', password: PASSWORD });
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
		expect(h.verifyCalls).toBeGreaterThan(before);
	});

	it('does not run argon2 for the ambiguous multi-candidate 400 (client error, not a credential check)', async () => {
		await ctx.store.createIdentity({
			id: randomUUID(),
			label: 'second',
			role: 'invitee',
			status: 'invited',
			passwordHash: await hashPassword(PASSWORD)
		});
		const before = h.verifyCalls;
		const res = await loginPost(ctx, { password: PASSWORD });
		expect(res.statusCode).toBe(400);
		expect(res.body).toBe('{"error":"label required"}');
		expect(h.verifyCalls).toBe(before);
	});

	it('keeps the real-verify path working (spy does not change outcomes)', async () => {
		ctx.clock.now += STEP_MS;
		const before = h.verifyCalls;
		const res = await loginPost(ctx, {
			label: 'owner',
			password: PASSWORD,
			code: codeFor(secret, ctx.clock.now)
		});
		expect(res.statusCode).toBe(200);
		expect(h.verifyCalls).toBeGreaterThan(before);
	});
});
