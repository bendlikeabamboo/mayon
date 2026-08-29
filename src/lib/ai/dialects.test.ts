import { describe, expect, it } from 'vitest';
import {
	EXTRA_BODY_ALLOWLISTS,
	describeDialect,
	namespaceFor,
	namespaceKeyFor,
	resolveRequestSettings,
	validateExtraBody
} from './dialects';
import type { ProviderConfig } from './types';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: 'test-provider',
		kind: 'openai-compatible',
		name: 'Test',
		baseUrl: 'https://api.example.com/v1',
		defaultModel: 'gpt-4o',
		models: ['gpt-4o'],
		...overrides
	};
}

const EMPTY_RESULT = {
	callSettings: {},
	providerOptions: {},
	droppedExtraKeys: []
};

const ZAI_CONFIG = makeConfig({ name: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4' });
const DEEPSEEK_CONFIG = makeConfig({
	name: 'DeepSeek',
	baseUrl: 'https://api.deepseek.com/v1'
});
const GROQ_CONFIG = makeConfig({ name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' });
const MISTRAL_CONFIG = makeConfig({ name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' });
const MOONSHOT_CONFIG = makeConfig({
	name: 'Moonshot Kimi',
	baseUrl: 'https://api.moonshot.cn/v1'
});
const DASHSCOPE_CONFIG = makeConfig({
	name: 'DashScope',
	baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
});
const GEMINI_CONFIG = makeConfig({
	kind: 'gemini',
	name: 'Google AI Studio',
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
});
const ANTHROPIC_CONFIG = makeConfig({
	kind: 'anthropic',
	name: 'Anthropic',
	baseUrl: 'https://api.anthropic.com'
});
const OLLAMA_CONFIG = makeConfig({
	kind: 'ollama',
	name: 'Ollama',
	baseUrl: 'http://localhost:11434'
});
const GITHUB_COPILOT_CONFIG = makeConfig({
	kind: 'github-copilot',
	name: 'GitHub Copilot',
	baseUrl: 'https://api.githubcopilot.com'
});
const ROUTER_CONFIG = makeConfig({
	name: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1'
});

function withProviderOptions(providerOptions: Record<string, unknown>) {
	return { ...EMPTY_RESULT, providerOptions };
}

describe('namespaceKeyFor', () => {
	it('truncates at the first dot: "Z.AI" → "Z"', () => {
		expect(namespaceKeyFor(makeConfig({ name: 'Z.AI' }))).toBe('Z');
	});

	it('preserves case: "OpenAI" → "OpenAI" (regression vs old lowercase key)', () => {
		const key = namespaceKeyFor(makeConfig({ name: 'OpenAI' }));
		expect(key).toBe('OpenAI');
		expect(key).not.toBe('openai');
	});

	it('trims surrounding whitespace', () => {
		expect(namespaceKeyFor(makeConfig({ name: '  Kilo Gateway  ' }))).toBe('Kilo Gateway');
	});

	it('truncates a multi-dot name at the first segment', () => {
		expect(namespaceKeyFor(makeConfig({ name: 'provider.inc.api' }))).toBe('provider');
	});

	it('defaults when name is undefined', () => {
		expect(namespaceKeyFor(makeConfig({ name: undefined as unknown as string }))).toBe(
			'openai-compatible'
		);
	});
});

describe('layer precedence and null suppression', () => {
	it('glm-5.3 overlay null-suppresses the zai endpoint thinking key at off', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.3', 'off')).toEqual(EMPTY_RESULT);
	});

	it('kimi-k3 overlay null-suppresses the zai endpoint thinking key at off', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'kimi-k3', 'off')).toEqual(EMPTY_RESULT);
	});

	it('gemini-2.5-pro off emits no thinkingConfig at all', () => {
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-pro', 'off')).toEqual(EMPTY_RESULT);
	});

	it('dashscope kimi-k2.7-code overlay null-suppresses the endpoint enable_thinking at off', () => {
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'kimi-k2.7-code', 'off')).toEqual(EMPTY_RESULT);
	});

	it('model overlay fragment merges per-key over the endpoint dialect fragment', () => {
		expect(resolveRequestSettings(GROQ_CONFIG, 'gpt-oss-120b', 'on')).toEqual(
			withProviderOptions({
				Groq: { reasoning_format: 'parsed', reasoning_effort: 'medium' }
			})
		);
	});

	it('overlay deep fragment merges with, not replaces, the endpoint deep fragment', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.3', 'deep')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});
});

describe('router prefixes (baseUrl https://openrouter.ai/api/v1)', () => {
	it('z-ai/glm-5.2 effort on resolves through the glm-5.x overlay into the namespace key', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'z-ai/glm-5.2', 'on')).toEqual(
			withProviderOptions({
				OpenRouter: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
	});

	it('z-ai/GLM-5.2-Plus matches case-insensitively on the last path segment', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'z-ai/GLM-5.2-Plus', 'on')).toEqual(
			withProviderOptions({
				OpenRouter: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
	});

	it('deepseek/deepseek-chat effort on resolves thinking + reasoning_effort', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'deepseek/deepseek-chat', 'on')).toEqual(
			withProviderOptions({
				OpenRouter: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
	});

	it('moonshotai/kimi-k3 off sends no thinking key', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'moonshotai/kimi-k3', 'off')).toEqual(
			EMPTY_RESULT
		);
	});

	it('moonshotai/kimi-k3 on sends reasoning_effort high only', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'moonshotai/kimi-k3', 'on')).toEqual(
			withProviderOptions({
				OpenRouter: { reasoning_effort: 'high' }
			})
		);
	});

	it('anthropic/claude-sonnet-4.5 on a generic router invents no parameters', () => {
		expect(resolveRequestSettings(ROUTER_CONFIG, 'anthropic/claude-sonnet-4.5', 'on')).toEqual(
			EMPTY_RESULT
		);
	});
});

