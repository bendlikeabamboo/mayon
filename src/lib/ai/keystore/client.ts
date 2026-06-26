/**
 * Runtime selector for the secret store. Desktop gets the OS keychain (secrets
 * never re-enter JS); the browser gets IndexedDB (the fetch transport reads the
 * key back to inject the auth header). Detection reuses the single `isTauri()`.
 */
import { isTauri } from '$lib/db';
import { createBrowserKeyStore } from './browser';
import { createDesktopKeyStore } from './desktop';
import type { KeyStore } from './types';

/** Pick the right `KeyStore` for the current runtime. */
export function createKeyStore(): KeyStore {
	return isTauri() ? createDesktopKeyStore() : createBrowserKeyStore();
}
