import { beforeEach, describe, expect, it } from 'vitest';
import {
	resolveToolCapability,
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

	it('returns true for anthropic with auto (default)', () => {
		expect(
			resolveToolCapability(makeConfig({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
		).toBe(true);
	});

	it('returns true for gemini with auto (default)', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' })
			)
		).toBe(true);
	});

	it('returns false for ollama with auto (default)', () => {
		expect(
			resolveToolCapability(makeConfig({ kind: 'ollama', baseUrl: 'http://localhost:11434' }))
		).toBe(false);
	});

	it('returns true for openai-compatible with known gateway URL (Z.AI)', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://api.z.ai/api/coding/paas/v4' })
			)
		).toBe(true);
	});

	it('returns false for openai-compatible with unknown URL', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://example.com/v1' })
			)
		).toBe(false);
	});

	it('returns true for ollama with toolCapability on (overrides default false)', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'ollama', baseUrl: 'http://localhost:11434', toolCapability: 'on' })
			)
		).toBe(true);
	});

	it('returns false for anthropic with toolCapability off (overrides default true)', () => {
		expect(
			resolveToolCapability(
				makeConfig({
					kind: 'anthropic',
					baseUrl: 'https://api.anthropic.com',
					toolCapability: 'off'
				})
			)
		).toBe(false);
	});

	it('returns true for openai-compatible Kilo Gateway URL', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://api.kilo.ai/api/gateway' })
			)
		).toBe(true);
	});

	it('returns true for openai-compatible OpenRouter URL', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' })
			)
		).toBe(true);
	});

	it('returns true for openai-compatible OpenAI URL', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' })
			)
		).toBe(true);
	});

	it('returns false for openai-compatible random unknown URL', () => {
		expect(
			resolveToolCapability(
				makeConfig({ kind: 'openai-compatible', baseUrl: 'https://random.com/v1' })
			)
		).toBe(false);
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

	it('resolveToolCapability returns false for anthropic after session disabled', () => {
		expect(
			resolveToolCapability(makeConfig({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
		).toBe(false);
	});
});
