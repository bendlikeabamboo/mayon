import { describe, expect, it } from 'vitest';
import { createBrowserKeyStore } from './browser';

describe('createBrowserKeyStore (no IndexedDB available)', () => {
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
