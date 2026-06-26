import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createBrowserKeyStore } from './browser';
import { createDesktopKeyStore } from './desktop';

// Mock the Tauri core `invoke` so the desktop store can be exercised without a
// real desktop shell (same approach as tauri-transport.test.ts). This mock is
// file-wide but only the desktop store imports `invoke`.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

describe('createDesktopKeyStore', () => {
	beforeEach(() => {
		mockedInvoke.mockReset();
	});

	it('persists a secret via the key_set command with { id, secret }', async () => {
		const store = createDesktopKeyStore();
		await store.set('p1', 'secret');
		expect(mockedInvoke).toHaveBeenCalledWith('key_set', { id: 'p1', secret: 'secret' });
	});

	it('forgets a secret via the key_delete command with { id }', async () => {
		const store = createDesktopKeyStore();
		await store.delete('p1');
		expect(mockedInvoke).toHaveBeenCalledWith('key_delete', { id: 'p1' });
	});

	it('queries presence via the key_has command and returns true when present', async () => {
		const store = createDesktopKeyStore();
		mockedInvoke.mockResolvedValue(true);
		await expect(store.has('p1')).resolves.toBe(true);
		expect(mockedInvoke).toHaveBeenCalledWith('key_has', { id: 'p1' });
	});

	it('returns false when the keychain reports the key is absent', async () => {
		const store = createDesktopKeyStore();
		mockedInvoke.mockResolvedValue(false);
		await expect(store.has('p1')).resolves.toBe(false);
		expect(mockedInvoke).toHaveBeenCalledWith('key_has', { id: 'p1' });
	});
});

describe('createBrowserKeyStore (no IndexedDB available)', () => {
	// Vitest runs in the `node` environment, which has no `indexedDB`. The
	// browser store defers its IDB availability check to call time (not import
	// time), so every operation rejects with the clear desktop-fallback message.

	it('get rejects with the IndexedDB-unavailable message', async () => {
		const store = createBrowserKeyStore();
		await expect(store.get('x')).rejects.toThrow(/IndexedDB is unavailable/);
	});

	it('has rejects with the IndexedDB-unavailable message', async () => {
		const store = createBrowserKeyStore();
		await expect(store.has('x')).rejects.toThrow(/IndexedDB is unavailable/);
	});

	it('set rejects with the IndexedDB-unavailable message', async () => {
		const store = createBrowserKeyStore();
		await expect(store.set('x', 'k')).rejects.toThrow(/IndexedDB is unavailable/);
	});

	it('delete rejects with the IndexedDB-unavailable message', async () => {
		const store = createBrowserKeyStore();
		await expect(store.delete('x')).rejects.toThrow(/IndexedDB is unavailable/);
	});
});
