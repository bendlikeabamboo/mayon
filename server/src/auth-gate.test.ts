import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from './server';
import { randomToken, sha256Hex } from './auth/crypto';
import { createAuthStore, type AuthStore } from './auth/store';
import type { AuthIdentityStatus } from '@mayon/schema';
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

describe('auth gate — open mode parity', () => {
	let app: ReturnType<typeof buildApp>;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	it('GET /api/health is 200 public', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
	});

	it('POST /api/db/query reaches its handler (503 pg not configured, not 401)', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(503);
		expect(res.json().error).toBe('pg not configured');
	});

	it('GET /ws/mcp is not intercepted by the gate', async () => {
		const res = await app.inject({ method: 'GET', url: '/ws/mcp' });
		expect(res.statusCode).not.toBe(401);
	});

	it('GET /api/backup/db reaches its handler (503 pg not configured)', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/backup/db' });
		expect(res.statusCode).toBe(503);
		expect(res.json().error).toBe('pg not configured');
	});

	it('POST /api/llm/proxy reaches its handler (400 invalid url)', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			body: { url: 'not-a-url' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid url');
	});

	it('POST /api/llm/copilot/token reaches its handler (400 bad_request)', async () => {
		const res = await app.inject({ method: 'POST', url: '/api/llm/copilot/token', body: {} });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('bad_request');
	});
});

describe('auth gate — locked mode (store-backed)', () => {
	let app: ReturnType<typeof buildApp>;
	let pool: PgPoolLike;
	let store: AuthStore;
	const clock = { now: 1_756_000_000_000 };

	async function mintSession(
		opts: { status?: AuthIdentityStatus; expiresAt?: number } = {}
	): Promise<{ token: string; sessionId: string }> {
		const identityId = randomUUID();
		await store.createIdentity({
			id: identityId,
			label: `tester-${identityId.slice(0, 8)}`,
			role: 'owner',
			status: opts.status ?? 'active',
			passwordHash: 'hash-unused-by-the-gate'
		});
		const token = randomToken();
		const sessionId = randomUUID();
		await store.createSession({
			id: sessionId,
			identityId,
			tokenHash: sha256Hex(token),
			expiresAt: opts.expiresAt ?? clock.now + 600_000
		});
		return { token, sessionId };
	}

	const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

	beforeAll(async () => {
		pool = await createPglitePool();
		store = createAuthStore(pool, () => clock.now);
		await pool.query(
			`INSERT INTO settings(key,value) VALUES('security.mode',$1)
			 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
			[JSON.stringify('locked')]
		);
		app = buildApp(':memory:', { pgPool: pool, authNow: () => clock.now });
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	it('keeps the allowlisted health route public', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
	});

	it('rejects session-less requests uniformly', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.json()).toEqual({ error: 'unauthenticated' });
	});

	it('rejects mismatched origins before session checks', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { origin: 'http://evil.example' },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(403);
		expect(res.json()).toEqual({ error: 'bad origin' });
	});

	it('passes valid sessions through to the handler', async () => {
		const { token } = await mintSession();
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1 AS one' }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ columns: ['one'], rows: [[1]] });
	});

	it('refuses sessions of non-active identities', async () => {
		const { token } = await mintSession({ status: 'invited' });
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.json()).toEqual({ error: 'unauthenticated' });
	});

	it('refuses expired sessions', async () => {
		const { token } = await mintSession({ expiresAt: clock.now - 1 });
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(401);
	});

	it('refuses revoked sessions immediately', async () => {
		const { token, sessionId } = await mintSession();
		await store.revokeSession(sessionId, clock.now);
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${token}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(401);
	});

	it('refuses tokens that were never issued', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${randomToken()}` },
			body: { op: 'query', sql: 'SELECT 1' }
		});
		expect(res.statusCode).toBe(401);
	});

	it('throttles last_seen updates to once per minute per session', async () => {
		const { token, sessionId } = await mintSession();
		const lastSeen = async (): Promise<number | null> => {
			const res = await pool.query('SELECT last_seen_at FROM auth_sessions WHERE id = $1', [
				sessionId
			]);
			const raw = res.rows[0] as { last_seen_at: string | number | null } | undefined;
			return raw?.last_seen_at == null ? null : Number(raw.last_seen_at);
		};
		const hit = () =>
			app.inject({
				method: 'POST',
				url: '/api/db/query',
				headers: { cookie: `mayon_session=${token}` },
				body: { op: 'query', sql: 'SELECT 1' }
			});

		expect((await hit()).statusCode).toBe(200);
		await settle();
		expect(await lastSeen()).toBe(clock.now);

		await hit();
		await settle();
		expect(await lastSeen()).toBe(clock.now);

		clock.now += 61_000;
		expect((await hit()).statusCode).toBe(200);
		await settle();
		expect(await lastSeen()).toBe(clock.now);
	});
});

