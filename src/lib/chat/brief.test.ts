import { describe, expect, it } from 'vitest';
import {
	applyProfile,
	DEFAULT_LEVEL,
	DEFAULT_MODE,
	buildBriefSystemNote,
	parseBrief,
	summarizeBrief,
	type LearningBrief,
	type LearnerProfile,
	type ScopeStrategyId
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

	it('round-trips scopeStrategy', () => {
		const raw = JSON.stringify({ goal: 'g', scopeStrategy: 'guided-curriculum' });
		expect(parseBrief(raw)?.scopeStrategy).toBe('guided-curriculum');
	});

	it('drops an invalid scopeStrategy but keeps a valid goal', () => {
		const raw = JSON.stringify({ goal: 'g', scopeStrategy: 'nonexistent-strategy' });
		expect(parseBrief(raw)?.scopeStrategy).toBeUndefined();
	});

	it('drops a scopeStrategy that is a valid string but not in the enum', () => {
		const raw = JSON.stringify({ goal: 'g', scopeStrategy: 'lecture' });
		expect(parseBrief(raw)?.scopeStrategy).toBeUndefined();
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

	it('emits the strategy block for each mode', () => {
		const socratic = buildBriefSystemNote({ goal: 'g', mode: 'socratic' }).content;
		const explainer = buildBriefSystemNote({ goal: 'g', mode: 'explainer' }).content;
		const build = buildBriefSystemNote({ goal: 'g', mode: 'build' }).content;
		expect(explainer).toContain('GUIDED CURRICULUM');
		expect(socratic).toContain('NUANCED INQUIRY');
		expect(build).toContain('WORKSHOP mode');
	});

	it('does not contain the old mode one-liners', () => {
		const socratic = buildBriefSystemNote({ goal: 'g', mode: 'socratic' }).content;
		const explainer = buildBriefSystemNote({ goal: 'g', mode: 'explainer' }).content;
		const build = buildBriefSystemNote({ goal: 'g', mode: 'build' }).content;
		expect(socratic).not.toContain('questioning and active recall');
		expect(explainer).not.toContain('explain directly and clearly');
		expect(build).not.toContain('side-by-side');
	});

	it('tells the tutor to announce goal mastery', () => {
		expect(buildBriefSystemNote({ goal: 'g' }).content).toContain(
			'When the learner can do the goal'
		);
	});

	it('explicit scopeStrategy overrides the mode-default block when mode-matched', () => {
		const note = buildBriefSystemNote({
			goal: 'g',
			mode: 'socratic',
			scopeStrategy: 'devils-advocate'
		});
		expect(note.content).toContain("DEVIL'S ADVOCATE");
		expect(note.content).not.toContain('NUANCED INQUIRY');
	});

	it('cross-mode scopeStrategy falls back to mode-default block', () => {
		const note = buildBriefSystemNote({ goal: 'g', mode: 'socratic', scopeStrategy: 'workshop' });
		expect(note.content).toContain('NUANCED INQUIRY');
		expect(note.content).not.toContain('WORKSHOP');
	});

	it('a legacy brief with no scopeStrategy still emits a mode-default block', () => {
		const note = buildBriefSystemNote({ goal: 'g', mode: 'explainer' });
		expect(note.content).toContain('GUIDED CURRICULUM');
	});

	it('includes the budget line when scope is set', () => {
		const note = buildBriefSystemNote({ goal: 'g', scope: 'orient me in 10 min' });
		expect(note.content).toContain('The learner set this budget: orient me in 10 min');
	});

	it('omits the budget line when scope is empty', () => {
		const note = buildBriefSystemNote({ goal: 'g' });
		expect(note.content).not.toContain('The learner set this budget');
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

describe('applyProfile', () => {
	it('brief scopeStrategy wins over profile scopeStrategy', () => {
		const profile: LearnerProfile = {
			context: 'p-ctx',
			level: 'novice',
			mode: 'build',
			scopeStrategy: 'guided-inquiry'
		};
		const brief = {
			context: 'b-ctx',
			level: 'regular' as const,
			mode: 'explainer' as const,
			scopeStrategy: 'guided-curriculum' as ScopeStrategyId
		};
		const result = applyProfile(profile, brief);
		expect(result.context).toBe('b-ctx');
		expect(result.level).toBe('regular');
		expect(result.mode).toBe('explainer');
		expect(result.scopeStrategy).toBe('guided-curriculum');
	});

	it('profile fills gaps when brief omits fields', () => {
		const profile: LearnerProfile = {
			context: 'p-ctx',
			level: 'practitioner',
			mode: 'build',
			scopeStrategy: 'workshop'
		};
		const result = applyProfile(profile, {});
		expect(result.context).toBe('p-ctx');
		expect(result.level).toBe('practitioner');
		expect(result.mode).toBe('build');
		expect(result.scopeStrategy).toBe('workshop');
	});

	it('defaults fill remaining gaps', () => {
		const result = applyProfile({}, {});
		expect(result.level).toBe(DEFAULT_LEVEL);
		expect(result.mode).toBe(DEFAULT_MODE);
		expect(result.context).toBeUndefined();
	});

	it('goal and scope pass through unchanged', () => {
		const profile: LearnerProfile = { context: 'x', level: 'novice', mode: 'build' };
		const brief = { goal: 'my goal', scope: 'my scope' };
		const result = applyProfile(profile, brief);
		expect(result.goal).toBe('my goal');
		expect(result.scope).toBe('my scope');
	});

	it('empty brief + empty profile yields defaults', () => {
		const result = applyProfile({}, {});
		expect(result).toEqual({
			goal: undefined,
			context: undefined,
			level: DEFAULT_LEVEL,
			mode: DEFAULT_MODE,
			scope: undefined,
			scopeStrategy: 'guided-inquiry'
		});
	});

	it('level, mode, and scopeStrategy are always present', () => {
		const partial: Partial<LearningBrief> = { goal: 'g' };
		const result = applyProfile({}, partial);
		expect(result.level).toBeDefined();
		expect(result.mode).toBeDefined();
		expect(result.scopeStrategy).toBeDefined();
	});
});
