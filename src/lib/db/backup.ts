// Backup/restore suspended in P-pg-2 (RemotePgDriver has no snapshot/restore).
// Returns in P-pg-5 (pg_dump/pg_restore).

export function createBackup(): Promise<void> {
	throw new Error('Backup/restore returns in P-pg-5 (pg_dump/pg_restore).');
}

export function restoreBackupFromBytes(_bytes: Uint8Array): Promise<void> {
	throw new Error('Backup/restore returns in P-pg-5 (pg_dump/pg_restore).');
}

export function downloadBlob(bytes: Uint8Array, filename: string) {
	const blob = new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function isSqliteHeader(bytes: Uint8Array): boolean {
	return bytes.length >= 16 && bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x69;
}
