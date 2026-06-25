import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '$lib/db/schema';
import type { StorageDriver } from './types';

/**
 * Attach the shared drizzle schema to any `StorageDriver` via the sqlite-proxy.
 *
 * NOTE: drizzle-orm 0.45's proxy factory is positional —
 *   `drizzle(remoteCallback, batchCallback, { schema })` — not the object form some
 *   older guides show. Verified against the installed types (see `driver.d.ts`).
 */
export function createDb(driver: StorageDriver) {
	return drizzle(
		(sql, params) => driver.query(sql, params ?? []),
		(batch) => driver.batch(batch.map((b) => ({ sql: b.sql, params: b.params ?? [] }))),
		{ schema }
	);
}

export type Db = ReturnType<typeof createDb>;
