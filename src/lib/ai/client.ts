/**
 * The single entry point components/stores call to obtain the active provider.
 *
 * Reads `activeProvider` + `providers` from the settings KV and constructs the
 * adapter via `buildProvider`. API keys live in the runtime `KeyStore` — the OS
 * keychain on desktop (plaintext never enters JS) / IndexedDB in the browser —
 * NOT in the settings table. The accessor handed to the factory probes `hasKey`
 * lazily per request, so a key saved after the adapter was built is picked up
 * without re-fetching the provider object.
 */
import { repos } from '$lib/db';
import { buildProvider, type ProviderKeyAccessor } from './registry';
import { createKeyStore } from './keystore/client';
import { MissingKeyError, type Provider, type ProviderConfig } from './types';

const ACTIVE_KEY = 'activeProvider';
const PROVIDERS_KEY = 'providers';

/** Runtime secret store (OS keychain on desktop / IndexedDB in browser). */
const keyStore = createKeyStore();

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
 * Persist an API key for a provider into the runtime `KeyStore` (OS keychain on
 * desktop, IndexedDB in browser). On desktop the plaintext crosses into Rust
 * exactly once, here.
 */
export async function setProviderKey(id: string, key: string): Promise<void> {
	await keyStore.set(id, key);
}

/** Forget a provider's API key from the runtime `KeyStore` (no-op if absent). */
export async function deleteProviderKey(id: string): Promise<void> {
	await keyStore.delete(id);
}

/** True if a provider has an API key stored in the runtime `KeyStore`. */
export async function hasProviderKey(id: string): Promise<boolean> {
	return keyStore.has(id);
}

/** True if a provider of this kind needs a key (Ollama does not). */
export function kindRequiresKey(config: Pick<ProviderConfig, 'kind'>): boolean {
	return config.kind !== 'ollama';
}

/** The lazy key probe handed to the adapter factory (boolean only — never the secret). */
const settingsKeyAccessor: ProviderKeyAccessor = {
	hasKey: (id) => hasProviderKey(id)
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
		if (!(await hasProviderKey(activeId))) throw new MissingKeyError(undefined, activeId);
	}

	return buildProvider(config, settingsKeyAccessor);
}