describe('auth store (pglite)', () => {
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

	it('creates and finds identities by label', async () => {
		const id = randomUUID();
		await store.createIdentity({
			id,
			label: 'ada',
			role: 'invitee',
			status: 'active',
			passwordHash: 'h-ada'
		});
		expect(await store.findIdentityByLabel('ada')).toMatchObject({
			id,
			label: 'ada',
			role: 'invitee',
			status: 'active',
			passwordHash: 'h-ada',
			totpSecretEnc: null,
			totpLastStep: null,
			mfaEnrolledAt: null,
			createdAt: base,
			updatedAt: base
		});
		expect(await store.findIdentityByLabel('nobody')).toBeNull();
	});

	it('finds the active owner and counts non-revoked identities', async () => {
		await store.createIdentity({
			id: randomUUID(),
			label: 'owner-1',
			role: 'owner',
			status: 'active',
			passwordHash: 'x'
		});
		await store.createIdentity({
			id: randomUUID(),
			label: 'invited-1',
			role: 'invitee',
			status: 'invited',
			passwordHash: 'x'
		});
		await store.createIdentity({
			id: randomUUID(),
			label: 'revoked-1',
			role: 'invitee',
			status: 'revoked',
			passwordHash: 'x'
		});
		expect((await store.findActiveOwner())?.label).toBe('owner-1');
		expect(await store.countNonRevokedIdentities()).toBe(3);
	});

	it('updates mfa, status, and password hash', async () => {
		const id = randomUUID();
		await store.createIdentity({
			id,
			label: 'mutable',
			role: 'invitee',
			status: 'invited',
			passwordHash: 'old'
		});
		await store.setIdentityMfa(id, {
			totpSecretEnc: 'v1.enc',
			totpLastStep: 12345,
			mfaEnrolledAt: base
		});
		await store.setIdentityStatus(id, 'active');
		await store.setIdentityPasswordHash(id, 'new');
		expect(await store.findIdentityByLabel('mutable')).toMatchObject({
			status: 'active',
			passwordHash: 'new',
			totpSecretEnc: 'v1.enc',
			totpLastStep: 12345,
			mfaEnrolledAt: base
		});
	});

	it('lists live sessions only and validates by token hash', async () => {
		const identityId = randomUUID();
		await store.createIdentity({
			id: identityId,
			label: 'sess-owner',
			role: 'owner',
			status: 'active',
			passwordHash: 'x'
		});
		await store.createSession({
			id: 's-live',
			identityId,
			tokenHash: 'hash-live',
			expiresAt: base + 1000
		});
		await store.createSession({
			id: 's-expired',
			identityId,
			tokenHash: 'hash-expired',
			expiresAt: base - 1000
		});
		await store.createSession({
			id: 's-revoked',
			identityId,
			tokenHash: 'hash-revoked',
			expiresAt: base + 1000
		});
		await store.revokeSession('s-revoked', base);

		const sessions = await store.listSessions(base);
		expect(sessions.map((s) => s.id)).toEqual(['s-live']);
		expect(sessions[0]).toMatchObject({
			identityLabel: 'sess-owner',
			expiresAt: base + 1000,
			lastSeenAt: null
		});

		expect(await store.findValidSessionByTokenHash('hash-live', base)).toMatchObject({
			session: { id: 's-live', identityId },
			identity: { id: identityId, label: 'sess-owner', role: 'owner', status: 'active' }
		});
		expect(await store.findValidSessionByTokenHash('hash-expired', base)).toBeNull();
		expect(await store.findValidSessionByTokenHash('hash-revoked', base)).toBeNull();
	});

	it('revokes all sessions and deletes by identity', async () => {
		const idA = randomUUID();
		const idB = randomUUID();
		await store.createIdentity({
			id: idA,
			label: 'a',
			role: 'owner',
			status: 'active',
			passwordHash: 'x'
		});
		await store.createIdentity({
			id: idB,
			label: 'b',
			role: 'invitee',
			status: 'active',
			passwordHash: 'x'
		});
		await store.createSession({
			id: 'ra-1',
			identityId: idA,
			tokenHash: 'ra-1',
			expiresAt: base + 1000
		});
		await store.createSession({
			id: 'rb-1',
			identityId: idB,
			tokenHash: 'rb-1',
			expiresAt: base + 1000
		});

		await store.revokeAllSessions(base + 5);
		expect(await store.findValidSessionByTokenHash('ra-1', base + 6)).toBeNull();
		expect(await store.findValidSessionByTokenHash('rb-1', base + 6)).toBeNull();

		await store.createSession({
			id: 'rb-2',
			identityId: idB,
			tokenHash: 'rb-2',
			expiresAt: base + 1000
		});
		expect((await store.listSessions(base + 6)).map((s) => s.id)).toEqual(['rb-2']);
		await store.deleteSessionsByIdentity(idB);
		expect(await store.listSessions(base + 6)).toEqual([]);
	});

	it('records attempts, counts recent failures, lists newest first', async () => {
		await store.recordAttempt({
			identityLabel: 'ada',
			source: '10.0.0.1',
			outcome: 'bad_password',
			at: base
		});
		await store.recordAttempt({
			identityLabel: null,
			source: '10.0.0.1',
			outcome: 'unknown_identity',
			at: base + 1000
		});
		await store.recordAttempt({
			identityLabel: 'ada',
			source: '10.0.0.2',
			outcome: 'success',
			at: base + 2000
		});

		expect(await store.countRecentFailures('10.0.0.1', base - 1)).toBe(2);
		expect(await store.countRecentFailures('10.0.0.1', base + 1000)).toBe(1);
		expect(await store.countRecentFailures('10.0.0.2', base - 1)).toBe(0);
		expect(await store.countRecentFailures('10.9.9.9', base - 1)).toBe(0);

		const attempts = await store.listRecentAttempts(2);
		expect(attempts.map((a) => a.at)).toEqual([base + 2000, base + 1000]);
		expect(attempts[1]).toMatchObject({
			identityLabel: null,
			source: '10.0.0.1',
			outcome: 'unknown_identity'
		});
	});

	it('prunes attempts older than 30 days on write', async () => {
		await store.recordAttempt({
			source: 'ancient',
			outcome: 'bad_code',
			at: base - 31 * 24 * 60 * 60 * 1000
		});
		await store.recordAttempt({ source: 'fresh', outcome: 'bad_code', at: base });
		const sources = (await store.listRecentAttempts(100)).map((a) => a.source);
		expect(sources).toContain('fresh');
		expect(sources).not.toContain('ancient');
	});
});
