import { describe, expect, it } from 'vitest';
import {
	buildBriefSystemNote,
	DEFAULT_LEVEL,
	DEFAULT_MODE,
	parseBrief,
	summarizeBrief,
	type LearningBrief
} from './brief';

describe('parseBrief', () => {
	it('round-trips a fully-populated brief', () => {
		const brief: LearningBrief = {
			goal: 'build a Makefile',
			context: 'engineer with a real bug',
			level: 'regular',
			mode: 'explainer',
			scope: 'orient me in 10 min'
		};
		expect(parseBrief(JSON.stringify(brief))).toEqual(brief);
	});

	it('round-trips a goal-only brief (required field)', () => {
		const brief: LearningBrief = { goal: 'decide when to branch a chat' };
		expect(parseBrief(JSON.stringify(brief))).toEqual(brief);
	});

	it('returns null for null/empty/whitespace input', () => {
		expect(parseBrief(null)).toBeNull();
		expect(parseBrief('')).toBeNull();
		expect(parseBrief('   ')).toBeNull();
		expect(parseBrief(undefined)).toBeNull();
	});

	it('returns null for bad JSON (never throws)', () => {
		expect(parseBrief('{not json')).toBeNull();
		expect(parseBrief('null')).toBeNull();
		expect(parseBrief('42')).toBeNull();
		expect(parseBrief('[]')).toBeNull();
	});

	it('returns null when goal is missing or empty (goal is required)', () => {
		expect(parseBrief(JSON.stringify({ level: 'some' }))).toBeNull();
		expect(parseBrief(JSON.stringify({ goal: '   ' }))).toBeNull();
		expect(parseBrief(JSON.stringify({ goal: 42 }))).toBeNull();
	});

	it('drops invalid enum values but keeps a valid goal', () => {
		const raw = JSON.stringify({ goal: 'g', level: 'expert', mode: 'lecture', context: 'c' });
		const parsed = parseBrief(raw);
		expect(parsed).not.toBeNull();
		expect(parsed?.level).toBeUndefined();
		expect(parsed?.mode).toBeUndefined();
		expect(parsed?.context).toBe('c');
	});

	it('ignores unknown extra keys', () => {
		const parsed = parseBrief(JSON.stringify({ goal: 'g', surprise: 'x' }));
		expect(parsed).toEqual({ goal: 'g' });
	});

	it('trims the goal on parse', () => {
		expect(parseBrief(JSON.stringify({ goal: '  spaced  ' }))?.goal).toBe('spaced');
	});

	it('drops whitespace-only optional strings', () => {
		const parsed = parseBrief(JSON.stringify({ goal: 'g', context: '   ', scope: '\t' }));
		expect(parsed).toEqual({ goal: 'g' });
	});
});

describe('buildBriefSystemNote', () => {
	it('is a system message', () => {
		const note = buildBriefSystemNote({ goal: 'g' });
		expect(note.role).toBe('system');
	});

	it('includes the goal verbatim', () => {
		const note = buildBriefSystemNote({ goal: 'build a REST API in Rust' });
		expect(note.content).toContain('build a REST API in Rust');
	});

	it('reflects each populated field', () => {
		const note = buildBriefSystemNote({
			goal: 'g',
			context: 'on-call engineer',
			level: 'practitioner',
			mode: 'build',
			scope: 'mastery over days'
		});
		expect(note.content).toContain('on-call engineer');
		expect(note.content).toContain('practitioner');
		expect(note.content).toContain('build');
		expect(note.content).toContain('mastery over days');
	});

	it('substitutes defaults for omitted optional fields', () => {
		const note = buildBriefSystemNote({ goal: 'g' });
		expect(note.content).toContain(`Level: ${DEFAULT_LEVEL}`);
		expect(note.content).toContain(`Mode: ${DEFAULT_MODE}`);
		expect(note.content).toContain('Context: (not given)');
		expect(note.content).toContain('Scope: (open)');
	});

	it('uses mode-specific teaching guidance', () => {
		const socratic = buildBriefSystemNote({ goal: 'g', mode: 'socratic' }).content;
		const explainer = buildBriefSystemNote({ goal: 'g', mode: 'explainer' }).content;
		const build = buildBriefSystemNote({ goal: 'g', mode: 'build' }).content;
		expect(socratic).toContain('questioning and active recall');
		expect(explainer).toContain('explain directly and clearly');
		expect(build).toContain('side-by-side');
	});

	it('tells the tutor to announce goal mastery', () => {
		expect(buildBriefSystemNote({ goal: 'g' }).content).toContain(
			'When the learner can do the goal'
		);
	});
});

describe('summarizeBrief', () => {
	it('joins goal, level, and mode with the stable order', () => {
		const summary = summarizeBrief({
			goal: 'build a Makefile',
			level: 'some',
			mode: 'socratic'
		});
		expect(summary).toBe('Goal: build a Makefile · level: some · socratic');
	});

	it('substitutes defaults for omitted level/mode', () => {
		expect(summarizeBrief({ goal: 'g' })).toBe(
			`Goal: g · level: ${DEFAULT_LEVEL} · ${DEFAULT_MODE}`
		);
	});

	it('truncates a long goal and preserves field order', () => {
		const longGoal = 'x'.repeat(120);
		const summary = summarizeBrief({ goal: longGoal });
		// Truncated goal fragment ends with "…"; the level/mode segments follow.
		expect(summary.startsWith('Goal: ')).toBe(true);
		expect(summary).toContain('…');
		expect(summary.endsWith(`level: ${DEFAULT_LEVEL} · ${DEFAULT_MODE}`)).toBe(true);
		// Total chip stays compact (well under the raw goal length).
		expect(summary.length).toBeLessThan(longGoal.length);
	});
});