describe('catalog: endpoint dialects', () => {
	it('zai (api.z.ai)', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'gpt-4o', 'off')).toEqual(
			withProviderOptions({ Z: { thinking: { type: 'disabled' } } })
		);
		expect(resolveRequestSettings(ZAI_CONFIG, 'gpt-4o', 'on')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(ZAI_CONFIG, 'gpt-4o', 'deep')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});

	it('deepseek (api.deepseek.com)', () => {
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-v3.2', 'off')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'disabled' } }
			})
		);
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-v3.2', 'on')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-v3.2', 'deep')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});

	it('groq (api.groq.com): reasoning_format parsed on+deep, nothing at off', () => {
		expect(resolveRequestSettings(GROQ_CONFIG, 'llama-3.3-70b', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GROQ_CONFIG, 'llama-3.3-70b', 'on')).toEqual(
			withProviderOptions({ Groq: { reasoning_format: 'parsed' } })
		);
		expect(resolveRequestSettings(GROQ_CONFIG, 'llama-3.3-70b', 'deep')).toEqual(
			withProviderOptions({ Groq: { reasoning_format: 'parsed' } })
		);
	});

	it('mistral (api.mistral.ai) base: nothing at any effort', () => {
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-large', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-large', 'on')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-large', 'deep')).toEqual(EMPTY_RESULT);
	});

	it('moonshot (api.moonshot.cn) base: nothing at any effort', () => {
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'moonshot-v1-8k', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'moonshot-v1-8k', 'on')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'moonshot-v1-8k', 'deep')).toEqual(EMPTY_RESULT);
	});

	it('dashscope (dashscope.aliyuncs.com): enable_thinking false/true/true', () => {
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'qwen-plus', 'off')).toEqual(
			withProviderOptions({ DashScope: { enable_thinking: false } })
		);
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'qwen-plus', 'on')).toEqual(
			withProviderOptions({ DashScope: { enable_thinking: true } })
		);
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'qwen-plus', 'deep')).toEqual(
			withProviderOptions({ DashScope: { enable_thinking: true } })
		);
	});
});

