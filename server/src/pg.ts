import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import type { DbQueryRequest, DbQueryResponse, DbQueryResult } from '@mayon/shared';
import * as schema from '@mayon/schema';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PgQueryResult {
	rows: Record<string, unknown>[];
	fields: { name: string }[];
	rowCount: number | null;
}

export interface PgPoolClient {
	query(text: string, params?: unknown[]): Promise<PgQueryResult>;
	release(err?: boolean): void;
}

export interface PgPoolLike {
	query(text: string, params?: unknown[]): Promise<PgQueryResult>;
	connect(): Promise<PgPoolClient>;
	end(): Promise<void>;
}

export function createPgPool(databaseUrl: string): pg.Pool {
	return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function probePg(
	pool: PgPoolLike,
	opts: { retries?: number; delayMs?: number } = {}
): Promise<boolean> {
	const retries = opts.retries ?? 5;
	const delayMs = opts.delayMs ?? 500;
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			await pool.query('SELECT 1');
			return true;
		} catch (err) {
			if (attempt === retries - 1) {
				const detail = err instanceof Error ? err.message : String(err);
				console.error(`pg: unreachable — ${detail}`);
				return false;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
	return false;
}

function toResult(res: PgQueryResult): DbQueryResult {
	const columns = res.fields.map((f) => f.name);
	const rows = res.rows.map((r) => res.fields.map((f) => r[f.name]));
	return { columns, rows };
}

export async function pgQueryHandler(
	pool: PgPoolLike,
	req: DbQueryRequest
): Promise<DbQueryResponse> {
	if (req.op === 'query') {
		const res = await pool.query(req.sql, req.params ?? []);
		return toResult(res);
	}

	if (req.op === 'batch') {
		const results: DbQueryResult[] = [];
		await pool.query('BEGIN');
		try {
			for (const stmt of req.stmts) {
				const res = await pool.query(stmt.sql, stmt.params ?? []);
				if (res.fields.length > 0) {
					results.push(toResult(res));
				} else {
					results.push({ columns: [], rows: [] });
				}
			}
			await pool.query('COMMIT');
			return { results };
		} catch (err) {
			await pool.query('ROLLBACK');
			throw err;
		}
	}

	const res = await pool.query(req.sql);
	return { changes: res.rowCount ?? 0, lastInsertRowid: null };
}

export async function runPgMigrations(pool: pg.Pool, migrationsDir: string): Promise<boolean> {
	try {
		const db = drizzle(pool, { schema });
		await migrate(db, { migrationsFolder: migrationsDir });
		console.log('pg: migrations applied');
		return true;
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		console.error('pg: migrations failed —', detail);
		return false;
	}
}

export function registerPgDb(app: FastifyInstance, pool: PgPoolLike | undefined): void {
	app.post(
		'/api/db/query',
		{
			schema: {
				body: {
					type: 'object',
					required: ['op'],
					properties: {
						op: { type: 'string', enum: ['query', 'batch', 'exec'] },
						sql: { type: 'string' },
						params: { type: 'array' },
						stmts: {
							type: 'array',
							items: {
								type: 'object',
								required: ['sql'],
								properties: { sql: { type: 'string' }, params: { type: 'array' } }
							}
						}
					},
					additionalProperties: false
				}
			}
		},
		async (req, reply) => {
			if (!pool) {
				reply.code(503).send({ error: 'pg not configured' });
				return;
			}
			try {
				const body = req.body as DbQueryRequest;
				const result = await pgQueryHandler(pool, body);
				reply.send(result);
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				reply.code(400).send({ error: 'query failed', detail });
			}
		}
	);
}
