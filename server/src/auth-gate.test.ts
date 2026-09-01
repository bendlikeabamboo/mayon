import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import WebSocket from 'ws';
import { buildApp, getSecurityMode, setSecurityMode } from './server';
import { setRestoring } from './pg';
import { randomToken, sha256Hex } from './auth/crypto';
import { PUBLIC_ALLOWLIST } from './auth/gate';
import { createAuthStore, type AuthStore } from './auth/store';
import type { AuthIdentityStatus } from '@mayon/schema';
import type { PgPoolLike } from './pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');
const STUB_PATH = fileURLToPath(
	new URL('../../tests/fixtures/stub-mcp-server.mjs', import.meta.url)
);

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

type SweepMethod = 'GET' | 'POST' | 'PUT';

interface RouteRef {
	method: SweepMethod;
	url: string;
}

/**
 * Every route registered by the register* modules (server.ts, auth/index.ts,
 * pg.ts, db.ts, backup.ts, pg-backup.ts, pg-import.ts, mcp.ts, llm-proxy.ts,
 * copilot-auth.ts). The sweep cross-checks this list against printRoutes()
 * output so a newly registered route that is not added here fails the suite
 * instead of silently escaping the sweep.
 */
const ALL_ROUTES: readonly RouteRef[] = [
	{ method: 'GET', url: '/api/health' },
	{ method: 'POST', url: '/api/auth/session' },
	{ method: 'POST', url: '/api/auth/setup' },
	{ method: 'POST', url: '/api/auth/setup/confirm' },
	{ method: 'GET', url: '/api/backup/db' },
	{ method: 'PUT', url: '/api/backup/db' },
	{ method: 'GET', url: '/api/backup/safety' },
	{ method: 'GET', url: '/api/backup/sandbox' },
	{ method: 'PUT', url: '/api/backup/sandbox' },
	{ method: 'POST', url: '/api/llm/copilot/auth/start' },
	{ method: 'POST', url: '/api/llm/copilot/auth/poll' },
	{ method: 'POST', url: '/api/llm/copilot/token' },
	{ method: 'PUT', url: '/api/import/sqlite' },
	{ method: 'POST', url: '/api/sandbox/query' },
	{ method: 'POST', url: '/api/db/query' },
	{ method: 'GET', url: '/ws/mcp' },
	{ method: 'POST', url: '/api/llm/proxy' }
];

/**
 * Allowlisted per contracts/auth-api.md but not yet registered (arrive with
 * US3/US4 login/logout/invite work). The gate must exempt them already;
 * today they fall through to Fastify's 404.
 */
const PENDING_ALLOWLIST_ROUTES: ReadonlyArray<[SweepMethod, string]> = [
	['POST', '/api/auth/login'],
	['POST', '/api/auth/enroll'],
	['POST', '/api/auth/logout']
];

function normalizeRoutes(routes: readonly RouteRef[]): string[] {
	return routes.map((r) => `${r.method} ${r.url}`).sort();
}

/**
 * Parses fastify's printRoutes({ commonPrefix: false }) tree. Top-level lines
 * carry full paths; deeper lines carry only the divergent suffix (e.g.
 * `/confirm` under `/api/auth/setup`), accumulated via an indent-level stack.
 * Auto-generated HEAD routes are dropped.
 */
export function parseRouteTree(tree: string): RouteRef[] {
	const routes: RouteRef[] = [];
	const stack: Array<{ level: number; path: string }> = [];
	for (const rawLine of tree.split('\n')) {
		const line = rawLine.replace(/\s+$/, '');
		if (!line.trim()) {
			continue;
		}
		const indent = line.match(/^[\s│├└─]*/)![0].length;
		const level = Math.round(indent / 4);
		const content = line.slice(indent);
		if (!content.startsWith('/')) {
			continue;
		}
		const match = /^(.*?)\s*\(([^()]*)\)$/.exec(content);
		const path = match ? match[1]! : content;
		while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
			stack.pop();
		}
		const full = (stack[stack.length - 1]?.path ?? '') + path;
		if (match) {
			for (const method of match[2]!.split(',')) {
				const m = method.trim();
				if (m !== 'HEAD') {
					routes.push({ method: m as SweepMethod, url: full });
				}
			}
		}
		stack.push({ level, path: full });
	}
	return routes;
}

