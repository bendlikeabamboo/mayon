import { describe, expect, it } from 'vitest';
import { supportsVision } from './vision-capability';
import type { ProviderConfig } from './types';

function makeConfig(vision?: ProviderConfig['vision']): ProviderConfig {
	return {
		id: 'p1',
		kind: 'openai-compatible',
		name: 'Test',
		baseUrl: 'https://example.com/v1',
		defaultModel: 'test',
		models: ['test'],
		...(vision !== undefined && { vision })
	};
}

describe('supportsVision', () => {
	it("returns true when vision is 'on', even for non-vision families", () => {
		expect(supportsVision(makeConfig('on'), 'deepseek-chat')).toBe(true);
		expect(supportsVision(makeConfig('on'), 'llama3.2')).toBe(true);
	});

	it("returns false when vision is 'off', overriding a vision-family model", () => {
		expect(supportsVision(makeConfig('off'), 'gpt-4o')).toBe(false);
		expect(supportsVision(makeConfig('off'), 'claude-3-5-sonnet-latest')).toBe(false);
	});

	it("treats 'auto' and absent identically via the allowlist", () => {
		expect(supportsVision(makeConfig('auto'), 'gpt-4o')).toBe(true);
		expect(supportsVision(makeConfig(), 'gpt-4o')).toBe(true);
		expect(supportsVision(makeConfig('auto'), 'deepseek-chat')).toBe(false);
		expect(supportsVision(makeConfig(), 'deepseek-chat')).toBe(false);
	});

	it('matches vision-capable family prefixes on plain model IDs', () => {
		const matching = [
			'gpt-4o',
			'gpt-4o-mini',
			'gpt-4.1-mini',
			'gpt-5.4',
			'chatgpt-4o-latest',
			'o3-mini',
			'o4-mini',
			'claude-3-5-sonnet-latest',
			'claude-4-opus',
			'gemini-1.5-flash',
			'gemini-2.0-flash-exp',
			'gemini-3.7-flash',
			'llama-3.2-vision:11b',
			'llama-4-scout',
			'qwen-vl-max',
			'qwen2-vl-7b-instruct',
			'qwen2.5-vl-72b-instruct',
			'qvq-72b-preview',
			'pixtral-12b',
			'mistral-small-3.1-latest'
		];
		for (const model of matching) {
			expect(supportsVision(makeConfig(), model)).toBe(true);
		}
	});

	it('rejects non-vision model IDs', () => {
		const nonMatching = [
			'deepseek-chat',
			'gpt-3.5-turbo',
			'o1-mini',
			'text-embedding-3-small',
			'llama3.2',
			'qwen2.5',
			'glm-5.2',
			'kimi-k3',
			'mistral-large-latest',
			'devstral-medium-2507'
		];
		for (const model of nonMatching) {
			expect(supportsVision(makeConfig(), model)).toBe(false);
		}
	});

	it('is case-insensitive', () => {
		expect(supportsVision(makeConfig(), 'GPT-4O')).toBe(true);
		expect(supportsVision(makeConfig(), 'Claude-3-Opus')).toBe(true);
		expect(supportsVision(makeConfig(), 'Pixtral-Large')).toBe(true);
		expect(supportsVision(makeConfig(), 'DEEPSEEK-CHAT')).toBe(false);
	});

	it('matches on the last path segment, so gateway vendor prefixes resolve', () => {
		expect(supportsVision(makeConfig(), 'openai/gpt-4o-mini')).toBe(true);
		expect(supportsVision(makeConfig(), 'anthropic/claude-3.5-sonnet')).toBe(true);
		expect(supportsVision(makeConfig(), 'google/gemini-2.0-flash')).toBe(true);
		expect(supportsVision(makeConfig(), 'meta-llama/llama-4-scout')).toBe(true);
		expect(supportsVision(makeConfig(), 'mistralai/pixtral-12b')).toBe(true);
		expect(supportsVision(makeConfig(), 'openai/gpt-3.5-turbo')).toBe(false);
	});

	it('prefix semantics: the family must start the segment, not merely appear in it', () => {
		expect(supportsVision(makeConfig(), 'gpt-4o')).toBe(true);
		expect(supportsVision(makeConfig(), 'xgpt-4o')).toBe(false);
		expect(supportsVision(makeConfig(), 'my-gpt-4o-tune')).toBe(false);
	});
});
