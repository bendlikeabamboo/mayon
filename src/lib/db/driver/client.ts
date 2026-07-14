import type { QueryResult, StorageDriver } from './types';
import { createDb, type Db } from './proxy';
import { dbStatus, type DbRuntime } from '$lib/stores/db.svelte';

/** Browser primary: Postgres over the server (RemotePgDriver). */
import { createRemotePgDriver } from './pg';

let driverRef: StorageDriver | null = null;
let dbRef: Db | null = null;
let driverPromise: Promise<Db> | null = null;

/** Core boot: run migrations over an injected driver and build the drizzle instance. */
export async function bootstrapWithDriver(
	driver: StorageDriver,
	runtime: DbRuntime = 'memory'
): Promise<Db> {
	dbStatus.status = 'initializing';
	dbStatus.runtime = runtime;
	// Migrations are run server-side in P-pg-2; browser no longer runs runMigrations.
	const db = createDb(driver);
	driverRef = driver;
	dbRef = db;
	dbStatus.markReady(runtime);
	return db;
}

/**
 * Boot the data layer exactly once for the current runtime. Updates the global
 * `dbStatus` store so the UI can react. On failure, clears the cache to allow retry.
 *
 * In P-pg-2: flips to RemotePgDriver and gates on server 'pg' cap.
 */
export async function bootstrapDb(): Promise<Db> {
	if (driverPromise) return driverPromise;
	const runtime: DbRuntime = 'pg';
	dbStatus.runtime = runtime;
	dbStatus.status = 'initializing';
	driverPromise = (async () => {
		try {
			const { waitForServerPg } = await import('$lib/server/detect');
			const { serverStatus } = await import('$lib/server/status.svelte');
			const health = await waitForServerPg();
			if (!health) {
				const msg = 'Cannot reach the Mayon server. Start it with `docker compose up`, then retry.';
				serverStatus.markDisconnected();
				dbStatus.markError(msg, 'server-unreachable');
				throw new Error(msg);
			}
			serverStatus.markConnected(health);
			const driver = createRemotePgDriver();
			return await bootstrapWithDriver(driver, runtime);
		} catch (err) {
			driverPromise = null;
			if (dbStatus.status !== 'error') {
				dbStatus.markError(err instanceof Error ? err.message : String(err));
			}
			throw err;
		}
	})();
	return driverPromise;
}

/** Resolved drizzle instance (after bootstrap). Throws if not bootstrapped. */
export function getDb(): Db {
	if (!dbRef) throw new Error('Database not bootstrapped yet — call bootstrapDb() first.');
	return dbRef;
}

/**
 * Await the bootstrapped drizzle instance. Repository code should prefer this
 * over `getDb()` so that a repo call made during early boot (before the layout's
 * `onMount` resolves `bootstrapDb`) waits for boot instead of throwing a race.
 * Throws if boot failed or was never started.
 */
export async function awaitDb(): Promise<Db> {
	if (dbRef) return dbRef;
	if (!driverPromise) {
		throw new Error('Database not bootstrapped yet — call bootstrapDb() first.');
	}
	return driverPromise;
}

/** Resolved raw driver (used by the boot-time self-check). */
export function getDriver(): StorageDriver {
	if (!driverRef) throw new Error('Driver not bootstrapped yet.');
	return driverRef;
}

/**
 * Reboot for backup/restore (P-pg-5 will repurpose). Migrations are server-side.
 */
export async function rebootstrapWith(next?: {
	driver?: StorageDriver;
	runtime?: DbRuntime;
}): Promise<Db> {
	if (next?.driver) {
		try {
			await driverRef?.dispose?.();
		} catch {
			// best-effort
		}
		driverRef = next.driver;
	}
	if (next?.runtime) dbStatus.runtime = next.runtime;
	dbStatus.status = 'initializing';
	driverPromise = null;
	dbRef = null;
	if (!driverRef) throw new Error('rebootstrap called before bootstrap');
	// Migrations are server-side; skip runMigrations.
	dbRef = createDb(driverRef);
	dbStatus.markReady(dbStatus.runtime);
	driverPromise = Promise.resolve(dbRef);
	return dbRef;
}

export type { QueryResult };
