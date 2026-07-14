import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupSandboxToFile, replaceSandboxFromBytes } from './db';

function formatDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

const OCTET_STREAM = 'application/octet-stream';

export function registerBackup(app: FastifyInstance, db: Database.Database, dbPath: string): void {
	app.get('/api/backup/sandbox', async (_req, reply) => {
		const tmp = join(tmpdir(), `mayon-sandbox-backup-${Date.now()}.sqlite`);
		try {
			backupSandboxToFile(db, tmp);
			const buf = readFileSync(tmp);
			reply
				.header('content-type', OCTET_STREAM)
				.header(
					'content-disposition',
					`attachment; filename="mayon-sandbox-${formatDate()}.sqlite"`
				)
				.send(buf);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			reply.code(500).send({ error: 'backup failed', detail });
		} finally {
			try {
				unlinkSync(tmp);
			} catch {
				// temp file may not exist
			}
		}
	});

	app.put(
		'/api/backup/sandbox',
		{
			bodyLimit: 512 * 1024 * 1024
		},
		async (req, reply) => {
			const bytes = req.body as Buffer;
			const header = bytes.subarray(0, 16);
			const expected = Buffer.from('SQLite format 3\x00', 'binary');
			if (!header.equals(expected)) {
				reply.code(400).send({ error: 'not a valid SQLite file' });
				return;
			}

			try {
				await replaceSandboxFromBytes(dbPath, db, new Uint8Array(bytes));
				reply.code(204).send();
			} catch (err) {
				if (!reply.sent) {
					reply.code(500).send({ error: 'restore failed', detail: String(err) });
				}
			}
		}
	);
}
