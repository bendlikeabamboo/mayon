import { describe, it, expect } from 'vitest';
import { estimateContextLimit } from './model-limits';

describe('estimateContextLimit', () => {
	it('returns known caps for glm models', () => {
		expect(estimateContextLimit('glm-5.3')).toBe(1000000);
		expect(estimateContextLimit('glm-5.2')).toBe(1000000);
		expect(estimateContextLimit('glm-5.1')).toBe(200000);
		expect(estimateContextLimit('glm-5-turbo')).toBe(200000);
		expect(estimateContextLimit('glm-4')).toBe(128000);
	});

	it('returns known caps for gpt models', () => {
		expect(estimateContextLimit('gpt-4o')).toBe(128000);
		expect(estimateContextLimit('gpt-4')).toBe(128000);
		expect(estimateContextLimit('gpt-3.5')).toBe(16384);
	});

	it('returns known caps for other shipped template models', () => {
		expect(estimateContextLimit('deepseek-chat')).toBe(128000);
		expect(estimateContextLimit('deepseek-reasoner')).toBe(128000);
		expect(estimateContextLimit('grok-4.6')).toBe(500000);
		expect(estimateContextLimit('mistral-large-latest')).toBe(256000);
		expect(estimateContextLimit('glm-4.7')).toBe(200000);
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

	it('returns null for unknown router-prefixed models', () => {
		expect(estimateContextLimit('google/veo-3.1-generate-001')).toBe(null);
	});

	it('matches on last segment for router-prefixed models', () => {
		expect(estimateContextLimit('z-ai/glm-5.2')).toBe(1000000);
		expect(estimateContextLimit('openai/gpt-4o')).toBe(128000);
		expect(estimateContextLimit('gateway/openai/gpt-4o')).toBe(128000);
	});

	it('returns null for empty/undefined', () => {
		expect(estimateContextLimit('')).toBe(null);
		expect(estimateContextLimit(undefined)).toBe(null);
	});

	it('strips bracket suffixes', () => {
		expect(estimateContextLimit('glm-5.2[1m]')).toBe(1000000);
	});

	it('returns sourced caps for modern router-catalog families', () => {
		expect(estimateContextLimit('anthropic/claude-sonnet-4.5')).toBe(1000000);
		expect(estimateContextLimit('anthropic/claude-sonnet-5')).toBe(1000000);
		expect(estimateContextLimit('anthropic/claude-opus-5')).toBe(1000000);
		expect(estimateContextLimit('anthropic/claude-haiku-4.5')).toBe(200000);
		expect(estimateContextLimit('claude-fable-5')).toBe(1000000);
		expect(estimateContextLimit('google/gemini-3.5-flash')).toBe(1048576);
		expect(estimateContextLimit('deepseek/deepseek-v4.1-flash')).toBe(1048576);
		expect(estimateContextLimit('openai/gpt-6.1-sol')).toBe(1050000);
		expect(estimateContextLimit('moonshotai/kimi-k3')).toBe(1048576);
		expect(estimateContextLimit('qwen/qwen3.6-plus')).toBe(1000000);
		expect(estimateContextLimit('meta/muse-spark-1.3')).toBe(1048576);
		expect(estimateContextLimit('x-ai/grok-build-0.1')).toBe(256000);
		expect(estimateContextLimit('inclusionai/ling-3.1-flash')).toBe(262144);
		expect(estimateContextLimit('mistralai/mistral-large-4-0')).toBe(524288);
		expect(estimateContextLimit('claude-sonnet-4-6')).toBe(1000000);
	});

	it('stays null for families with inconsistent or missing reported windows', () => {
		expect(estimateContextLimit('openai/gpt-5.5')).toBe(null);
		expect(estimateContextLimit('claude-opus-4-8')).toBe(null);
		expect(estimateContextLimit('openai/gpt-image-1')).toBe(null);
	});
});
