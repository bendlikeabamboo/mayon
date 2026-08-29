import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { createKeychainFetch } from './sdk-fetch';
import { createCopilotFetch } from './copilot-fetch';
import type { ProviderConfig } from './types';
import { resolveToolCapability } from '$lib/agent/capability';

export interface ActiveProvider {
	model: LanguageModel;
	config: ProviderConfig;
	toolCapability: boolean;
}

export interface SdkFactoryDeps {
	hasKey: () => Promise<boolean>;
}

export async function buildSdkModel(
	config: ProviderConfig,
	_deps: SdkFactoryDeps
): Promise<ActiveProvider> {
	const toolCapability = resolveToolCapability(config);
	switch (config.kind) {
		case 'openai-compatible': {
			const customFetch = createKeychainFetch({
				header: 'Authorization',
				scheme: 'Bearer',
				keyId: config.id
			});
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
			const customFetch = createKeychainFetch({
				header: 'x-api-key',
				keyId: config.id
			});
			const provider = createAnthropic({ baseURL: config.baseUrl, fetch: customFetch });
			const model = provider(config.defaultModel);
			return { model, config, toolCapability };
		}
		case 'gemini': {
			const customFetch = createKeychainFetch({
				header: 'x-goog-api-key',
				keyId: config.id
			});
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