describe('catalog: model overlays', () => {
	it('glm-5.3 on zai: off ∅ / on thinking+high / deep thinking+max', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.3', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.3', 'on')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.3', 'deep')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});

	it('glm-5.x (glm-5.2) on zai: off disabled / on thinking+high / deep thinking+max', () => {
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.2', 'off')).toEqual(
			withProviderOptions({ Z: { thinking: { type: 'disabled' } } })
		);
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.2', 'on')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(ZAI_CONFIG, 'glm-5.2', 'deep')).toEqual(
			withProviderOptions({
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});

	it('kimi-k2.6 on moonshot: disabled/enabled/enabled', () => {
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k2.6-turbo', 'off')).toEqual(
			withProviderOptions({
				'Moonshot Kimi': { thinking: { type: 'disabled' } }
			})
		);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k2.6-turbo', 'on')).toEqual(
			withProviderOptions({
				'Moonshot Kimi': { thinking: { type: 'enabled' } }
			})
		);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k2.6-turbo', 'deep')).toEqual(
			withProviderOptions({
				'Moonshot Kimi': { thinking: { type: 'enabled' } }
			})
		);
	});

	it('kimi-k3: off ∅ / on reasoning_effort high / deep max (no thinking key at any effort)', () => {
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k3', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k3', 'on')).toEqual(
			withProviderOptions({
				'Moonshot Kimi': { reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(MOONSHOT_CONFIG, 'kimi-k3', 'deep')).toEqual(
			withProviderOptions({
				'Moonshot Kimi': { reasoning_effort: 'max' }
			})
		);
	});

	it('kimi-k3 on a generic endpoint (no endpoint dialect) still resolves via overlay', () => {
		expect(resolveRequestSettings(makeConfig(), 'kimi-k3', 'on')).toEqual(
			withProviderOptions({ Test: { reasoning_effort: 'high' } })
		);
	});

	it('deepseek-v4 (deepseek-chat) on deepseek endpoint: off disabled / on thinking+high / deep thinking+max', () => {
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-chat', 'off')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'disabled' } }
			})
		);
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-chat', 'on')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(DEEPSEEK_CONFIG, 'deepseek-chat', 'deep')).toEqual(
			withProviderOptions({
				DeepSeek: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
			})
		);
	});

	it('groq-gpt-oss: off ∅ / on parsed+medium / deep parsed+high', () => {
		expect(resolveRequestSettings(GROQ_CONFIG, 'gpt-oss-120b', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GROQ_CONFIG, 'gpt-oss-120b', 'on')).toEqual(
			withProviderOptions({
				Groq: { reasoning_format: 'parsed', reasoning_effort: 'medium' }
			})
		);
		expect(resolveRequestSettings(GROQ_CONFIG, 'gpt-oss-120b', 'deep')).toEqual(
			withProviderOptions({
				Groq: { reasoning_format: 'parsed', reasoning_effort: 'high' }
			})
		);
	});

	it('groq-qwen3: reasoning_effort none/default/default (merged with endpoint parsed)', () => {
		expect(resolveRequestSettings(GROQ_CONFIG, 'qwen3-32b', 'off')).toEqual(
			withProviderOptions({ Groq: { reasoning_effort: 'none' } })
		);
		expect(resolveRequestSettings(GROQ_CONFIG, 'qwen3-32b', 'on')).toEqual(
			withProviderOptions({ Groq: { reasoning_format: 'parsed', reasoning_effort: 'default' } })
		);
		expect(resolveRequestSettings(GROQ_CONFIG, 'qwen3-32b', 'deep')).toEqual(
			withProviderOptions({ Groq: { reasoning_format: 'parsed', reasoning_effort: 'default' } })
		);
	});

	it('mistral-reasoning (mistral-small): none/high/high', () => {
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-small-latest', 'off')).toEqual(
			withProviderOptions({
				Mistral: { reasoning_effort: 'none' }
			})
		);
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-small-latest', 'on')).toEqual(
			withProviderOptions({
				Mistral: { reasoning_effort: 'high' }
			})
		);
		expect(resolveRequestSettings(MISTRAL_CONFIG, 'mistral-small-latest', 'deep')).toEqual(
			withProviderOptions({
				Mistral: { reasoning_effort: 'high' }
			})
		);
	});

	it('dashscope-thinking-only (kimi-k2.7-code): off ∅ / on enable_thinking / deep enable_thinking', () => {
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'kimi-k2.7-code', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'kimi-k2.7-code', 'on')).toEqual(
			withProviderOptions({
				DashScope: { enable_thinking: true }
			})
		);
		expect(resolveRequestSettings(DASHSCOPE_CONFIG, 'kimi-k2.7-code', 'deep')).toEqual(
			withProviderOptions({
				DashScope: { enable_thinking: true }
			})
		);
	});

	it('gemini-3: off ∅ / on thinkingLevel medium / deep thinkingLevel high, at namespace root', () => {
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-3-flash', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-3-flash', 'on')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } }
			})
		);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-3-flash', 'deep')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } }
			})
		);
	});

	it('gemini-2.5-pro: off ∅ / on budget 2048 / deep budget 32768', () => {
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-pro', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-pro', 'on')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } }
			})
		);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-pro', 'deep')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingBudget: 32768, includeThoughts: true } }
			})
		);
	});

	it('gemini-2.5 (flash): off budget 0 / on budget 2048 / deep budget 32768', () => {
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-flash', 'off')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingBudget: 0 } }
			})
		);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-flash', 'on')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } }
			})
		);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-flash', 'deep')).toEqual(
			withProviderOptions({
				google: { thinkingConfig: { thinkingBudget: 32768, includeThoughts: true } }
			})
		);
	});
});

