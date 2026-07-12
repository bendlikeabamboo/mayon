import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './server';
import type Fastify from 'fastify';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQLITE_HEADER_BYTES = Buffer.from('SQLite format 3\x00', 'binary');

function makeValidSqliteBytes(): Buffer {
	const tmpDbPath = join(tmpdir(), `backup-test-src-${Date.now()}.sqlite`);
	const tmpDb = new Database(tmpDbPath);
	tmpDb.exec('CREATE TABLE test(x)');
	tmpDb.exec('INSERT INTO test VALUES(1)');
	const data = tmpDb.serialize();
	tmpDb.close();
	const buf = Buffer.from(data);
	try {
		unlinkSync(tmpDbPath);
	} catch {
		/* ignore */
	}
	return buf;
}

describe('GET /api/backup/sandbox', () => {
	let app: Fastify.Instance;
	let tmpDir: string;
	let dbPath: string;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'backup-get-test-'));
		dbPath = join(tmpDir, 'get-test.sqlite');
		app = buildApp(dbPath);
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('returns 200 with application/octet-stream and sqlite header', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/backup/sandbox' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('application/octet-stream');
		expect(res.headers['content-disposition']).toMatch(
			/^attachment; filename="mayon-sandbox-\d{8}\.sqlite"$/
		);
		const body = res.rawPayload;
		expect(body.subarray(0, 16)).toEqual(SQLITE_HEADER_BYTES);
	});
});

describe('PUT /api/backup/sandbox', () => {
	let app: Fastify.Instance;
	let tmpDir: string;
	let dbPath: string;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'backup-put-test-'));
		dbPath = join(tmpDir, 'put-test.sqlite');
		app = buildApp(dbPath);
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('returns 204 for a valid SQLite file', async () => {
		const validBytes = makeValidSqliteBytes();
		const res = await app.inject({
			method: 'PUT',
			url: '/api/backup/sandbox',
			payload: validBytes,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(204);
	});

	it('returns 400 for a non-SQLite file', async () => {
		const badBytes = Buffer.from('not a sqlite file at all');
		const res = await app.inject({
			method: 'PUT',
			url: '/api/backup/sandbox',
			payload: badBytes,
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.statusCode).toBe(400);
		const json = res.json();
		expect(json.error).toContain('not a valid SQLite file');
	});
});

describe('GET /api/health (backup cap)', () => {
	let app: Fastify.Instance;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	it('includes backup in caps', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json().caps).toContain('backup');
	});
});
