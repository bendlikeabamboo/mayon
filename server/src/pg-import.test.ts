import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { FTS_BOOTSTRAP_SQL } from '@mayon/shared';
import Database from 'better-sqlite3';
import { buildApp } from './server';
import type Fastify from 'fastify';
import type { PgPoolLike } from './pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle');

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mayon-test-data-'));

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args)
}));

function mockChild(opts: { exitCode?: number; stdoutData?: Buffer } = {}) {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const child: Record<string, unknown> = {
		stdout,
		stderr,
		killed: false,
		kill() {
			child.killed = true;
			stdout.destroy();
			stderr.destroy();
		},
		on(event: string, fn: (...args: unknown[]) => void) {
			if (event === 'close') setTimeout(() => fn(opts.exitCode ?? 0), 0);
			return child;
		}
	};
	if (opts.stdoutData) setTimeout(() => stdout.end(opts.stdoutData), 0);
	else setTimeout(() => stdout.end(), 0);
	setTimeout(() => stderr.end(), 0);
	return child;
}

function createSqliteFixture(): Buffer {
	const db = new Database(':memory:');

	db.exec(`CREATE TABLE chats (
		id TEXT PRIMARY KEY, parent_id TEXT, root_id TEXT NOT NULL, title TEXT NOT NULL,
		depth INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE messages (
		id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
		content TEXT NOT NULL, ord INTEGER NOT NULL, created_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE branch_sources (
		id TEXT PRIMARY KEY, source_message_id TEXT NOT NULL, start_char INTEGER NOT NULL,
		end_char INTEGER NOT NULL, excerpt TEXT NOT NULL, branch_chat_id TEXT NOT NULL,
		created_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE cross_links (
		id TEXT PRIMARY KEY, from_chat_id TEXT NOT NULL, to_chat_id TEXT NOT NULL,
		created_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE labs (
		id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, title TEXT NOT NULL,
		content TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE quizzes (
		id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, created_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE quiz_questions (
		id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, ord INTEGER NOT NULL,
		type TEXT NOT NULL, prompt TEXT NOT NULL, payload TEXT NOT NULL
	)`);
	db.exec(`CREATE TABLE quiz_attempts (
		id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, started_at BIGINT NOT NULL,
		finished_at BIGINT
	)`);
	db.exec(`CREATE TABLE quiz_answers (
		id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, question_id TEXT NOT NULL,
		answer TEXT NOT NULL, is_correct INTEGER, created_at BIGINT
	)`);
	db.exec(`CREATE TABLE agent_traces (
		id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, config_kind TEXT NOT NULL,
		reasoning TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
		trace TEXT NOT NULL, created_at BIGINT NOT NULL
	)`);
	db.exec(`CREATE TABLE settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL
	)`);

	db.exec(`CREATE TABLE old_legacy_table(x INTEGER)`);

	const chatId = 'c1';
	const msgId = 'm1';
	db.prepare(
		`INSERT INTO chats (id, parent_id, root_id, title, depth, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`
	).run(chatId, null, chatId, 'Test Chat', 0, 1000000, 1000000);

	db.prepare(
		`INSERT INTO messages (id, chat_id, role, content, ord, created_at) VALUES (?,?,?,?,?,?)`
	).run(msgId, chatId, 'user', 'Hello world', 0, 1000000);

	db.prepare(
		`INSERT INTO branch_sources (id, source_message_id, start_char, end_char, excerpt, branch_chat_id, created_at) VALUES (?,?,?,?,?,?,?)`
	).run('bs1', msgId, 0, 5, 'Hello', chatId, 1000000);

	db.prepare(
		`INSERT INTO cross_links (id, from_chat_id, to_chat_id, created_at) VALUES (?,?,?,?)`
	).run('cl1', chatId, chatId, 1000000);

	db.prepare(
		`INSERT INTO labs (id, chat_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?)`
	).run('l1', chatId, 'Lab 1', 'Content', 1000000, 1000000);

	db.prepare(`INSERT INTO quizzes (id, chat_id, created_at) VALUES (?,?,?)`).run(
		'q1',
		chatId,
		1000000
	);

	db.prepare(
		`INSERT INTO quiz_questions (id, quiz_id, ord, type, prompt, payload) VALUES (?,?,?,?,?,?)`
	).run('qq1', 'q1', 0, 'mcq', 'What is 2+2?', '{"options":["3","4","5"],"answerIndex":1}');

	db.prepare(
		`INSERT INTO quiz_attempts (id, quiz_id, started_at, finished_at) VALUES (?,?,?,?)`
	).run('qa1', 'q1', 1000000, 1001000);

	db.prepare(
		`INSERT INTO quiz_answers (id, attempt_id, question_id, answer, is_correct, created_at) VALUES (?,?,?,?,?,?)`
	).run('anza1', 'qa1', 'qq1', '4', 1, 1000000);

	db.prepare(
		`INSERT INTO quiz_answers (id, attempt_id, question_id, answer, is_correct, created_at) VALUES (?,?,?,?,?,?)`
	).run('anza2', 'qa1', 'qq1', '3', 0, 1000000);

	db.prepare(
		`INSERT INTO agent_traces (id, chat_id, config_kind, reasoning, kind, trace, created_at) VALUES (?,?,?,?,?,?,?)`
	).run('at1', chatId, 'default', 'reasoning text', 'chat', '{}', 1000000);

	db.prepare(`INSERT INTO settings (key, value) VALUES (?,?)`).run('theme', '"dark"');

	db.prepare(`INSERT INTO old_legacy_table (x) VALUES (?)`).run(42);

	const buf = Buffer.from((db as unknown as { serialize: () => Buffer }).serialize());
	db.close();
	return buf;
}