describe('catalog: kind baselines', () => {
	it('anthropic: off ∅ / on adaptive+medium / deep adaptive+high; never budget_tokens', () => {
		expect(resolveRequestSettings(ANTHROPIC_CONFIG, 'claude-sonnet-4.5', 'off')).toEqual(
			EMPTY_RESULT
		);
		expect(resolveRequestSettings(ANTHROPIC_CONFIG, 'claude-sonnet-4.5', 'on')).toEqual(
			withProviderOptions({
				anthropic: {
					thinking: { type: 'adaptive', display: 'summarized' },
					effort: 'medium'
				}
			})
		);
		const deep = resolveRequestSettings(ANTHROPIC_CONFIG, 'claude-sonnet-4.5', 'deep');
		expect(deep).toEqual(
			withProviderOptions({
				anthropic: {
					thinking: { type: 'adaptive', display: 'summarized' },
					effort: 'high'
				}
			})
		);
		expect(JSON.stringify(deep.providerOptions)).not.toContain('budget_tokens');
	});

	it('ollama: off ∅ / on think true / deep think true', () => {
		expect(resolveRequestSettings(OLLAMA_CONFIG, 'llama3.2', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(OLLAMA_CONFIG, 'llama3.2', 'on')).toEqual(
			withProviderOptions({ ollama: { think: true } })
		);
		expect(resolveRequestSettings(OLLAMA_CONFIG, 'llama3.2', 'deep')).toEqual(
			withProviderOptions({ ollama: { think: true } })
		);
	});

	it('gemini without a matching overlay invents nothing', () => {
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.0-flash', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.0-flash', 'on')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.0-flash', 'deep')).toEqual(EMPTY_RESULT);
	});

	it('github-copilot: baseline invents nothing, namespace is the kind, empty allowlist drops extra body', () => {
		expect(namespaceFor(GITHUB_COPILOT_CONFIG)).toBe('github-copilot');
		expect(resolveRequestSettings(GITHUB_COPILOT_CONFIG, 'gpt-5', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GITHUB_COPILOT_CONFIG, 'gpt-5', 'on')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(GITHUB_COPILOT_CONFIG, 'gpt-5', 'deep')).toEqual(EMPTY_RESULT);

		const withExtra = makeConfig({
			kind: 'github-copilot',
			name: 'GitHub Copilot',
			baseUrl: 'https://api.githubcopilot.com',
			extraBody: { top_k: 40 }
		});
		expect(resolveRequestSettings(withExtra, 'gpt-5', 'on')).toEqual({
			callSettings: {},
			providerOptions: {},
			droppedExtraKeys: ['top_k']
		});
	});
});

