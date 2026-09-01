import { describe, expect, it } from 'vitest';
import {
	buildExpoundPrompt,
	parseAddFormats,
	selectionOverlapsExisting,
	spansOverlap
} from './expound';

describe('buildExpoundPrompt', () => {
	it('embeds the excerpt verbatim', () => {
		const p = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: '',
			formats: []
		});
		expect(p).toContain('"""\npowerhouse of the cell\n"""');
	});

	it('lists selected formats as imperative directives, in input order', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: 'go deep',
			formats: [
				{ name: 'Code Examples' },
				{ name: 'Comparison Tables', description: 'Contrast options side by side' },
				{ name: 'Diagrams (prompt diagrams)' }
			]
		});
		const lines = p.split('\n');
		const start = lines.indexOf('Extra formats to include in this reply:');
		expect(start).toBeGreaterThan(-1);
		expect(lines[start + 1]).toBe('- Code Examples');
		expect(lines[start + 2]).toBe('- Comparison Tables: Contrast options side by side');
		expect(lines[start + 3]).toBe('- Diagrams (prompt diagrams)');
	});

	it('reads "no extra formats" when no toggles are selected', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: 'plain summary',
			formats: []
		});
		expect(p).toContain('Extra formats: none — reply in prose.');
		expect(p).not.toContain('Extra formats to include in this reply:');
	});

	it('collapses empty/whitespace custom instructions to (none provided)', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '   \n\t  ',
			formats: [{ name: 'Code Examples' }]
		});
		expect(p).toContain('With the following instructions:\n(none provided)');
	});

	it('trims surrounding whitespace from custom instructions', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '  focus on trade-offs  ',
			formats: []
		});
		expect(p).toContain('focus on trade-offs');
		expect(p).not.toContain('  focus on trade-offs');
	});

	it('keeps a single name readable', () => {
		const p = buildExpoundPrompt({
			excerpt: 'x',
			customInstructions: '',
			formats: [{ name: 'Comparison Tables' }]
		});
		expect(p).toContain('Extra formats to include in this reply:\n- Comparison Tables');
	});

	it('omits summary line by default (provideSummary not set)', () => {
		const p = buildExpoundPrompt({
			excerpt: 'hello world',
			customInstructions: '',
			formats: []
		});
		expect(p).not.toContain('Summarize the current discussion.');
		expect(p.startsWith('The user would like to expound on this excerpt:')).toBe(true);
	});

	it('includes summary line when provideSummary is true', () => {
		const p = buildExpoundPrompt({
			excerpt: 'hello world',
			customInstructions: '',
			formats: [],
			provideSummary: true
		});
		expect(p.startsWith('Summarize the current discussion.\n')).toBe(true);
		expect(p).toContain('Summarize the current discussion.');
	});
});

describe('parseAddFormats', () => {
	it('maps legacy toggle keys to their labels', () => {
		expect(parseAddFormats('["diagrams","tables"]')).toEqual([
			'Diagrams (prompt diagrams)',
			'Comparison Tables'
		]);
	});

	it('keeps unknown strings verbatim', () => {
		expect(parseAddFormats('["diagrams","unknown"]')).toEqual([
			'Diagrams (prompt diagrams)',
			'unknown'
		]);
	});

	it('drops non-string elements', () => {
		expect(parseAddFormats('["Code Examples",42,null]')).toEqual(['Code Examples']);
	});

	it('returns [] on null', () => {
		expect(parseAddFormats(null)).toEqual([]);
	});

	it('returns [] on malformed JSON', () => {
		expect(parseAddFormats('not json')).toEqual([]);
	});

	it('returns [] on non-array JSON', () => {
		expect(parseAddFormats('{"diagrams":true}')).toEqual([]);
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
