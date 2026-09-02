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

const OWNER_PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const ENROLL_TTL_MS = 900_000;

function codeFor(secret: string, atMs: number): string {
	return generateSync({ secret, epoch: Math.floor(atMs / 1000) });
}

function secretFromUri(uri: string): string {
	const secret = new URL(uri).searchParams.get('secret');
	expect(secret).toBeTruthy();
	return secret as string;
}

function findCookie(headers: Record<string, unknown>, name: string): string | undefined {
	const raw = headers['set-cookie'];
	const list = raw == null ? [] : Array.isArray(raw) ? raw : [String(raw)];
	return list.find((c) => c.startsWith(`${name}=`));
}

function cookieToken(header: string): string {
	return header.split(';')[0]!.split('=').slice(1).join('=');
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
		authKeyPath: path.join(mkdtempSync(path.join(tmpdir(), 'mayon-auth-invites-')), 'auth-secret')
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

async function seedOwner(ctx: TestApp): Promise<string> {
	const setup = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup',
		body: { label: 'owner', password: OWNER_PASSWORD }
	});
	expect(setup.statusCode).toBe(200);
	const secret = secretFromUri(setup.json().otpauthUri as string);
	const confirm = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/setup/confirm',
		body: { code: codeFor(secret, ctx.clock.now) }
	});
	expect(confirm.statusCode).toBe(200);
	const cookie = findCookie(confirm.headers, 'mayon_session');
	expect(cookie).toBeDefined();
	return cookieToken(cookie as string);
}

interface InviteIssue {
	id: string;
	oneTimePassword: string;
}

async function createInvite(ctx: TestApp, ownerToken: string, label: string): Promise<InviteIssue> {
	const res = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/invites',
		headers: { cookie: `mayon_session=${ownerToken}` },
		body: { label }
	});
	expect(res.statusCode).toBe(201);
	return res.json() as InviteIssue;
}

interface FriendSession {
	friendToken: string;
	enrollToken: string;
	otpauthSecret: string;
	invite: InviteIssue;
}

async function enrollFriend(
	ctx: TestApp,
	ownerToken: string,
	label: string
): Promise<FriendSession> {
	const invite = await createInvite(ctx, ownerToken, label);
	ctx.clock.now += STEP_MS;
	const login = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/login',
		body: { label, password: invite.oneTimePassword }
	});
	expect(login.statusCode).toBe(200);
	const body = login.json() as Record<string, unknown>;
	expect(body.status).toBe('mfa_enrollment_required');
	expect(typeof body.enrollToken).toBe('string');
	expect(typeof body.otpauthUri).toBe('string');
	const enrollCookie = findCookie(login.headers, 'mayon_enroll');
	expect(enrollCookie).toBeDefined();
	expect(findCookie(login.headers, 'mayon_session')).toBeUndefined();
	const otpauthSecret = secretFromUri(body.otpauthUri as string);
	ctx.clock.now += STEP_MS;
	const enroll = await ctx.app.inject({
		method: 'POST',
		url: '/api/auth/enroll',
		headers: { cookie: `mayon_enroll=${cookieToken(enrollCookie as string)}` },
		body: { code: codeFor(otpauthSecret, ctx.clock.now) }
	});
	expect(enroll.statusCode).toBe(200);
	const friendCookie = findCookie(enroll.headers, 'mayon_session');
	expect(friendCookie).toBeDefined();
	return {
		friendToken: cookieToken(friendCookie as string),
		enrollToken: cookieToken(enrollCookie as string),
		otpauthSecret,
		invite
	};
}

describe('auth invites — creation and one-time password', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = await seedOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('returns the one-time password exactly once, hashed in storage', async () => {
		const invite = await createInvite(ctx, ownerToken, 'friend');
		expect(invite.id).toBeTruthy();
		expect(invite.oneTimePassword.length).toBeGreaterThanOrEqual(12);

		const list = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/invites',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(list.statusCode).toBe(200);
		expect(list.json()).toMatchObject({
			invites: [{ id: invite.id, label: 'friend', status: 'invited' }]
		});
		expect(list.json().invites[0]).toHaveProperty('createdAt');
		expect(list.body).not.toContain(invite.oneTimePassword);
		const identity = await ctx.store.findIdentityByLabel('friend');
		expect(identity).toMatchObject({ role: 'invitee', status: 'invited' });
		expect(identity?.passwordHash).not.toBe(invite.oneTimePassword);
	});

	it('rejects duplicate labels among non-revoked identities', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/invites',
			headers: { cookie: `mayon_session=${ownerToken}` },
			body: { label: 'friend' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.body).toBe('{"error":"duplicate label"}');
	});

	it('rejects invalid labels', async () => {
		for (const label of ['', '   ', 'x'.repeat(65)]) {
			const res = await ctx.app.inject({
				method: 'POST',
				url: '/api/auth/invites',
				headers: { cookie: `mayon_session=${ownerToken}` },
				body: { label }
			});
			expect(res.statusCode).toBe(400);
			expect(res.body).toBe('{"error":"invalid label"}');
		}
	});

	it('answers 404 for unknown invite ids', async () => {
		const res = await ctx.app.inject({
			method: 'DELETE',
			url: '/api/auth/invites/does-not-exist',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(res.statusCode).toBe(404);
	});
});

