/**
 * The single entry point components/stores call to obtain the active provider.
 *
 * Reads `activeProvider` + `providers` + `providerKey:<id>` from the settings KV
 * and constructs the adapter via `buildProvider`. The key accessor it hands the
 * factory reads the key lazily on each request, so a key saved after the adapter
 * was built is picked up without re-fetching the provider object.
 *
 * NOTE(P1 tradeoff): API keys are stored as plaintext JSON in the `settings` KV
 * under `providerKey:<id>`. This deliberately violates the spirit of
 * architecture.md §2 ("no secrets in settings"); secure storage (desktop OS
 * keychain / browser IndexedDB isolation) ships with the P5 Rust transport. The
 * TODO(P5) marker below tracks it. Do NOT add more secret-bearing keys here.
 */
// TODO(P5): move API key storage off plaintext settings KV → OS keychain (desktop)
//           / IndexedDB (browser), bundled with the Rust reqwest transport.
import { repos } from '$lib/db';
import { buildProvider, type ProviderKeyAccessor } from './registry';
import { MissingKeyError, type Provider, type ProviderConfig } from './types';

const ACTIVE_KEY = 'activeProvider';
const PROVIDERS_KEY = 'providers';
const providerKeyStorageKey = (id: string) => `providerKey:${id}`;

/** Read all configured providers from settings. Empty on first run. */
export async function listProviders(): Promise<ProviderConfig[]> {
	const map = await repos.settings.get<Record<string, ProviderConfig>>(PROVIDERS_KEY);
	if (!map) return [];
	return Object.values(map);
}

/** Read the id of the currently active provider (or null if none selected). */
export async function getActiveProviderId(): Promise<string | null> {
	return (await repos.settings.get<string>(ACTIVE_KEY)) ?? null;
}

/** Persist the full provider map (used by the Settings UI on add/edit/delete). */
export async function saveProviders(providers: ProviderConfig[]): Promise<void> {
	const map: Record<string, ProviderConfig> = {};
	for (const p of providers) map[p.id] = p;
	await repos.settings.set(PROVIDERS_KEY, map);
}

/** Persist which provider is active. */
export async function setActiveProvider(id: string | null): Promise<void> {
	await repos.settings.set(ACTIVE_KEY, id);
}

/**
 * Store an API key for a provider (plaintext KV — see the P1 tradeoff note above).
 * Pass `null`/empty to clear it.
 */
export async function setProviderKey(id: string, key: string | null): Promise<void> {
	const storageKey = providerKeyStorageKey(id);
	if (key && key.trim()) {
		await repos.settings.set(storageKey, key.trim());
	} else {
		await repos.settings.delete(storageKey);
	}
}

/** Read a provider's API key (null if unset). */
export async function getProviderKey(id: string): Promise<string | null> {
	return (await repos.settings.get<string>(providerKeyStorageKey(id))) ?? null;
}

/** True if a provider of this kind needs a key (Ollama does not). */
export function kindRequiresKey(config: Pick<ProviderConfig, 'kind'>): boolean {
	return config.kind !== 'ollama';
}

/** The lazy key accessor handed to the adapter factory. */
const settingsKeyAccessor: ProviderKeyAccessor = {
	getKey: (id) => getProviderKey(id)
};

/**
 * Build the active provider. Throws a typed `MissingKeyError` if no provider is
 * active, the active id is stale, or a key-requiring provider has no key set.
 *
 * This is the function `StreamDemo` (and, later, the P2 composer) calls.
 */
export async function getActiveProvider(): Promise<Provider> {
	const activeId = await getActiveProviderId();
	if (!activeId) {
		throw new MissingKeyError('No provider is active. Add one in Settings.');
	}

	const map = await repos.settings.get<Record<string, ProviderConfig>>(PROVIDERS_KEY);
	const config = map?.[activeId];
	if (!config) {
		// Stale active id (provider was deleted). Clear it so the next call errors fast.
		await setActiveProvider(null);
		throw new MissingKeyError(`The active provider was removed. Pick one in Settings.`, activeId);
	}

	// For key-requiring kinds, fail fast here too (the adapter also checks, but a
	// clear message before any network attempt is friendlier).
	if (kindRequiresKey(config)) {
		const key = await getProviderKey(activeId);
		if (!key) throw new MissingKeyError(undefined, activeId);
	}

	return buildProvider(config, settingsKeyAccessor);
}
