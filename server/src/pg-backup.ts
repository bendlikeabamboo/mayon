import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, unlinkSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { PgPoolLike } from './pg';

const PGDMP = Buffer.from('PGDMP', 'ascii');

export function isPgDumpHeader(b: Buffer): boolean {
	return b.length >= 5 && b.subarray(0, 5).equals(PGDMP);
}

function runDump(databaseUrl: string, destPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-d', databaseUrl]);
		const ws = createWriteStream(destPath);
		child.stdout.pipe(ws);
		let stderr = '';
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		ws.on('error', reject);
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`pg_dump exited ${code}: ${stderr}`));
		});
	});
}

function runRestore(databaseUrl: string, srcPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_restore', [
			'--no-owner',
			'--no-privileges',
			'--dbname',
			databaseUrl,
			srcPath
		]);
		let stderr = '';
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`pg_restore exited ${code}: ${stderr}`));
		});
	});
}

function runValidateToc(srcPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_restore', ['-l', srcPath]);
		let stderr = '';
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`pg_restore -l exited ${code}: ${stderr}`));
		});
	});
}

export { runDump as dumpDatabase, runRestore as runRestore, runValidateToc as validateDumpToc };

export function spawnPgDump(databaseUrl: string) {
	return spawn('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-d', databaseUrl]);
}

function formatDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

export interface RegisterPgBackupOptions {
	pool?: PgPoolLike;
	databaseUrl: string;
}

export function registerPgBackup(app: FastifyInstance, opts: RegisterPgBackupOptions): void {
	app.get('/api/backup/db', async (_req, reply) => {
		if (!opts.pool) {
			return reply.code(503).send({ error: 'pg not configured' });
		}
		const child = spawnPgDump(opts.databaseUrl);
		let stderr = '';
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		const cleanup = () => {
			if (!child.killed) child.kill();
		};
		_req.raw.on('close', cleanup);
		reply.raw.on('close', cleanup);
		reply.header('content-type', 'application/octet-stream');
		reply.header('content-disposition', `attachment; filename="mayon-${formatDate()}.dump"`);
		reply.send(child.stdout);
		child.on('error', (err) => {
			if (!reply.sent) {
				reply.code(500).send({ error: 'backup failed', detail: err.message });
			}
		});
		child.on('close', (code) => {
			if (code !== 0 && !reply.sent) {
				reply.code(500).send({ error: 'backup failed', detail: stderr || `exit ${code}` });
			}
		});
	});

	app.put('/api/backup/db', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
		const bytes = req.body as Buffer;
		if (!isPgDumpHeader(bytes)) {
			return reply.code(400).send({ error: 'not a valid pg_dump (custom format) file' });
		}

		const ts = Date.now();
		const tmp = join(tmpdir(), `mayon-restore-${ts}.dump`);
		try {
			await writeFile(tmp, bytes);
			await runValidateToc(tmp);

			await mkdir('/data', { recursive: true });
			const safety = `/data/mayon-pre-restore-${ts}.dump`;
			await runDump(opts.databaseUrl, safety);

			await opts.pool?.end();

			const client = new pg.Client(opts.databaseUrl);
			await client.connect();
			try {
				await client.query(
					`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()`
				);
				await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
				await client.query('DROP SCHEMA public CASCADE');
				await client.query('CREATE SCHEMA public');
			} finally {
				await client.end();
			}

			try {
				await runRestore(opts.databaseUrl, tmp);
				const safetyBytes = await readFile(safety);
				reply
					.header('content-type', 'application/octet-stream')
					.header('content-disposition', `attachment; filename="mayon-pre-restore-${ts}.dump"`)
					.send(safetyBytes);
				setImmediate(() => process.exit(0));
			} catch (restoreErr) {
				const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
				try {
					await runRestore(opts.databaseUrl, safety);
				} catch {
					/* rollback failed; leave for manual recovery */
				}
				const body = { error: 'restore failed', detail, safetyPath: safety, rolledBack: true };
				if (!reply.sent) reply.code(500).send(body);
				setImmediate(() => process.exit(0));
			}
		} catch (err) {
			if (!reply.sent) {
				const detail = err instanceof Error ? err.message : String(err);
				reply.code(400).send({ error: 'invalid or corrupt dump', detail });
			}
		} finally {
			try {
				unlinkSync(tmp);
			} catch {
				/* temp may not exist */
			}
		}
	});
}