describe('generic openai-compatible baseline invents nothing (R2)', () => {
	it('unknown baseUrl + gpt-4o: all three efforts yield empty output', () => {
		const config = makeConfig({ baseUrl: 'https://api.example.com' });
		expect(resolveRequestSettings(config, 'gpt-4o', 'off')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(config, 'gpt-4o', 'on')).toEqual(EMPTY_RESULT);
		expect(resolveRequestSettings(config, 'gpt-4o', 'deep')).toEqual(EMPTY_RESULT);
	});
});

describe('gemini thinkingConfig lives at the namespace root (regression)', () => {
	it('gemini-2.5-flash on: google.thinkingConfig directly, no generationConfig nesting', () => {
		const { providerOptions } = resolveRequestSettings(GEMINI_CONFIG, 'gemini-2.5-flash', 'on');
		const google = providerOptions.google as Record<string, unknown>;
		expect(google.thinkingConfig).toBeDefined();
		expect(google.generationConfig).toBeUndefined();
		expect(Object.keys(google)).toEqual(['thinkingConfig']);
	});

	it('gemini-3-flash on: google.thinkingConfig directly, no generationConfig nesting', () => {
		const { providerOptions } = resolveRequestSettings(GEMINI_CONFIG, 'gemini-3-flash', 'on');
		const google = providerOptions.google as Record<string, unknown>;
		expect(google.thinkingConfig).toBeDefined();
		expect(google.generationConfig).toBeUndefined();
		expect(Object.keys(google)).toEqual(['thinkingConfig']);
	});
});

describe('requestDefaults (Tier A layer 4, omit-empty)', () => {
	it('absent requestDefaults field entirely yields callSettings {}', () => {
		expect(resolveRequestSettings(makeConfig(), 'gpt-4o', 'on').callSettings).toEqual({});
	});

	it('empty requestDefaults object yields callSettings {}', () => {
		const config = makeConfig({ requestDefaults: {} });
		expect(resolveRequestSettings(config, 'gpt-4o', 'on').callSettings).toEqual({});
	});

	it('partial requestDefaults (temperature only) emits exactly { temperature }', () => {
		const config = makeConfig({ requestDefaults: { temperature: 0.2 } });
		const { callSettings } = resolveRequestSettings(config, 'gpt-4o', 'on');
		expect(callSettings).toEqual({ temperature: 0.2 });
		expect(Object.keys(callSettings)).toEqual(['temperature']);
	});

	it('full 7-field requestDefaults emits all keys present', () => {
		const requestDefaults = {
			temperature: 0.7,
			topP: 0.9,
			maxOutputTokens: 4096,
			stopSequences: ['STOP'],
			seed: 42,
			frequencyPenalty: 0.5,
			presencePenalty: -0.5
		};
		const config = makeConfig({ requestDefaults });
		expect(resolveRequestSettings(config, 'gpt-4o', 'on').callSettings).toEqual(requestDefaults);
	});

	it('explicitly-undefined keys are omitted, never emitted as key: undefined', () => {
		const config = makeConfig({
			requestDefaults: { temperature: undefined, topP: 0.9 }
		});
		const { callSettings } = resolveRequestSettings(config, 'gpt-4o', 'on');
		expect(callSettings).toEqual({ topP: 0.9 });
		expect('temperature' in callSettings).toBe(false);
	});

	it('returns a fresh object with no reference into config', () => {
		const requestDefaults = { temperature: 0.5 };
		const config = makeConfig({ requestDefaults });
		const { callSettings } = resolveRequestSettings(config, 'gpt-4o', 'on');
		expect(callSettings).not.toBe(requestDefaults);
		callSettings.temperature = 0.9;
		expect(requestDefaults.temperature).toBe(0.5);
	});

	it('requestDefaults do not contaminate providerOptions', () => {
		const config = makeConfig({
			name: 'Z.AI',
			baseUrl: 'https://api.z.ai/api/paas/v4',
			requestDefaults: { temperature: 0.3, seed: 7 }
		});
		const { providerOptions, callSettings } = resolveRequestSettings(config, 'glm-5.2', 'on');
		expect(callSettings).toEqual({ temperature: 0.3, seed: 7 });
		expect(providerOptions).toEqual({
			Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
		});
		expect(JSON.stringify(providerOptions)).not.toContain('temperature');
	});

	it('requestDefaults apply identically at every effort', () => {
		const config = makeConfig({ requestDefaults: { temperature: 0.1 } });
		for (const effort of ['off', 'on', 'deep'] as const) {
			expect(resolveRequestSettings(config, 'gpt-4o', effort).callSettings).toEqual({
				temperature: 0.1
			});
		}
	});
});

