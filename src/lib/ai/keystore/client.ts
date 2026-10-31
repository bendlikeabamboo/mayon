/**
 * Runtime key store factory. Picks the IndexedDB browser store in the browser
 * and the read-only env-backed store (`env.ts`) headlessly — vitest/node has no
 * IndexedDB. Detection happens at call time so environments without IndexedDB
 * don't pay for it at import time.
 */
import { createBrowserKeyStore, type BrowserKeyStore } from './browser';
import { createEnvKeyStore } from './env';

/** Build the runtime key store: IndexedDB in the browser, env-backed otherwise. */
export function createKeyStore(): BrowserKeyStore {
	if (typeof indexedDB === 'undefined') return createEnvKeyStore();
	return createBrowserKeyStore();
}
