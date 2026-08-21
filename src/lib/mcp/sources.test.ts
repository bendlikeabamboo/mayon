import { describe, expect, it } from 'vitest';
import { collectCards, extractSources, scanJsonValues } from './sources';

function detail(text: string): { serverId: string; toolName: string; content: unknown[] } {
	return { serverId: 'srv', toolName: 'brave_web_search', content: [{ type: 'text', text }] };
}

describe('extractSources', () => {
	it('extracts title/url pairs from a Brave-shaped web result payload', () => {
		const payload = {
			query: { original: 'ai news' },
			web: {
				results: [
					{ title: 'Story One', url: 'https://example.com/1', description: 'd' },
					{ title: 'Story Two', url: 'https://example.com/2' }
				]
			}
		};
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'Story One', url: 'https://example.com/1' },
			{ title: 'Story Two', url: 'https://example.com/2' }
		]);
	});

	it('extracts from a bare array of results', () => {
		const payload = [{ title: 'News', url: 'https://n.example/x' }];
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'News', url: 'https://n.example/x' }
		]);
	});

	it('handles image payloads (v2 URL-only, no base64)', () => {
		const payload = {
			results: [
				{ title: 'Aurora', url: 'https://img.example/aurora.jpg', source: 'https://page.example' }
			]
		};
		const sources = extractSources(detail(JSON.stringify(payload)));
		expect(sources).toHaveLength(2);
		expect(sources[0]).toEqual({ title: 'Aurora', url: 'https://img.example/aurora.jpg' });
		expect(sources[1]).toEqual({ title: 'page.example', url: 'https://page.example' });
	});

	it('falls back to host as title when title is missing or empty', () => {
		const payload = [
			{ url: 'https://no-title.example/a' },
			{ title: '   ', url: 'https://blank.example/b' }
		];
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'no-title.example', url: 'https://no-title.example/a' },
			{ title: 'blank.example', url: 'https://blank.example/b' }
		]);
	});

	it('scans raw text for URLs when the payload is not JSON', () => {
		const text = 'See https://plain.example/page and http://other.example for details.';
		expect(extractSources(detail(text))).toEqual([
			{ title: 'plain.example', url: 'https://plain.example/page' },
			{ title: 'other.example', url: 'http://other.example' }
		]);
	});

	it('ignores non-http(s) url fields', () => {
		const payload = [
			{ title: 'Ftp', url: 'ftp://files.example' },
			{ title: 'Mail', url: 'mailto:a@b.example' },
			{ title: 'Ok', url: 'https://ok.example' }
		];
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'Ok', url: 'https://ok.example' }
		]);
	});

	it('dedupes by URL preserving first-seen order', () => {
		const payload = [
			{ title: 'First', url: 'https://dup.example/a' },
			{ title: 'Second', url: 'https://dup.example/a' },
			{ title: 'Third', url: 'https://uniq.example/b' }
		];
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'First', url: 'https://dup.example/a' },
			{ title: 'Third', url: 'https://uniq.example/b' }
		]);
	});

	it('caps at 10 sources', () => {
		const payload = Array.from({ length: 25 }, (_, i) => ({
			title: `R${i}`,
			url: `https://cap.example/${i}`
		}));
		const sources = extractSources(detail(JSON.stringify(payload)));
		expect(sources).toHaveLength(10);
		expect(sources[0].url).toBe('https://cap.example/0');
		expect(sources[9].url).toBe('https://cap.example/9');
	});

	it('truncates long titles to 120 chars', () => {
		const longTitle = 'T'.repeat(300);
		const sources = extractSources(
			detail(JSON.stringify([{ title: longTitle, url: 'https://t.example' }]))
		);
		expect(sources[0].title).toHaveLength(120);
	});

	it('collects urls nested in arbitrary objects', () => {
		const payload = { mixed: [{ deep: { url: 'https://deep.example' } }], meta: { url: 42 } };
		expect(extractSources(detail(JSON.stringify(payload)))).toEqual([
			{ title: 'deep.example', url: 'https://deep.example' }
		]);
	});

	it('returns [] for non-object detail, missing content, empty content, or non-string text', () => {
		expect(extractSources(null)).toEqual([]);
		expect(extractSources('string')).toEqual([]);
		expect(extractSources({ serverId: 'x' })).toEqual([]);
		expect(extractSources({ content: [] })).toEqual([]);
		expect(extractSources({ content: [{ type: 'image', data: '...' }] })).toEqual([]);
	});

	it('returns [] for foreign tool payloads without url fields', () => {
		expect(extractSources(detail(JSON.stringify({ stdout: 'hello', code: 0 })))).toEqual([]);
	});
});

