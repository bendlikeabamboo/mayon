import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sidecar/status.svelte', () => ({
	sidecarStatus: {
		has: vi.fn().mockReturnValue(true),
		connected: true,
		caps: ['backup'],
		version: '0.0.1',
		error: null,
		sandboxDbPath: '/data/sandbox.sqlite',
		markConnected: vi.fn(),
		markDisconnected: vi.fn()
	}
}));

vi.mock('$lib/db/backup', () => ({
	downloadBlob: vi.fn(),
	isSqliteHeader: (bytes: Uint8Array) =>
		bytes.length >= 16 &&
		bytes[0] === 0x53 &&
		bytes[1] === 0x51 &&
		bytes[2] === 0x4c &&
		bytes[3] === 0x69
}));

import { sidecarStatus } from '$lib/sidecar/status.svelte';
import { downloadBlob } from '$lib/db/backup';
import { downloadSandboxBackup, restoreSandboxBackup } from '$lib/sidecar/sandbox-backup';

describe('downloadSandboxBackup', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
		vi.mocked(sidecarStatus.has).mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('throws when backup cap is absent', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(false);
		await expect(downloadSandboxBackup()).rejects.toThrow('Sidecar backup cap not available');
	});

	it('downloads a backup and calls downloadBlob', async () => {
		const fakeBytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66]);
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(fakeBytes, { status: 200 })
		);

		await downloadSandboxBackup();

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/backup/sandbox', undefined);
		expect(downloadBlob).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			expect.stringContaining('mayon-sandbox-')
		);
	});

	it('throws on non-ok response', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(null, { status: 500 })
		);

		await expect(downloadSandboxBackup()).rejects.toThrow('Backup download failed: 500');
	});
});

describe('restoreSandboxBackup', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.clearAllMocks();
		vi.mocked(sidecarStatus.has).mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('throws when backup cap is absent', async () => {
		vi.mocked(sidecarStatus.has).mockReturnValue(false);
		const file = new File([new ArrayBuffer(16)], 'test.sqlite');
		await expect(restoreSandboxBackup(file)).rejects.toThrow('Sidecar backup cap not available');
	});

	it('rejects non-SQLite file before uploading', async () => {
		const file = new File([new ArrayBuffer(4)], 'bad.sqlite');
		await expect(restoreSandboxBackup(file)).rejects.toThrow('Not a valid SQLite file');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('PUTs valid SQLite file to sidecar', async () => {
		const buf = new Uint8Array(100);
		buf[0] = 0x53;
		buf[1] = 0x51;
		buf[2] = 0x4c;
		buf[3] = 0x69;
		const file = new File([buf], 'sandbox.sqlite');

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(null, { status: 204 })
		);

		await restoreSandboxBackup(file);

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect((init as RequestInit).method).toBe('PUT');
		expect(((init as RequestInit).headers as Record<string, string>)['content-type']).toBe(
			'application/octet-stream'
		);
	});

	it('throws on non-ok PUT response', async () => {
		const buf = new Uint8Array(100);
		buf[0] = 0x53;
		buf[1] = 0x51;
		buf[2] = 0x4c;
		buf[3] = 0x69;
		const file = new File([buf], 'sandbox.sqlite');

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(null, { status: 400 })
		);

		await expect(restoreSandboxBackup(file)).rejects.toThrow('Restore failed: 400');
	});
});
