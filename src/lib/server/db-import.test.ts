import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/status.svelte', () => ({
	serverStatus: {
		has: vi.fn().mockReturnValue(true),
		connected: true,
		caps: ['pg', 'backup'],
		version: '0.0.1',
		error: null,
		sandboxDbPath: '/data/sandbox.sqlite',
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

vi.mock('$lib/db/backup', () => ({
	downloadBlob: vi.fn(),
	isSqliteHeader: (bytes: Uint8Array) => {
		if (bytes.length < 16) return false;
		const header = new TextDecoder('ascii', { fatal: false }).decode(bytes.subarray(0, 16));
		return header === 'SQLite format 3\x00';
	},
	parseContentDispositionFilename: (_res: Response, fallback: string) => fallback
}));

import { serverStatus } from '$lib/server/status.svelte';
import { downloadBlob } from '$lib/db/backup';
import { dryRunImport, importFromSqlite } from '$lib/server/db-import';

const SQLITE_HEADER = new Uint8Array(Buffer.from('SQLite format 3\x00', 'binary'));

describe('dryRunImport', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
		vi.mocked(serverStatus.has).mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('throws when pg cap is absent', async () => {
		vi.mocked(serverStatus.has).mockReturnValue(false);
		const file = new File([SQLITE_HEADER], 'test.sqlite');
		await expect(dryRunImport(file)).rejects.toThrow('Server DB not ready');
	});

	it('rejects non-SQLite file before fetch', async () => {
		const file = new File([new ArrayBuffer(4)], 'bad.sqlite');
		await expect(dryRunImport(file)).rejects.toThrow('Not a valid SQLite file');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('returns preview on success', async () => {
		const preview = { summary: { chats: 5, messages: 10 }, warnings: [] };
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify(preview), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		const file = new File([SQLITE_HEADER], 'test.sqlite');
		const result = await dryRunImport(file);
		expect(result.summary).toEqual(preview.summary);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
	});

	it('throws on non-ok with detail', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: 'bad', detail: 'some error' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);

		const file = new File([SQLITE_HEADER], 'test.sqlite');
		await expect(dryRunImport(file)).rejects.toThrow('Preview failed: some error');
	});
});

describe('importFromSqlite', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
		vi.mocked(serverStatus.has).mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('throws when pg cap is absent', async () => {
		vi.mocked(serverStatus.has).mockReturnValue(false);
		const file = new File([SQLITE_HEADER], 'test.sqlite');
		await expect(importFromSqlite(file)).rejects.toThrow('Server DB not ready');
	});

	it('rejects non-SQLite file before fetch', async () => {
		const file = new File([new ArrayBuffer(4)], 'bad.sqlite');
		await expect(importFromSqlite(file)).rejects.toThrow('Not a valid SQLite file');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('downloads safety dump and returns summary', async () => {
		const safetyBytes = new Uint8Array([0x50, 0x47, 0x44]);
		const summary = { chats: 1, messages: 2 };
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(safetyBytes, {
				status: 200,
				headers: {
					'content-type': 'application/octet-stream',
					'content-disposition': 'attachment; filename="mayon-pre-import-123.dump"',
					'x-import-summary': JSON.stringify(summary)
				}
			})
		);

		const file = new File([SQLITE_HEADER], 'test.sqlite');
		const result = await importFromSqlite(file);
		expect(result.summary).toEqual(summary);
		expect(downloadBlob).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			expect.stringContaining('mayon-pre-import')
		);
	});

	it('throws on 500 with detail', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: 'import failed', detail: 'some error' }), {
				status: 500,
				headers: { 'content-type': 'application/json' }
			})
		);

		const file = new File([SQLITE_HEADER], 'test.sqlite');
		await expect(importFromSqlite(file)).rejects.toThrow('Import failed: some error');
	});
});
