/**
 * Headless counterpart to the browser store (`browser.ts`): a read-only,
 * environment-backed `BrowserKeyStore` for vitest/node runs where IndexedDB is
 * absent. Keys come from environment variables — `MAYON_API_KEY_<ID>` (the
 * provider id uppercased, non-alphanumerics collapsed to `_`) with
 * `MAYON_API_KEY` as a catch-all fallback — and are never persisted anywhere.
 */
import type { BrowserKeyStore } from './browser';

/** Env var name for a provider id: `MAYON_API_KEY_` + the sanitized id. */
function envVarName(id: string): string {
	return `MAYON_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Read the key for `id` from the environment (null when unset or empty). */
function readEnvKey(id: string): string | null {
	if (typeof process === 'undefined') return null;
	const specific = process.env[envVarName(id)];
	if (specific) return specific;
	return process.env.MAYON_API_KEY || null;
}

/** Writes are refused: headless keys are provided via environment variables. */
function readOnly(): Promise<never> {
	return Promise.reject(
		new Error(
			'The env-backed key store is read-only: headless keys are provided via environment variables (MAYON_API_KEY_<ID> or MAYON_API_KEY).'
		)
	);
}

/** Build the env-backed headless key store. */
export function createEnvKeyStore(): BrowserKeyStore {
	return {
		get: (id) => Promise.resolve(readEnvKey(id)),
		has: (id) => Promise.resolve(readEnvKey(id) != null),
		set: () => readOnly(),
		delete: () => readOnly()
	};
}
