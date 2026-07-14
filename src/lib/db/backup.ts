export function downloadBlob(
	bytes: Uint8Array,
	filename: string,
	type = 'application/octet-stream'
) {
	const blob = new Blob([bytes as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function isPgDumpHeader(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 5 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x47 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x4d &&
		bytes[4] === 0x50
	);
}

export function parseContentDispositionFilename(res: Response, fallback: string): string {
	const cd = res.headers.get('content-disposition');
	if (!cd) return fallback;
	const match = cd.match(/filename="?([^";]+)"?/);
	return match ? match[1] : fallback;
}
