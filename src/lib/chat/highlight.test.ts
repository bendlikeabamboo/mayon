import { describe, expect, it } from 'vitest';
import { resolveSelectionOffsets } from './highlight';

describe('resolveSelectionOffsets', () => {
	it('maps a clean prose selection back to raw offsets', () => {
		const raw = 'The quick brown fox jumps over the lazy dog.';
		// Select "brown fox"
		const containerText = raw; // prose == raw here
		const start = raw.indexOf('brown');
		const end = start + 'brown fox'.length;
		const out = resolveSelectionOffsets(raw, {
			excerpt: 'brown fox',
			containerText,
			startInContainer: start,
			endInContainer: end
		});
		expect(out).not.toBeNull();
		expect(out!.startChar).toBe(start);
		expect(out!.endChar).toBe(end);
		expect(out!.excerpt).toBe('brown fox');
		expect(raw.slice(out!.startChar, out!.endChar)).toBe('brown fox');
	});

	it('resolves offsets across markdown emphasis reflow (verbatim anchor miss, ws fallback)', () => {
		// Raw markdown has emphasis markers; rendered prose drops them.
		const raw = 'This is **important** text for the reader.';
		// Rendered text collapses the ** so it reads "This is important text...".
		const rendered = 'This is important text for the reader.';
		const start = rendered.indexOf('important');
		const end = start + 'important'.length;
		const out = resolveSelectionOffsets(raw, {
			excerpt: 'important',
			containerText: rendered,
			startInContainer: start,
			endInContainer: end
		});
		expect(out).not.toBeNull();
		// The excerpt "important" should land on the raw "important" inside **...**.
		expect(raw.slice(out!.startChar, out!.endChar)).toBe('important');
	});

	it('resolves offsets across a list marker reflow', () => {
		const raw = 'Intro line.\n- first item\n- second item\nOutro.';
		// Rendered: list markers become bullets; visible text has the item text
		// separated by newlines/spaces. Select "second item".
		const rendered = 'Intro line. first item second item Outro.';
		const start = rendered.indexOf('second item');
		const end = start + 'second item'.length;
		const out = resolveSelectionOffsets(raw, {
			excerpt: 'second item',
			containerText: rendered,
			startInContainer: start,
			endInContainer: end
		});
		expect(out).not.toBeNull();
		expect(raw.slice(out!.startChar, out!.endChar)).toBe('second item');
	});

	it('returns null when the excerpt is not present in the raw content (generated content)', () => {
		// Selection over a rendered Mermaid SVG label that never existed in raw.
		const raw = '```mermaid\ngraph TD\nA-->B\n```\nAfter.';
		const rendered = 'Diagram renders as SVG. After.';
		const start = rendered.indexOf('Diagram');
		const end = start + 'Diagram renders as SVG'.length;
		const out = resolveSelectionOffsets(raw, {
			excerpt: 'Diagram renders as SVG',
			containerText: rendered,
			startInContainer: start,
			endInContainer: end
		});
		expect(out).toBeNull();
	});

	it('returns null for an empty excerpt', () => {
		const out = resolveSelectionOffsets('some text', {
			excerpt: '',
			containerText: 'some text',
			startInContainer: 0,
			endInContainer: 0
		});
		expect(out).toBeNull();
	});

	it('returns null when the container slice does not match the excerpt', () => {
		const out = resolveSelectionOffsets('hello world', {
			excerpt: 'world',
			containerText: 'hello world',
			startInContainer: 0,
			endInContainer: 2 // claims "world" but window is "he"
		});
		expect(out).toBeNull();
	});
});