describe('scanJsonValues', () => {
	it('parses a whole-string JSON object into a single value', () => {
		expect(scanJsonValues('{"a":1}')).toEqual([{ a: 1 }]);
	});

	it('parses a whole-string JSON array into a single value', () => {
		expect(scanJsonValues('[{"url":"https://a"},{"url":"https://b"}]')).toEqual([
			[{ url: 'https://a' }, { url: 'https://b' }]
		]);
	});

	it('splits concatenated top-level JSON values with no separator', () => {
		const text = '{"url":"https://a"}{"url":"https://b"}';
		expect(scanJsonValues(text)).toEqual([{ url: 'https://a' }, { url: 'https://b' }]);
	});

	it('splits a mix of objects, arrays, and scalars', () => {
		const text = '{"q":"ai"}[1,2]null42"done"';
		expect(scanJsonValues(text)).toEqual([{ q: 'ai' }, [1, 2], null, 42, 'done']);
	});

	it('does not split on braces inside string literals', () => {
		const text = '{"label":"a } b { c"}{"url":"https://x"}';
		expect(scanJsonValues(text)).toEqual([{ label: 'a } b { c' }, { url: 'https://x' }]);
	});

	it('handles escaped quotes inside strings', () => {
		const text = '{"label":"she said \\"}\\" nicely"}{"url":"https://y"}';
		expect(scanJsonValues(text)).toEqual([{ label: 'she said "}" nicely' }, { url: 'https://y' }]);
	});

	it('drops a truncated trailing value', () => {
		const text = '{"url":"https://a"}{"url":"https://b';
		expect(scanJsonValues(text)).toEqual([{ url: 'https://a' }]);
	});

	it('ignores whitespace between values', () => {
		const text = '{"a":1}\n  {"b":2}';
		expect(scanJsonValues(text)).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it('yields [] for empty, whitespace, or garbage input', () => {
		expect(scanJsonValues('')).toEqual([]);
		expect(scanJsonValues('   \n ')).toEqual([]);
		expect(scanJsonValues('not json at all')).toEqual([]);
	});

	it('never throws on adversarial input', () => {
		expect(() => scanJsonValues('{"a":')).not.toThrow();
		expect(() => scanJsonValues('}}}{{{')).not.toThrow();
		expect(() => scanJsonValues('{"s":"\\\\u"}{')).not.toThrow();
	});
});

describe('collectCards', () => {
	it('projects brave-shaped values into cards with stripped one-line descriptions', () => {
		const values = [
			{
				web: {
					results: [
						{
							title: 'Story One',
							url: 'https://example.com/1',
							description: '<strong>Bold</strong> intro\nsecond line'
						}
					]
				}
			}
		];
		expect(collectCards(values)).toEqual([
			{
				url: 'https://example.com/1',
				title: 'Story One',
				host: 'example.com',
				description: 'Bold intro second line',
				snippet: undefined
			}
		]);
	});

	it('captures snippet fields and falls back to host for missing titles', () => {
		const values = [{ url: 'https://bare.example/a', snippet: 'extra context' }];
		expect(collectCards(values)).toEqual([
			{
				url: 'https://bare.example/a',
				title: 'bare.example',
				host: 'bare.example',
				description: undefined,
				snippet: 'extra context'
			}
		]);
	});

	it('dedupes by URL preserving first occurrence', () => {
		const values = [
			{ title: 'First', url: 'https://dup.example/a' },
			{ title: 'Second', url: 'https://dup.example/a' }
		];
		const cards = collectCards(values);
		expect(cards).toHaveLength(1);
		expect(cards[0]?.title).toBe('First');
	});

	it('makes a bare url string value into a host-titled card', () => {
		expect(collectCards(['https://plain.example/x'])).toEqual([
			{ url: 'https://plain.example/x', title: 'plain.example', host: 'plain.example' }
		]);
	});

	it('adds page-url cards for source/origin alongside media urls', () => {
		const values = [
			{ title: 'Aurora', url: 'https://img.example/a.jpg', source: 'https://page.example' }
		];
		const cards = collectCards(values);
		expect(cards).toHaveLength(2);
		expect(cards[1]).toEqual({
			url: 'https://page.example',
			title: 'page.example',
			host: 'page.example'
		});
	});

	it('bounds the scan (50 cards max from pathological payloads)', () => {
		const values = [
			Array.from({ length: 80 }, (_, i) => ({ title: `R${i}`, url: `https://cap.example/${i}` }))
		];
		expect(collectCards(values)).toHaveLength(50);
	});

	it('returns [] for values without urls', () => {
		expect(collectCards([{ id: 1 }, 'plain text', 42, null])).toEqual([]);
	});
});
