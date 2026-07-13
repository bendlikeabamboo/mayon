import { describe, expect, it } from 'vitest';
import { repos } from '$lib/db';

describe('search repository (P-pg-2 stub)', () => {
	it('fts5Available() returns false', async () => {
		expect(await repos.search.fts5Available()).toBe(false);
	});

	it('search() returns empty array', async () => {
		const hits = await repos.search.search('anything');
		expect(hits).toEqual([]);
	});

	it('rebuildIndex() is a no-op', async () => {
		await expect(repos.search.rebuildIndex()).resolves.toBeUndefined();
	});

	describe('pure helpers unchanged', () => {
		let stripIndexNoise: typeof import('$lib/db').stripIndexNoise;
		let buildMatchQuery: typeof import('$lib/db').buildMatchQuery;
		let renderSnippet: typeof import('$lib/db').renderSnippet;
		let deepLink: typeof import('$lib/db').deepLink;

		it('loads helpers', async () => {
			const mod = await import('$lib/db');
			stripIndexNoise = mod.stripIndexNoise;
			buildMatchQuery = mod.buildMatchQuery;
			renderSnippet = mod.renderSnippet;
			deepLink = mod.deepLink;
		});

		it('stripIndexNoise strips mermaid fenced blocks', () => {
			const input = 'hello ```mermaid\ngraph LR\nA-->B\n``` world';
			expect(stripIndexNoise(input)).toBe('hello  world');
		});

		it('stripIndexNoise strips $$...$$ display math', () => {
			const input = 'before $$E=mc^2$$ after';
			expect(stripIndexNoise(input)).toBe('before  after');
		});

		it('stripIndexNoise strips $...$ inline math but not $$', () => {
			const input = 'text $x+y$ more $$z$$ end';
			expect(stripIndexNoise(input)).toBe('text  more  end');
		});

		it('stripIndexNoise keeps inline code and non-mermaid fenced code', () => {
			const input = '`code` ```typescript\nconst x=1;\n``` done';
			expect(stripIndexNoise(input)).toBe('`code` ```typescript\nconst x=1;\n``` done');
		});

		it('buildMatchQuery "foo bar" → \'"foo" "bar"\'', () => {
			expect(buildMatchQuery('foo bar')).toBe('"foo" "bar"');
		});

		it('buildMatchQuery empty or whitespace-only → null', () => {
			expect(buildMatchQuery('')).toBeNull();
			expect(buildMatchQuery('  ')).toBeNull();
		});

		it('buildMatchQuery special chars are safely quoted', () => {
			const result = buildMatchQuery('hello*:world');
			expect(result).toBe('"hello*:world"');
		});

		it('renderSnippet parses marked segments', () => {
			const input = 'hello \x01world\x02 goodbye';
			expect(renderSnippet(input)).toEqual([
				{ text: 'hello ', mark: false },
				{ text: 'world', mark: true },
				{ text: ' goodbye', mark: false }
			]);
		});

		it('renderSnippet no markers → single unmarked segment', () => {
			expect(renderSnippet('no markers')).toEqual([{ text: 'no markers', mark: false }]);
		});

		it('renderSnippet two marked segments', () => {
			expect(renderSnippet('\x01A\x02 \x01B\x02')).toEqual([
				{ text: 'A', mark: true },
				{ text: ' ', mark: false },
				{ text: 'B', mark: true }
			]);
		});

		it('deepLink message → /chat/{chatId}#m={refId}', () => {
			const hit = {
				kind: 'message',
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			} as const;
			expect(deepLink(hit)).toBe('/chat/c1#m=r1');
		});

		it('deepLink chat → /chat/{refId}', () => {
			const hit = {
				kind: 'chat',
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			} as const;
			expect(deepLink(hit)).toBe('/chat/r1');
		});

		it('deepLink lab → /lab/{refId}', () => {
			const hit = {
				kind: 'lab',
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			} as const;
			expect(deepLink(hit)).toBe('/lab/r1');
		});

		it('deepLink quiz_question → /quiz/{quizId}', () => {
			const hit = {
				kind: 'quiz_question',
				chatId: 'c1',
				refId: 'r1',
				quizId: 'q1',
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			} as const;
			expect(deepLink(hit)).toBe('/quiz/q1');
		});
	});
});
