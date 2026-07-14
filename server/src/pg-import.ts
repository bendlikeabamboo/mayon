import Database from 'better-sqlite3';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PgPoolLike, PgPoolClient } from './pg';
import { dumpDatabase } from './pg-backup';

const SQLITE_HEADER = Buffer.from('SQLite format 3\x00', 'binary');

const TABLES = [
	'chats',
	'messages',
	'branch_sources',
	'cross_links',
	'labs',
	'quizzes',
	'quiz_questions',
	'quiz_attempts',
	'quiz_answers',
	'agent_traces',
	'settings'
] as const;

type TableName = (typeof TABLES)[number];

export class ImportError extends Error {
	constructor(
		message: string,
		public statusCode = 400
	) {
		super(message);
		this.name = 'ImportError';
	}
}

export function isSqliteHeader(bytes: Buffer): boolean {
	return bytes.length >= 16 && bytes.subarray(0, 16).equals(SQLITE_HEADER);
}

function openSqliteReadonly(bytes: Buffer): { db: Database.Database; cleanup: () => void } {
	if (!isSqliteHeader(bytes)) {
		throw new ImportError('not a valid SQLite file');
	}
	const tmp = join(tmpdir(), `mayon-import-${Date.now()}.sqlite`);
	writeFileSync(tmp, bytes);
	const db = new Database(tmp, { readonly: true });
	const cleanup = () => {
		db.close();
		try {
			unlinkSync(tmp);
		} catch {
			/* ignore */
		}
	};
	return { db, cleanup };
}

function readSqliteColumns(db: Database.Database, table: string): string[] {
	const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
	return rows.map((r) => r.name);
}

async function readPgColumns(
	client: PgPoolClient,
	table: string
): Promise<Array<{ name: string; isBoolean: boolean }>> {
	const res = await client.query(
		`SELECT column_name AS name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
		[table]
	);
	return res.rows.map((r) => ({
		name: r.name as string,
		isBoolean: (r.data_type as string) === 'boolean'
	}));
}

function coerceRow(
	row: Record<string, unknown>,
	booleanCols: Set<string>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(row)) {
		if (booleanCols.has(key)) {
			if (val === 0) out[key] = false;
			else if (val === 1) out[key] = true;
			else out[key] = val;
		} else {
			out[key] = val;
		}
	}
	return out;
}

export async function dryRunImport(
	bytes: Buffer
): Promise<{ summary: Record<string, number>; warnings: string[] }> {
	const { db, cleanup } = openSqliteReadonly(bytes);
	try {
		const summary: Record<string, number> = {};
		const warnings: string[] = [];

		for (const table of TABLES) {
			const sqliteCols = readSqliteColumns(db, table);
			if (sqliteCols.length === 0) continue;
			const count = (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
			summary[table] = count;
		}

		const allTables = (
			db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
				name: string;
			}>
		).map((r) => r.name);
		const knownSet = new Set<string>(TABLES);
		for (const t of allTables) {
			if (!knownSet.has(t)) {
				warnings.push(`skipped unknown table: ${t}`);
			}
		}

		return { summary, warnings };
	} finally {
		cleanup();
	}
}

const CHUNK_SIZE = 500;

export async function runImport(
	bytes: Buffer,
	pool: PgPoolLike,
	databaseUrl: string,
	opts: { safetyDir?: string } = {}
): Promise<{ summary: Record<string, number>; safetyPath: string; safetyFilename: string }> {
	const { db, cleanup: sqliteCleanup } = openSqliteReadonly(bytes);

	const presentTables: TableName[] = [];
	for (const table of TABLES) {
		const cols = readSqliteColumns(db, table);
		if (cols.length > 0) presentTables.push(table);
	}

	if (presentTables.length === 0) {
		sqliteCleanup();
		throw new ImportError('no Mayon tables found');
	}

	const safetyDir = opts.safetyDir ?? '/data';
	const ts = Date.now();
	const safetyPath = `${safetyDir}/mayon-pre-import-${ts}.dump`;
	const safetyFilename = `mayon-pre-import-${ts}.dump`;

	await dumpDatabase(databaseUrl, safetyPath);

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query("SET LOCAL session_replication_role = 'replica'");
		await client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);

		const summary: Record<string, number> = {};

		for (const table of presentTables) {
			const sqliteCols = readSqliteColumns(db, table);
			const pgCols = await readPgColumns(client, table);
			const pgColNames = new Set(pgCols.map((c) => c.name));
			const booleanCols = new Set(pgCols.filter((c) => c.isBoolean).map((c) => c.name));
			const intersection = sqliteCols.filter((c) => pgColNames.has(c));

			if (intersection.length === 0) {
				summary[table] = 0;
				continue;
			}

			const rows = db.prepare(`SELECT ${intersection.join(', ')} FROM ${table}`).all() as Array<
				Record<string, unknown>
			>;

			if (rows.length === 0) {
				summary[table] = 0;
				continue;
			}

			let inserted = 0;

			for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
				const chunk = rows.slice(i, i + CHUNK_SIZE);
				const allValues: unknown[] = [];
				const allPlaceholders: string[] = [];
				for (const row of chunk) {
					const coerced = coerceRow(row, booleanCols);
					const phs: string[] = [];
					for (const col of intersection) {
						allValues.push(coerced[col] ?? null);
						phs.push(`$${allValues.length}`);
					}
					allPlaceholders.push(`(${phs.join(', ')})`);
				}
				await client.query(
					`INSERT INTO ${table} (${intersection.join(', ')}) VALUES ${allPlaceholders.join(', ')}`,
					allValues
				);
				inserted += chunk.length;
			}

			summary[table] = inserted;
		}

		await client.query('COMMIT');
		return { summary, safetyPath, safetyFilename };
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		client.release();
		sqliteCleanup();
	}
}

export interface RegisterPgImportOptions {
	pool?: PgPoolLike;
	databaseUrl: string;
	safetyDir?: string;
}

export function registerPgImport(app: FastifyInstance, opts: RegisterPgImportOptions): void {
	app.put('/api/import/sqlite', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
		const bytes = req.body as Buffer;
		if (!isSqliteHeader(bytes)) {
			return reply.code(400).send({ error: 'not a valid SQLite file' });
		}

		const dryRun = (req.query as { 'dry-run'?: string })['dry-run'] != null;

		if (dryRun) {
			const { summary, warnings } = await dryRunImport(bytes);
			return reply.send({ summary, warnings });
		}

		if (!opts.pool) {
			return reply.code(503).send({ error: 'pg not configured' });
		}

		try {
			const { summary, safetyPath, safetyFilename } = await runImport(
				bytes,
				opts.pool,
				opts.databaseUrl,
				{ safetyDir: opts.safetyDir }
			);
			const safetyBytes = readFileSync(safetyPath);
			reply
				.header('content-type', 'application/octet-stream')
				.header('content-disposition', `attachment; filename="${safetyFilename}"`)
				.header('x-import-summary', JSON.stringify(summary))
				.send(safetyBytes);
		} catch (err) {
			if (!reply.sent) {
				if (err instanceof ImportError) {
					reply.code(err.statusCode).send({ error: err.message });
				} else {
					const detail = err instanceof Error ? err.message : String(err);
					reply.code(500).send({ error: 'import failed', detail });
				}
			}
		}
	});
}
