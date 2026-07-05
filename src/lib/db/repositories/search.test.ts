import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver, getDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { stripIndexNoise, buildMatchQuery, renderSnippet, deepLink, type SearchHit } from '$lib/db';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

describe('search repository', () => {
	it('FTS5 gate — fts5Available() returns true', async () => {
		expect(await repos.search.fts5Available()).toBe(true);
	});

	it('trigger sync — message insert, update, delete propagate to FTS', async () => {
		const chat = await repos.chats.createRoot({ title: 'Chat' });
		const msg = await repos.messages.append(chat.id, 'user', 'uniqueword here');

		let hits = await repos.search.search('uniqueword');
		expect(hits.length).toBeGreaterThanOrEqual(1);
		expect(hits.some((h) => h.refId === msg.id && h.kind === 'message')).toBe(true);

		await getDriver().exec(
			"UPDATE messages SET content = 'completely different text' WHERE id = '" + msg.id + "'"
		);
		hits = await repos.search.search('uniqueword');
		expect(hits.find((h) => h.refId === msg.id)).toBeUndefined();

		await repos.messages.delete(msg.id);
		hits = await repos.search.search('uniqueword');
		expect(hits.find((h) => h.refId === msg.id)).toBeUndefined();
	});

	it('trigger sync — chat title searchable', async () => {
		const chat = await repos.chats.createRoot({ title: 'uniquechattitlexyz' });
		const hits = await repos.search.search('uniquechattitlexyz');
		expect(hits.some((h) => h.kind === 'chat' && h.refId === chat.id)).toBe(true);
	});

	it('trigger sync — lab searchable by content', async () => {
		const chat = await repos.chats.createRoot({ title: 'Chat' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'Lab',
			content: 'uniquelabcontentxyz'
		});
		const hits = await repos.search.search('uniquelabcontentxyz');
		expect(hits.some((h) => h.kind === 'lab' && h.refId === lab.id)).toBe(true);
	});

	it('trigger sync — quiz_question searchable by prompt', async () => {
		const chat = await repos.chats.createRoot({ title: 'Chat' });
		const quiz = await repos.quizzes.create({ chatId: chat.id });
		const qq = await repos.quizQuestions.add({
			quizId: quiz.id,
			type: 'mcq',
			prompt: 'uniquequizpromptxyz',
			payload: { options: ['a', 'b'], answerIndex: 0 }
		});
		const hits = await repos.search.search('uniquequizpromptxyz');
		expect(hits.some((h) => h.kind === 'quiz_question' && h.refId === qq.id)).toBe(true);
	});

	it('cascade consistency — deleteBranch removes child messages from search', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const msgRoot = await repos.messages.append(root.id, 'user', 'rootword998877');

		const a = await repos.chats.createChild({ parentId: root.id, title: 'A' });
		const msgA = await repos.messages.append(a.id, 'user', 'aword887766');

		const b = await repos.chats.createChild({ parentId: a.id, title: 'B' });
		const msgB = await repos.messages.append(b.id, 'user', 'bword776655');

		await repos.chats.deleteBranch(b.id);

		const hitsB = await repos.search.search('bword776655');
		expect(hitsB.find((h) => h.refId === msgB.id)).toBeUndefined();

		const hitsRoot = await repos.search.search('rootword998877');
		expect(hitsRoot.some((h) => h.refId === msgRoot.id)).toBe(true);

		const hitsA = await repos.search.search('aword887766');
		expect(hitsA.some((h) => h.refId === msgA.id)).toBe(true);
	});

	it('rebuildIndex idempotent + strips noise', async () => {
		const chat = await repos.chats.createRoot({ title: 'Chat' });
		const content = 'before ```mermaid\nclassDiagram\nA --> B\n``` after $$E=mc^2$$ and $x+y$ here';
		await repos.messages.append(chat.id, 'user', content);

		const mermaidToken = 'classDiagram';
		const katexToken = 'E=mc';

		let hitsMermaid = await repos.search.search(mermaidToken);
		expect(hitsMermaid.length).toBeGreaterThanOrEqual(1);

		let hitsKatex = await repos.search.search(katexToken);
		expect(hitsKatex.length).toBeGreaterThanOrEqual(1);

		await repos.search.rebuildIndex();

		hitsMermaid = await repos.search.search(mermaidToken);
		expect(hitsMermaid.length).toBe(0);

		hitsKatex = await repos.search.search(katexToken);
		expect(hitsKatex.length).toBe(0);

		await repos.search.rebuildIndex();

		hitsMermaid = await repos.search.search(mermaidToken);
		expect(hitsMermaid.length).toBe(0);

		const hitsBefore = await repos.search.search('before');
		expect(hitsBefore.length).toBeGreaterThanOrEqual(1);
	});

	it('bm25 ranking — closer match ranks higher', async () => {
		const chat = await repos.chats.createRoot({ title: 'Chat' });
		await repos.messages.append(chat.id, 'user', 'alpha beta gamma delta');
		await repos.messages.append(chat.id, 'user', 'alpha');

		const hits = await repos.search.search('alpha');
		expect(hits.length).toBeGreaterThanOrEqual(2);

		const alphaOnly = hits.find((h) => h.kind === 'message' && h.snippetBody.includes('alpha'));
		const alphaWithMany = hits.find((h) => h.kind === 'message' && h.snippetBody.includes('beta'));

		if (alphaOnly && alphaWithMany) {
			expect(alphaOnly.rank).toBeLessThan(alphaWithMany.rank);
		}
	});

	describe('stripIndexNoise (pure)', () => {
		it('strips mermaid fenced blocks', () => {
			const input = 'hello ```mermaid\ngraph LR\nA-->B\n``` world';
			expect(stripIndexNoise(input)).toBe('hello  world');
		});

		it('strips $$...$$ display math', () => {
			const input = 'before $$E=mc^2$$ after';
			expect(stripIndexNoise(input)).toBe('before  after');
		});

		it('strips $...$ inline math but not $$', () => {
			const input = 'text $x+y$ more $$z$$ end';
			expect(stripIndexNoise(input)).toBe('text  more  end');
		});

		it('keeps inline code and non-mermaid fenced code', () => {
			const input = '`code` ```typescript\nconst x=1;\n``` done';
			expect(stripIndexNoise(input)).toBe('`code` ```typescript\nconst x=1;\n``` done');
		});
	});

	describe('buildMatchQuery (pure)', () => {
		it('"foo bar" → \'"foo" "bar"\'', () => {
			expect(buildMatchQuery('foo bar')).toBe('"foo" "bar"');
		});

		it('empty or whitespace-only → null', () => {
			expect(buildMatchQuery('')).toBeNull();
			expect(buildMatchQuery('  ')).toBeNull();
		});

		it('special chars are safely quoted', () => {
			const result = buildMatchQuery('hello*:world');
			expect(result).toBe('"hello*:world"');
		});
	});

	describe('renderSnippet (pure)', () => {
		it('parses marked segments', () => {
			const input = 'hello \x01world\x02 goodbye';
			expect(renderSnippet(input)).toEqual([
				{ text: 'hello ', mark: false },
				{ text: 'world', mark: true },
				{ text: ' goodbye', mark: false }
			]);
		});

		it('no markers → single unmarked segment', () => {
			expect(renderSnippet('no markers')).toEqual([{ text: 'no markers', mark: false }]);
		});

		it('two marked segments', () => {
			expect(renderSnippet('\x01A\x02 \x01B\x02')).toEqual([
				{ text: 'A', mark: true },
				{ text: ' ', mark: false },
				{ text: 'B', mark: true }
			]);
		});
	});

	describe('deepLink (pure)', () => {
		it('message → /chat/{chatId}#m={refId}', () => {
			const hit: SearchHit = {
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
			};
			expect(deepLink(hit)).toBe('/chat/c1#m=r1');
		});

		it('chat → /chat/{refId}', () => {
			const hit: SearchHit = {
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
			};
			expect(deepLink(hit)).toBe('/chat/r1');
		});

		it('lab → /lab/{refId}', () => {
			const hit: SearchHit = {
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
			};
			expect(deepLink(hit)).toBe('/lab/r1');
		});

		it('quiz_question → /quiz/{quizId}', () => {
			const hit: SearchHit = {
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
			};
			expect(deepLink(hit)).toBe('/quiz/q1');
		});
	});
});
