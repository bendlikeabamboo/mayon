/**
 * The runtime-agnostic secret store seam. Implementations:
 *   - desktop (`desktop.ts`): OS keychain via Tauri commands — secrets never
 *     re-enter JS (no `get` exists on desktop).
 *   - browser (`browser.ts`): IndexedDB — the fetch transport reads the key back
 *     into the auth header because the browser has no secure enclave.
 *
 * `client.ts` (`createKeyStore`) picks one by `isTauri()`.
 */
export interface KeyStore {
	/** True if a secret is stored for `id` (never returns the secret itself). */
	has(id: string): Promise<boolean>;
	/** Persist `key` for `id`. On desktop the plaintext crosses into Rust once, here. */
	set(id: string, key: string): Promise<void>;
	/** Forget the secret for `id` (no-op if absent). */
	delete(id: string): Promise<void>;
}
