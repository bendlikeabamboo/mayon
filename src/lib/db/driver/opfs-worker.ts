/// <reference lib="webworker" />
/**
 * Browser storage driver — runs inside a Web Worker because the OPFS VFS uses
 * sync-access handles which are only legal from a worker.
 *
 * This worker is a *dumb SQL executor*: it owns one OPFS-backed sqlite-wasm
 * database and answers `query` / `exec` / `batch` requests over `postMessage`.
 * All drizzle/repository logic stays on the main thread.
 *
 * (Cannot be exercised in the headless CI sandbox; it is a manual acceptance
 * gate — see AGENTS.md "Browser (OPFS)".)
 */
import sqlite3InitModule, { type Database, type SqlValue } from '@sqlite.org/sqlite-wasm';

interface DriverRequest {
	id: number;
	op: 'query' | 'exec' | 'batch';
	sql?: string;
	params?: unknown[];
	stmts?: { sql: string; params?: unknown[] }[];
}

interface DriverResponse {
	id: number;
	ok: boolean;
	rows?: unknown[];
	results?: { rows: unknown[] }[];
	error?: string;
}

const ctx = self as unknown as Worker;
function reply(msg: DriverResponse) {
	ctx.postMessage(msg);
}

let db: Database | null = null;

try {
	const sqlite3 = await sqlite3InitModule();
	const OpfsDb = sqlite3.oo1?.OpfsDb;
	if (!OpfsDb) throw new Error('OPFS VFS is unavailable in this browser.');
	// OPFS-backed database; OpfsDb auto-selects the `opfs` VFS and spawns its own
	// async-proxy worker internally. Throws if OPFS is unavailable.
	const handle = new OpfsDb('file:mayon.sqlite?vfs=opfs');
	handle.exec('PRAGMA foreign_keys = ON');
	db = handle;
	reply({ id: -1, ok: true }); // ready signal
} catch (err) {
	reply({ id: -1, ok: false, error: err instanceof Error ? err.message : String(err) });
}

ctx.onmessage = async (e: MessageEvent<DriverRequest>) => {
	const req = e.data;
	if (!db) {
		reply({ id: req.id, ok: false, error: 'Database not initialized.' });
		return;
	}
	const database = db;
	const bind = (p: unknown[] | undefined): SqlValue[] => (p ?? []) as SqlValue[];
	try {
		if (req.op === 'exec') {
			database.exec({ sql: req.sql as string, bind: bind(req.params) });
			reply({ id: req.id, ok: true });
		} else if (req.op === 'query') {
			const rows = database.exec({
				sql: req.sql as string,
				bind: bind(req.params),
				rowMode: 'array',
				returnValue: 'resultRows'
			}) as SqlValue[][];
			reply({ id: req.id, ok: true, rows });
		} else if (req.op === 'batch') {
			database.exec({ sql: 'BEGIN' });
			const results: { rows: unknown[] }[] = [];
			for (const s of req.stmts ?? []) {
				const rows = database.exec({
					sql: s.sql,
					bind: bind(s.params),
					rowMode: 'array',
					returnValue: 'resultRows'
				}) as SqlValue[][];
				results.push({ rows });
			}
			database.exec({ sql: 'COMMIT' });
			reply({ id: req.id, ok: true, results });
		}
	} catch (err) {
		try {
			database.exec({ sql: 'ROLLBACK' });
		} catch {
			// ignore rollback errors
		}
		reply({
			id: req.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		});
	}
};
