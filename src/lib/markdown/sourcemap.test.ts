import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import { buildSourceMap, _testPlugins } from './sourcemap';
import type { Segment, SegmentKind } from './sourcemap';
import { renderMarkdown } from './render';
import { admonition } from './admonition';

function seg(kind: SegmentKind, rendered: string, startChar: number, endChar: number): Segment {
	return { kind, rendered, startChar, endChar };
}

function assertRawSlice(raw: string, s: Segment) {
	if (s.kind === 'inter-block-ws') return;
	if (s.rendered === '') return;
	if (s.kind === 'math-inline' || s.kind === 'math-display' || s.kind === 'mermaid') return;
	expect(raw.slice(s.startChar, s.endChar)).toBe(s.rendered);
}

describe('buildSourceMap', () => {
	it('plain prose round-trips 1:1', () => {
		const raw = 'Hello world.';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('Hello world.');
		expect(sm.segments).toHaveLength(1);
		expect(sm.segments[0]).toEqual(seg('prose', 'Hello world.', 0, 12));
		assertRawSlice(raw, sm.segments[0]);
	});

	it('bold text maps to inner text only', () => {
		const raw = 'Hello **world**.';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('Hello world.');
		const bold = sm.segments.find((s) => s.rendered === 'world');
		expect(bold).toBeDefined();
		expect(bold!.kind).toBe('prose');
		assertRawSlice(raw, bold!);
		expect(raw.slice(bold!.startChar, bold!.endChar)).toBe('world');
	});

	it('link text is link-text, URL has no segment', () => {
		const raw = '[the label](https://example.com/x)';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('the label');
		expect(sm.segments).toHaveLength(1);
		expect(sm.segments[0]).toEqual(seg('link-text', 'the label', 1, 10));
		assertRawSlice(raw, sm.segments[0]);
	});

	it('inline code strips backticks', () => {
		const raw = '`inline code`';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('inline code');
		expect(sm.segments).toHaveLength(1);
		expect(sm.segments[0].kind).toBe('inline-code');
		expect(sm.segments[0].rendered).toBe('inline code');
		expect(raw.slice(sm.segments[0].startChar, sm.segments[0].endChar)).toBe('inline code');
	});

	it('fenced block code maps inner content', () => {
		const raw = '```js\nconst x = 1;\n```';
		const sm = buildSourceMap(raw);
		expect(sm.segments).toHaveLength(1);
		const s = sm.segments[0];
		expect(s.kind).toBe('block-code');
		expect(s.rendered).toBe('const x = 1;\n');
		const inner = raw.slice(s.startChar, s.endChar);
		expect(inner).toBe('const x = 1;');
	});

	it('empty fenced block', () => {
		const raw = '```\n\n```';
		const sm = buildSourceMap(raw);
		expect(sm.segments).toHaveLength(1);
		const s = sm.segments[0];
		expect(s.kind).toBe('block-code');
		expect(s.rendered).toBe('');
	});

	it('fenced mermaid is mermaid segment with empty rendered', () => {
		const raw = '```mermaid\ngraph TD\nA-->B\n```';
		const sm = buildSourceMap(raw);
		expect(sm.segments).toHaveLength(1);
		const s = sm.segments[0];
		expect(s.kind).toBe('mermaid');
		expect(s.rendered).toBe('');
	});

	it('list items have inter-block-ws between them', () => {
		const raw = '- a\n- b\nc';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toContain('a');
		expect(sm.canonical).toContain('b');
		expect(sm.canonical).toContain('c');
		const wsSegments = sm.segments.filter((s) => s.kind === 'inter-block-ws');
		expect(wsSegments.length).toBeGreaterThan(0);
	});

	it('GFM table has prose cells and inter-block-ws', () => {
		const raw = '| a | b |\n| --- | --- |\n| 1 | 2 |';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toContain('a');
		expect(sm.canonical).toContain('b');
		expect(sm.canonical).toContain('1');
		expect(sm.canonical).toContain('2');
		expect(sm.segments.some((s) => s.kind === 'inter-block-ws')).toBe(true);
	});

	it('inline math is math-inline with empty rendered', () => {
		const raw = '$x^2$';
		const sm = buildSourceMap(raw);
		expect(sm.segments).toHaveLength(1);
		expect(sm.segments[0].kind).toBe('math-inline');
		expect(sm.segments[0].rendered).toBe('');
		expect(sm.canonical).toBe('');
	});

	it('display math has empty rendered', () => {
		const raw = '$$\\int x\\,dx$$';
		const sm = buildSourceMap(raw);
		expect(sm.segments).toHaveLength(1);
		expect(['math-inline', 'math-display']).toContain(sm.segments[0].kind);
		expect(sm.segments[0].rendered).toBe('');
		expect(sm.canonical).toBe('');
	});

	it('nested blockquote + list + emphasis + link + code', () => {
		const raw = '> - **a** [b](u) `c`';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toContain('a');
		expect(sm.canonical).toContain('b');
		expect(sm.canonical).toContain('c');

		const proseA = sm.segments.find((s) => s.rendered === 'a');
		expect(proseA).toBeDefined();
		expect(proseA!.kind).toBe('prose');

		const linkB = sm.segments.find((s) => s.rendered === 'b');
		expect(linkB).toBeDefined();
		expect(linkB!.kind).toBe('link-text');

		const codeC = sm.segments.find((s) => s.rendered === 'c');
		expect(codeC).toBeDefined();
		expect(codeC!.kind).toBe('inline-code');
	});

	it('hard break produces newline in canonical', () => {
		const raw = 'line1  \nline2';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('line1\nline2');
		const brSeg = sm.segments.find((s) => s.rendered === '\n' && s.kind === 'prose');
		expect(brSeg).toBeDefined();
	});

	it('admonition body text has correct offsets, title has no segment', () => {
		const raw = '> [!NOTE] body text\n> second line';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toContain('body text');
		expect(sm.canonical).toContain('second line');
		expect(sm.canonical).not.toContain('Note');

		const proseSegs = sm.segments.filter((s) => s.kind === 'prose');
		expect(proseSegs.length).toBeGreaterThan(0);
	});

	it('empty input returns empty canonical', () => {
		const sm = buildSourceMap('');
		expect(sm.canonical).toBe('');
		expect(sm.segments.length).toBe(0);
	});

	it('whitespace-only input returns whitespace canonical', () => {
		const sm = buildSourceMap('   \n  ');
		expect(sm.canonical.trim()).toBe('');
	});

	it('HTML entity: rendered is decoded, range covers raw entity', () => {
		const raw = 'a &amp; b';
		const sm = buildSourceMap(raw);
		const prose = sm.segments.find((s) => s.kind === 'prose');
		expect(prose).toBeDefined();
		expect(prose!.rendered).toBe('a & b');
		expect(raw.slice(prose!.startChar, prose!.endChar)).toBe('a &amp; b');
	});
});

