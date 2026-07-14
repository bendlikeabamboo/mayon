import { serverClient } from './client';
import { serverStatus } from './status.svelte';
import { downloadBlob, isPgDumpHeader, parseContentDispositionFilename } from '$lib/db/backup';

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
	downloadBlob(bytes, `mayon-${formatDate()}.dump`);
}

export async function restoreDbBackup(file: File): Promise<void> {
	if (!serverStatus.has('pg')) throw new Error('Server DB not ready');

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!isPgDumpHeader(bytes)) throw new Error('Not a valid pg_dump file');

	const res = await serverClient.http('/api/backup/db', {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});

	if (res.ok) {
		const safety = new Uint8Array(await res.arrayBuffer());
		downloadBlob(safety, parseContentDispositionFilename(res, 'mayon-pre-restore.dump'));
		location.reload();
		return;
	}

	const j = await res.json().catch(() => ({}));
	throw new Error(j.detail ? `Restore failed: ${j.detail}` : `Restore failed: ${res.status}`);
}
