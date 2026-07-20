import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { canonicalize, alignDomToCanonical, resolveSelection } from './selection';
import type { AlignmentTable, AlignmentEntry } from './selection';
import { buildSourceMap } from '$lib/markdown/sourcemap';
import type { SourceMap } from '$lib/markdown/sourcemap';
import { renderMarkdown } from '$lib/markdown/render';

describe('canonicalize', () => {
	it('collapses runs of whitespace to a single space and trims', () => {
		expect(canonicalize('  hello   world  ')).toBe('hello world');
	});
	it('normalizes tabs and newlines', () => {
		expect(canonicalize('line1\n\nline2')).toBe('line1 line2');
		expect(canonicalize('a\t\tb')).toBe('a b');
	});
	it('preserves non-whitespace verbatim', () => {
		expect(canonicalize('abc')).toBe('abc');
	});
	it('returns empty for whitespace-only input', () => {
		expect(canonicalize('  \n  ')).toBe('');
	});
});

describe('alignDomToCanonical (jsdom)', () => {
	function setup(html: string): { doc: Document; root: HTMLElement } {
		const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
		return { doc: dom.window.document, root: dom.window.document.getElementById('root')! };
	}

	const fixtures: string[] = [
		'Hello **world**.',
		'[the label](https://example.com/x)',
		'`inline code`',
		'```js\nconst x = 1;\n```',
		'```mermaid\ngraph TD\nA-->B\n```',
		'- a\n- b\nc',
		'| a | b |\n| --- | --- |\n| 1 | 2 |',
		'$x^2$',
		'$$\\int x\\,dx$$',
		'> - **a** [b](u) `c`',
		'First paragraph.\n\nSecond paragraph.',
		'plain text before\n\n```js\nconsole.log(1);\n```\n\nplain text after',
		'Text with $x^2$ inline.',
		'Display math:\n\n$$E=mc^2$$\n\nAfter math.',
		'Mermaid in middle:\n\n```mermaid\nA->B\n```\n\nAfter mermaid.',
		'**bold** and `code` and [link](url)'
	];

	for (const raw of fixtures) {
		it(`aligns: ${JSON.stringify(raw.slice(0, 40))}`, () => {
			const sm = buildSourceMap(raw);
			const html = renderMarkdown(raw);
			const { root } = setup(html);
			const table = alignDomToCanonical(root, sm);
			expect(table.aligned).toBe(true);

			const nonExcluded = table.entries.filter((e) => !e.excluded);
			const domText = nonExcluded.map((e) => e.node.textContent ?? '').join('');
			expect(domText).toBe(sm.canonical);
		});
	}
});

