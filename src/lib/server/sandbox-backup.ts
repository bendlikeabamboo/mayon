import { serverClient } from './client';
import { serverStatus } from './status.svelte';
import { downloadBlob } from '$lib/db/backup';

function isSqliteHeader(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 16 &&
		bytes[0] === 0x53 &&
		bytes[1] === 0x51 &&
		bytes[2] === 0x4c &&
		bytes[3] === 0x69
	);
}

function formatDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

export async function downloadSandboxBackup(): Promise<void> {
	if (!serverStatus.has('backup')) throw new Error('Server backup cap not available');

	const res = await serverClient.http('/api/backup/sandbox');
	if (!res.ok) throw new Error(`Backup download failed: ${res.status}`);

	const bytes = new Uint8Array(await res.arrayBuffer());
	downloadBlob(bytes, `mayon-sandbox-${formatDate()}.sqlite`);
}

export async function restoreSandboxBackup(file: File): Promise<void> {
	if (!serverStatus.has('backup')) throw new Error('Server backup cap not available');

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!isSqliteHeader(bytes)) throw new Error('Not a valid SQLite file');

	const res = await serverClient.http('/api/backup/sandbox', {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});
	if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
}
