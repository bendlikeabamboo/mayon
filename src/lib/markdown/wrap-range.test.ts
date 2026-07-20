import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { wrapRange } from './wrap-range';
import type { AlignmentTable, AlignmentEntry } from '$lib/chat/selection';
import type { SegmentKind } from '$lib/markdown/sourcemap';

function setupJSDOM(html: string): { doc: Document; root: HTMLElement } {
	const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
	return { doc: dom.window.document, root: dom.window.document.getElementById('root')! };
}

function makeTable(
	root: HTMLElement,
	segments: { canonicalStart: number; canonicalEnd: number; kind: SegmentKind }[]
): { table: AlignmentTable; container: HTMLElement } {
	const html = root.innerHTML;
	root.innerHTML = '';
	const doc = root.ownerDocument!;
	const container = doc.createElement('div');
	container.innerHTML = html;
	root.appendChild(container);

	const entries: AlignmentEntry[] = [];
	const walker = doc.createTreeWalker(container, doc.defaultView!.NodeFilter.SHOW_TEXT);
	let current: Node | null = walker.nextNode();
	let segIdx = 0;

	while (current && segIdx < segments.length) {
		const seg = segments[segIdx]!;
		entries.push({
			node: current as Text,
			canonicalStart: seg.canonicalStart,
			canonicalEnd: seg.canonicalEnd,
			segmentKind: seg.kind,
			excluded: false
		});
		segIdx++;
		current = walker.nextNode();
	}

	return { table: { entries, aligned: true, unalignedNode: null }, container };
}

describe('wrapRange', () => {
	it('single text node: wraps canonical [0, 5)', () => {
		const { root } = setupJSDOM('<p>Hello world</p>');
		const { table, container } = makeTable(root, [
			{ canonicalStart: 0, canonicalEnd: 11, kind: 'prose' }
		]);
		const result = wrapRange(table, 0, 5, { 'data-branch-chat': 'test-id' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.wrapped).toBe(1);
		const mark = container.querySelector('span.expound-mark');
		expect(mark).not.toBeNull();
		expect(mark?.textContent).toBe('Hello');
		expect(mark?.getAttribute('data-branch-chat')).toBe('test-id');
	});

	it('partial text node at end: wraps [2, 7)', () => {
		const { root } = setupJSDOM('<p>Hello world</p>');
		const { table, container } = makeTable(root, [
			{ canonicalStart: 0, canonicalEnd: 11, kind: 'prose' }
		]);
		const result = wrapRange(table, 2, 7, { 'data-branch-chat': 'x' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const mark = container.querySelector('span.expound-mark');
		expect(mark?.textContent).toBe('llo w');
		expect(container.textContent).toBe('Hello world');
	});

	it('cross-<strong>: wraps "one two" across elements', () => {
		const { root } = setupJSDOM('<p>one <strong>two</strong> three</p>');
		const { table, container } = makeTable(root, [
			{ canonicalStart: 0, canonicalEnd: 4, kind: 'prose' },
			{ canonicalStart: 4, canonicalEnd: 7, kind: 'prose' },
			{ canonicalStart: 8, canonicalEnd: 13, kind: 'prose' }
		]);
		const result = wrapRange(table, 0, 7, { 'data-branch-chat': 'x' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const marks = container.querySelectorAll('span.expound-mark');
		expect(marks.length).toBeGreaterThanOrEqual(1);
		const wrappedText = Array.from(marks)
			.map((m) => m.textContent)
			.join('');
		expect(wrappedText).toContain('one');
		expect(wrappedText).toContain('two');
	});

	it('cross-<a>: wraps across anchor', () => {
		const { root } = setupJSDOM('<p><a href="u">link text</a></p>');
		const { table } = makeTable(root, [{ canonicalStart: 0, canonicalEnd: 9, kind: 'link-text' }]);
		const result = wrapRange(table, 0, 9, { 'data-branch-chat': 'x' });
		expect(result.ok).toBe(true);
	});

	it('empty range: returns empty', () => {
		const { root } = setupJSDOM('<p>Hello world</p>');
		const { table } = makeTable(root, [{ canonicalStart: 0, canonicalEnd: 11, kind: 'prose' }]);
		const result = wrapRange(table, 5, 5, { 'data-branch-chat': 'x' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('empty');
	});

	it('out-of-range canonical: returns empty', () => {
		const { root } = setupJSDOM('<p>Hello</p>');
		const { table } = makeTable(root, [{ canonicalStart: 0, canonicalEnd: 5, kind: 'prose' }]);
		const result = wrapRange(table, 10, 20, { 'data-branch-chat': 'x' });
		expect(result.ok).toBe(false);
	});
});
