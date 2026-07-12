import { createBrowserKeyStore } from './browser';
import type { KeyStore } from './types';

export function createKeyStore(): KeyStore {
	return createBrowserKeyStore();
}
