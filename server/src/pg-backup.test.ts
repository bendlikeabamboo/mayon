import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { buildApp } from './server';
import { setRestoring } from './pg';
import { filterToc } from './pg-backup';
import { SCHEMA_MIGRATIONS } from './schema-migrations';
import type Fastify from 'fastify';
import type { PgPoolLike } from './pg';

const spawnMock = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('node:child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

const fsStore = new Map<string, Buffer>();

vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		unlinkSync: vi.fn(),
		createWriteStream: vi.fn((p: string) => {
			const chunks: Buffer[] = [];
			const ws = new Writable({
				write(chunk, _enc, cb) {
					chunks.push(chunk as Buffer);
					cb();
				},
				final(cb) {
					fsStore.set(p, Buffer.concat(chunks));
					cb();
				}
			});
			return ws;
		})
	};
});

vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
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
		stat: vi.fn(async (p: string) => {
			const buf = fsStore.get(p);
			if (buf) return { size: buf.length };
			throw new Error(`ENOENT: ${p}`);
		})
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

function versionStdout(version: number): Buffer {
	return Buffer.from(
		`INSERT INTO public.settings (key, value) VALUES ('schemaVersion', '${version}');\n`
	);
}

function makeMockPool() {
	return {
		query: vi.fn().mockResolvedValue({ rows: [], fields: [], rowCount: 0 }),
		connect: vi.fn().mockResolvedValue({
			query: vi.fn().mockResolvedValue({ rows: [], fields: [], rowCount: 0 }),
			release: vi.fn()
		}),
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

	it('returns 200 with PGDMP body and versioned filename', async () => {
		const res = await app.inject({ method: 'GET', url: '/api/backup/db' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('application/octet-stream');
		expect(res.headers['content-disposition']).toMatch(
			/^attachment; filename="mayon-\d{8}-v\d+\.dump"$/
		);
		expect(res.rawPayload.subarray(0, 5).toString('ascii')).toBe('PGDMP');
	});

	it('returns 500 when pg_dump exits non-zero', async () => {
		spawnMock.mockReturnValue(mockChild({ exitCode: 1 }));
		const res = await app.inject({ method: 'GET', url: '/api/backup/db' });
		expect(res.statusCode).toBe(500);
		expect(res.json().error).toBe('backup failed');
		expect(res.json().detail).toContain('pg_dump exited 1');
	});

	it('returns 500 when pg_dump produces an empty file', async () => {
		spawnMock.mockReturnValue(mockChild({ exitCode: 0, stdoutData: Buffer.alloc(0) }));
		const res = await app.inject({ method: 'GET', url: '/api/backup/db' });
		expect(res.statusCode).toBe(500);
		expect(res.json().detail).toContain('empty file');
	});
});

describe('PUT /api/backup/db', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setRestoring(false);
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
			expect(pool.connect).not.toHaveBeenCalled();
		} finally {
			await app.close();
		}
	});

	it('refuses newer dump version (400)', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: versionStdout(9) }))
			.mockReturnValue(mockChild({ exitCode: 0 }));

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
			expect(res.json().decision).toBe('refuse-newer');
			expect(res.json().dumpVersion).toBe(9);
			expect(res.json().currentVersion).toBe(1);
			expect(pool.connect).not.toHaveBeenCalled();
		} finally {
			await app.close();
		}
	});

	it('refuses breaking migration without migrate fn (400)', async () => {
		SCHEMA_MIGRATIONS.push({
			from: 0,
			to: 1,
			description: 'breaking col rename',
			kind: 'breaking',
			hasMigrate: false
		});
		try {
			spawnMock
				.mockReturnValueOnce(mockChild({ exitCode: 0 }))
				.mockReturnValueOnce(mockChild({ exitCode: 0 }))
				.mockReturnValue(mockChild({ exitCode: 0 }));

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
				expect(res.json().decision).toBe('refuse-breaking');
				expect(pool.connect).not.toHaveBeenCalled();
			} finally {
				await app.close();
			}
		} finally {
			SCHEMA_MIGRATIONS.pop();
		}
	});

	it('success v1 to v1: proceeds with no migrations', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: versionStdout(1) }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }))
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
			const res = await app.inject({
				method: 'PUT',
				url: '/api/backup/db',
				payload,
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(200);
			const json = res.json();
			expect(json.ok).toBe(true);
			expect(json.dumpVersion).toBe(1);
			expect(json.currentVersion).toBe(1);
			expect(json.migrated).toHaveLength(0);
			expect(json.safetyFilename).toMatch(/^mayon-pre-restore-\d+\.dump$/);
			expect(json.notice).toBeDefined();
			expect(pool.connect).toHaveBeenCalled();
		} finally {
			await app.close();
		}
	});

	it('success legacy v0 to v1: proceeds with legacy notice', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }))
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
			const res = await app.inject({
				method: 'PUT',
				url: '/api/backup/db',
				payload,
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(200);
			const json = res.json();
			expect(json.dumpVersion).toBe(0);
			expect(json.notice).toContain('legacy');
		} finally {
			await app.close();
		}
	});

	it('success with migration: migrate fn called and listed', async () => {
		const migrateFn = vi.fn().mockResolvedValue(undefined);
		SCHEMA_MIGRATIONS.push({
			from: 0,
			to: 1,
			description: 'test breaking migration',
			kind: 'breaking',
			hasMigrate: true,
			migrate: migrateFn
		});
		try {
			spawnMock
				.mockReturnValueOnce(mockChild({ exitCode: 0 }))
				.mockReturnValueOnce(mockChild({ exitCode: 0 }))
				.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }))
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
				const res = await app.inject({
					method: 'PUT',
					url: '/api/backup/db',
					payload,
					headers: { 'content-type': 'application/octet-stream' }
				});
				expect(res.statusCode).toBe(200);
				const json = res.json();
				expect(json.migrated).toHaveLength(1);
				expect(json.migrated[0]).toContain('test breaking migration');
				expect(migrateFn).toHaveBeenCalledOnce();
			} finally {
				await app.close();
			}
		} finally {
			SCHEMA_MIGRATIONS.pop();
		}
	});

	it('failure: restore fails then rollback then 500 rolledBack true', async () => {
		spawnMock
			.mockReturnValueOnce(mockChild({ exitCode: 0 }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: versionStdout(1) }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }))
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
			expect(json.safetyFilename).toMatch(/^mayon-pre-restore-\d+\.dump$/);
		} finally {
			await app.close();
		}
	});
});

