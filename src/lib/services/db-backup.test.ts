import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/status.svelte', () => ({
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
	isPgDumpHeader: (bytes: Uint8Array) =>
		bytes.length >= 5 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x47 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x4d &&
		bytes[4] === 0x50,
	parseContentDispositionFilename: (_res: Response, fallback: string) => fallback
}));

import { serverStatus } from '$lib/services/status.svelte';
import { downloadBlob } from '$lib/db/backup';
import { downloadDbBackup, restoreDbBackup } from '$lib/services/db-backup';

const PGDMP_BYTES = new Uint8Array([0x50, 0x47, 0x44, 0x4d, 0x50, 0x00, 0x00, 0x00]);

describe('downloadDbBackup', () => {
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
		await expect(downloadDbBackup()).rejects.toThrow('Server DB not ready');
	});

	it('downloads and calls downloadBlob', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(PGDMP_BYTES, { status: 200 })
		);
		await downloadDbBackup();
		expect(globalThis.fetch).toHaveBeenCalledWith('/api/backup/db', undefined);
		expect(downloadBlob).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			expect.stringContaining('mayon-')
		);
	});

	it('throws on non-ok response', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(null, { status: 500 })
		);
		await expect(downloadDbBackup()).rejects.toThrow('Backup download failed: 500');
	});
});

describe('restoreDbBackup', () => {
	const originalFetch = globalThis.fetch;
	const origLocation = globalThis.location;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).location = { reload: vi.fn() };
		vi.clearAllMocks();
		vi.mocked(serverStatus.has).mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).location = origLocation;
	});

	it('throws when pg cap is absent', async () => {
		vi.mocked(serverStatus.has).mockReturnValue(false);
		const file = new File([PGDMP_BYTES], 'test.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('Server DB not ready');
	});

	it('rejects non-PGDMP file before fetch', async () => {
		const file = new File([new ArrayBuffer(4)], 'bad.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('Not a valid pg_dump file');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('PUTs valid bytes and reloads on 200', async () => {
		const safetyBytes = new Uint8Array([0x50, 0x47, 0x44, 0x4d, 0x50]);
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(safetyBytes, {
				status: 200,
				headers: { 'content-disposition': 'attachment; filename="safety.dump"' }
			})
		);

		const file = new File([PGDMP_BYTES], 'restore.dump');
		await restoreDbBackup(file);

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect((init as RequestInit).method).toBe('PUT');
		expect(((init as RequestInit).headers as Record<string, string>)['content-type']).toBe(
			'application/octet-stream'
		);
		expect(downloadBlob).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			expect.stringContaining('mayon-pre-restore')
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((globalThis as any).location.reload).toHaveBeenCalled();
	});

	it('throws on 500 with detail', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: 'restore failed', detail: 'some error' }), {
				status: 500,
				headers: { 'content-type': 'application/json' }
			})
		);

		const file = new File([PGDMP_BYTES], 'restore.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('Restore failed: some error');
	});
});
