import Fastify from 'fastify';
import fp from '@fastify/websocket';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	SCHEMA_VERSION,
	LEGACY_VERSION,
	SCHEMA_VERSION_SETTINGS_KEY,
	AUTH_BOOTSTRAP_SQL,
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
import type { PgPoolLike } from './pg';

const HOST = '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '4319', 10);

const SANDBOX_DB_PATH = process.env.SANDBOX_DB_PATH ?? '/data/sandbox.sqlite';

const BASE_CAPS: ServerCap[] = ['stdio-mcp', 'llm-proxy', 'sandbox-db', 'backup'];

export interface BuildAppOptions {
	pgPool?: PgPoolLike;
	pgReady?: boolean;
	databaseUrl?: string;
	safetyDir?: string;
}

export function buildApp(dbPath = SANDBOX_DB_PATH, opts: BuildAppOptions = {}) {
	const app = Fastify();

	app.register(fp);
	app.register(async (fastify) => {
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
