import { describe, expect, it } from 'vitest';
import { extractSources } from './sources';

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
