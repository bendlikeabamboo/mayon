import { describe, it, expect } from 'vitest';
import { providerOptionsForReasoning } from './sdk-factory';
import type { ReasoningEffort } from './types';

const _efforts: ReasoningEffort[] = ['off', 'on', 'deep'];
const _kinds = ['openai-compatible', 'anthropic', 'gemini', 'ollama'] as const;
const pKey = 'z.ai';

function opts(
	kind: (typeof _kinds)[number],
	effort: ReasoningEffort,
	model?: string
): Record<string, unknown> {
	return providerOptionsForReasoning(kind, effort, pKey, model);
}

describe('supportsReasoningEffort (indirect via openai-compatible)', () => {
	function hasReasoningEffort(modelId: string): boolean {
		for (const e of ['on', 'deep'] as const) {
			const r = providerOptionsForReasoning('openai-compatible', e, pKey, modelId);
			const inner = r[pKey] as Record<string, unknown> | undefined;
			if (inner && 'reasoning_effort' in inner) return true;
		}
		return false;
	}

	it('returns true for glm-5.2', () => {
		expect(hasReasoningEffort('glm-5.2')).toBe(true);
	});

	it('returns true for glm-5.2[1m] (bracket suffix)', () => {
		expect(hasReasoningEffort('glm-5.2[1m]')).toBe(true);
	});

	it('returns true for GLM-5.2-Plus (case insensitive)', () => {
		expect(hasReasoningEffort('GLM-5.2-Plus')).toBe(true);
	});

	it('returns false for glm-5.1', () => {
		expect(hasReasoningEffort('glm-5.1')).toBe(false);
	});

	it('returns false for glm-5-turbo', () => {
		expect(hasReasoningEffort('glm-5-turbo')).toBe(false);
	});

	it('returns false for glm-4.7', () => {
		expect(hasReasoningEffort('glm-4.7')).toBe(false);
	});

	it('returns false for undefined modelId', () => {
		expect(hasReasoningEffort(undefined!)).toBe(false);
	});
});

describe('providerOptionsForReasoning — openai-compatible + GLM-5.2', () => {
	const model = 'glm-5.2';

	it('off → thinking disabled', () => {
		expect(opts('openai-compatible', 'off', model)).toEqual({
			[pKey]: { thinking: { type: 'disabled' } }
		});
	});

	it('on → thinking enabled + reasoning_effort high', () => {
		expect(opts('openai-compatible', 'on', model)).toEqual({
			[pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
		});
	});

	it('deep → thinking enabled + reasoning_effort max', () => {
		expect(opts('openai-compatible', 'deep', model)).toEqual({
			[pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
		});
	});
});

describe('providerOptionsForReasoning — openai-compatible + other model', () => {
	const model = 'gpt-4o';

	it('off → thinking disabled', () => {
		expect(opts('openai-compatible', 'off', model)).toEqual({
			[pKey]: { thinking: { type: 'disabled' } }
		});
	});

	it('on → thinking enabled (no reasoning_effort)', () => {
		expect(opts('openai-compatible', 'on', model)).toEqual({
			[pKey]: { thinking: { type: 'enabled' } }
		});
	});

	it('deep → thinking enabled (no reasoning_effort)', () => {
		expect(opts('openai-compatible', 'deep', model)).toEqual({
			[pKey]: { thinking: { type: 'enabled' } }
		});
	});
});

describe('providerOptionsForReasoning — anthropic', () => {
	it('off → empty object', () => {
		expect(opts('anthropic', 'off')).toEqual({});
	});

	it('on → thinking enabled with budget 2048', () => {
		expect(opts('anthropic', 'on')).toEqual({
			anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } }
		});
	});

	it('deep → thinking enabled with budget 10000', () => {
		expect(opts('anthropic', 'deep')).toEqual({
			anthropic: { thinking: { type: 'enabled', budget_tokens: 10000 } }
		});
	});
});

describe('providerOptionsForReasoning — gemini', () => {
	it('off → thinkingBudget 0', () => {
		expect(opts('gemini', 'off')).toEqual({
			google: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }
		});
	});

	it('on → empty object', () => {
		expect(opts('gemini', 'on')).toEqual({});
	});

	it('deep → thinkingBudget 32768', () => {
		expect(opts('gemini', 'deep')).toEqual({
			google: { generationConfig: { thinkingConfig: { thinkingBudget: 32768 } } }
		});
	});
});

describe('providerOptionsForReasoning — ollama', () => {
	it('off → empty object', () => {
		expect(opts('ollama', 'off')).toEqual({});
	});

	it('on → empty object', () => {
		expect(opts('ollama', 'on')).toEqual({});
	});

	it('deep → empty object', () => {
		expect(opts('ollama', 'deep')).toEqual({});
	});
});
