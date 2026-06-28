import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { createKeychainFetch } from './sdk-fetch';
import type { ProviderConfig, ReasoningMode } from './types';

export interface ActiveProvider {
	model: LanguageModel;
	config: ProviderConfig;
}

export interface SdkFactoryDeps {
	hasKey: () => Promise<boolean>;
}

export async function buildSdkModel(
	config: ProviderConfig,
	_deps: SdkFactoryDeps
): Promise<ActiveProvider> {
	switch (config.kind) {
		case 'openai-compatible': {
			const customFetch = createKeychainFetch({
				header: 'Authorization',
				scheme: 'Bearer',
				keyId: config.id
			});
			const provider = createOpenAI({ baseURL: config.baseUrl, fetch: customFetch, apiKey: 'keychain' });
			const model = provider.chat(config.defaultModel);
			return { model, config };
		}
		case 'anthropic': {
			const customFetch = createKeychainFetch({
				header: 'x-api-key',
				keyId: config.id
			});
			const provider = createAnthropic({ baseURL: config.baseUrl, fetch: customFetch });
			const model = provider(config.defaultModel);
			return { model, config };
		}
		case 'gemini': {
			const customFetch = createKeychainFetch({
				header: 'x-goog-api-key',
				keyId: config.id
			});
			const provider = createGoogleGenerativeAI({ baseURL: config.baseUrl, fetch: customFetch });
			const model = provider(config.defaultModel);
			return { model, config };
		}
		case 'ollama': {
			const provider = createOllama({ baseURL: config.baseUrl });
			const model = provider(config.defaultModel);
			return { model, config };
		}
	}
}

export function providerOptionsForReasoning(
	kind: ProviderConfig['kind'],
	reasoning?: ReasoningMode
): Record<string, unknown> {
	if (!reasoning || reasoning === 'auto') return {};

	switch (kind) {
		case 'openai-compatible':
			return reasoning === 'disabled'
				? { openai: { thinking: { type: 'disabled' } } }
				: { openai: { thinking: { type: 'enabled' } } };
		case 'anthropic':
			return reasoning === 'enabled'
				? { anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } } }
				: {};
		case 'gemini':
			return reasoning === 'disabled'
				? { google: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } }
				: {};
		case 'ollama':
			return {};
	}
}
