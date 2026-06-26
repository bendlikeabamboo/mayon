/**
 * Desktop secret store backed by the OS keychain via Tauri commands.
 *
 * Deliberately has NO `get`: the plaintext never re-enters JS. Save sends the
 * secret into Rust exactly once (`key_set`); `key_has` returns only a boolean;
 * `key_delete` forgets it. The Rust side resolves the secret into the request
 * header itself (see the `tauri-transport` / `llm_stream` bridge).
 */
import { invoke } from '@tauri-apps/api/core';
import type { KeyStore } from './types';

export class DesktopKeyStore implements KeyStore {
	async has(id: string): Promise<boolean> {
		return invoke<boolean>('key_has', { id });
	}
	async set(id: string, secret: string): Promise<void> {
		await invoke('key_set', { id, secret });
	}
	async delete(id: string): Promise<void> {
		await invoke('key_delete', { id });
	}
}

/** Build the desktop (OS-keychain) key store. */
export function createDesktopKeyStore(): KeyStore {
	return new DesktopKeyStore();
}
