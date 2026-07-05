import { describe, it, expect } from 'vitest';
import { estimateContextLimit } from './model-limits';

describe('estimateContextLimit', () => {
	it('returns known caps for glm models', () => {
		expect(estimateContextLimit('glm-5.2')).toBe(128000);
		expect(estimateContextLimit('glm-5.1')).toBe(128000);
		expect(estimateContextLimit('glm-4')).toBe(128000);
	});

	it('returns known caps for gpt models', () => {
		expect(estimateContextLimit('gpt-4o')).toBe(128000);
		expect(estimateContextLimit('gpt-4')).toBe(128000);
		expect(estimateContextLimit('gpt-3.5')).toBe(16384);
	});

	it('returns known caps for claude models', () => {
		expect(estimateContextLimit('claude-3-5-sonnet')).toBe(200000);
		expect(estimateContextLimit('claude-3-opus')).toBe(200000);
		expect(estimateContextLimit('claude-3-sonnet')).toBe(200000);
		expect(estimateContextLimit('claude-3-haiku')).toBe(200000);
	});

	it('returns known caps for gemini models', () => {
		expect(estimateContextLimit('gemini-1.5-pro')).toBe(1000000);
		expect(estimateContextLimit('gemini-1.5-flash')).toBe(1000000);
		expect(estimateContextLimit('gemini-2.0')).toBe(1000000);
		expect(estimateContextLimit('gemini-2.5')).toBe(1000000);
	});

	it('returns null for unknown models', () => {
		expect(estimateContextLimit('unknown-model')).toBe(null);
	});

	it('returns null for empty/undefined', () => {
		expect(estimateContextLimit('')).toBe(null);
		expect(estimateContextLimit(undefined)).toBe(null);
	});

	it('strips bracket suffixes', () => {
		expect(estimateContextLimit('glm-5.2[1m]')).toBe(128000);
	});
});
