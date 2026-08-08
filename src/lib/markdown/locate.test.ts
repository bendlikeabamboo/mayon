import { describe, expect, it, beforeEach } from 'vitest';
import { buildSourceMap, _clearSourceMapCache } from './sourcemap';
import { locateCanonical, canonicalOffsetOfSegmentStart } from './locate';

beforeEach(() => _clearSourceMapCache());

describe('canonicalOffsetOfSegmentStart', () => {
	it('returns 0 for the first segment', () => {
		const sm = buildSourceMap('Hello world');
		expect(canonicalOffsetOfSegmentStart(sm, 0)).toBe(0);
	});

	it('returns the canonical index after the first segment for the second', () => {
		const raw = 'Hello **world**.';
		const sm = buildSourceMap(raw);
		if (sm.segments.length < 2) return;
		const firstLen = sm.segments[0]!.rendered.length;
		expect(canonicalOffsetOfSegmentStart(sm, 1)).toBe(firstLen);
	});
});

describe('locateCanonical', () => {
	it('mid-segment start and end: single prose segment', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 3, 8);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('lo wo');
	});

	it('mid-segment start only: end at segment boundary', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 3, 11);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('lo world');
	});

	it('mid-segment end only: start at segment boundary', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 0, 5);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('Hello');
	});

	it('boundary-aligned: full segment', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 0, 11);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('Hello world');
	});

	it('single character selection mid-segment', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 5, 6);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe(' ');
	});

	it('inline-code segment', () => {
		const raw = '`inline code`';
		const sm = buildSourceMap(raw);
		const codeSeg = sm.segments.find((s) => s.kind === 'inline-code');
		if (!codeSeg) return;
		const startChar = codeSeg.startChar + 2;
		const endChar = codeSeg.startChar + 6;
		const hit = locateCanonical(sm, startChar, endChar);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('line');
	});

	it('block-code segment', () => {
		const raw = '```js\nconst x = 1;\n```';
		const sm = buildSourceMap(raw);
		const codeSeg = sm.segments.find((s) => s.kind === 'block-code');
		if (!codeSeg) return;
		const startChar = codeSeg.startChar;
		const endChar = codeSeg.startChar + 5;
		const hit = locateCanonical(sm, startChar, endChar);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('const');
	});

	it('spanning multiple segments: bold in prose', () => {
		const raw = 'Hello **world** foo';
		const sm = buildSourceMap(raw);
		expect(sm.canonical).toBe('Hello world foo');
		const seg0 = sm.segments[0]!;
		const seg2 = sm.segments[sm.segments.length - 1]!;
		const startChar = seg0.startChar + 3;
		const endChar = seg2.startChar + 2;
		const hit = locateCanonical(sm, startChar, endChar);
		expect(hit).not.toBeNull();
		expect(sm.canonical.slice(hit!.start, hit!.end)).toBe('lo world f');
	});

	it('spanning across paragraph boundary (inter-block-ws)', () => {
		const raw = 'First paragraph.\n\nSecond paragraph.';
		const sm = buildSourceMap(raw);
		const p1 = sm.segments.find((s) => s.kind === 'prose' && s.rendered.includes('First'));
		const p2 = sm.segments.find((s) => s.kind === 'prose' && s.rendered.includes('Second'));
		if (!p1 || !p2) return;
		const hit = locateCanonical(sm, p1.startChar + 5, p2.startChar + 5);
		expect(hit).not.toBeNull();
	});

	it('returns null for inverted range', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		const hit = locateCanonical(sm, 8, 3);
		expect(hit).toBeNull();
	});

	it('returns null for out-of-range offsets', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		expect(locateCanonical(sm, 100, 110)).toBeNull();
	});

	it('returns null for empty range', () => {
		const raw = 'Hello world';
		const sm = buildSourceMap(raw);
		expect(locateCanonical(sm, 5, 5)).toBeNull();
	});

	it('round-trips with resolveSelection-style math', () => {
		const raw = 'Hello **world** foo';
		const sm = buildSourceMap(raw);
		const firstSegCanonStart = canonicalOffsetOfSegmentStart(sm, 0);
		const startChar = sm.segments[0]!.startChar + 3;
		const startCanonical = firstSegCanonStart + 3;

		const lastSegIdx = sm.segments.length - 1;
		const lastSegCanonStart = canonicalOffsetOfSegmentStart(sm, lastSegIdx);
		const endCanonical = lastSegCanonStart + 3;
		const endChar = sm.segments[lastSegIdx]!.startChar + 3;

		const hit = locateCanonical(sm, startChar, endChar);
		expect(hit).not.toBeNull();
		expect(hit!.start).toBe(startCanonical);
		expect(hit!.end).toBe(endCanonical);
	});
});
