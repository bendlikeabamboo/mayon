/**
 * The runtime-agnostic secret store seam. Implementation: browser
 * (`browser.ts`): IndexedDB — the fetch transport reads the key back
 * into the auth header because the browser has no secure enclave.
 */
export interface KeyStore {
	/** True if a secret is stored for `id` (never returns the secret itself). */
	has(id: string): Promise<boolean>;
	/** Persist `key` for `id`. */
	set(id: string, key: string): Promise<void>;
	/** Forget the secret for `id` (no-op if absent). */
	delete(id: string): Promise<void>;
}
