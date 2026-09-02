import Fastify from 'fastify';
import fp from '@fastify/websocket';
import cookie from '@fastify/cookie';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	SCHEMA_VERSION,
	LEGACY_VERSION,
	SCHEMA_VERSION_SETTINGS_KEY,
	AUTH_BOOTSTRAP_SQL,
	type AuthMode,
	type HealthResponse,
	type ServerCap
} from '@mayon/shared';
import { VERSION } from './version';
import { registerMcpBridge } from './mcp';
import { registerLlmProxy } from './llm-proxy';
import { registerCopilotAuth } from './copilot-auth';
import { createSandboxDb, registerSandboxDb } from './db';
import { registerBackup } from './backup';
import { createPgPool, probePg, registerPgDb, runPgMigrations, isRestoring } from './pg';
import { registerPgBackup } from './pg-backup';
import { registerPgImport } from './pg-import';
import { runFtsBootstrap } from './fts';
import { runSchemaDataMigrations } from './schema-migrations';
import { registerAuthGate } from './auth/gate';
import { registerAuth } from './auth/index';
import { createAuthStore } from './auth/store';
import { resolveAuthSecretKey } from './auth/secret-key';
import { SESSION_COOKIE, ENROLL_COOKIE } from './auth/cookies';
import type { PgPoolLike } from './pg';

declare module 'fastify' {
	interface FastifyInstance {
		getAuthKey(): Buffer;
	}
}

const HOST = '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '4319', 10);

const SANDBOX_DB_PATH = process.env.SANDBOX_DB_PATH ?? '/data/sandbox.sqlite';

const BASE_CAPS: ServerCap[] = ['stdio-mcp', 'llm-proxy', 'sandbox-db', 'backup'];

const SECURITY_MODE_KEY = 'security.mode';
const SECURITY_MODE_TTL_MS = 5000;

interface SecurityModeCache {
	value: AuthMode;
	readAt: number;
}
const securityModeCaches = new WeakMap<PgPoolLike, SecurityModeCache>();

export async function getSecurityMode(
	pool: PgPoolLike | undefined,
	now: () => number = Date.now
): Promise<AuthMode> {
	if (!pool) {
		return 'open';
	}
	const cached = securityModeCaches.get(pool);
	if (cached && now() - cached.readAt < SECURITY_MODE_TTL_MS) {
		return cached.value;
	}
	try {
		const res = await pool.query('SELECT value FROM settings WHERE key = $1', [SECURITY_MODE_KEY]);
		let value: AuthMode = 'open';
		const raw = res.rows[0]?.value;
		if (typeof raw === 'string') {
			const parsed: unknown = JSON.parse(raw);
			if (parsed === 'open' || parsed === 'locked') {
				value = parsed;
			}
		}
		securityModeCaches.set(pool, { value, readAt: now() });
		return value;
	} catch (err) {
		if (isMissingSettingsRelation(err)) {
			return 'open';
		}
		return 'locked';
	}
}

