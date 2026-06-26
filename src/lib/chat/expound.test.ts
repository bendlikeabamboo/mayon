import { describe, expect, it } from 'vitest';
import {
	buildExpoundPrompt,
	selectionOverlapsExisting,
	spansOverlap,
	TOGGLE_LABELS,
	type ExpoundToggle
} from './expound';

describe('buildExpoundPrompt', () => {
	it('embeds the excerpt verbatim', () => {
		const p = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: '',
			toggles: []
		});
		expect(p).toContain('"""\npowerhouse of the cell\n"""');
	});

	it('lists all selected toggle labels in stable order', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: 'go deep',
			// Intentionally out of declaration order.
			toggles: ['code', 'diagrams', 'tables'] as ExpoundToggle[]
		});
		expect(p).toContain(
			`Adding [${TOGGLE_LABELS.code}, ${TOGGLE_LABELS.diagrams}, ${TOGGLE_LABELS.tables}] whenever possible.`
		);
	});

	it('reads "no extra formats" when no toggles are selected', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: 'plain summary',
			toggles: []
		});
		expect(p).toContain('Adding no extra formats whenever possible.');
		expect(p).not.toContain('[');
	});

	it('collapses empty/whitespace custom instructions to (none provided)', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '   \n\t  ',
			toggles: ['diagrams']
		});
		expect(p).toContain('With the following instructions:\n(none provided)');
	});

	it('trims surrounding whitespace from custom instructions', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '  focus on trade-offs  ',
			toggles: []
		});
		expect(p).toContain('focus on trade-offs');
		expect(p).not.toContain('  focus on trade-offs');
	});

	it('keeps a single toggle readable', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '',
			toggles: ['tables']
		});
		expect(p).toContain(`Adding [${TOGGLE_LABELS.tables}] whenever possible.`);
	});
});

describe('spansOverlap (half-open [start,end))', () => {
	it('blocks exact overlap', () => {
		const a = { startChar: 5, endChar: 10 };
		expect(spansOverlap(a, { ...a })).toBe(true);
	});

	it('blocks partial overlap on the left', () => {
		expect(spansOverlap({ startChar: 3, endChar: 7 }, { startChar: 5, endChar: 9 })).toBe(true);
	});

	it('blocks partial overlap on the right', () => {
		expect(spansOverlap({ startChar: 5, endChar: 9 }, { startChar: 3, endChar: 7 })).toBe(true);
	});

	it('blocks containment (one inside another)', () => {
		expect(spansOverlap({ startChar: 0, endChar: 20 }, { startChar: 5, endChar: 10 })).toBe(true);
	});

	it('allows adjacent spans (a.end === b.start)', () => {
		expect(spansOverlap({ startChar: 0, endChar: 5 }, { startChar: 5, endChar: 10 })).toBe(false);
	});

	it('allows disjoint spans', () => {
		expect(spansOverlap({ startChar: 0, endChar: 4 }, { startChar: 10, endChar: 20 })).toBe(false);
	});

	it('allows zero-length touches (empty span adjacent)', () => {
		expect(spansOverlap({ startChar: 5, endChar: 5 }, { startChar: 5, endChar: 9 })).toBe(false);
	});
});

describe('selectionOverlapsExisting', () => {
	const existing = [
		{ startChar: 10, endChar: 20 },
		{ startChar: 40, endChar: 50 }
	];

	it('returns false when no existing spans exist', () => {
		expect(selectionOverlapsExisting({ startChar: 0, endChar: 5 }, [])).toBe(false);
	});

	it('returns true when overlapping any existing span', () => {
		expect(selectionOverlapsExisting({ startChar: 15, endChar: 25 }, existing)).toBe(true);
		expect(selectionOverlapsExisting({ startChar: 45, endChar: 55 }, existing)).toBe(true);
	});

	it('returns false when adjacent to all existing spans', () => {
		expect(selectionOverlapsExisting({ startChar: 20, endChar: 30 }, existing)).toBe(false);
		expect(selectionOverlapsExisting({ startChar: 30, endChar: 40 }, existing)).toBe(false);
	});

	it('returns false when fully disjoint', () => {
		expect(selectionOverlapsExisting({ startChar: 60, endChar: 70 }, existing)).toBe(false);
	});
});
