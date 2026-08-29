import { spawn } from 'node:child_process';
import { createWriteStream, unlinkSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PgPoolLike } from './pg';
import { setRestoring } from './pg';
import { TABLES } from './pg-import';
import { SCHEMA_VERSION, LEGACY_VERSION, planRestore } from '@mayon/shared';
import { registryDescriptors, SCHEMA_MIGRATIONS } from './schema-migrations';

const PGDMP = Buffer.from('PGDMP', 'ascii');
const SAFETY_FILENAME_RE = /^mayon-pre-restore-\d+\.dump$/;

export function isPgDumpHeader(b: Buffer): boolean {
	return b.length >= 5 && b.subarray(0, 5).equals(PGDMP);
}

function runDump(databaseUrl: string, destPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_dump', [
			'-Fc',
			'--no-owner',
			'--no-privileges',
			// drizzle's migration bookkeeping is part of live schema state, not app data.
			// Excluding it keeps dumps from colliding with the rows drizzle inserts at boot
			// when later restored with pg_restore --data-only (duplicate-key on the pkey).
			'--exclude-table-data=drizzle.__drizzle_migrations',
			'-d',
			databaseUrl
		]);
		const ws = createWriteStream(destPath);
		// Resolving on child 'close' alone races the file writes: pg_dump exiting
		// does not mean the piped WriteStream has flushed. Wait for 'finish' so
		// callers never read a truncated dump.
		const flushed = new Promise<void>((resolveFlush, rejectFlush) => {
			ws.on('finish', resolveFlush);
			ws.on('error', rejectFlush);
		});
		child.stdout.pipe(ws);
		let stderr = '';
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('error', (err) => {
			ws.destroy();
			reject(err);
		});
		child.on('close', (code) => {
			if (code === 0) flushed.then(resolve, reject);
			else {
				ws.destroy();
				reject(new Error(`pg_dump exited ${code}: ${stderr}`));
			}
		});
	});
}

function runRestoreDataOnly(
	databaseUrl: string,
	srcPath: string,
	listPath?: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		const args = [
			'--data-only',
			'--single-transaction',
			'--disable-triggers',
			'--no-owner',
			'--no-privileges'
		];
		if (listPath) {
			args.push('-L', listPath);
		}
		args.push('--dbname', databaseUrl, srcPath);
		const child = spawn('pg_restore', args);
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

function runListToc(srcPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_restore', ['-l', srcPath]);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`pg_restore -l exited ${code}: ${stderr}`));
		});
	});
}

// Disable (comment out) TOC entries that target drizzle's migration bookkeeping
// table. The live drizzle migration state is authoritative; restoring a dump's
// copy of __drizzle_migrations would collide with the rows drizzle inserted at
// boot (duplicate-key on __drizzle_migrations_pkey) and could desync drizzle's
// view of which migrations are applied. We restore data for every Mayon table
// but never touch the drizzle schema. Active list entries begin with a number;
// prefixing with ";" turns an entry into a comment pg_restore skips.
const DRIZZLE_MIGRATIONS_RE = /\b__drizzle_migrations\b/;

export function filterToc(toc: string): string {
	return toc
		.split('\n')
		.map((line) => {
			if (line.startsWith(';')) return line;
			return DRIZZLE_MIGRATIONS_RE.test(line) ? `; ${line}` : line;
		})
		.join('\n');
}

function extractDumpVersion(srcPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn('pg_restore', [
			'--data-only',
			'-t',
			'settings',
			'--column-inserts',
			'--no-owner',
			'--no-privileges',
			srcPath
		]);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr.on('data', (d: Buffer) => {
			stderr += d.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				// Treat a non-zero exit as legacy (unstamped) rather than failing: a corrupt-but-
				// TOC-valid dump would surface again in runRestoreDataOnly below, triggering the
				// safety rollback. Treating unknown dumps as legacy lets real pre-versioned backups
				// restore into the current schema with an additive-gap notice.
				console.error(`[mayon-backup] extractDumpVersion: pg_restore exited ${code}: ${stderr}`);
				resolve(LEGACY_VERSION);
				return;
			}
			const match = stdout.match(/'schemaVersion'\s*,\s*'(\d+)'/);
			if (match) {
				resolve(parseInt(match[1], 10));
			} else {
				resolve(LEGACY_VERSION);
			}
		});
	});
}

export { runDump as dumpDatabase, runRestoreDataOnly, runListToc as listDumpToc };

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
	safetyDir?: string;
}

