import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { createKeychainFetch } from './sdk-fetch';
import { createCopilotFetch } from './copilot-fetch';
import { normalizeUrlHost } from './llm-target';
import type { ProviderConfig } from './types';
import { resolveToolCapability } from '#lib/agent/capability.js';

export interface ActiveProvider {
	model: LanguageModel;
	config: ProviderConfig;
	toolCapability: boolean;
}

export interface SdkFactoryDeps {
	hasKey: () => Promise<boolean>;
}

/**
 * The provider-transport fetch for `config`, shared by the SDK model and
 * finalize-time image materialization (030 R-4): keychain auth and the server
 * proxy apply, same as a chat request. Kinds whose fetch retargets request
 * URLs (`github-copilot` — image links must keep their own host) or needs no
 * custom transport (`ollama`) return undefined; callers fall back to plain
 * fetch.
 */
export function providerFetchFor(config: ProviderConfig): typeof globalThis.fetch | undefined {
	switch (config.kind) {
		case 'openai-compatible':
			return createKeychainFetch({
				header: 'Authorization',
				scheme: 'Bearer',
				keyId: config.id,
				authHost: normalizeUrlHost(config.baseUrl),
				// Keyless openai-compatible endpoints (local runtimes, keyless
				// gateways) chat without a key; a key saved later upgrades the
				// connection (the 008 keyless flow).
				optionalKey: config.requiresKey === false
			});
		case 'anthropic':
			return createKeychainFetch({
				header: 'x-api-key',
				keyId: config.id,
				authHost: normalizeUrlHost(config.baseUrl)
			});
		case 'gemini':
			return createKeychainFetch({
				header: 'x-goog-api-key',
				keyId: config.id,
				authHost: normalizeUrlHost(config.baseUrl)
			});
		default:
			return undefined;
	}
}

export async function buildSdkModel(
	config: ProviderConfig,
	_deps: SdkFactoryDeps
): Promise<ActiveProvider> {
	const toolCapability = resolveToolCapability(config);
	switch (config.kind) {
		case 'openai-compatible': {
			const customFetch = providerFetchFor(config)!;
			const provider = createOpenAICompatible({
				name: config.name ?? 'openai-compatible',
				baseURL: config.baseUrl,
				fetch: customFetch,
				apiKey: 'keychain'
			});
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
		case 'anthropic': {
			const customFetch = providerFetchFor(config)!;
			const provider = createAnthropic({ baseURL: config.baseUrl, fetch: customFetch });
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
		case 'gemini': {
			const customFetch = providerFetchFor(config)!;
			const provider = createGoogleGenerativeAI({ baseURL: config.baseUrl, fetch: customFetch });
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
		case 'ollama': {
			const provider = createOllama({ baseURL: config.baseUrl });
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
		case 'github-copilot': {
			const customFetch = createCopilotFetch(config);
			const provider = createOpenAICompatible({
				name: config.name ?? 'github-copilot',
				baseURL: config.baseUrl,
				fetch: customFetch,
				apiKey: 'keychain'
			});
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
	}
}
