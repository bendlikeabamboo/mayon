import { getDriver, isTauri } from './driver/client';
import { rebootstrapWith } from './driver/client';
import migrations from './driver/migrations';
import type { DbRuntime } from '$lib/stores/db.svelte';

export const REQUIRED_TABLES: string[] = [
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
];

export function maxKnownMigrationMillis(): number {
	return Math.max(...migrations.map((m) => m.folderMillis));
}

export interface CheckBackupInput {
	headerOk: boolean;
	tables: Set<string> | Iterable<string>;
	maxAppliedMillis: number | null;
}

export interface CheckBackupResult {
	ok: boolean;
	reason?: string;
}

export function checkBackup(input: CheckBackupInput): CheckBackupResult {
	if (!input.headerOk) return { ok: false, reason: 'Not a valid SQLite database.' };

	const tablesSet = input.tables instanceof Set ? input.tables : new Set(input.tables);
	for (const t of REQUIRED_TABLES) {
		if (!tablesSet.has(t)) {
			return { ok: false, reason: `Backup is missing required table: ${t}.` };
		}
	}

	const maxKnown = maxKnownMigrationMillis();
	if (input.maxAppliedMillis !== null && input.maxAppliedMillis > maxKnown) {
		return { ok: false, reason: 'Backup is from a newer app version.' };
	}

	return { ok: true };
}

export async function validateBackupBytes(bytes: Uint8Array): Promise<CheckBackupResult> {
	const { default: initSqlJs } = await import('sql.js');
	const SQL = await initSqlJs();

	const headerOk =
		bytes[0] === 0x53 &&
		bytes[1] === 0x51 &&
		bytes[2] === 0x4c &&
		bytes[3] === 0x69 &&
		bytes[4] === 0x74 &&
		bytes[5] === 0x65 &&
		bytes[6] === 0x20 &&
		bytes[7] === 0x66 &&
		bytes[8] === 0x6f &&
		bytes[9] === 0x72 &&
		bytes[10] === 0x6d &&
		bytes[11] === 0x61 &&
		bytes[12] === 0x74 &&
		bytes[13] === 0x20 &&
		bytes[14] === 0x33 &&
		bytes[15] === 0x00;
	if (!headerOk) return checkBackup({ headerOk: false, tables: new Set(), maxAppliedMillis: null });

	const testDb = new SQL.Database(bytes as Buffer);
	try {
		const masterRows = testDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
		const tables = new Set<string>();
		if (masterRows.length > 0) {
			for (const row of masterRows[0].values) {
				tables.add(String(row[0]));
			}
		}

		let maxAppliedMillis: number | null = null;
		try {
			const migRows = testDb.exec('SELECT MAX(created_at) FROM __drizzle_migrations');
			if (migRows.length > 0 && migRows[0].values[0][0] !== null) {
				maxAppliedMillis = Number(migRows[0].values[0][0]);
			}
		} catch {
			// table absent → null
		}

		return checkBackup({ headerOk: true, tables, maxAppliedMillis });
	} finally {
		testDb.close();
	}
}

function formatDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

function downloadBlob(bytes: Uint8Array, filename: string) {
	const blob = new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export async function createBackup(): Promise<void> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const target = await save({
			filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
			defaultPath: `mayon-${formatDate()}.sqlite`
		});
		if (!target) return;
		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('backup_database', { target });
	} else {
		const bytes = await getDriver().snapshot!();
		downloadBlob(bytes, `mayon-${formatDate()}.sqlite`);
	}
}

export async function restoreBackupFromBytes(bytes: Uint8Array): Promise<void> {
	const validation = await validateBackupBytes(bytes);
	if (!validation.ok) throw new Error(validation.reason ?? 'Invalid backup.');

	const safety = await getDriver().snapshot!();
	const ts = Date.now();
	downloadBlob(safety, `mayon-pre-restore-${ts}.sqlite`);

	await getDriver().restore!(bytes);
	await rebootstrapWith();
	location.reload();
}

export async function restoreBackupFromPath(path: string): Promise<void> {
	await getDriver().dispose?.();
	const { invoke } = await import('@tauri-apps/api/core');
	const { createTauriDriver } = await import('./driver/tauri');
	await invoke('restore_database', { source: path, knownMax: maxKnownMigrationMillis() });
	await rebootstrapWith({ driver: await createTauriDriver(), runtime: 'tauri' as DbRuntime });
	location.reload();
}
