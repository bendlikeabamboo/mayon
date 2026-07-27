import { serverClient } from './client';
import { serverStatus } from './status.svelte';
import { downloadBlob, isPgDumpHeader } from '$lib/db/backup';

function formatDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

export async function downloadDbBackup(): Promise<void> {
	if (!serverStatus.has('pg')) throw new Error('Server DB not ready');

	const res = await serverClient.http('/api/backup/db');
	if (!res.ok) throw new Error(`Backup download failed: ${res.status}`);

	const bytes = new Uint8Array(await res.arrayBuffer());
	const first16 = Array.from(bytes.subarray(0, 16))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join(' ');
	console.error('[mayon-backup] download', {
		status: res.status,
		contentType: res.headers.get('content-type'),
		byteLength: bytes.length,
		first16
	});

	if (!isPgDumpHeader(bytes)) {
		const hint =
			bytes.length > 0
				? new TextDecoder('utf-8', { fatal: false }).decode(
						bytes.subarray(0, Math.min(512, bytes.length))
					)
				: '(empty body)';
		throw new Error(
			`Backup failed: server returned an invalid dump (status ${res.status}, ${bytes.length} bytes, first bytes: ${first16}, body: ${hint.slice(0, 200)})`
		);
	}

	downloadBlob(bytes, `mayon-${formatDate()}.dump`);
}

export interface RestoreResult {
	notice: string;
	safetyFilename: string;
	dumpVersion: number;
	currentVersion: number;
	migrated: string[];
}

export async function restoreDbBackup(file: File): Promise<RestoreResult> {
	if (!serverStatus.has('pg')) throw new Error('Server DB not ready');

	const bytes = new Uint8Array(await file.arrayBuffer());
	const first16 = Array.from(bytes.subarray(0, 16))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join(' ');
	console.error('[mayon-backup] restore-file', {
		name: file.name,
		size: file.size,
		type: file.type,
		first16
	});
	if (!isPgDumpHeader(bytes))
		throw new Error(`Not a valid pg_dump file (${bytes.length} bytes, first bytes: ${first16})`);

	const res = await serverClient.http('/api/backup/db', {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});

	if (res.ok) {
		const payload = (await res.json()) as RestoreResult;
		return payload;
	}

	const j = await res.json().catch(() => ({}));

	if (res.status === 400) {
		throw new Error(j.error || 'Restore refused');
	}

	if (res.status === 500) {
		const detail = j.detail ? `: ${j.detail}` : '';
		throw new Error(
			j.rolledBack === true
				? `Restore failed${detail}. Your data has been rolled back to its pre-restore state.`
				: `Restore failed${detail}`
		);
	}

	throw new Error(j.detail ? `Restore failed: ${j.detail}` : `Restore failed: ${res.status}`);
}

export async function downloadSafetyBackup(filename: string): Promise<void> {
	const res = await serverClient.http(
		`/api/backup/safety?filename=${encodeURIComponent(filename)}`
	);
	if (!res.ok) throw new Error(`Safety backup download failed: ${res.status}`);

	const bytes = new Uint8Array(await res.arrayBuffer());
	downloadBlob(bytes, filename);
}