export function registerPgBackup(app: FastifyInstance, opts: RegisterPgBackupOptions): void {
	app.get('/api/backup/db', async (_req, reply) => {
		if (!opts.pool) {
			return reply.code(503).send({ error: 'pg not configured' });
		}

		try {
			await opts.pool.query(
				`INSERT INTO settings(key,value) VALUES('schemaVersion',$1)
				 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
				[String(SCHEMA_VERSION)]
			);
		} catch {
			/* non-fatal; dump proceeds */
		}

		const ts = Date.now();
		const tmp = join(tmpdir(), `mayon-backup-${ts}.dump`);
		try {
			await runDump(opts.databaseUrl, tmp);
			const info = await stat(tmp);
			if (info.size === 0) {
				return reply
					.code(500)
					.send({ error: 'backup failed', detail: 'pg_dump produced an empty file' });
			}

			const data = (await readFile(tmp)) as Buffer;
			const filename = `mayon-${formatDate()}-v${SCHEMA_VERSION}.dump`;
			reply
				.type('application/octet-stream')
				.header('content-disposition', `attachment; filename="${filename}"`)
				.send(data);
			try {
				unlinkSync(tmp);
			} catch {
				/* ignore */
			}
		} catch (err) {
			try {
				unlinkSync(tmp);
			} catch {
				/* ignore */
			}
			const detail = err instanceof Error ? err.message : String(err);
			if (!reply.sent) {
				reply.code(500).send({ error: 'backup failed', detail });
			}
		}
	});

	app.put('/api/backup/db', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
		const bytes = req.body as Buffer;
		if (!isPgDumpHeader(bytes)) {
			return reply.code(400).send({ error: 'not a valid pg_dump (custom format) file' });
		}

		if (!opts.pool) {
			return reply.code(503).send({ error: 'pg not configured' });
		}

		const ts = Date.now();
		const tmp = join(tmpdir(), `mayon-restore-${ts}.dump`);
		const listPath = `${tmp}.list`;
		const safetyDir = opts.safetyDir ?? '/data';
		const safetyFilename = `mayon-pre-restore-${ts}.dump`;
		const safetyPath = join(safetyDir, safetyFilename);

		try {
			await writeFile(tmp, bytes);
			// Validate the TOC and capture it; we filter out the drizzle migrations
			// bookkeeping table so pg_restore never reloads its rows over the live,
			// authoritative drizzle state (would hit __drizzle_migrations_pkey dup).
			const toc = await runListToc(tmp);
			await writeFile(listPath, filterToc(toc));

			const dumpVersion = await extractDumpVersion(tmp);

			const plan = planRestore(dumpVersion, SCHEMA_VERSION, registryDescriptors());
			if (plan.decision !== 'proceed') {
				return reply.code(400).send({
					error: plan.notice,
					decision: plan.decision,
					dumpVersion: plan.dumpVersion,
					currentVersion: plan.currentVersion
				});
			}

			setRestoring(true);

			await mkdir(safetyDir, { recursive: true });
			await runDump(opts.databaseUrl, safetyPath);

			try {
				const client = await opts.pool.connect();
				try {
					await client.query('BEGIN');
					await client.query("SET LOCAL session_replication_role = 'replica'");
					await client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
					await client.query('COMMIT');
				} finally {
					client.release();
				}

				await runRestoreDataOnly(opts.databaseUrl, tmp, listPath);

				const migrated: string[] = [];
				if (plan.migrations.length > 0) {
					const migClient = await opts.pool.connect();
					try {
						for (const desc of plan.migrations) {
							const serverMig = SCHEMA_MIGRATIONS.find(
								(m) => m.from === desc.from && m.to === desc.to
							);
							if (serverMig?.migrate) {
								await migClient.query('BEGIN');
								try {
									await serverMig.migrate(migClient);
									await migClient.query('COMMIT');
									migrated.push(`${desc.from}\u2192${desc.to}: ${desc.description}`);
								} catch (migErr) {
									await migClient.query('ROLLBACK').catch(() => {});
									throw migErr;
								}
							}
						}
					} finally {
						migClient.release();
					}
				}

				const stampClient = await opts.pool.connect();
				try {
					await stampClient.query(
						`INSERT INTO settings(key,value) VALUES('schemaVersion',$1)
						 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
						[String(SCHEMA_VERSION)]
					);
				} finally {
					stampClient.release();
				}

				setRestoring(false);

				return reply.code(200).send({
					ok: true,
					notice: plan.notice,
					safetyFilename,
					dumpVersion: plan.dumpVersion,
					currentVersion: plan.currentVersion,
					migrated
				});
			} catch (restoreErr) {
				// The safety dump may itself contain __drizzle_migrations rows (e.g. a
				// legacy dump, or one made before the dump-time exclude shipped). Filter
				// its TOC the same way so the rollback actually lands the app data back.
				let safetyListPath: string | undefined;
				try {
					const safetyToc = await runListToc(safetyPath);
					safetyListPath = `${safetyPath}.list`;
					await writeFile(safetyListPath, filterToc(safetyToc));
				} catch {
					/* if the safety TOC can't be built, fall back to an unfiltered restore */
				}
				try {
					await runRestoreDataOnly(opts.databaseUrl, safetyPath, safetyListPath);
				} catch {
					/* rollback failed; leave for manual recovery */
				}
				setRestoring(false);
				const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
				if (!reply.sent) {
					return reply.code(500).send({
						error: 'restore failed',
						detail,
						rolledBack: true,
						safetyFilename
					});
				}
			}
		} catch (err) {
			if (!reply.sent) {
				const detail = err instanceof Error ? err.message : String(err);
				return reply.code(400).send({ error: 'invalid or corrupt dump', detail });
			}
		} finally {
			try {
				unlinkSync(tmp);
			} catch {
				/* temp may not exist */
			}
			try {
				unlinkSync(listPath);
			} catch {
				/* list may not exist */
			}
		}
	});

	app.get('/api/backup/safety', async (req, reply) => {
		const query = req.query as { filename?: string };
		const filename = query.filename;
		if (!filename || !SAFETY_FILENAME_RE.test(filename)) {
			return reply.code(400).send({ error: 'invalid filename' });
		}
		const safetyDir = opts.safetyDir ?? '/data';
		const filePath = join(safetyDir, filename);
		try {
			const data = await readFile(filePath);
			reply
				.type('application/octet-stream')
				.header('content-disposition', `attachment; filename="${filename}"`)
				.send(data);
		} catch {
			return reply.code(404).send({ error: 'safety backup not found' });
		}
	});
}