function createNoMayonSqlite(): Buffer {
	const db = new Database(':memory:');
	db.exec(`CREATE TABLE old_legacy_table(x INTEGER)`);
	db.prepare(`INSERT INTO old_legacy_table (x) VALUES (?)`).run(1);
	const buf = Buffer.from((db as unknown as { serialize: () => Buffer }).serialize());
	db.close();
	return buf;
}

const SQLITE_FIXTURE = createSqliteFixture();
const NO_MAYON_FIXTURE = createNoMayonSqlite();
const SAFETY_BYTES = Buffer.from('safety-dump-bytes');

async function setupPglitePool() {
	const pg = new PGlite();
	const dbDrizzle = drizzle(pg);
	await migrate(dbDrizzle, { migrationsFolder: MIGRATIONS_DIR });
	for (const sql of FTS_BOOTSTRAP_SQL) {
		await pg.exec(sql);
	}

	const pool: PgPoolLike = {
		query: (t, p) => pg.query(t, p),
		connect: async () => ({
			query: (t, p) => pg.query(t, p),
			release: () => {}
		}),
		end: async () => pg.close()
	};

	return pool;
}

describe('pg-import', () => {
	let pool: PgPoolLike;
	let app: Fastify.Instance;

	beforeAll(async () => {
		pool = await setupPglitePool();
		app = buildApp(':memory:', {
			pgPool: pool,
			databaseUrl: DATA_DIR,
			pgReady: true,
			safetyDir: DATA_DIR
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
		try {
			rmSync(DATA_DIR, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	beforeEach(() => {
		vi.clearAllMocks();
		spawnMock.mockReturnValue(mockChild({ exitCode: 0, stdoutData: SAFETY_BYTES }));
	});

	it('dry-run returns summary and warnings', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/import/sqlite?dry-run=1',
			payload: SQLITE_FIXTURE,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(200);
		const json = res.json();
		expect(json.summary.chats).toBe(1);
		expect(json.summary.messages).toBe(1);
		expect(json.summary.quiz_answers).toBe(2);
		expect(json.summary.settings).toBe(1);
		expect(json.warnings).toContain('skipped unknown table: old_legacy_table');
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it('actual import returns safety dump and summary header', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/import/sqlite',
			payload: SQLITE_FIXTURE,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('application/octet-stream');
		expect(res.headers['content-disposition']).toMatch(/mayon-pre-import-\d+\.dump/);
		const importSummaryHeader = res.headers['x-import-summary'];
		expect(importSummaryHeader).toBeDefined();
		const importSummary = JSON.parse(importSummaryHeader as string);
		expect(importSummary.chats).toBe(1);
		expect(importSummary.messages).toBe(1);
		expect(importSummary.quiz_answers).toBe(2);
		expect(res.rawPayload.length).toBeGreaterThan(0);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const spawnArgs = spawnMock.mock.calls[0];
		expect(spawnArgs[0]).toBe('pg_dump');
	});

	it('post-import: data round-trips correctly with boolean coercion and FTS', async () => {
		const client = await pool.connect();
		try {
			const chats = await client.query('SELECT count(*) AS c FROM chats');
			expect(Number(chats.rows[0]?.c)).toBe(1);

			const msgs = await client.query('SELECT count(*) AS c FROM messages');
			expect(Number(msgs.rows[0]?.c)).toBe(1);

			const trueAnswers = await client.query(
				'SELECT count(*) AS c FROM quiz_answers WHERE is_correct = true'
			);
			expect(Number(trueAnswers.rows[0]?.c)).toBe(1);

			const falseAnswers = await client.query(
				'SELECT count(*) AS c FROM quiz_answers WHERE is_correct = false'
			);
			expect(Number(falseAnswers.rows[0]?.c)).toBe(1);

			const fts = await client.query(
				'SELECT search_vec IS NOT NULL AS has_fts FROM messages WHERE content = $1',
				['Hello world']
			);
			expect(fts.rows[0]?.has_fts).toBe(true);

			const briefCol = await client.query("SELECT brief FROM chats WHERE id = 'c1'");
			expect(briefCol.rows[0]?.brief).toBeNull();

			const settings = await client.query("SELECT * FROM settings WHERE key = 'theme'");
			expect(settings.rows.length).toBe(1);
		} finally {
			client.release();
		}
	});

	it('re-import is idempotent', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/import/sqlite',
			payload: SQLITE_FIXTURE,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(200);
		const summary = JSON.parse(res.headers['x-import-summary'] as string);
		expect(summary.chats).toBe(1);
		expect(summary.messages).toBe(1);
	});

	it('non-SQLite body returns 400', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/import/sqlite',
			payload: Buffer.from('not sqlite'),
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain('not a valid SQLite file');
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it('no Mayon tables returns 400', async () => {
		const res = await app.inject({
			method: 'PUT',
			url: '/api/import/sqlite',
			payload: NO_MAYON_FIXTURE,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain('no Mayon tables found');
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it('no-pool returns 503', async () => {
		const a = buildApp(':memory:', { databaseUrl: DATA_DIR });
		await a.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await a.inject({
				method: 'PUT',
				url: '/api/import/sqlite',
				payload: SQLITE_FIXTURE,
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(503);
			expect(res.json().error).toBe('pg not configured');
		} finally {
			await a.close();
		}
	});
});
