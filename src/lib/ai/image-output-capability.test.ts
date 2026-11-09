import { describe, expect, it } from 'vitest';
import { supportsImageOutput } from './image-output-capability';
import type { ProviderConfig } from './types';

function makeConfig(imageOutput?: ProviderConfig['imageOutput']): ProviderConfig {
	return {
		id: 'p1',
		kind: 'openai-compatible',
		name: 'Test',
		baseUrl: 'https://example.com/v1',
		defaultModel: 'test',
		models: ['test'],
		...(imageOutput !== undefined && { imageOutput })
	};
}

describe('supportsImageOutput', () => {
	it("returns true when imageOutput is 'on', even for non-image families", () => {
		expect(supportsImageOutput(makeConfig('on'), 'deepseek-chat')).toBe(true);
		expect(supportsImageOutput(makeConfig('on'), 'llama3.2')).toBe(true);
	});

	it("returns false when imageOutput is 'off', overriding an image-output family", () => {
		expect(supportsImageOutput(makeConfig('off'), 'gpt-image-1')).toBe(false);
		expect(supportsImageOutput(makeConfig('off'), 'gemini-2.5-flash-image')).toBe(false);
	});

	it("treats 'auto' and absent identically via the allowlist", () => {
		expect(supportsImageOutput(makeConfig('auto'), 'gpt-image-1')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'gpt-image-1')).toBe(true);
		expect(supportsImageOutput(makeConfig('auto'), 'deepseek-chat')).toBe(false);
		expect(supportsImageOutput(makeConfig(), 'deepseek-chat')).toBe(false);
	});

	it('matches image-output family prefixes on plain model IDs', () => {
		const matching = [
			'gpt-image-1',
			'gpt-image-1-mini',
			'dall-e-3',
			'dall-e-2',
			'imagen-3.0-generate-002',
			'imagen-4.0-generate-preview-06-06',
			'gemini-2.0-flash-exp-image-generation',
			'gemini-2.5-flash-image-preview',
			'gemini-2.5-flash-image',
			'gemini-3-pro-image-preview'
		];
		for (const model of matching) {
			expect(supportsImageOutput(makeConfig(), model)).toBe(true);
		}
	});

	it('rejects non-image-output model IDs', () => {
		const nonMatching = [
			'deepseek-chat',
			'gpt-4o',
			'gpt-4.1-mini',
			'claude-sonnet-4',
			'gemini-2.5-flash',
			'text-embedding-3-small',
			'llama3.2',
			'mistral-large-latest'
		];
		for (const model of nonMatching) {
			expect(supportsImageOutput(makeConfig(), model)).toBe(false);
		}
	});

	it('is case-insensitive', () => {
		expect(supportsImageOutput(makeConfig(), 'GPT-Image-1')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'DALL-E-3')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'Imagen-4.0-Generate-001')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'DEEPSEEK-CHAT')).toBe(false);
	});

	it('matches on the last path segment, so gateway vendor prefixes resolve', () => {
		expect(supportsImageOutput(makeConfig(), 'openai/gpt-image-1')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'openai/dall-e-3')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'google/imagen-3.0-generate-002')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'google/gemini-2.5-flash-image-preview')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'google/gemini-2.5-flash')).toBe(false);
		expect(supportsImageOutput(makeConfig(), 'openai/gpt-4o-mini')).toBe(false);
	});

	it('prefix semantics: the family must start the segment, not merely appear in it', () => {
		expect(supportsImageOutput(makeConfig(), 'gpt-image-1')).toBe(true);
		expect(supportsImageOutput(makeConfig(), 'my-gpt-image-1-tune')).toBe(false);
		expect(supportsImageOutput(makeConfig(), 'notdall-e-3')).toBe(false);
	});

	it('is pure: never mutates the config and never touches request payloads', () => {
		const config = Object.freeze(makeConfig('auto'));
		expect(() => supportsImageOutput(config, 'gpt-image-1')).not.toThrow();
		expect(supportsImageOutput(config, 'gpt-image-1')).toBe(true);
		expect(supportsImageOutput(config, 'deepseek-chat')).toBe(false);
	});
});
