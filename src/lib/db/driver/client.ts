import type { QueryResult, StorageDriver } from './types';
import { createDb, type Db } from './proxy';
import { runMigrations } from './migrator';
import migrations from './migrations';
import { dbStatus, type DbRuntime } from '$lib/stores/db.svelte';

/** Detect the Tauri desktop shell. Uses the reliable internal global check. */
export function isTauri(): boolean {
	return '__TAURI_INTERNALS__' in globalThis;
}

function opfsAvailable(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		'storage' in navigator &&
		typeof navigator.storage?.getDirectory === 'function'
	);
}

/** Select the right driver for the current runtime (dynamic import per bundle). */
async function createDriver(): Promise<StorageDriver> {
	if (isTauri()) {
		const { createTauriDriver } = await import('./tauri');
		return createTauriDriver();
	}
	if (!opfsAvailable()) {
		throw new Error(
			'OPFS is not available in this browser. Use the Mayon desktop app, or a modern browser with OPFS enabled.'
		);
	}
	const { createOpfsDriver } = await import('./opfs-driver');
	return createOpfsDriver();
}

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
	await runMigrations(driver, migrations);
	const db = createDb(driver);
	driverRef = driver;
	dbRef = db;
	dbStatus.markReady(runtime);
	return db;
}

/**
 * Boot the data layer exactly once for the current runtime. Updates the global
 * `dbStatus` store so the UI can react. On failure, clears the cache to allow retry.
 */
export function bootstrapDb(): Promise<Db> {
	if (driverPromise) return driverPromise;
	const runtime: DbRuntime = isTauri() ? 'tauri' : 'browser';
	dbStatus.runtime = runtime;
	dbStatus.status = 'initializing';
	driverPromise = (async () => {
		try {
			const driver = await createDriver();
			return await bootstrapWithDriver(driver, runtime);
		} catch (err) {
			driverPromise = null;
			dbStatus.markError(err instanceof Error ? err.message : String(err));
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

/** Resolved raw driver (used by the boot-time self-check). */
export function getDriver(): StorageDriver {
	if (!driverRef) throw new Error('Driver not bootstrapped yet.');
	return driverRef;
}

export type { QueryResult };