describe('filterToc (exclude drizzle migrations from restore)', () => {
	it('comments out __drizzle_migrations DATA entries', () => {
		const toc = [
			';',
			'; Selected TOC Entries:',
			';',
			'5; 1259 16500 TABLE DATA public chats mayon',
			'6; 1259 16510 TABLE DATA drizzle __drizzle_migrations mayon',
			'7; 1259 16520 TABLE DATA public settings mayon'
		].join('\n');
		const filtered = filterToc(toc).split('\n');
		expect(filtered[3]).toBe('5; 1259 16500 TABLE DATA public chats mayon');
		expect(filtered[4]).toBe('; 6; 1259 16510 TABLE DATA drizzle __drizzle_migrations mayon');
		expect(filtered[5]).toBe('7; 1259 16520 TABLE DATA public settings mayon');
	});

	it('leaves already-commented drizzle lines untouched', () => {
		const line = '; 6; 1259 16510 TABLE DATA drizzle __drizzle_migrations mayon';
		expect(filterToc(line)).toBe(line);
	});

	it('does not match unrelated tables', () => {
		const toc = '9; 1259 16530 TABLE DATA public agent_traces mayon';
		expect(filterToc(toc)).toBe(toc);
	});

	it('handles an empty / legacy TOC', () => {
		expect(filterToc('')).toBe('');
	});
});

