import Database from 'better-sqlite3';
import { renameSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { DbQueryRequest, DbQueryResult } from '@mayon/shared';

const SQLITE_HEADER = Buffer.from('SQLite format 3\x00', 'binary');

export function backupSandboxToFile(db: Database.Database, destPath: string): void {
	const data = db.serialize();
	writeFileSync(destPath, data);
}

export async function replaceSandboxFromBytes(
	dbPath: string,
	currentDb: Database.Database,
	bytes: Uint8Array
): Promise<Database.Database> {
	if (bytes.length < 16 || !Buffer.from(bytes.subarray(0, 16)).equals(SQLITE_HEADER)) {
		throw new Error('not a valid SQLite file');
	}

	currentDb.close();

	try {
		renameSync(dbPath, dbPath + '.bak');
	} catch {
		// no existing file to back up
	}

	writeFileSync(dbPath, bytes);
	return createSandboxDb(dbPath);
}

export function createSandboxDb(path?: string): Database.Database {
	const dbPath = path ?? process.env.SANDBOX_DB_PATH ?? '/data/sandbox.sqlite';
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('busy_timeout = 5000');
	return db;
}

export function registerSandboxDb(app: FastifyInstance, db: Database.Database): void {
	app.post(
		'/api/sandbox/query',
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
			const body = req.body as DbQueryRequest;

			try {
				if (body.op === 'query') {
					const stmt = db.prepare(body.sql);
					const rows = stmt.raw().all(...(body.params ?? []));
					const columns = stmt.columns().map((c) => c.name);
					const result: DbQueryResult = { columns, rows: rows as unknown[][] };
					return reply.send(result);
				}

				if (body.op === 'batch') {
					if (!Array.isArray(body.stmts)) {
						reply.code(400).send({ error: 'batch requires stmts array' });
						return;
					}
					const results: DbQueryResult[] = db.transaction(() => {
						return body.stmts.map((s) => {
							const stmt = db.prepare(s.sql);
							if (stmt.reader) {
								const rows = stmt.raw().all(...(s.params ?? []));
								const columns = stmt.columns().map((c) => c.name);
								return { columns, rows: rows as unknown[][] };
							}
							stmt.run(...(s.params ?? []));
							return { columns: [], rows: [] };
						});
					})();
					return reply.send({ results });
				}

				if (body.op === 'exec') {
					const info = db.prepare(body.sql).run();
					return reply.send({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
				}

				reply.code(400).send({ error: `unknown op: ${String(body.op)}` });
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				reply.code(400).send({ error: 'query failed', detail });
			}
		}
	);
}
