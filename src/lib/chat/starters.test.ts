import { describe, expect, it } from 'vitest';
import { deriveStarters, type StarterContext } from './starters';
import type { LearningBrief } from './brief';

const brief: LearningBrief = {
	goal: 'be able to read a Makefile',
	level: 'some',
	mode: 'explainer'
};

describe('deriveStarters — generic fallback', () => {
	it('returns the generic set for undefined context', () => {
		const starters = deriveStarters(undefined);
		expect(starters.length).toBeGreaterThanOrEqual(3);
		expect(starters.length).toBeLessThanOrEqual(5);
		expect(starters.map((s) => s.id)).toContain('explore');
		expect(starters.map((s) => s.id)).toContain('quiz-me');
	});

	it('returns the same generic set for null and empty-object context', () => {
		expect(deriveStarters(null)).toEqual(deriveStarters(undefined));
		expect(deriveStarters({})).toEqual(deriveStarters(undefined));
	});

	it('treats whitespace-only titles as no context (generic set)', () => {
		const ctx: StarterContext = { chatTitles: ['   '], labTitles: [] };
		expect(deriveStarters(ctx)).toEqual(deriveStarters(undefined));
	});

	it('is stable across repeated calls (deterministic order)', () => {
		const a = deriveStarters(undefined);
		const b = deriveStarters(undefined);
		expect(a).toEqual(b);
	});
});

describe('deriveStarters — curriculum context preference', () => {
	it('leads with goal-derived seeds when a brief is present', () => {
		const starters = deriveStarters({ brief });
		expect(starters[0].prompt).toContain('be able to read a Makefile');
		// Context seeds come before the generic pad.
		const genericIds = new Set(['explore', 'quiz-me', 'plan-session']);
		const firstGenericIndex = starters.findIndex((s) => genericIds.has(s.id));
		if (firstGenericIndex >= 0) {
			for (let i = 0; i < firstGenericIndex; i++) {
				expect(genericIds.has(starters[i].id)).toBe(false);
			}
		}
	});

	it('stays within 3–5 seeds with a brief', () => {
		const starters = deriveStarters({ brief });
		expect(starters.length).toBeGreaterThanOrEqual(3);
		expect(starters.length).toBeLessThanOrEqual(5);
	});

	it('orders recall-first for socratic mode and practice-first for build mode', () => {
		const socratic = deriveStarters({ brief: { ...brief, mode: 'socratic' } });
		const build = deriveStarters({ brief: { ...brief, mode: 'build' } });
		expect(socratic[0].id).toBe('quiz-goal');
		expect(build[0].id).toBe('practice-goal');
	});

	it('falls back to generics when the context has only empty-string titles', () => {
		const starters = deriveStarters({ chatTitles: [''], labTitles: [''] });
		expect(starters).toEqual(deriveStarters(undefined));
	});
});

describe('deriveStarters — shape stability', () => {
	it('never duplicates prompts', () => {
		const cases: Array<StarterContext | undefined | null> = [
			undefined,
			null,
			{},
			{ brief },
			{ brief, chatTitles: ['Makefiles 101', 'Shells'], labTitles: ['Write a Makefile'] }
		];
		for (const ctx of cases) {
			const prompts = deriveStarters(ctx).map((s) => s.prompt);
			expect(new Set(prompts).size).toBe(prompts.length);
		}
	});

	it('keeps ids unique and labels/prompts nonempty for every seed', () => {
		for (const starters of [deriveStarters(undefined), deriveStarters({ brief })]) {
			const ids = starters.map((s) => s.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const s of starters) {
				expect(s.label.trim().length).toBeGreaterThan(0);
				expect(s.prompt.trim().length).toBeGreaterThan(0);
			}
		}
	});

	it('truncates long goals in labels to keep chips short', () => {
		const longGoal = 'a'.repeat(80);
		const starters = deriveStarters({ brief: { goal: longGoal } });
		expect(starters[0].label.length).toBeLessThanOrEqual(40);
		expect(starters[0].label.endsWith('…')).toBe(true);
	});
});
