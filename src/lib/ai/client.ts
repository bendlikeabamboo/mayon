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
import { buildSdkModel, type ActiveProvider } from './sdk-factory';
import { createKeyStore } from './keystore/client';
import { discoverModels } from './model-discovery';
import { MissingKeyError, type ProviderConfig } from './types';

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

/**
 * Discover the live model list for an OpenAI-compatible gateway (OpenRouter,
 * Kilo Gateway, Z.AI) from its `/models` endpoint. Auth is attached only when a
 * key is configured, so public catalogs work pre-key. Throws the same typed
 * provider errors as a chat request on failure — the UI treats this best-effort.
 */
export async function discoverProviderModels(
	config: ProviderConfig,
	signal?: AbortSignal
): Promise<string[]> {
	return discoverModels(config, settingsKeyAccessor, signal);
}

const settingsKeyAccessor = {
	hasKey: (id: string) => hasProviderKey(id)
};

export async function getActiveSdkProvider(): Promise<ActiveProvider> {
	const activeId = await getActiveProviderId();
	if (!activeId) {
		throw new MissingKeyError('No provider is active. Add one in Settings.');
	}

	const map = await repos.settings.get<Record<string, ProviderConfig>>(PROVIDERS_KEY);
	const config = map?.[activeId];
	if (!config) {
		await setActiveProvider(null);
		throw new MissingKeyError(`The active provider was removed. Pick one in Settings.`, activeId);
	}

	if (kindRequiresKey(config)) {
		if (!(await hasProviderKey(activeId))) throw new MissingKeyError(undefined, activeId);
	}

	return buildSdkModel(config, { hasKey: () => hasProviderKey(activeId) });
}
