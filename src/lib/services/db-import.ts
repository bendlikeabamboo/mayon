import { serverClient } from './client';
import { serverStatus } from './status.svelte';
import { downloadBlob, isSqliteHeader, parseContentDispositionFilename } from '$lib/db/backup';

export interface ImportPreview {
	summary: Record<string, number>;
	warnings: string[];
}

export async function dryRunImport(file: File): Promise<ImportPreview> {
	if (!serverStatus.has('pg')) throw new Error('Server DB not ready');

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!isSqliteHeader(bytes)) throw new Error('Not a valid SQLite file');

	const res = await serverClient.http('/api/import/sqlite?dry-run=1', {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});

	if (!res.ok) {
		const j = await res.json().catch(() => ({}));
		throw new Error(j.detail ? `Preview failed: ${j.detail}` : `Preview failed: ${res.status}`);
	}
	return (await res.json()) as ImportPreview;
}

export async function importFromSqlite(file: File): Promise<{ summary: Record<string, number> }> {
	if (!serverStatus.has('pg')) throw new Error('Server DB not ready');

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!isSqliteHeader(bytes)) throw new Error('Not a valid SQLite file');

	const res = await serverClient.http('/api/import/sqlite', {
		method: 'PUT',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});

	if (!res.ok) {
		const j = await res.json().catch(() => ({}));
		throw new Error(j.detail ? `Import failed: ${j.detail}` : `Import failed: ${res.status}`);
	}

	const header = res.headers.get('x-import-summary');
	const summary = header ? JSON.parse(header) : {};
	const safety = new Uint8Array(await res.arrayBuffer());
	downloadBlob(safety, parseContentDispositionFilename(res, 'mayon-pre-import.dump'));
	return { summary };
}
