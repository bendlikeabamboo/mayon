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
import {
	downloadDbBackup,
	restoreDbBackup,
	downloadSafetyBackup,
	type RestoreResult
} from '$lib/services/db-backup';

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

	it('downloads valid PGDMP body and calls downloadBlob', async () => {
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

	it('throws and does NOT call downloadBlob when body fails PGDMP check', async () => {
		const badBody = new Uint8Array([0x7b, 0x22, 0x65, 0x72, 0x72]);
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(badBody, { status: 200, headers: { 'content-type': 'application/json' } })
		);
		await expect(downloadDbBackup()).rejects.toThrow('invalid dump');
		expect(downloadBlob).not.toHaveBeenCalled();
	});
});

describe('restoreDbBackup', () => {
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
		const file = new File([PGDMP_BYTES], 'test.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('Server DB not ready');
	});

	it('rejects non-PGDMP file before fetch', async () => {
		const file = new File([new ArrayBuffer(4)], 'bad.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('Not a valid pg_dump file');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('returns RestoreResult on 200 and does NOT auto-download', async () => {
		const resultPayload: RestoreResult = {
			notice: 'restoring from schema v1; no migrations needed',
			safetyFilename: 'mayon-pre-restore-123.dump',
			dumpVersion: 1,
			currentVersion: 1,
			migrated: []
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify(resultPayload), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		const file = new File([PGDMP_BYTES], 'restore.dump');
		const result = await restoreDbBackup(file);

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		expect(result).toEqual(resultPayload);
		expect(downloadBlob).not.toHaveBeenCalled();
	});

	it('throws user-facing message on 400 refusal', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(
				JSON.stringify({
					error: 'backup is from a newer schema (v9); upgrade Mayon first',
					decision: 'refuse-newer',
					dumpVersion: 9,
					currentVersion: 1
				}),
				{ status: 400, headers: { 'content-type': 'application/json' } }
			)
		);

		const file = new File([PGDMP_BYTES], 'restore.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('newer schema');
	});

	it('throws with rolledBack info on 500', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(
				JSON.stringify({
					error: 'restore failed',
					detail: 'pg_restore exited 1',
					rolledBack: true,
					safetyFilename: 'mayon-pre-restore-123.dump'
				}),
				{ status: 500, headers: { 'content-type': 'application/json' } }
			)
		);

		const file = new File([PGDMP_BYTES], 'restore.dump');
		await expect(restoreDbBackup(file)).rejects.toThrow('rolled back');
	});
});

describe('downloadSafetyBackup', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('downloads and calls downloadBlob on 200', async () => {
		const safetyBytes = new Uint8Array([0x50, 0x47, 0x44, 0x4d, 0x50]);
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(safetyBytes, { status: 200 })
		);

		await downloadSafetyBackup('mayon-pre-restore-123.dump');

		expect(globalThis.fetch).toHaveBeenCalledWith(
			'/api/backup/safety?filename=mayon-pre-restore-123.dump',
			undefined
		);
		expect(downloadBlob).toHaveBeenCalledWith(expect.any(Uint8Array), 'mayon-pre-restore-123.dump');
	});

	it('throws on non-ok response', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(null, { status: 404 })
		);
		await expect(downloadSafetyBackup('mayon-pre-restore-123.dump')).rejects.toThrow(
			'Safety backup download failed: 404'
		);
	});
});