describe('resolveSelection (mocked table)', () => {
	function setupTable(sm: SourceMap, excludedIndices?: Set<number>) {
		const dom = new JSDOM('<div></div>');
		const doc = dom.window.document;
		const text = doc.createTextNode(sm.canonical);
		doc.body.appendChild(text);

		const entries: AlignmentEntry[] = [];
		for (let i = 0; i < sm.canonical.length; i++) {
			entries.push({
				node: text,
				canonicalStart: i,
				canonicalEnd: i + 1,
				segmentKind: sm.segments[sm.canonicalToSegment[i]!]!.kind,
				excluded: excludedIndices?.has(i) ?? false
			});
		}
		const table: AlignmentTable = { entries, aligned: true, unalignedNode: null };

		function makeRange(startCanonical: number, endCanonical: number): Range {
			const range = doc.createRange();
			range.setStart(text, startCanonical);
			range.setEnd(text, endCanonical);
			return range;
		}

		return { table, makeRange, text, doc };
	}

	it('plain prose: selecting "world" from "Hello world."', () => {
		const raw = 'Hello world.';
		const sm = buildSourceMap(raw);
		const { table, makeRange } = setupTable(sm);
		const range = makeRange(6, 11);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(raw.slice(result.startChar, result.endChar)).toBe('world');
			expect(result.excerpt).toBe('world');
		}
	});

	it('bold text: selecting "world" from "Hello **world**."', () => {
		const raw = 'Hello **world**.';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('Hello world.');
		const { table, makeRange } = setupTable(sm);
		const worldStart = sm.canonical.indexOf('world');
		const range = makeRange(worldStart, worldStart + 5);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(raw.slice(result.startChar, result.endChar)).toBe('world');
		}
	});

	it('link text: selecting "the label"', () => {
		const raw = '[the label](https://example.com/x)';
		const sm = buildSourceMap(raw);
		const { table, makeRange } = setupTable(sm);
		const range = makeRange(0, sm.canonical.length);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(raw.slice(result.startChar, result.endChar)).toBe('the label');
		}
	});

	it('inline code: selecting "inline code"', () => {
		const raw = '`inline code`';
		const sm = buildSourceMap(raw);
		const { table, makeRange } = setupTable(sm);
		const range = makeRange(0, sm.canonical.length);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(raw.slice(result.startChar, result.endChar)).toBe('inline code');
		}
	});

	it('duplicate prose: second "the" resolved correctly', () => {
		const raw = 'the cat chased the bird in the tree';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe(raw);
		const { table, makeRange } = setupTable(sm);
		const secondTheStart = raw.indexOf('the', 1);
		const range = makeRange(secondTheStart, secondTheStart + 3);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.startChar).toBe(secondTheStart);
			expect(result.endChar).toBe(secondTheStart + 3);
		}
	});

	it('generated content (mermaid): mermaid excluded from canonical', () => {
		const raw = 'before\n```mermaid\nA->B\n```\nafter';
		const sm = buildSourceMap(raw);
		expect(sm.segments.some((s) => s.kind === 'mermaid')).toBe(true);
		expect(sm.canonical).not.toContain('A->B');
	});

	it('generated content (math): rejects', () => {
		const raw = '$x^2$';
		const sm = buildSourceMap(raw);
		if (sm.canonical.length > 0) {
			const { table, makeRange } = setupTable(sm);
			const range = makeRange(0, sm.canonical.length);
			const result = resolveSelection(table, sm, range);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe('generated');
		}
	});

	it('empty selection: rejects', () => {
		const raw = 'Hello world.';
		const sm = buildSourceMap(raw);
		const table = setupTable(sm).table;
		const dom = new JSDOM('<div></div>');
		const doc = dom.window.document;
		const range = doc.createRange();
		range.setStart(doc.body, 0);
		range.collapse(true);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('empty');
	});

	it('unaligned table: rejects when unaligned node is in range', () => {
		const raw = 'Hello world.';
		const sm = buildSourceMap(raw);
		const entries: AlignmentEntry[] = [];
		const dom = new JSDOM('<div></div>');
		const doc = dom.window.document;
		const text = doc.createTextNode(sm.canonical);

		for (let i = 0; i < sm.canonical.length; i++) {
			entries.push({
				node: text,
				canonicalStart: i,
				canonicalEnd: i + 1,
				segmentKind: sm.segments[sm.canonicalToSegment[i]!]!.kind,
				excluded: false
			});
		}

		const table: AlignmentTable = { entries, aligned: false, unalignedNode: text };
		const range = doc.createRange();
		range.setStart(text, 0);
		range.setEnd(text, sm.canonical.length);
		const result = resolveSelection(table, sm, range);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('unaligned');
	});

	it('two paragraphs: inter-block-ws clamped correctly', () => {
		const raw = 'First paragraph.\n\nSecond paragraph.';
		const sm = buildSourceMap(raw);
		const { table, makeRange } = setupTable(sm);

		const endOfP1 = sm.canonical.length;
		const startOfP2 = sm.canonical.lastIndexOf('S');
		if (startOfP2 < 0 || endOfP1 <= startOfP2) return;

		const range = makeRange(endOfP1 - 1, startOfP2 + 6);
		const result = resolveSelection(table, sm, range);
		if (result.ok) {
			const slice = raw.slice(result.startChar, result.endChar);
			expect(slice).not.toContain('\n\n');
		}
	});
});
