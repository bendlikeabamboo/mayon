import { describe, expect, it } from 'vitest';
import { classifyResult } from './result-shape';

/** One Brave-shaped MCP content part: a web result with url nested via web.results. */
const bravePart = (n: number) =>
	JSON.stringify({
		query: { original: `query ${n}` },
		web: {
			results: [
				{
					title: `Story ${n}`,
					url: `https://example.com/${n}`,
					description: `<strong>Desc ${n}</strong>`
				}
			]
		}
	});

const urlValue = (n: number) => `{"url":"https://v.example/${n}"}`;
const noUrlValue = (n: number) => `{"id":${n}}`;

describe('classifyResult: records rule (S2)', () => {
	it('classifies concatenated web-search JSON as records with one value per part', () => {
		const summary = bravePart(1) + bravePart(2) + bravePart(3);
		const shape = classifyResult(summary, null);
		expect(shape?.kind).toBe('records');
		if (shape?.kind === 'records') expect(shape.values).toHaveLength(3);
	});

	it('classifies a single JSON object carrying an https url (nested) as records', () => {
		const shape = classifyResult('{"meta":{"url":"https://deep.example/a"}}', null);
		expect(shape?.kind).toBe('records');
	});

	it('counts a bare url string value as url-bearing', () => {
		const summary = '"https://plain.example/a"{"url":"https://v.example/1"}';
		expect(classifyResult(summary, null)?.kind).toBe('records');
	});

	it('boundary: exactly 60% url-bearing values → records', () => {
		const summary = urlValue(1) + urlValue(2) + urlValue(3) + noUrlValue(4) + noUrlValue(5);
		expect(classifyResult(summary, null)?.kind).toBe('records');
	});

	it('boundary: below 60% url-bearing values → json', () => {
		const summary = urlValue(1) + urlValue(2) + noUrlValue(3) + noUrlValue(4) + noUrlValue(5);
		expect(classifyResult(summary, null)?.kind).toBe('json');
	});

	it('ignores ftp/mailto urls in the ratio', () => {
		const summary =
			urlValue(1) +
			'{"url":"ftp://files.example"}{"url":"mailto:a@b.example"}' +
			noUrlValue(4) +
			noUrlValue(5);
		expect(classifyResult(summary, null)?.kind).toBe('json');
	});

	it('json without any url → json', () => {
		const shape = classifyResult('{"stdout":"hello","code":0}', null);
		expect(shape?.kind).toBe('json');
		if (shape?.kind === 'json') expect(shape.value).toEqual({ stdout: 'hello', code: 0 });
	});

	it('multiple non-record values render as a json array', () => {
		const shape = classifyResult(noUrlValue(1) + noUrlValue(2), null);
		expect(shape?.kind).toBe('json');
		if (shape?.kind === 'json') expect(shape.value).toEqual([{ id: 1 }, { id: 2 }]);
	});

	it('truncated trailing value contributes no record', () => {
		const summary = urlValue(1) + '{"url":"https://truncated.example/b';
		const shape = classifyResult(summary, null);
		expect(shape?.kind).toBe('records');
		if (shape?.kind === 'records') expect(shape.values).toHaveLength(1);
	});
});

describe('classifyResult: ladder floor (S5 / S1)', () => {
	it('long plain text → text', () => {
		const shape = classifyResult(`${'plain summary text '.repeat(20)}`, null);
		expect(shape?.kind).toBe('text');
		if (shape?.kind === 'text') expect(shape.text.length).toBeGreaterThan(160);
	});

	it('short prose → null (no expanded body)', () => {
		expect(classifyResult('Copied 3 items to the lab checklist.', null)).toBeNull();
	});

	it('empty summary → null', () => {
		expect(classifyResult('', null)).toBeNull();
	});
});

