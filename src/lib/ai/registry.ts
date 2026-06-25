/**
 * Provider registry: the factory `buildProvider(config, deps)` plus the built-in
 * catalog of provider templates used to prefill the Settings "add provider" UI.
 *
 * The Z.AI template is notable: it uses the coding endpoint base URL and ships
 * the GLM model list (glm-5.2 / glm-5.1 / glm-5-turbo / glm-4.7 / glm-4.5-air),
 * and is served by the same `openai-compatible` adapter as OpenAI.
 */
import { createAnthropicAdapter } from './adapters/anthropic';
import { createGeminiAdapter } from './adapters/gemini';
import { createOllamaAdapter } from './adapters/ollama';
import { createOpenAICompatibleAdapter } from './adapters/openai-compatible';
import type { Provider, ProviderConfig, ProviderKind } from './types';

/**
 * Lazy key accessor. Adapters call this per request so a key saved after the
 * adapter was constructed still applies (and a deleted key is noticed).
 */
export interface ProviderKeyAccessor {
	/** Returns the API key for `providerId`, or null if none is set. */
	getKey(providerId: string): Promise<string | null>;
}

/**
 * Build the right adapter for a `ProviderConfig`. Ollama takes no key (local
 * server); the others receive the lazy key accessor.
 */
export function buildProvider(config: ProviderConfig, keys: ProviderKeyAccessor): Provider {
	switch (config.kind) {
		case 'openai-compatible':
			return createOpenAICompatibleAdapter(config, {
				getKey: () => keys.getKey(config.id)
			});
		case 'anthropic':
			return createAnthropicAdapter(config, { getKey: () => keys.getKey(config.id) });
		case 'gemini':
			return createGeminiAdapter(config, { getKey: () => keys.getKey(config.id) });
		case 'ollama':
			return createOllamaAdapter(config);
	}
}

/** The set of kinds selectable in the Settings UI. */
export function listProviderKinds(): ProviderKind[] {
	return ['openai-compatible', 'anthropic', 'gemini', 'ollama'];
}

/**
 * A provider template: the prefilled defaults shown when a user picks "Add
 * provider → Z.AI" etc. `id` and `name` are left unset (assigned on creation).
 */
export interface ProviderTemplate {
	kind: ProviderKind;
	label: string;
	description: string;
	baseUrl: string;
	defaultModel: string;
	models: string[];
	/** Whether this kind typically requires an API key (drives the UI prompt). */
	requiresKey: boolean;
}

/**
 * Built-in provider catalog. The Settings "add provider" picker lists these; the
 * Z.AI entry pins the coding base URL and GLM model list.
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
	{
		kind: 'openai-compatible',
		label: 'Z.AI (GLM)',
		description: 'Z.AI coding endpoint — OpenAI-compatible. Models: glm-5.2, glm-4.7, …',
		baseUrl: 'https://api.z.ai/api/coding/paas/v4',
		defaultModel: 'glm-5.2',
		models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
		requiresKey: true
	},
	{
		kind: 'openai-compatible',
		label: 'OpenAI',
		description: 'OpenAI Chat Completions (also works for any OpenAI-compatible gateway).',
		baseUrl: 'https://api.openai.com/v1',
		defaultModel: 'gpt-4o',
		models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
		requiresKey: true
	},
	{
		kind: 'anthropic',
		label: 'Anthropic (Claude)',
		description: 'Claude via the Messages API. Browser calls need the dangerous-access header.',
		baseUrl: 'https://api.anthropic.com',
		defaultModel: 'claude-3-5-sonnet-latest',
		models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
		requiresKey: true
	},
	{
		kind: 'gemini',
		label: 'Google Gemini',
		description: 'Gemini via streamGenerateContent.',
		baseUrl: 'https://generativelanguage.googleapis.com',
		defaultModel: 'gemini-1.5-flash',
		models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
		requiresKey: true
	},
	{
		kind: 'ollama',
		label: 'Ollama (local)',
		description: 'A local Ollama server. No API key required.',
		baseUrl: 'http://localhost:11434/api',
		defaultModel: 'llama3.2',
		models: ['llama3.2', 'qwen2.5', 'mistral'],
		requiresKey: false
	}
];

/** Look up a template by label (the Settings UI keys off the label). */
export function findTemplate(label: string): ProviderTemplate | undefined {
	return PROVIDER_TEMPLATES.find((t) => t.label === label);
}
