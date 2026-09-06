import { beforeEach, describe, expect, it } from 'vitest';
import {
	resolveToolCapability,
	legacyToolDefault,
	disableToolsForSession,
	isSessionDisabled
} from '$lib/agent/capability';
import type { ProviderConfig } from '$lib/ai/types';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: 'test',
		kind: 'openai-compatible',
		name: 'Test',
		baseUrl: '',
		defaultModel: '',
		models: [],
		...overrides
	};
}

describe('resolveToolCapability', () => {
	beforeEach(() => {
		expect(isSessionDisabled()).toBe(false);
	});

	it('returns true for explicit on', () => {
		expect(resolveToolCapability(makeConfig({ toolCapability: 'on' }))).toBe(true);
	});

	it('returns false for explicit off', () => {
		expect(resolveToolCapability(makeConfig({ toolCapability: 'off' }))).toBe(false);
	});

	it('ignores kind and baseUrl — resolution reads the flag only', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'ollama', baseUrl: 'http://localhost:11434', toolCapability: 'on' })
			)
		).toBe(true);
		expect(resolveToolCapability(makeConfig({ kind: 'anthropic', toolCapability: 'off' }))).toBe(
			false
		);
	});

	it('returns false for allowlisted baseUrl with off (no URL guessing)', () => {
		expect(
			resolveToolCapability(
				makeConfig({ baseUrl: 'https://openrouter.ai/api/v1', toolCapability: 'off' })
			)
		).toBe(false);
	});

	it('returns true for unknown baseUrl with on (no URL guessing)', () => {
		expect(
			resolveToolCapability(makeConfig({ baseUrl: 'https://example.com/v1', toolCapability: 'on' }))
		).toBe(true);
	});
});

describe('session safety-net', () => {
	it('disableToolsForSession sets the sticky flag', () => {
		disableToolsForSession();
		expect(isSessionDisabled()).toBe(true);
	});

	it('isSessionDisabled returns true after calling disableToolsForSession', () => {
		expect(isSessionDisabled()).toBe(true);
	});

	it('resolveToolCapability returns false for explicit on after session disabled (latch composes)', () => {
		expect(resolveToolCapability(makeConfig({ toolCapability: 'on' }))).toBe(false);
	});
});

describe('legacyToolDefault (read-time normalization mapping)', () => {
	function legacy(overrides: {
		kind: ProviderConfig['kind'];
		baseUrl: string;
		toolCapability?: 'auto' | 'on' | 'off';
	}) {
		return overrides;
	}

	it('passes explicit on through unchanged', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'ollama', baseUrl: 'http://localhost:11434', toolCapability: 'on' })
			)
		).toBe('on');
	});

	it('passes explicit off through unchanged', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', toolCapability: 'off' })
			)
		).toBe('off');
	});

	it('maps anthropic auto → on', () => {
		expect(
			legacyToolDefault(legacy({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
		).toBe('on');
	});

	it('maps gemini auto → on', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' })
			)
		).toBe('on');
	});

	it('maps github-copilot auto → on', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'github-copilot', baseUrl: 'https://api.githubcopilot.com' })
			)
		).toBe('on');
	});

	it('maps ollama auto → off', () => {
		expect(legacyToolDefault(legacy({ kind: 'ollama', baseUrl: 'http://localhost:11434' }))).toBe(
			'off'
		);
	});

	it('maps absent toolCapability like auto (ollama → off)', () => {
		expect(legacyToolDefault({ kind: 'ollama', baseUrl: 'http://localhost:11434' })).toBe('off');
	});

	it('maps unknown kinds → off', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'mystery' as ProviderConfig['kind'], baseUrl: 'https://example.com/v1' })
			)
		).toBe('off');
	});

	it('strips trailing slashes before the allowlist hit', () => {
		expect(
			legacyToolDefault(
				legacy({ kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1/' })
			)
		).toBe('on');
	});

	it('maps unknown openai-compatible URLs → off', () => {
		expect(
			legacyToolDefault(legacy({ kind: 'openai-compatible', baseUrl: 'https://example.com/v1' }))
		).toBe('off');
	});

	const allowlisted: [string, string][] = [
		['DeepSeek bare', 'https://api.deepseek.com'],
		['DeepSeek /v1', 'https://api.deepseek.com/v1'],
		['xAI', 'https://api.x.ai/v1'],
		['Moonshot international', 'https://api.moonshot.ai/v1'],
		['Moonshot China', 'https://api.moonshot.cn/v1'],
		['DashScope international', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'],
		['DashScope China', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
		['Groq', 'https://api.groq.com/openai/v1'],
		['Mistral', 'https://api.mistral.ai/v1'],
		['OpenCode Zen', 'https://opencode.ai/zen/v1'],
		['OpenCode Zen Go', 'https://opencode.ai/zen/go/v1'],
		['LiteLLM root', 'http://localhost:4000'],
		['LiteLLM /v1', 'http://localhost:4000/v1'],
		['Vercel AI Gateway', 'https://ai-gateway.vercel.sh/v1'],
		['Requesty', 'https://router.requesty.ai/v1'],
		['Requesty EU', 'https://router.eu.requesty.ai/v1'],
		['Z.AI', 'https://api.z.ai/api/coding/paas/v4'],
		['Kilo Gateway', 'https://api.kilo.ai/api/gateway'],
		['OpenRouter', 'https://openrouter.ai/api/v1'],
		['OpenAI', 'https://api.openai.com/v1']
	];

	it.each(allowlisted)('maps openai-compatible %s → on', (_name, baseUrl) => {
		expect(legacyToolDefault(legacy({ kind: 'openai-compatible', baseUrl }))).toBe('on');
	});
});