describe('classifyResult: detail overrides (rules 1–2)', () => {
	it('detail.markdown string → markdown', () => {
		const summary = '# Learning Brief\n\n- point one\n- point two';
		const shape = classifyResult(summary, { markdown: summary });
		expect(shape?.kind).toBe('markdown');
		if (shape?.kind === 'markdown') expect(shape.text).toBe(summary);
	});

	it('detail.mimeType text/markdown → markdown even when summary starts payload-like', () => {
		const summary = '{"looks":"like json"}';
		const shape = classifyResult(summary, { mimeType: 'text/markdown' });
		expect(shape?.kind).toBe('markdown');
	});

	it('detail.mimeType application/json → json beating markdown heuristics', () => {
		const summary = '# Heading\n\n```js\nconst x = 1;\n```';
		const shape = classifyResult(summary, { mimeType: 'application/json' });
		expect(shape?.kind).toBe('json');
	});
});

describe('classifyResult: markdown heuristics (rule 5)', () => {
	it('fenced code block → markdown', () => {
		const summary = 'Result below:\n\n```\ntotal 3 items\n```\n' + 'x'.repeat(150);
		expect(classifyResult(summary, null)?.kind).toBe('markdown');
	});

	it('heading line → markdown', () => {
		const summary = '## Quiz Outcome\n\nPassed with 4 of 5 correct. ' + 'y'.repeat(150);
		expect(classifyResult(summary, null)?.kind).toBe('markdown');
	});

	it('high link density (short) → markdown', () => {
		const summary = 'See [one](https://a.example) and [two](https://b.example) for detail.';
		expect(classifyResult(summary, null)?.kind).toBe('markdown');
	});

	it('high link density (long) → markdown', () => {
		const summary =
			'See [one](https://a.example) and [two](https://b.example) and [three](https://c.example) plus more prose following. ' +
			'z'.repeat(400);
		expect(classifyResult(summary, null)?.kind).toBe('markdown');
	});

	it('single bare URL in prose is not markdown', () => {
		const summary =
			'Read https://docs.example/guide for the full setup instructions ' + 'w'.repeat(150);
		expect(classifyResult(summary, null)?.kind).toBe('text');
	});

	it('JSON beats markdown heuristics (precedence)', () => {
		const summary = '{"note":"# not a heading\\n``` not a fence"}';
		const shape = classifyResult(summary, null);
		expect(shape?.kind).toBe('json');
	});
});

describe('classifyResult: degradation safety (US4)', () => {
	it('deeply nested JSON without urls → json', () => {
		const summary = JSON.stringify({ a: { b: { c: { d: [{ e: { f: 'g' } }] } } } });
		expect(classifyResult(summary, null)?.kind).toBe('json');
	});

	it('mixed text+JSON soup falls to the length floor', () => {
		const soup = `before {"a":1 middle} after ` + 'x'.repeat(200);
		expect(classifyResult(soup, null)?.kind).toBe('text');
	});

	it('never throws on adversarial input, including cyclic detail', () => {
		const cyclic: Record<string, unknown> = { mimeType: 'text/markdown' };
		cyclic.self = cyclic;
		expect(() => classifyResult('{"a":', cyclic)).not.toThrow();
		expect(() => classifyResult('}}}{{{', null)).not.toThrow();
		expect(() => classifyResult('x'.repeat(10_000), { markdown: 'm' })).not.toThrow();
	});

	it('empty summary with detail never throws', () => {
		expect(() => classifyResult('', { serverId: 's', content: [] })).not.toThrow();
		expect(classifyResult('', null)).toBeNull();
	});

	it('very long single-line text → text', () => {
		expect(classifyResult('h'.repeat(50_000), null)?.kind).toBe('text');
	});

	it('title field without a url does not make records', () => {
		const summary = JSON.stringify({ title: 'Report', body: 'no links here' });
		expect(classifyResult(summary, null)?.kind).toBe('json');
	});

	it('non-text content parts in detail do not affect classification', () => {
		const summary = JSON.stringify({ query: { original: 'ai' }, web: { results: [] } });
		const detail = {
			serverId: 'srv',
			toolName: 'search',
			content: [
				{ type: 'text', text: summary },
				{ type: 'image', data: 'iVBORw0K', mimeType: 'image/png' }
			]
		};
		expect(classifyResult(summary, detail)?.kind).toBe('json');
	});
});