describe('describeDialect', () => {
	it('kimi-k3 locks sampling', () => {
		expect(describeDialect(MOONSHOT_CONFIG, 'kimi-k3')?.locksSampling).toBe(true);
	});

	it('kimi-k2.6 locks sampling and hides deep', () => {
		const d = describeDialect(MOONSHOT_CONFIG, 'kimi-k2.6-turbo');
		expect(d?.locksSampling).toBe(true);
		expect(d?.effortLevels).toEqual(['off', 'on']);
	});

	it('plain ollama kind hides deep', () => {
		expect(describeDialect(OLLAMA_CONFIG, 'llama3.2')?.effortLevels).toEqual(['off', 'on']);
	});

	it('github-copilot kind reports no sampling locks and all three efforts', () => {
		expect(describeDialect(GITHUB_COPILOT_CONFIG, 'gpt-5')).toEqual({
			locksSampling: false,
			effortLevels: ['off', 'on', 'deep'],
			hazards: []
		});
	});

	it('generic openai-compatible returns null', () => {
		expect(describeDialect(makeConfig(), 'gpt-4o')).toBeNull();
	});

	it('glm on zai surfaces the endpoint+overlay hazards union', () => {
		const hazards = describeDialect(ZAI_CONFIG, 'glm-5.2')?.hazards ?? [];
		expect(hazards).toContain('thinking-ignores-sampling');
		expect(hazards).toContain('reasoning-eats-token-cap');
	});

	it('kimi-k3 carries the cannot-disable-thinking hazard', () => {
		expect(describeDialect(MOONSHOT_CONFIG, 'kimi-k3')?.hazards).toContain(
			'cannot-disable-thinking'
		);
	});
});

