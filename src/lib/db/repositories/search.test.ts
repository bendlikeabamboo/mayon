import { beforeEach, describe, expect, it } from 'vitest';
import { repos } from '$lib/db';
import { renderSnippet, stripIndexNoise, buildMatchQuery, deepLink } from '$lib/db';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { bootstrapTestDb } from '$lib/db/driver/pg-test';

beforeEach(async () => {
	const { driver } = await bootstrapTestDb();
	await bootstrapWithDriver(driver, 'pg');
});

describe('search repository (P-pg-4 PG FTS)', () => {
	it('searchAvailable() returns true', async () => {
		expect(await repos.search.searchAvailable()).toBe(true);
	});

	it('searches a token in a message and returns a hit with highlighted snippet', async () => {
		const chat = await repos.chats.createRoot({
			title: 'Test Chat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		const msg = await repos.messages.append(
			chat.id,
			'assistant',
			'The quick brown fox jumps over the lazy dog.'
		);

		const hits = await repos.search.search('fox');
		expect(hits.length).toBeGreaterThanOrEqual(1);

		const msgHit = hits.find((h) => h.kind === 'message');
		expect(msgHit).toBeDefined();
		expect(msgHit!.chatId).toBe(chat.id);
		expect(msgHit!.refId).toBe(msg.id);

		const segs = renderSnippet(msgHit!.snippetBody);
		const markedSeg = segs.find((s) => s.mark && s.text.includes('fox'));
		expect(markedSeg).toBeDefined();
	});

	it('finds hits across labs and quiz_questions', async () => {
		const chat = await repos.chats.createRoot({
			title: 'LabChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		await repos.labs.create({
			chatId: chat.id,
			title: 'uniqueLabToken experiment',
			content: 'Description of the experiment'
		});
		const quiz = await repos.quizzes.create({ chatId: chat.id, model: 'gpt-4o' });
		await repos.quizQuestions.add({
			quizId: quiz.id,
			type: 'short',
			prompt: 'Explain uniqueQuizToken in detail',
			payload: { rubric: 'test' }
		});

		const hits = await repos.search.search('uniqueLabToken OR uniqueQuizToken');
		expect(hits.some((h) => h.kind === 'lab')).toBe(true);
		expect(hits.some((h) => h.kind === 'quiz_question')).toBe(true);
	});

	it('filters by kinds', async () => {
		const chat = await repos.chats.createRoot({
			title: 'FilterChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		await repos.messages.append(chat.id, 'assistant', 'labfiltertoken content');
		await repos.labs.create({
			chatId: chat.id,
			title: 'labfiltertoken lab title',
			content: 'lab body'
		});

		const allHits = await repos.search.search('labfiltertoken');
		expect(allHits.length).toBeGreaterThanOrEqual(2);

		const labHits = await repos.search.search('labfiltertoken', { kinds: ['lab'] });
		expect(labHits.length).toBeGreaterThanOrEqual(1);
		expect(labHits.every((h) => h.kind === 'lab')).toBe(true);
	});

	it('ranks results by relevance (higher rank first)', async () => {
		const chat = await repos.chats.createRoot({
			title: 'RankChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		await repos.messages.append(
			chat.id,
			'assistant',
			'ranktoken ranktoken ranktoken appears multiple times'
		);
		await repos.messages.append(chat.id, 'assistant', 'ranktoken appears once');

		const hits = await repos.search.search('ranktoken');
		const msgHits = hits.filter((h) => h.kind === 'message');
		expect(msgHits.length).toBeGreaterThanOrEqual(2);
		expect(msgHits[0].rank).toBeGreaterThanOrEqual(msgHits[msgHits.length - 1].rank);
	});

	it('strips mermaid code blocks from search index (noise stripping)', async () => {
		const chat = await repos.chats.createRoot({
			title: 'NoiseChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		await repos.messages.append(
			chat.id,
			'assistant',
			'```mermaid\ngraph LR\nA-->B\nuniquemermaidtoken\n``` some plain text here'
		);
		await repos.messages.append(chat.id, 'assistant', 'uniquemermaidtoken appears in plain text');

		const hits = await repos.search.search('uniquemermaidtoken');
		const msgHits = hits.filter((h) => h.kind === 'message');
		expect(msgHits.length).toBe(1);
		expect(msgHits[0].snippetBody).toContain('plain text');
	});

	it('strips $$...$$ display math from search index', async () => {
		const chat = await repos.chats.createRoot({
			title: 'MathChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		await repos.messages.append(chat.id, 'assistant', '$$uniquemathtoken$$ only in math block');
		await repos.messages.append(chat.id, 'assistant', 'uniquemathtoken in plain text');

		const hits = await repos.search.search('uniquemathtoken');
		const msgHits = hits.filter((h) => h.kind === 'message');
		expect(msgHits.length).toBe(1);
	});

	it('rebuildIndex() is a no-op', async () => {
		await expect(repos.search.rebuildIndex()).resolves.toBeUndefined();
	});

	it('search() returns empty for empty/whitespace query', async () => {
		expect(await repos.search.search('')).toEqual([]);
		expect(await repos.search.search('   ')).toEqual([]);
	});

	describe('pure helpers unchanged', () => {
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
				kind: 'message' as const,
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			};
			expect(deepLink(hit)).toBe('/chat/c1#m=r1');
		});

		it('deepLink chat → /chat/{refId}', () => {
			const hit = {
				kind: 'chat' as const,
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			};
			expect(deepLink(hit)).toBe('/chat/r1');
		});

		it('deepLink lab → /lab/{refId}', () => {
			const hit = {
				kind: 'lab' as const,
				chatId: 'c1',
				refId: 'r1',
				quizId: null,
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			};
			expect(deepLink(hit)).toBe('/lab/r1');
		});

		it('deepLink quiz_question → /quiz/{quizId}', () => {
			const hit = {
				kind: 'quiz_question' as const,
				chatId: 'c1',
				refId: 'r1',
				quizId: 'q1',
				title: '',
				chatTitle: null,
				rootId: null,
				snippetTitle: '',
				snippetBody: '',
				rank: 0
			};
			expect(deepLink(hit)).toBe('/quiz/q1');
		});
	});
});