function sessionMinter(store: AuthStore, clock: { now: number }) {
	return async function mintSession(
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
	};
}

function brokenPool(): PgPoolLike {
	return {
		query: async () => {
			throw new Error('connection refused');
		},
		connect: async () => {
			throw new Error('connection refused');
		},
		end: async () => {}
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

describe('auth gate — locked mode sweep over every registered route (SC-001/SC-002)', () => {
	let app: ReturnType<typeof buildApp>;
	let basePort = 0;
	const clock = { now: 1_756_050_000_000 };

	beforeAll(async () => {
		const pool = await createPglitePool();
		await setSecurityMode(pool, 'locked', () => clock.now);
		app = buildApp(':memory:', { pgPool: pool, authNow: () => clock.now });
		await app.listen({ port: 0, host: '0.0.0.0' });
		const addr = app.server.address();
		if (typeof addr === 'object' && addr) {
			basePort = addr.port;
		}
	});

	afterAll(async () => {
		await app.close();
	});

	it('PUBLIC_ALLOWLIST matches the contract exactly', () => {
		expect(PUBLIC_ALLOWLIST).toEqual({
			'/api/health': 'GET',
			'/api/auth/session': 'POST',
			'/api/auth/login': 'POST',
			'/api/auth/setup': 'POST',
			'/api/auth/setup/confirm': 'POST',
			'/api/auth/enroll': 'POST',
			'/api/auth/logout': 'POST'
		});
	});

	it('printRoutes output equals the explicit register-module route list (sweep completeness)', () => {
		const parsed = parseRouteTree(app.printRoutes({ commonPrefix: false }));
		expect(normalizeRoutes(parsed)).toEqual(normalizeRoutes(ALL_ROUTES));
	});

	it.each(ALL_ROUTES.filter((r) => PUBLIC_ALLOWLIST[r.url] !== r.method))(
		'locked + no session → 401 unauthenticated on $method $url',
		async (route) => {
			const res = await app.inject({ method: route.method, url: route.url });
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"unauthenticated"}');
		}
	);

	it('keeps allowlisted GET /api/health public with its handler outcome', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
	});

	it('keeps allowlisted POST /api/auth/session public with its handler outcome', async () => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/session' });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			mode: 'locked',
			setupRequired: false,
			authenticated: false,
			identity: null,
			session: null
		});
	});

	it('keeps allowlisted POST /api/auth/setup public (handler outcome: 409 setup closed)', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/auth/setup',
			body: { label: 'x', password: 'password123' }
		});
		expect(res.statusCode).toBe(409);
		expect(res.body).toBe('{"error":"setup closed"}');
	});

	it('keeps allowlisted POST /api/auth/setup/confirm public (handler outcome: 409 setup closed)', async () => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/setup/confirm', body: {} });
		expect(res.statusCode).toBe(409);
		expect(res.body).toBe('{"error":"setup closed"}');
	});

	it.each(PENDING_ALLOWLIST_ROUTES)(
		'gate-exempts allowlisted (not yet registered) $0 $1 — no 401/403',
		async (method, url) => {
			const res = await app.inject({ method, url, body: {} });
			expect(res.statusCode).not.toBe(401);
			expect(res.statusCode).not.toBe(403);
		}
	);

	it('rejects session-less websocket upgrades with 401 before dispatch', { timeout: 15000 }, () => {
		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${basePort}/ws/mcp`);
			ws.once('error', (err: Error) => {
				expect(err.message).toContain('401');
				ws.close();
				resolve();
			});
			ws.once('open', () => {
				ws.close();
				reject(new Error('upgrade should have been refused with 401'));
			});
		});
	});
});

describe('auth gate — locked mode with-session pass-through', () => {
	let app: ReturnType<typeof buildApp>;
	let store: AuthStore;
	let basePort = 0;
	let upstream: http.Server;
	let upstreamPort = 0;
	let upstreamHits = 0;
	const clock = { now: 1_756_100_000_000 };
	let mintSession: ReturnType<typeof sessionMinter>;

	beforeAll(async () => {
		const pool = await createPglitePool();
		store = createAuthStore(pool, () => clock.now);
		mintSession = sessionMinter(store, clock);
		await setSecurityMode(pool, 'locked', () => clock.now);
		upstream = http.createServer((_req, res) => {
			upstreamHits++;
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.write('chunk-1');
			setTimeout(() => {
				res.write('chunk-2');
				res.end();
			}, 25);
		});
		await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
		upstreamPort = (upstream.address() as AddressInfo).port;
		app = buildApp(':memory:', { pgPool: pool, authNow: () => clock.now });
		await app.listen({ port: 0, host: '0.0.0.0' });
		const addr = app.server.address();
		if (typeof addr === 'object' && addr) {
			basePort = addr.port;
		}
	});

	afterAll(async () => {
		await app.close();
		upstream.closeAllConnections();
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
	});

	it('POST /api/db/query with a valid session reaches its handler', async () => {
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

	it('POST /api/llm/proxy streams the hijacked upstream through with a session', async () => {
		const { token } = await mintSession();
		const before = upstreamHits;
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			headers: { cookie: `mayon_session=${token}` },
			body: { url: `http://127.0.0.1:${upstreamPort}/stream`, method: 'GET' }
		});
		expect(res.statusCode).toBe(200);
		expect(res.payload).toBe('chunk-1chunk-2');
		expect(upstreamHits).toBe(before + 1);
	});

	it('POST /api/llm/proxy without a session is refused before the handler hijacks', async () => {
		const before = upstreamHits;
		const res = await app.inject({
			method: 'POST',
			url: '/api/llm/proxy',
			body: { url: `http://127.0.0.1:${upstreamPort}/stream`, method: 'GET' }
		});
		expect(res.statusCode).toBe(401);
		expect(res.body).toBe('{"error":"unauthenticated"}');
		expect(upstreamHits).toBe(before);
	});

	it('GET /ws/mcp upgrade with a session connects and MCP frames flow', { timeout: 15000 }, () => {
		return new Promise<void>((resolve, reject) => {
			void mintSession().then(({ token }) => {
				const ws = new WebSocket(`ws://127.0.0.1:${basePort}/ws/mcp`, {
					headers: { cookie: `mayon_session=${token}` }
				});
				ws.on('error', reject);
				ws.on('open', () => {
					ws.send(
						JSON.stringify({
							kind: 'spawn',
							serverId: 'gate1',
							spawn: {
								serverId: 'gate1',
								command: process.execPath,
								args: [STUB_PATH],
								env: {}
							}
						})
					);
				});
				const timer = setTimeout(() => {
					ws.close();
					reject(new Error('timeout waiting for spawned frame'));
				}, 10000);
				ws.on('message', (data: WebSocket.RawData) => {
					const frame = JSON.parse(data.toString()) as Record<string, unknown>;
					if (frame.kind === 'spawned') {
						clearTimeout(timer);
						expect(frame.serverId).toBe('gate1');
						ws.close();
						resolve();
					}
				});
			}, reject);
		});
	});

	it('GET /api/health stays public without a session', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
	});
});