describe('validateExtraBody', () => {
	it('accepts a valid object and returns it', () => {
		const result = validateExtraBody({ top_k: 40, metadata: { tier: 'auto' } });
		expect(result).toEqual({ ok: true, value: { top_k: 40, metadata: { tier: 'auto' } } });
	});

	it('rejects an array', () => {
		expect(validateExtraBody([1, 2])).toEqual({
			ok: false,
			errors: ['Extra body must be a JSON object']
		});
	});

	it('rejects a scalar', () => {
		expect(validateExtraBody(42)).toEqual({
			ok: false,
			errors: ['Extra body must be a JSON object']
		});
		expect(validateExtraBody('bare string')).toEqual({
			ok: false,
			errors: ['Extra body is not valid JSON']
		});
	});

	it('rejects null', () => {
		expect(validateExtraBody(null)).toEqual({
			ok: false,
			errors: ['Extra body must be a JSON object']
		});
	});

	it('rejects oversize serialized input (> 16 KiB)', () => {
		expect(validateExtraBody({ pad: 'x'.repeat(16385) })).toEqual({
			ok: false,
			errors: ['Extra body exceeds 16 KiB limit']
		});
	});

	it('accepts input serialized at exactly 16 KiB', () => {
		expect(validateExtraBody({ pad: 'x'.repeat(16374) }).ok).toBe(true);
	});

	it.each(['authorization', 'api_key', 'x-api-key', 'headers', 'token'])(
		'rejects secret-like top-level key "%s"',
		(key) => {
			expect(validateExtraBody({ [key]: 'value' })).toEqual({
				ok: false,
				errors: [`Key "${key}" looks like a secret; secrets never live in provider settings`]
			});
		}
	);

	it('rejects __proto__, constructor, and prototype keys', () => {
		for (const key of ['__proto__', 'constructor', 'prototype']) {
			expect(validateExtraBody({ [key]: {} })).toEqual({
				ok: false,
				errors: [`Key "${key}" is not allowed`]
			});
		}
	});

	it('does not flag secret-like keys nested below the top level', () => {
		expect(validateExtraBody({ options: { token: 'inner', password: 'inner' } }).ok).toBe(true);
	});

	it('parses a JSON string into an object', () => {
		expect(validateExtraBody('{"top_k": 40}')).toEqual({ ok: true, value: { top_k: 40 } });
	});

	it('rejects a non-JSON string with an actionable parse error', () => {
		const result = validateExtraBody('{"top_k": ');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors).toHaveLength(1);
	});
});

