import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp, setSecurityMode } from '../server';
import { createAuthStore, type AuthStore } from '../auth/store';
import type { PgPoolLike } from '../pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../../drizzle');

/**
 * pglite pool with the repository schema migrated in. `connect()` is supported
 * so CLI transaction tests can exercise checked-out-client paths.
 */
export async function createPglitePool(): Promise<PgPoolLike> {
	const client = new PGlite();
	let closed = false;
	try {
		await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
	} catch (err) {
		await client.close();
		throw err;
	}
	const runQuery = async (text: string, params?: unknown[]) => {
		const res = await client.query(text, params as unknown[]);
		return {
			rows: res.rows as Record<string, unknown>[],
			fields: res.fields as { name: string }[],
			rowCount: res.affectedRows ?? res.rows.length
		};
	};
	return {
		query: runQuery,
		connect: async () => ({
			query: runQuery,
			release: () => undefined
		}),
		end: async () => {
			if (closed) {
				return;
			}
			closed = true;
			await client.close();
		}
	};
}

export interface TestApp {
	app: ReturnType<typeof buildApp>;
	pool: PgPoolLike | undefined;
	store: AuthStore;
	clock: { now: number };
	keyFile: string;
	close: () => Promise<void>;
}

export interface CreateTestAppOptions {
	/** Build with a migrated pglite pool (default true). */
	pg?: boolean;
	/** Shared, mutable clock so tests can advance time. */
	clock?: { now: number };
	/** Persist this mode before the app is built. Requires `pg`. */
	securityMode?: 'open' | 'locked';
	authKeyPath?: string;
}

/**
 * Builds the production Fastify app with injected test dependencies for
 * `app.inject(...)`. Never starts a listener: transport-subject tests (real
 * websockets) opt in with their own `app.listen(...)`.
 */
export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestApp> {
	const clock = opts.clock ?? { now: Date.now() };
	const pool = opts.pg === false ? undefined : await createPglitePool();
	if (opts.securityMode && !pool) {
		throw new Error('createTestApp: securityMode requires a pg pool (pg: true)');
	}
	let tempDir: string | undefined;
	const keyFile =
		opts.authKeyPath ??
		path.join((tempDir = mkdtempSync(path.join(tmpdir(), 'mayon-test-app-'))), 'auth-secret');
	try {
		if (pool && opts.securityMode) {
			await setSecurityMode(pool, opts.securityMode, () => clock.now);
		}
		const app = buildApp(':memory:', {
			pgPool: pool,
			authNow: () => clock.now,
			authKeyPath: keyFile
		});
		return {
			app,
			pool,
			store: createAuthStore(pool, () => clock.now),
			clock,
			keyFile,
			close: async () => {
				try {
					await app.close();
				} finally {
					if (tempDir) {
						rmSync(tempDir, { recursive: true, force: true });
					}
				}
			}
		};
	} catch (err) {
		await pool?.end();
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
		throw err;
	}
}
