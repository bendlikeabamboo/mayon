import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { createKeychainFetch } from './sdk-fetch';
import type { ProviderConfig, ReasoningMode } from './types';
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
	}
}

export function providerOptionsForReasoning(
	kind: ProviderConfig['kind'],
	reasoning: ReasoningMode | undefined,
	providerName?: string
): Record<string, unknown> {
	const mode = reasoning ?? 'auto';
	const pKey = providerName?.toLowerCase() ?? 'openai';
	if (mode === 'disabled') {
		switch (kind) {
			case 'openai-compatible':
				return { [pKey]: { thinking: { type: 'disabled' } } };
			case 'anthropic':
				return {};
			case 'gemini':
				return { google: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } };
			case 'ollama':
				return {};
		}
	}
	if (mode === 'enabled' || mode === 'auto') {
		switch (kind) {
			case 'openai-compatible':
				return { [pKey]: { thinking: { type: 'enabled' } } };
			case 'anthropic':
				return { anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } } };
			case 'gemini':
				return {};
			case 'ollama':
				return {};
		}
	}
	return {};
}