describe('auth gate — restore ordering (auth before restore)', () => {
	let app: ReturnType<typeof buildApp>;
	let store: AuthStore;
	const clock = { now: 1_756_200_000_000 };
	let mintSession: ReturnType<typeof sessionMinter>;

	beforeAll(async () => {
		const pool = await createPglitePool();
		store = createAuthStore(pool, () => clock.now);
		mintSession = sessionMinter(store, clock);
		await setSecurityMode(pool, 'locked', () => clock.now);
		app = buildApp(':memory:', { pgPool: pool, authNow: () => clock.now });
	});

	afterAll(async () => {
		setRestoring(false);
		await app.close();
	});

	it('without a session: 401 wins over the restore 503', async () => {
		setRestoring(true);
		try {
			const res = await app.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT 1' }
			});
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"unauthenticated"}');
		} finally {
			setRestoring(false);
		}
	});

	it('with a valid session: 503 restore in progress (session never bypasses restore)', async () => {
		setRestoring(true);
		try {
			const { token } = await mintSession();
			const res = await app.inject({
				method: 'POST',
				url: '/api/db/query',
				headers: { cookie: `mayon_session=${token}` },
				body: { op: 'query', sql: 'SELECT 1' }
			});
			expect(res.statusCode).toBe(503);
			expect(res.json()).toEqual({ error: 'restore in progress' });
		} finally {
			setRestoring(false);
		}
	});

	it('GET /api/health stays public while restoring and reports the flag', async () => {
		setRestoring(true);
		try {
			const res = await app.inject({ method: 'GET', url: '/api/health' });
			expect(res.statusCode).toBe(200);
			expect(res.json().restoring).toBe(true);
		} finally {
			setRestoring(false);
		}
	});
});

