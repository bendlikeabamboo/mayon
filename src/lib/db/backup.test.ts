import { describe, expect, it } from 'vitest';
import { isPgDumpHeader, parseContentDispositionFilename } from '$lib/db/backup';

describe('isPgDumpHeader', () => {
	it('returns true for PGDMP magic bytes', () => {
		const bytes = new Uint8Array([0x50, 0x47, 0x44, 0x4d, 0x50, 0x00, 0x01]);
		expect(isPgDumpHeader(bytes)).toBe(true);
	});

	it('returns false for SQLite header', () => {
		const bytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66]);
		expect(isPgDumpHeader(bytes)).toBe(false);
	});

	it('returns false for too-short input', () => {
		expect(isPgDumpHeader(new Uint8Array([0x50]))).toBe(false);
		expect(isPgDumpHeader(new Uint8Array([]))).toBe(false);
	});
});

describe('parseContentDispositionFilename', () => {
	it('parses filename from content-disposition header', () => {
		const res = new Response(null, {
			headers: { 'content-disposition': 'attachment; filename="mayon-pre-restore.dump"' }
		});
		expect(parseContentDispositionFilename(res, 'fallback.dump')).toBe('mayon-pre-restore.dump');
	});

	it('returns fallback when header is missing', () => {
		const res = new Response(null);
		expect(parseContentDispositionFilename(res, 'fallback.dump')).toBe('fallback.dump');
	});
});
