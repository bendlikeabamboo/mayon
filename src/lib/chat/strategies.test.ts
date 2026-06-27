import { describe, expect, it } from 'vitest';
import {
	SCOPE_STRATEGIES,
	SCOPE_STRATEGY_IDS,
	defaultStrategyFor,
	isScopeStrategyId,
	resolveStrategy,
	strategiesForMode,
	strategyForBrief,
	type ScopeStrategyId
} from './strategies';

describe('SCOPE_STRATEGIES entries are valid', () => {
	it('each entry has non-empty block, label, hint, one mode, and gated set', () => {
		for (const s of SCOPE_STRATEGIES) {
			expect(s.label.length).toBeGreaterThan(0);
			expect(s.hint.length).toBeGreaterThan(0);
			expect(s.block.length).toBeGreaterThan(0);
			expect(s.modes.length).toBe(1);
			expect(typeof s.gated).toBe('boolean');
		}
	});

	it('gated strategies have non-empty replies; non-gated have none', () => {
		for (const s of SCOPE_STRATEGIES) {
			if (s.gated) {
				expect(Array.isArray(s.replies)).toBe(true);
				expect(s.replies!.length).toBeGreaterThan(0);
			} else {
				expect(s.replies).toBeUndefined();
			}
		}
	});
});

describe('SCOPE_STRATEGY_IDS', () => {
	it('has all 10 ids', () => {
		expect(SCOPE_STRATEGY_IDS).toHaveLength(10);
	});

	it('all 10 ids resolve to exactly one registry entry', () => {
		for (const id of SCOPE_STRATEGY_IDS) {
			const matches = SCOPE_STRATEGIES.filter((s) => s.id === id);
			expect(matches).toHaveLength(1);
		}
	});

	it('every gated strategy has non-empty replies, every non-gated has undefined', () => {
		for (const s of SCOPE_STRATEGIES) {
			if (s.gated) {
				expect(s.replies).toBeDefined();
				expect(s.replies!.length).toBeGreaterThan(0);
			} else {
				expect(s.replies).toBeUndefined();
			}
		}
	});
});

describe('isScopeStrategyId', () => {
	it('accepts all 10 ids', () => {
		for (const id of SCOPE_STRATEGY_IDS) {
			expect(isScopeStrategyId(id)).toBe(true);
		}
	});

	it('rejects garbage and unknown strings', () => {
		expect(isScopeStrategyId(null)).toBe(false);
		expect(isScopeStrategyId(undefined)).toBe(false);
		expect(isScopeStrategyId(42)).toBe(false);
		expect(isScopeStrategyId('')).toBe(false);
		expect(isScopeStrategyId('random-id')).toBe(false);
		expect(isScopeStrategyId('guided')).toBe(false);
	});
});

describe('strategiesForMode', () => {
	it('returns ≥1 strategies per mode with a defined default', () => {
		for (const mode of ['socratic', 'explainer', 'build'] as const) {
			const strats = strategiesForMode(mode);
			expect(strats.length).toBeGreaterThanOrEqual(1);
			expect(strats.find((s) => s.id === defaultStrategyFor(mode))).toBeDefined();
		}
	});

	it('explainer has 4 strategies', () => {
		expect(strategiesForMode('explainer')).toHaveLength(4);
	});

	it('socratic has 3 strategies', () => {
		expect(strategiesForMode('socratic')).toHaveLength(3);
	});

	it('build has 3 strategies', () => {
		expect(strategiesForMode('build')).toHaveLength(3);
	});

	it('explainer returns guided-curriculum as first', () => {
		expect(strategiesForMode('explainer')[0].id).toBe('guided-curriculum');
	});

	it('socratic returns guided-inquiry as first', () => {
		expect(strategiesForMode('socratic')[0].id).toBe('guided-inquiry');
	});

	it('build returns workshop as first', () => {
		expect(strategiesForMode('build')[0].id).toBe('workshop');
	});
});

describe('defaultStrategyFor', () => {
	it('returns the correct default per mode', () => {
		expect(defaultStrategyFor('explainer')).toBe('guided-curriculum');
		expect(defaultStrategyFor('socratic')).toBe('guided-inquiry');
		expect(defaultStrategyFor('build')).toBe('workshop');
	});
});

describe('resolveStrategy', () => {
	it('brief.scopeStrategy wins over profile when mode-matched', () => {
		const result = resolveStrategy(
			{ scopeStrategy: 'deep-dive', mode: 'explainer' },
			{ scopeStrategy: 'guided-curriculum' }
		);
		expect(result.id).toBe('deep-dive');
	});

	it('cross-mode brief scopeStrategy is skipped; profile wins if mode-matched', () => {
		const result = resolveStrategy(
			{ scopeStrategy: 'workshop', mode: 'socratic' },
			{ scopeStrategy: 'devils-advocate' }
		);
		expect(result.id).toBe('devils-advocate');
	});

	it('cross-mode profile scopeStrategy falls back to mode default', () => {
		const result = resolveStrategy({ mode: 'socratic' }, { scopeStrategy: 'workshop' });
		expect(result.id).toBe('guided-inquiry');
	});

	it('both brief and profile cross-mode → mode default', () => {
		const result = resolveStrategy(
			{ scopeStrategy: 'workshop', mode: 'socratic' },
			{ scopeStrategy: 'guided-curriculum' }
		);
		expect(result.id).toBe('guided-inquiry');
	});

	it('falls back to mode-default when neither brief nor profile sets it', () => {
		const result = resolveStrategy({ mode: 'explainer' }, {});
		expect(result.id).toBe('guided-curriculum');
	});

	it('deep-dive resolves directly when mode-matched (no fallback)', () => {
		const result = resolveStrategy({ scopeStrategy: 'deep-dive', mode: 'explainer' }, {});
		expect(result.id).toBe('deep-dive');
	});

	it('unknown registered-but-mode-mismatched id falls back to mode-default', () => {
		const result = resolveStrategy({ scopeStrategy: 'workshop', mode: 'socratic' }, {});
		expect(result.id).toBe('guided-inquiry');
	});

	it('garbage id falls back to mode-default without throwing', () => {
		const result = resolveStrategy(
			{ scopeStrategy: 'garbage' as unknown as ScopeStrategyId, mode: 'socratic' },
			{}
		);
		expect(result.id).toBe('guided-inquiry');
	});
});

describe('strategyForBrief', () => {
	it('resolves from brief alone (no profile)', () => {
		expect(strategyForBrief({ scopeStrategy: 'workshop', mode: 'build' }).id).toBe('workshop');
	});

	it('falls back to mode-default when brief has no scopeStrategy', () => {
		expect(strategyForBrief({ mode: 'socratic' }).id).toBe('guided-inquiry');
	});
});