function isMissingSettingsRelation(err: unknown): boolean {
	if ((err as { code?: string } | null)?.code === '42P01') {
		return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return /relation\s+"?settings"?\s+does not exist/i.test(message);
}

export async function setSecurityMode(
	pool: PgPoolLike | undefined,
	value: AuthMode,
	now: () => number = Date.now
): Promise<void> {
	if (!pool) {
		return;
	}
	await pool.query(
		`INSERT INTO settings(key,value) VALUES($1,$2)
		 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
		[SECURITY_MODE_KEY, JSON.stringify(value)]
	);
	securityModeCaches.set(pool, { value, readAt: now() });
}

export interface BuildAppOptions {
	pgPool?: PgPoolLike;
	pgReady?: boolean;
	databaseUrl?: string;
	safetyDir?: string;
	authNow?: () => number;
	authKeyPath?: string;
	authRateWindowMs?: number;
	authRateLadderBase?: number;
	authRateSleep?: (ms: number) => Promise<void>;
}

export function buildApp(dbPath = SANDBOX_DB_PATH, opts: BuildAppOptions = {}) {
	const trustProxyHops = Number.parseInt(process.env.MAYON_TRUST_PROXY_HOPS ?? '1', 10);
	const app = Fastify({
		trustProxy: Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1
	});

	app.register(fp);
	app.register(cookie);
	app.register(async (fastify) => {
		const now = opts.authNow ?? (() => Date.now());
		const authStore = createAuthStore(opts.pgPool, now);

		registerAuthGate(fastify, {
			store: authStore,
			getSecurityMode: () => getSecurityMode(opts.pgPool, now),
			resolveSessionToken: (request) => request.cookies?.[SESSION_COOKIE],
			now
		});

		registerAuth(fastify, {
			store: authStore,
			getSecurityMode: () => getSecurityMode(opts.pgPool, now),
			setSecurityMode: (mode) => setSecurityMode(opts.pgPool, mode, now),
			getAuthKey: () => fastify.getAuthKey(),
			resolveSessionToken: (request) => request.cookies?.[SESSION_COOKIE],
			resolveEnrollToken: (request) => request.cookies?.[ENROLL_COOKIE],
			now,
			authRateWindowMs: opts.authRateWindowMs,
			authRateLadderBase: opts.authRateLadderBase,
			authRateSleep: opts.authRateSleep
		});

		let authKey: Buffer | undefined;
		fastify.decorate('getAuthKey', () => {
			authKey ??= resolveAuthSecretKey({
				envSecret: process.env.MAYON_AUTH_SECRET,
				keyPath: opts.authKeyPath ?? path.join(path.dirname(SANDBOX_DB_PATH), 'auth-secret')
			});
			return authKey;
		});

		const caps: ServerCap[] = [...BASE_CAPS];
		if (opts.pgReady === true) caps.push('pg');

		fastify.get<{ Reply: HealthResponse }>('/api/health', async (_req, reply) => {
			return reply.send({
				ok: true,
				version: VERSION,
				caps,
				sandboxDbPath: dbPath,
				restoring: isRestoring()
			});
		});

		fastify.addContentTypeParser(
			'application/octet-stream',
			{ parseAs: 'buffer' },
			(_req, body, done) => {
				done(null, body);
			}
		);

		registerMcpBridge(fastify);
		registerLlmProxy(fastify);
		registerCopilotAuth(fastify);

		const sandboxDb = createSandboxDb(dbPath);
		registerSandboxDb(fastify, sandboxDb);
		registerBackup(fastify, sandboxDb, dbPath);

		registerPgDb(fastify, opts.pgPool);
		registerPgBackup(fastify, {
			pool: opts.pgPool,
			databaseUrl: opts.databaseUrl ?? '',
			safetyDir: opts.safetyDir
		});
		registerPgImport(fastify, {
			pool: opts.pgPool,
			databaseUrl: opts.databaseUrl ?? '',
			safetyDir: opts.safetyDir
		});

		fastify.addHook('onClose', async () => {
			await opts.pgPool?.end();
			sandboxDb.close();
		});
	});

	return app;
}

export async function start() {
	const databaseUrl = process.env.DATABASE_URL;
	let pgPool: PgPoolLike | undefined;
	let pgReady = false;
	const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle');
	if (databaseUrl) {
		const pool = createPgPool(databaseUrl);
		pgReady = await probePg(pool, { retries: 20, delayMs: 1000 });
		if (pgReady) {
			pgPool = pool;
			console.log('pg: ready');
			const migrationsOk = await runPgMigrations(pool, migrationsDir);
			pgReady = pgReady && migrationsOk;
			if (!pgReady) {
				await pool.end();
				pgPool = undefined;
			} else {
				try {
					await runFtsBootstrap(pool);
					console.log('pg: fts ready');
				} catch (err) {
					const detail = err instanceof Error ? err.message : String(err);
					console.error('pg: fts bootstrap failed —', detail);
				}

				try {
					for (const sql of AUTH_BOOTSTRAP_SQL) {
						await pool.query(sql);
					}
					console.log('pg: auth ready');
				} catch (err) {
					const detail = err instanceof Error ? err.message : String(err);
					console.error('pg: auth bootstrap failed —', detail);
				}

				try {
					const verRes = await pool.query(
						`SELECT value FROM settings WHERE key = '${SCHEMA_VERSION_SETTINGS_KEY}'`
					);
					const stampRaw = verRes.rows[0]?.value;
					const stamp = stampRaw != null ? Number(stampRaw) : LEGACY_VERSION;

					if (stamp < SCHEMA_VERSION) {
						const applied = await runSchemaDataMigrations(pool, stamp);
						for (const note of applied) {
							console.log(`pg: schema migration ${note}`);
						}
					}

					await pool.query(
						`INSERT INTO settings(key,value) VALUES('schemaVersion',$1)
						 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
						[String(SCHEMA_VERSION)]
					);
					console.log(`pg: schemaVersion ${SCHEMA_VERSION} stamped`);
				} catch (err) {
					const detail = err instanceof Error ? err.message : String(err);
					console.error('pg: schema data-migration or stamp failed —', detail);
					await pool.end();
					pgPool = undefined;
					pgReady = false;
				}
			}
		} else {
			await pool.end();
		}
	} else {
		console.log('pg: DATABASE_URL not set (pg cap disabled)');
	}

	const app = buildApp(SANDBOX_DB_PATH, { pgPool, pgReady, databaseUrl: databaseUrl ?? '' });
	await app.listen({ port: PORT, host: HOST });
	console.log(`server listening on :${PORT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	start().catch((err) => {
		console.error('Failed to start server:', err);
		process.exit(1);
	});
}