describe('auth invites — enrollment and shared data', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = await seedOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('walks invite → enrollment pre-step → enroll → active identity', async () => {
		const invite = await createInvite(ctx, ownerToken, 'friend');
		ctx.clock.now += STEP_MS;
		const login = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { label: 'friend', password: invite.oneTimePassword }
		});
		expect(login.statusCode).toBe(200);
		const body = login.json() as Record<string, unknown>;
		expect(body.status).toBe('mfa_enrollment_required');
		expect(body.authenticated).toBeUndefined();
		const enrollCookie = findCookie(login.headers, 'mayon_enroll');
		expect(enrollCookie).toContain('HttpOnly');
		expect(findCookie(login.headers, 'mayon_session')).toBeUndefined();
		const secret = secretFromUri(body.otpauthUri as string);

		ctx.clock.now += STEP_MS;
		const enroll = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers: { cookie: `mayon_enroll=${cookieToken(enrollCookie as string)}` },
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(enroll.statusCode).toBe(200);
		const enrolled = enroll.json() as Record<string, unknown>;
		expect(enrolled).toMatchObject({
			authenticated: true,
			identity: { label: 'friend', role: 'invitee' }
		});
		const friendCookie = findCookie(enroll.headers, 'mayon_session');
		expect(friendCookie).toBeDefined();
		const friendToken = cookieToken(friendCookie as string);
		expect(findCookie(enroll.headers, 'mayon_enroll') ?? '').toMatch(/mayon_enroll=;/);

		const identity = await ctx.store.findIdentityByLabel('friend');
		expect(identity).toMatchObject({ status: 'active' });
		expect(identity?.mfaEnrolledAt).not.toBeNull();

		const status = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/session',
			body: {},
			headers: { cookie: `mayon_session=${friendToken}` }
		});
		expect(status.statusCode).toBe(200);
		expect(status.json()).toMatchObject({
			authenticated: true,
			identity: { label: 'friend', role: 'invitee' }
		});
	});

	it('refuses an invited identity with a wrong password uniformly', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { label: 'friend', password: 'not-the-password' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"invalid credentials"}');
	});

	it('lets the invitee reach the handler and the owner’s data (SC-005 pass-through proof)', async () => {
		const { friendToken } = await enrollFriend(ctx, ownerToken, 'reader');
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${friendToken}` },
			body: { op: 'query', sql: 'SELECT label FROM auth_identities ORDER BY created_at' }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ columns: ['label'], rows: [['owner'], ['friend'], ['reader']] });
	});

	it('lists the enroll outcome in the owner’s attempts feed', async () => {
		const res = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/attempts',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(res.statusCode).toBe(200);
		const attempts = res.json().attempts as Array<Record<string, unknown>>;
		expect(attempts[0]).toMatchObject({ identityLabel: 'reader', outcome: 'success' });
		expect(typeof attempts[0].at).toBe('number');
		expect(typeof attempts[0].source).toBe('string');
	});

	it('lists sessions of all identities with the current flag (owner view)', async () => {
		const res = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/sessions',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(res.statusCode).toBe(200);
		const sessions = res.json().sessions as Array<Record<string, unknown>>;
		expect(sessions).toHaveLength(3);
		const labels = sessions.map((s) => s.identityLabel).sort();
		expect(labels).toEqual(['friend', 'owner', 'reader']);
		expect(sessions.filter((s) => s.current === true)).toHaveLength(1);
		expect(sessions.find((s) => s.identityLabel === 'owner')?.current).toBe(true);
		expect(sessions.find((s) => s.identityLabel === 'friend')?.current).toBe(false);
	});
});

describe('auth invites — revocation (SC-005)', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = await seedOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('kills the live session, the login, and the pending enrollment immediately', async () => {
		const { friendToken, enrollToken, otpauthSecret, invite } = await enrollFriend(
			ctx,
			ownerToken,
			'friend'
		);
		const live = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${friendToken}` },
			body: { op: 'query', sql: 'SELECT 1 AS one' }
		});
		expect(live.statusCode).toBe(200);

		const revoke = await ctx.app.inject({
			method: 'DELETE',
			url: `/api/auth/invites/${invite.id}`,
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(revoke.statusCode).toBe(204);

		const dead = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${friendToken}` },
			body: { op: 'query', sql: 'SELECT 1 AS one' }
		});
		expect(dead.statusCode).toBe(401);
		expect(dead.body).toBe('{"error":"unauthenticated"}');

		ctx.clock.now += STEP_MS;
		const login = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { label: 'friend', password: invite.oneTimePassword }
		});
		expect(login.statusCode).toBe(401);
		expect(login.body).toBe('{"error":"invalid credentials"}');

		ctx.clock.now += STEP_MS;
		const enroll = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers: { cookie: `mayon_enroll=${enrollToken}` },
			body: { code: codeFor(otpauthSecret, ctx.clock.now) }
		});
		expect(enroll.statusCode).toBe(401);
		expect(enroll.body).toBe('{"error":"enrollment expired"}');

		const identity = await ctx.store.findIdentityByLabel('friend');
		expect(identity?.status).toBe('revoked');
	});

	it('expires the enroll token after 15 minutes', async () => {
		const invite = await createInvite(ctx, ownerToken, 'shortlived');
		ctx.clock.now += STEP_MS;
		const login = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/login',
			body: { label: 'shortlived', password: invite.oneTimePassword }
		});
		expect(login.statusCode).toBe(200);
		const enrollCookie = findCookie(login.headers, 'mayon_enroll');
		const secret = secretFromUri(login.json().otpauthUri as string);
		expect(enrollCookie).toContain('Max-Age=900');

		ctx.clock.now += ENROLL_TTL_MS + 1000;
		const enroll = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/enroll',
			headers: { cookie: `mayon_enroll=${cookieToken(enrollCookie as string)}` },
			body: { code: codeFor(secret, ctx.clock.now) }
		});
		expect(enroll.statusCode).toBe(401);
		expect(enroll.body).toBe('{"error":"enrollment expired"}');
	});
});

describe('auth invites — invitee role walls', () => {
	let ctx: TestApp;
	let ownerToken: string;
	let ownerSessionId: string;
	let friend: FriendSession;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = await seedOwner(ctx);
		friend = await enrollFriend(ctx, ownerToken, 'friend');
		const sessions = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/sessions',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		const listed = sessions.json().sessions as Array<Record<string, unknown>>;
		ownerSessionId = listed.find((s) => s.identityLabel === 'owner')?.id as string;
	});
	afterAll(async () => {
		await ctx.close();
	});

	function asFriend(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) {
		return ctx.app.inject({
			method,
			url,
			headers: { cookie: `mayon_session=${friend.friendToken}` },
			body
		});
	}

	it('blocks the invitee from every admin endpoint with a uniform 403', async () => {
		const walls: Array<['GET' | 'POST' | 'DELETE', string, unknown?]> = [
			['POST', '/api/auth/invites', { label: 'sneaky' }],
			['GET', '/api/auth/invites'],
			['GET', '/api/auth/attempts'],
			['DELETE', `/api/auth/sessions/${ownerSessionId}`],
			['POST', '/api/auth/sessions/revoke-all']
		];
		for (const [method, url, body] of walls) {
			const res = await asFriend(method, url, body);
			expect(res.statusCode, `${method} ${url}`).toBe(403);
			expect(res.body, `${method} ${url}`).toBe('{"error":"forbidden"}');
		}
		const ownerStill = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${ownerToken}` },
			body: { op: 'query', sql: 'SELECT 1 AS one' }
		});
		expect(ownerStill.statusCode).toBe(200);
	});

	it('lets the invitee see and revoke only their own session', async () => {
		const list = await asFriend('GET', '/api/auth/sessions');
		expect(list.statusCode).toBe(200);
		const sessions = list.json().sessions as Array<Record<string, unknown>>;
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ identityLabel: 'friend', current: true });

		const own = await asFriend('DELETE', `/api/auth/sessions/${sessions[0].id}`);
		expect(own.statusCode).toBe(204);

		const after = await ctx.app.inject({
			method: 'POST',
			url: '/api/db/query',
			headers: { cookie: `mayon_session=${friend.friendToken}` },
			body: { op: 'query', sql: 'SELECT 1 AS one' }
		});
		expect(after.statusCode).toBe(401);
	});
});

describe('auth invites — owner-only surface after lock', () => {
	let ctx: TestApp;
	let ownerToken: string;
	beforeAll(async () => {
		ctx = await startApp();
		ownerToken = await seedOwner(ctx);
	});
	afterAll(async () => {
		await ctx.close();
	});

	it('keeps setup closed once the owner exists (no registration path)', async () => {
		const res = await ctx.app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'sneaky', password: 'password123' }
		});
		expect(res.statusCode).toBe(409);
		expect(res.body).toBe('{"error":"setup closed"}');
	});

	it('answers attempts and invites listings for the owner with the documented shapes', async () => {
		const attempts = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/attempts',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(attempts.statusCode).toBe(200);
		expect(attempts.json()).toEqual({ attempts: [] });

		const invites = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/invites',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(invites.statusCode).toBe(200);
		expect(invites.json()).toEqual({ invites: [] });

		const sessions = await ctx.app.inject({
			method: 'GET',
			url: '/api/auth/sessions',
			headers: { cookie: `mayon_session=${ownerToken}` }
		});
		expect(sessions.statusCode).toBe(200);
		const listed = sessions.json().sessions as Array<Record<string, unknown>>;
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			identityLabel: 'owner',
			current: true,
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number)
		});
	});
});
