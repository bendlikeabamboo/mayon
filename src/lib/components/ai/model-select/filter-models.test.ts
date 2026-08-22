import { describe, expect, it } from 'vitest';
import { filterModels } from './filter-models.svelte';

describe('filterModels', () => {
	it('returns all models when query is empty', () => {
		const models = ['gpt-4o', 'claude-sonnet-4-20250514'];
		const result = filterModels(models, 'gpt-4o', '');
		expect(result.items).toEqual(['gpt-4o', 'claude-sonnet-4-20250514']);
	});

	it('filters on model id case-insensitively', () => {
		const models = ['gpt-4o', 'claude-sonnet-4-20250514', 'gemini-pro'];
		const result = filterModels(models, '', 'GPT');
		expect(result.items).toEqual(['gpt-4o']);
	});

	it('filters on display name case-insensitively', () => {
		const models = ['openai/gpt-4o', 'anthropic/claude-sonnet-4'];
		const result = filterModels(models, '', 'Claude');
		expect(result.items).toEqual(['anthropic/claude-sonnet-4']);
	});

	it('filters on provider label case-insensitively', () => {
		const models = ['openai/gpt-4o', 'anthropic/claude-sonnet-4'];
		const result = filterModels(models, '', 'openai');
		expect(result.items).toEqual(['openai/gpt-4o']);
	});

	it('returns empty array when no match (MP-1)', () => {
		const models = ['gpt-4o', 'claude-sonnet-4'];
		const result = filterModels(models, '', 'nonexistent');
		expect(result.items).toEqual([]);
	});

	it('prepends active value when missing from discovered list (MP-3)', () => {
		const models = ['claude-sonnet-4'];
		const result = filterModels(models, 'gpt-4o', '');
		expect(result.items[0]).toBe('gpt-4o');
		expect(result.items).toContain('claude-sonnet-4');
	});

	it('does not duplicate active value when already in list', () => {
		const models = ['gpt-4o', 'claude-sonnet-4'];
		const result = filterModels(models, 'gpt-4o', '');
		expect(result.items.filter((m) => m === 'gpt-4o')).toHaveLength(1);
		expect(result.items).toEqual(['gpt-4o', 'claude-sonnet-4']);
	});

	it('prepended active value is included even when filter would exclude it', () => {
		const models = ['claude-sonnet-4'];
		const result = filterModels(models, 'gpt-4o', 'claude');
		expect(result.items).toEqual(['gpt-4o', 'claude-sonnet-4']);
	});

	it('handles empty models array with active value', () => {
		const result = filterModels([], 'gpt-4o', '');
		expect(result.items).toEqual(['gpt-4o']);
	});

	it('handles empty models and empty value', () => {
		const result = filterModels([], '', '');
		expect(result.items).toEqual([]);
	});

	it('query polluted by Command auto-select collapses list — regression guard', () => {
		const models = [
			'glm-4-plus',
			'glm-4-air',
			'glm-4-airx',
			'glm-4-flash',
			'glm-4-long',
			'glm-4',
			'glm-z1-air',
			'glm-z1-flash',
			'glm-z1-premium'
		];
		const result = filterModels(models, 'glm-4-plus', 'glm-4-plus');
		expect(result.items.length).toBeLessThan(models.length);
		expect(result.items).toEqual(['glm-4-plus']);

		const resultEmpty = filterModels(models, 'glm-4-plus', '');
		expect(resultEmpty.items).toEqual(models);
	});

	it('query polluted with provider-prefixed id collapses to single match', () => {
		const models = [
			'anthropic/claude-fable-latest',
			'anthropic/claude-sonnet-4-20250514',
			'openai/gpt-4o',
			'google/gemini-pro'
		];
		const result = filterModels(
			models,
			'anthropic/claude-fable-latest',
			'anthropic/claude-fable-latest'
		);
		expect(result.items).toEqual(['anthropic/claude-fable-latest']);
	});
});
