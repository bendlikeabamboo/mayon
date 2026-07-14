import type { PgPoolLike } from './pg';
import { FTS_BOOTSTRAP_SQL } from '@mayon/shared';

export async function runFtsBootstrap(pool: PgPoolLike): Promise<void> {
	for (const sql of FTS_BOOTSTRAP_SQL) {
		await pool.query(sql);
	}
}
