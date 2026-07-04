/// <reference lib="webworker" />
import sqlite3InitModule, { type Database, type SqlValue } from '@sqlite.org/sqlite-wasm';
import { checkBackup, REQUIRED_TABLES } from '$lib/db/backup';

interface DriverRequest {
	id: number;
	op: 'query' | 'exec' | 'batch' | 'snapshot' | 'restore' | 'validate';
	sql?: string;
	params?: unknown[];
	stmts?: { sql: string; params?: unknown[] }[];
	bytes?: ArrayBuffer;
}

interface DriverResponse {
	id: number;
	ok: boolean;
	rows?: unknown[];
	results?: { rows: unknown[] }[];
	bytes?: ArrayBuffer;
	validate?: { ok: boolean; reason?: string };
	error?: string;
}

const ctx = self as unknown as Worker;
function reply(msg: DriverResponse, transfer?: Transferable[]) {
	ctx.postMessage(msg, transfer as unknown as StructuredSerializeOptions);
}

let db: Database | null = null;
let sqlite3Module: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;

try {
	sqlite3Module = await sqlite3InitModule();
	const OpfsDb = sqlite3Module.oo1?.OpfsDb;
	if (!OpfsDb) throw new Error('OPFS VFS is unavailable in this browser.');
	const handle = new OpfsDb('file:mayon.sqlite?vfs=opfs');
	handle.exec('PRAGMA foreign_keys = ON');
	db = handle;
	reply({ id: -1, ok: true });
} catch (err) {
	reply({ id: -1, ok: false, error: err instanceof Error ? err.message : String(err) });
}

const REQUIRED_TABLES_SET = new Set(REQUIRED_TABLES);

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
		} else if (req.op === 'snapshot') {
			const root = await navigator.storage.getDirectory();
			database.exec("VACUUM INTO 'file:mayon-snapshot.sqlite?vfs=opfs'");
			const snapHandle = await root.getFileHandle('mayon-snapshot.sqlite');
			const file = await snapHandle.getFile();
			const bytes = new Uint8Array(await file.arrayBuffer());
			await root.removeEntry('mayon-snapshot.sqlite');
			reply({ id: req.id, ok: true, bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer]);
		} else if (req.op === 'restore') {
			database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
			database.close();
			const root = await navigator.storage.getDirectory();
			const handle = await root.getFileHandle('mayon.sqlite', { create: true });
			const writable = await handle.createWritable();
			await writable.write(req.bytes!);
			await writable.close();
			const OpfsDb = sqlite3Module!.oo1?.OpfsDb;
			db = new OpfsDb!('file:mayon.sqlite?vfs=opfs');
			db.exec('PRAGMA foreign_keys = ON');
			reply({ id: req.id, ok: true });
		} else if (req.op === 'validate') {
			const result = validateBytesInWorker(new Uint8Array(req.bytes!));
			reply({ id: req.id, ok: true, validate: result });
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

function validateBytesInWorker(bytes: Uint8Array): { ok: boolean; reason?: string } {
	const header = new Uint8Array(bytes.buffer, 0, 16);
	const headerOk =
		header[0] === 0x53 &&
		header[1] === 0x51 &&
		header[2] === 0x4c &&
		header[3] === 0x69 &&
		header[4] === 0x74 &&
		header[5] === 0x65 &&
		header[6] === 0x20 &&
		header[7] === 0x66 &&
		header[8] === 0x6f &&
		header[9] === 0x72 &&
		header[10] === 0x6d &&
		header[11] === 0x61 &&
		header[12] === 0x74 &&
		header[13] === 0x20 &&
		header[14] === 0x33 &&
		header[15] === 0x00;
	if (!headerOk) return { ok: false, reason: 'Not a valid SQLite database.' };

	const sqlite3 = sqlite3Module!;
	const testDb = new sqlite3.oo1.DB(':memory:');
	try {
		testDb.exec({ sql: 'ATTACH DATABASE :mem AS backup', bind: [bytes] });
	} catch {
		try {
			testDb.close();
		} catch {
			// ignore
		}
		return { ok: false, reason: 'Failed to read backup database.' };
	}

	const tablesRows = testDb.exec({
		sql: "SELECT name FROM backup.sqlite_master WHERE type='table'",
		rowMode: 'array',
		returnValue: 'resultRows'
	}) as SqlValue[][];
	const tables = new Set(tablesRows.map((r) => String(r[0])));

	for (const t of REQUIRED_TABLES_SET) {
		if (!tables.has(t)) {
			testDb.close();
			return { ok: false, reason: `Backup is missing required table: ${t}.` };
		}
	}

	let maxAppliedMillis: number | null = null;
	try {
		const migRows = testDb.exec({
			sql: 'SELECT MAX(created_at) FROM backup.__drizzle_migrations',
			rowMode: 'array',
			returnValue: 'resultRows'
		}) as SqlValue[][];
		if (migRows.length > 0 && migRows[0][0] !== null) {
			maxAppliedMillis = Number(migRows[0][0]);
		}
	} catch {
		// table absent → null → treat as legacy/old
	}

	testDb.close();
	return checkBackup({ headerOk: true, tables, maxAppliedMillis });
}
