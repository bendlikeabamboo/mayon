import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { createKeychainFetch } from './sdk-fetch';
import type { ProviderConfig, ReasoningEffort } from './types';
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

export function supportsReasoningEffort(modelId?: string): boolean {
	return !!modelId && /^glm-5\.2/i.test(modelId);
}

export function providerOptionsForReasoning(
	kind: ProviderConfig['kind'],
	effort: ReasoningEffort,
	providerName?: string,
	modelId?: string
): Record<string, unknown> {
	const pKey = providerName?.toLowerCase() ?? 'openai';
	const glm = kind === 'openai-compatible' && supportsReasoningEffort(modelId);

	switch (effort) {
		case 'off':
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
			break;
		case 'on':
			switch (kind) {
				case 'openai-compatible':
					return glm
						? { [pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } }
						: { [pKey]: { thinking: { type: 'enabled' } } };
				case 'anthropic':
					return { anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } } };
				case 'gemini':
					return {};
				case 'ollama':
					return {};
			}
			break;
		case 'deep':
			switch (kind) {
				case 'openai-compatible':
					return glm
						? { [pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'max' } }
						: { [pKey]: { thinking: { type: 'enabled' } } };
				case 'anthropic':
					return { anthropic: { thinking: { type: 'enabled', budget_tokens: 10000 } } };
				case 'gemini':
					return { google: { generationConfig: { thinkingConfig: { thinkingBudget: 32768 } } } };
				case 'ollama':
					return {};
			}
			break;
	}
	return {};
}