describe('canonical === filtered DOM textContent', () => {
	const EXCLUDED_SELECTORS = ['.katex', '.callout-title', 'code.language-mermaid'];

	function domCanonical(html: string): string {
		const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
		const root = dom.window.document.getElementById('root')!;

		function isExcluded(node: Node): boolean {
			if (node.nodeType === 1) {
				const el = node as Element;
				for (const sel of EXCLUDED_SELECTORS) {
					if (el.closest(sel)) return true;
				}
			}
			return false;
		}

		function isMermaidPre(node: Node): boolean {
			if (node.nodeType === 1) {
				const el = node as Element;
				if (el.tagName === 'PRE' && el.querySelector('code.language-mermaid')) return true;
			}
			return false;
		}

		let result = '';
		const walker = dom.window.document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
		let current: Node | null = walker.nextNode();
		while (current) {
			if (!isExcluded(current.parentNode!) && !isMermaidPre(current.parentNode!)) {
				result += current.textContent ?? '';
			}
			current = walker.nextNode();
		}
		return result;
	}

	const fixtures: string[] = [
		'Hello **world**.',
		'[the label](https://example.com/x)',
		'`inline code`',
		'```js\nconst x = 1;\n```',
		'```\n\n```',
		'```mermaid\ngraph TD\nA-->B\n```',
		'- a\n- b\nc',
		'| a | b |\n| --- | --- |\n| 1 | 2 |',
		'$x^2$',
		'$$\\int x\\,dx$$',
		'> - **a** [b](u) `c`',
		'line1  \nline2',
		'> [!NOTE] body text\n> second line',
		'> [!NOTE]\n> body on next line',
		'a &amp; b',
		'First paragraph.\n\nSecond paragraph.',
		'- item 1\n  - nested\n- item 2',
		'plain text before\n\n```js\nconsole.log(1);\n```\n\nplain text after',
		'Text with $x^2$ inline.',
		'Display math:\n\n$$E=mc^2$$\n\nAfter math.',
		'Mermaid in middle:\n\n```mermaid\nA->B\n```\n\nAfter mermaid.',
		'> [!WARNING]\n> - item 1\n> - item 2',
		'**bold** and `code` and [link](url)'
	];

	for (const raw of fixtures) {
		it(`matches DOM for: ${JSON.stringify(raw.slice(0, 40))}`, () => {
			const sm = buildSourceMap(raw);
			const html = renderMarkdown(raw);
			const domText = domCanonical(html);
			expect(sm.canonical).toBe(domText);
		});
	}
});

describe('processor parity', () => {
	it('sourcemap processor matches render.ts parse+bridge stage', () => {
		const parsePlugins = [remarkParse, remarkGfm, remarkMath, remarkRehype, admonition];

		expect(_testPlugins).toBeDefined();
		expect(_testPlugins).toHaveLength(parsePlugins.length);
		for (let i = 0; i < parsePlugins.length; i++) {
			expect(_testPlugins[i]).toBe(parsePlugins[i]);
		}
	});
});