describe('getSecurityMode — fail-closed on transient read errors', () => {
	const fixedNow = () => 1_756_300_000_000;

	it("returns 'locked' when the settings read throws a transient error", async () => {
		expect(await getSecurityMode(brokenPool(), fixedNow)).toBe('locked');
	});

	it("returns 'open' pre-migration when the settings table is missing", async () => {
		const client = new PGlite();
		try {
			const bare: PgPoolLike = {
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
			expect(await getSecurityMode(bare, fixedNow)).toBe('open');
		} finally {
			await client.close();
		}
	});

	it('does not cache error results — the next read goes back to the DB', async () => {
		const real = await createPglitePool();
		let fail = true;
		const flaky: PgPoolLike = {
			query: async (text, params) => {
				if (fail) {
					throw new Error('connection refused');
				}
				return real.query(text, params);
			},
			connect: () => real.connect(),
			end: () => real.end()
		};
		try {
			expect(await getSecurityMode(flaky, fixedNow)).toBe('locked');
			fail = false;
			expect(await getSecurityMode(flaky, fixedNow)).toBe('open');
		} finally {
			await real.end();
		}
	});

	it('caches successful reads within the TTL', async () => {
		const pool = await createPglitePool();
		let now = 1_756_400_000_000;
		try {
			expect(await getSecurityMode(pool, () => now)).toBe('open');
			await pool.query(
				`INSERT INTO settings(key,value) VALUES('security.mode',$1)
				 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
				[JSON.stringify('locked')]
			);
			expect(await getSecurityMode(pool, () => now)).toBe('open');
			now += 5001;
			expect(await getSecurityMode(pool, () => now)).toBe('locked');
		} finally {
			await pool.end();
		}
	});
});

describe('buildApp — gate fails closed during a DB outage', () => {
	it('401s gated routes without a session and keeps health public', async () => {
		const app = buildApp(':memory:', { pgPool: brokenPool() });
		try {
			const res = await app.inject({
				method: 'POST',
				url: '/api/db/query',
				body: { op: 'query', sql: 'SELECT 1' }
			});
			expect(res.statusCode).toBe(401);
			expect(res.body).toBe('{"error":"unauthenticated"}');
			const health = await app.inject({ method: 'GET', url: '/api/health' });
			expect(health.statusCode).toBe(200);
			expect(health.json().ok).toBe(true);
		} finally {
			await app.close();
		}
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