describe('extraBody (Tier C layer 5)', () => {
	it('openai-compatible: extra body lands verbatim into the namespace key', () => {
		const config = makeConfig({
			name: 'Z.AI',
			baseUrl: 'https://api.z.ai/api/paas/v4',
			extraBody: { top_k: 40 }
		});
		expect(resolveRequestSettings(config, 'glm-5.2', 'on')).toEqual({
			callSettings: {},
			providerOptions: {
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high', top_k: 40 }
			},
			droppedExtraKeys: []
		});
	});

	it('openai-compatible: extra body overrides a colliding dialect key', () => {
		const config = makeConfig({
			name: 'Z.AI',
			baseUrl: 'https://api.z.ai/api/paas/v4',
			extraBody: { reasoning_effort: 'low' }
		});
		const { providerOptions } = resolveRequestSettings(config, 'glm-5.2', 'on');
		expect(providerOptions).toEqual({
			Z: { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
		});
	});

	it('openai-compatible: extra body works with no dialect fragment at all', () => {
		const config = makeConfig({ extraBody: { top_k: 7 } });
		expect(resolveRequestSettings(config, 'gpt-4o', 'on').providerOptions).toEqual({
			Test: { top_k: 7 }
		});
	});

	it('anthropic: allowlisted key merges, non-forwardable key lands in droppedExtraKeys', () => {
		const config = makeConfig({
			kind: 'anthropic',
			name: 'Anthropic',
			baseUrl: 'https://api.anthropic.com',
			extraBody: { top_k: 40, speed: 'fast' }
		});
		expect(resolveRequestSettings(config, 'claude-sonnet-4.5', 'on')).toEqual({
			callSettings: {},
			providerOptions: {
				anthropic: {
					thinking: { type: 'adaptive', display: 'summarized' },
					effort: 'medium',
					speed: 'fast'
				}
			},
			droppedExtraKeys: ['top_k']
		});
	});

	it('anthropic: forwardable-only extra body at off emits the namespace without baseline keys', () => {
		const config = makeConfig({
			kind: 'anthropic',
			name: 'Anthropic',
			baseUrl: 'https://api.anthropic.com',
			extraBody: { speed: 'fast' }
		});
		expect(resolveRequestSettings(config, 'claude-sonnet-4.5', 'off')).toEqual({
			callSettings: {},
			providerOptions: { anthropic: { speed: 'fast' } },
			droppedExtraKeys: []
		});
	});

	it('anthropic: fully-dropped extra body adds no namespace and reports keys sorted', () => {
		const config = makeConfig({
			kind: 'anthropic',
			name: 'Anthropic',
			baseUrl: 'https://api.anthropic.com',
			extraBody: { verbosity: 2, top_k: 40 }
		});
		const resolved = resolveRequestSettings(config, 'claude-sonnet-4.5', 'off');
		expect(resolved.providerOptions).toEqual({});
		expect(resolved.droppedExtraKeys).toEqual(['top_k', 'verbosity']);
	});

	it('gemini: thinkingConfig forwarded, top_k dropped', () => {
		const config = makeConfig({
			kind: 'gemini',
			name: 'Google AI Studio',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			extraBody: { thinkingConfig: { thinkingLevel: 'low' }, top_k: 5 }
		});
		expect(resolveRequestSettings(config, 'gemini-2.0-flash', 'on')).toEqual({
			callSettings: {},
			providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
			droppedExtraKeys: ['top_k']
		});
	});

	it('ollama: options forwarded, keepAlive dropped (chat schema has think/options only)', () => {
		const config = makeConfig({
			kind: 'ollama',
			name: 'Ollama',
			baseUrl: 'http://localhost:11434',
			extraBody: { options: { temperature: 0.2 }, keepAlive: '5m' }
		});
		expect(resolveRequestSettings(config, 'llama3.2', 'off')).toEqual({
			callSettings: {},
			providerOptions: { ollama: { options: { temperature: 0.2 } } },
			droppedExtraKeys: ['keepAlive']
		});
	});

	it('invalid (secret-like) extra body in a hand-crafted config is ignored wholesale', () => {
		const config = makeConfig({
			name: 'Z.AI',
			baseUrl: 'https://api.z.ai/api/paas/v4',
			extraBody: { temperature: 0.5, token: 'leak' }
		});
		expect(resolveRequestSettings(config, 'glm-5.2', 'on')).toEqual({
			callSettings: {},
			providerOptions: {
				Z: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
			},
			droppedExtraKeys: []
		});
	});

	it('non-object extra body (array) in a legacy config is ignored', () => {
		const config = makeConfig({
			extraBody: ['nope'] as unknown as Record<string, import('./types').JSONValue>
		});
		expect(resolveRequestSettings(config, 'gpt-4o', 'on')).toEqual(EMPTY_RESULT);
	});

	it('extra body merges on top of requestDefaults without contaminating callSettings', () => {
		const config = makeConfig({
			requestDefaults: { temperature: 0.3 },
			extraBody: { top_k: 40 }
		});
		const resolved = resolveRequestSettings(config, 'gpt-4o', 'on');
		expect(resolved.callSettings).toEqual({ temperature: 0.3 });
		expect(resolved.providerOptions).toEqual({ Test: { top_k: 40 } });
	});

	it('allowlists cover the catalog snapshot keys', () => {
		expect([...EXTRA_BODY_ALLOWLISTS.anthropic].sort()).toEqual([
			'disableParallelToolUse',
			'effort',
			'inferenceGeo',
			'speed',
			'structuredOutputMode',
			'taskBudget',
			'thinking',
			'toolStreaming'
		]);
		expect([...EXTRA_BODY_ALLOWLISTS.gemini].sort()).toEqual([
			'cachedContent',
			'responseModalities',
			'safetySettings',
			'structuredOutputs',
			'thinkingConfig'
		]);
		expect([...EXTRA_BODY_ALLOWLISTS.ollama].sort()).toEqual(['options', 'think'].sort());
		expect([...EXTRA_BODY_ALLOWLISTS['github-copilot']]).toEqual([]);
	});
});