describe('PUT /api/backup/db drizzle filtering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setRestoring(false);
	});

	it('excludes drizzle migrations from the dump and restores with a filtered TOC list', async () => {
		spawnMock
			.mockReturnValueOnce(
				mockChild({
					exitCode: 0,
					stdoutData: Buffer.from(
						'5; 1259 16500 TABLE DATA public chats mayon\n' +
							'6; 1259 16510 TABLE DATA drizzle __drizzle_migrations mayon\n'
					)
				})
			)
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: versionStdout(1) }))
			.mockReturnValueOnce(mockChild({ exitCode: 0, stdoutData: PGDMP_BYTES }))
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
			const res = await app.inject({
				method: 'PUT',
				url: '/api/backup/db',
				payload,
				headers: { 'content-type': 'application/octet-stream' }
			});
			expect(res.statusCode).toBe(200);

			// The safety pg_dump excludes the drizzle migrations bookkeeping data.
			const dumpCall = spawnMock.mock.calls.find(
				(c) => c[0] === 'pg_dump' && (c[1] as string[]).includes('-Fc')
			);
			expect(dumpCall).toBeDefined();
			expect(dumpCall![1]).toContain('--exclude-table-data=drizzle.__drizzle_migrations');

			// The main restore runs pg_restore --data-only with a -L filtered list.
			const restoreCalls = spawnMock.mock.calls.filter(
				(c) => c[0] === 'pg_restore' && (c[1] as string[]).includes('--data-only')
			);
			const mainRestore = restoreCalls.find((c) =>
				(c[1] as string[]).some((a) => typeof a === 'string' && a.endsWith('.list'))
			);
			expect(mainRestore).toBeDefined();
			const listArgs = mainRestore![1] as string[];
			const listIdx = listArgs.indexOf('-L');
			expect(listIdx).toBeGreaterThanOrEqual(0);
			const listPath = listArgs[listIdx + 1];
			// The list file content has the drizzle DATA entry commented out.
			const listContent = fsStore.get(listPath)?.toString('utf8') ?? '';
			expect(listContent).toContain('public chats mayon');
			expect(listContent).toMatch(/^; .*TABLE DATA drizzle __drizzle_migrations mayon$/m);
		} finally {
			await app.close();
		}
	});
});

describe('maintenance flag', () => {
	beforeEach(() => {
		setRestoring(false);
	});

	it('returns 503 on /api/db/query while restoring', async () => {
		setRestoring(true);
		try {
			const pool = makeMockPool();
			const app = buildApp(':memory:', {
				pgPool: pool as unknown as PgPoolLike,
				databaseUrl: DB_URL,
				pgReady: true
			});
			await app.listen({ port: 0, host: '0.0.0.0' });
			try {
				const res = await app.inject({
					method: 'POST',
					url: '/api/db/query',
					payload: { op: 'exec', sql: 'SELECT 1' }
				});
				expect(res.statusCode).toBe(503);
				expect(res.json().error).toBe('restore in progress');
			} finally {
				await app.close();
			}
		} finally {
			setRestoring(false);
		}
	});
});

describe('GET /api/backup/safety', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 400 for path-traversal filename', async () => {
		const app = buildApp(':memory:', {
			pgPool: makeMockPool() as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await app.inject({
				method: 'GET',
				url: '/api/backup/safety?filename=../../etc/passwd'
			});
			expect(res.statusCode).toBe(400);
		} finally {
			await app.close();
		}
	});

	it('returns 404 when safety file not found', async () => {
		const app = buildApp(':memory:', {
			pgPool: makeMockPool() as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await app.inject({
				method: 'GET',
				url: '/api/backup/safety?filename=mayon-pre-restore-12345.dump'
			});
			expect(res.statusCode).toBe(404);
		} finally {
			await app.close();
		}
	});

	it('returns 200 with file bytes when found', async () => {
		const safetyData = Buffer.from('safety-dump-bytes');
		fsStore.set('/data/mayon-pre-restore-99999.dump', safetyData);

		const app = buildApp(':memory:', {
			pgPool: makeMockPool() as unknown as PgPoolLike,
			databaseUrl: DB_URL,
			pgReady: true
		});
		await app.listen({ port: 0, host: '0.0.0.0' });
		try {
			const res = await app.inject({
				method: 'GET',
				url: '/api/backup/safety?filename=mayon-pre-restore-99999.dump'
			});
			expect(res.statusCode).toBe(200);
			expect(res.headers['content-type']).toBe('application/octet-stream');
			expect(res.rawPayload).toEqual(safetyData);
		} finally {
			await app.close();
		}
	});
});
