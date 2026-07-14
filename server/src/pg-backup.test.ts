import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs';
import { buildApp } from './server';
import type Fastify from 'fastify';
import type { PgPoolLike } from './pg';

const spawnMock = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('node:child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

const clientMock = {
	connect: vi.fn().mockResolvedValue(undefined),
	query: vi.fn().mockResolvedValue(undefined),
	end: vi.fn().mockResolvedValue(undefined)
};
vi.mock('pg', () => ({
	default: {
		Client: vi.fn(() => clientMock),
		Pool: vi.fn()
	}
}));

vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	const fsStore = new Map<string, Buffer>();
	return {
		...actual,
		writeFile: vi.fn((p: string, d: Buffer) => {
			fsStore.set(p, d);
			return Promise.resolve();
		}),
		readFile: vi.fn((p: string) => {
			const v = fsStore.get(p);
			return v ? Promise.resolve(v) : Promise.reject(new Error(`ENOENT: ${p}`));
		}),
		mkdir: vi.fn(() => Promise.resolve()),
		unlinkSync: vi.fn(),
		createWriteStream: vi.fn(() => new PassThrough())
	};
});

const PGDMP_BYTES = Buffer.from('PGDMP', 'ascii');

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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		on(event: string, fn: (...args: any[]) => void) {
			if (event === 'close') setTimeout(() => fn(opts.exitCode ?? 0), 0);
			return child;
		}
	};
	if (opts.stdoutData) setTimeout(() => stdout.end(opts.stdoutData), 0);
	else setTimeout(() => stdout.end(), 0);
	setTimeout(() => stderr.end(), 0);
	return child;
}

function makeMockPool() {
	return {
		query: vi.fn(),
		end: vi.fn().mockResolvedValue(undefined)
	};
}

const DB_URL = 'postgres://t:t@db/test';

describe('GET /api/backup/db', () => {
	let app: Fastify.Instance;

	beforeAll(async () => {
		app = buildApp(':memory:', {
			pgPool: makeMockPool() as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		spawnMock.mockReturnValue(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }));
	});

	it('returns 503 when pool is absent', async () => {
		const a = buildApp(':memory:', { databaseUrl: DB_URL });
		await a.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await a.inject({ method: 'GET', url: '/api/backup/db' });
			expect(res.statusCode).toBe(503);
			expect(res.json().error).toBe('pg not configured');
		} finally {
			await a.close();
		}
	});

	it('returns 200 with octet-stream content-type and .dump filename', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/backup/db' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('application/octet-stream');
		expect(res.headers['content-disposition']).toMatch(
			/^attachment; filename="mayon-\d{8}\.dump"$/
		);
		expect(spawnMock).toHaveBeenCalledWith(
			'pg_dump',
			expect.arrayContaining(['-Fc', '--no-owner', '--no-privileges', '-d', DB_URL])
		);
	});
});

describe('PUT /api/backup/db', () => {
	const exitSpy = vi.spyOn(process, 'exit').mockImplementation(function () {
		throw new Error('process.exit');
	});

	afterAll(() => {
		exitSpy.mockRestore();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(clientMock.connect).mockResolvedValue(undefined);
		vi.mocked(clientMock.query).mockResolvedValue(undefined);
		vi.mocked(clientMock.end).mockResolvedValue(undefined);
		vi.mocked(readFile).mockResolvedValue(Buffer.from('safety-dump'));
	});

	it('returns 400 for non-PGDMP body', async () => {
		const pool = makeMockPool();
		const app = buildApp(':memory:', {
			pgPool: pool as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await app.inject({
				method: 'PUT',
				url: '/api/backup/db',
				payload: Buffer.from('not a dump'),
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toContain('not a valid pg_dump');
		} finally {
			await app.close();
		}
	});

	it('returns 400 when pg_restore -l fails (invalid TOC)', async () => {
		spawnMock.mockReturnValueOnce(mockChild({ exitCode: 1 }));
		spawnMock.mockReturnValue(mockChild({ exitCode: 0 }));

		const pool = makeMockPool();
		const app = buildApp(':memory:', {
			pgPool: pool as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
		try {
			const payload = Buffer.concat([PGDMP_BYTES, Buffer.alloc(100)]);
			const res = await app.inject({
				method: 'PUT',
				url: '/api/backup/db',
				payload,
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toContain('invalid or corrupt dump');
			expect(pool.end).not.toHaveBeenCalled();
		} finally {
			await app.close();
		}
	});

	it('success path: safety dump → pool.end → pg_restore → 200 + exit', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0 }));

		const pool = makeMockPool();
		const app = buildApp(':memory:', {
			pgPool: pool as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });

		try {
			const payload = Buffer.concat([PGDMP_BYTES, Buffer.alloc(100)]);
			try {
				const res = await app.inject({
					method: 'PUT',
					url: '/api/backup/db',
					payload,
					headers: { 'content-type': 'application/octet-stream' }
				});
				expect(res.statusCode).toBe(200);
				expect(res.headers['content-type']).toBe('application/octet-stream');
				expect(res.headers['content-disposition']).toMatch(/mayon-pre-restore/);
				expect(pool.end).toHaveBeenCalled();
			} catch {
				expect(pool.end).toHaveBeenCalled();
			}
		} finally {
			await app.close();
		}
	});

	it('failure path: restore fails → rollback → 500 + exit', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 1 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0 }));

		const pool = makeMockPool();
		const app = buildApp(':memory:', {
			pgPool: pool as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });

		try {
			const payload = Buffer.concat([PGDMP_BYTES, Buffer.alloc(100)]);
			try {
				const res = await app.inject({
					method: 'PUT',
					url: '/api/backup/db',
					payload,
					headers: { 'content-type': 'application/octet-stream' }
				});
				expect(res.statusCode).toBe(500);
				const json = res.json();
				expect(json.error).toBe('restore failed');
				expect(json.rolledBack).toBe(true);
			} catch {
				expect(pool.end).toHaveBeenCalled();
			}
		} finally {
			await app.close();
		}
	});
});
