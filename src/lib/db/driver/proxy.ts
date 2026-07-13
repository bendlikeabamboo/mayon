import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '$lib/db/schema';
import type { StorageDriver } from './types';

/**
 * Attach the shared drizzle schema to any `StorageDriver` via the pg-proxy.
 *
 * NOTE: drizzle-orm's pg-proxy factory takes a single RemoteCallback and an
 * optional DrizzleConfig — there is no positional batch argument.
 */
export function createDb(driver: StorageDriver) {
	return drizzle(
		async (sql, params) => {
			const result = await driver.query(sql, params);
			return { rows: result.rows };
		},
		{ schema }
	);
}

export type Db = ReturnType<typeof createDb>;
