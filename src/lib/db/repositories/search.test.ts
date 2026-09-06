import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repos } from '$lib/db';
import { renderSnippet, stripIndexNoise, buildMatchQuery, deepLink } from '$lib/db';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import type { BranchArtifactMetadata } from '$lib/chat/kinds';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

function artifactMeta(overrides?: Partial<BranchArtifactMetadata>): string {
	const meta: BranchArtifactMetadata = {
		mode: 'raw',
		sourceChatId: 'branch-1',
		sourceChatTitle: 'Branch',
		branchPointMessageId: null,
		anchor: 'recorded',
		summaryTraceId: null,
		regeneratedAt: null,
		...overrides
	};
	return JSON.stringify(meta);
}

const IMAGE_BASE64_NOISE = 'zzQmFzZTY0Tm9pc2V6ejk5';

function imagePart(mime = 'image/jpeg') {
	return {
		type: 'image' as const,
		data: `data:${mime};base64,${IMAGE_BASE64_NOISE}`,
		mimeType: mime,
		width: 32,
		height: 32,
		bytes: 24
	};
}

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

	it('excludes tool_result rows from message search (kind filter)', async () => {
		const chat = await repos.chats.createRoot({
			title: 'KindFilterChat',
			provider: 'openai',
			model: 'gpt-4o'
		});
		const userMsg = await repos.messages.append(
			chat.id,
			'user',
			'uniquekindtok please read this file'
		);
		await repos.messages.appendToolResult(chat.id, {
			toolCallId: 'tc1',
			toolName: 'read_file',
			summary: 'uniquekindtok file contents here'
		});

		const hits = await repos.search.search('uniquekindtok');
		const msgHits = hits.filter((h) => h.kind === 'message');
		expect(msgHits.length).toBe(1);
		expect(msgHits[0].refId).toBe(userMsg.id);
	});

	describe('branch_artifact searchability (020 US4)', () => {
		it('finds a branch_artifact row by its payload text with highlighted snippet', async () => {
			const chat = await repos.chats.createRoot({
				title: 'ArtifactChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			await repos.messages.append(chat.id, 'user', 'parent turn one');
			await repos.messages.append(chat.id, 'assistant', 'parent turn two');
			const art = await repos.messages.insertAnchored(
				chat.id,
				{
					role: 'user',
					content: 'branchartifacttoken raw delta payload',
					kind: 'branch_artifact',
					metadata: artifactMeta()
				},
				{ afterOrd: 0, beforeOrd: 1 }
			);
			expect(art.ord).toBe(0.5);

			const hits = await repos.search.search('branchartifacttoken');
			const msgHit = hits.find((h) => h.kind === 'message');
			expect(msgHit).toBeDefined();
			expect(msgHit!.refId).toBe(art.id);
			expect(msgHit!.chatId).toBe(chat.id);

			const segs = renderSnippet(msgHit!.snippetBody);
			const markedSeg = segs.find((s) => s.mark && s.text.includes('branchartifacttoken'));
			expect(markedSeg).toBeDefined();
		});

		it('regular message results are identical before vs after an unrelated artifact row exists', async () => {
			const chat = await repos.chats.createRoot({
				title: 'StableChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			await repos.messages.append(chat.id, 'user', 'unperturbedtoken lives here');
			await repos.messages.append(chat.id, 'assistant', 'unperturbedtoken appears again');

			const before = await repos.search.search('unperturbedtoken');
			expect(before.filter((h) => h.kind === 'message').length).toBe(2);

			const other = await repos.chats.createRoot({
				title: 'OtherChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			const art = await repos.messages.insertAnchored(
				other.id,
				{
					role: 'user',
					content: 'artifactonlytoken unrelated payload',
					kind: 'branch_artifact',
					metadata: artifactMeta({ sourceChatId: other.id })
				},
				'start'
			);

			const after = await repos.search.search('unperturbedtoken');
			expect(after).toEqual(before);

			const artHits = await repos.search.search('artifactonlytoken');
			expect(artHits.filter((h) => h.kind === 'message').map((h) => h.refId)).toEqual([art.id]);
		});

		it('reasoning and tool_result rows remain non-searchable (unchanged behavior)', async () => {
			const chat = await repos.chats.createRoot({
				title: 'KindFilterChat2',
				provider: 'openai',
				model: 'gpt-4o'
			});
			const visible = await repos.messages.append(chat.id, 'user', 'visibletoken plain turn');
			await repos.messages.append(chat.id, 'assistant', 'hiddenreasoningtoken scratch pad', {
				kind: 'reasoning'
			});
			await repos.messages.appendToolResult(chat.id, {
				toolCallId: 'tc-ba',
				toolName: 'read_file',
				summary: 'hiddentooltoken file contents'
			});

			const visibleHits = await repos.search.search('visibletoken');
			expect(visibleHits.filter((h) => h.kind === 'message').map((h) => h.refId)).toEqual([
				visible.id
			]);

			for (const token of ['hiddenreasoningtoken', 'hiddentooltoken']) {
				const hits = await repos.search.search(token);
				expect(hits.filter((h) => h.kind === 'message')).toEqual([]);
			}
		});
	});

	describe('parts-bearing messages (018 FR-010 search invariant, real search_vec)', () => {
		it('finds a parts-bearing message by its text-part word with a ts_headline snippet', async () => {
			const chat = await repos.chats.createRoot({
				title: 'PartsChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			const text = 'quokka husbandry manual';
			const msg = await repos.messages.append(chat.id, 'user', text, {
				parts: [{ type: 'text', text }, imagePart(), { type: 'voice-memo' }]
			});

			const hits = await repos.search.search('quokka');
			const msgHit = hits.find((h) => h.kind === 'message' && h.refId === msg.id);
			expect(msgHit).toBeDefined();
			expect(msgHit!.chatId).toBe(chat.id);

			const segs = renderSnippet(msgHit!.snippetBody);
			const markedSeg = segs.find((s) => s.mark && s.text.includes('quokka'));
			expect(markedSeg).toBeDefined();
		});

		it('never matches image/base64 data from the parts JSON (control: text still matches)', async () => {
			const chat = await repos.chats.createRoot({
				title: 'PartsNoiseChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			const text = 'quokka husbandry manual';
			const msg = await repos.messages.append(chat.id, 'user', text, {
				parts: [{ type: 'text', text }, imagePart()]
			});

			const control = await repos.search.search('quokka');
			expect(control.some((h) => h.kind === 'message' && h.refId === msg.id)).toBe(true);

			for (const noise of [IMAGE_BASE64_NOISE, 'data:image']) {
				const hits = await repos.search.search(noise);
				expect(hits.filter((h) => h.kind === 'message' && h.refId === msg.id)).toEqual([]);
			}
		});

		it('appends an image-only message (content empty) that stays unsearchable while siblings match', async () => {
			const chat = await repos.chats.createRoot({
				title: 'ImageOnlyChat',
				provider: 'openai',
				model: 'gpt-4o'
			});
			const imgOnly = await repos.messages.append(chat.id, 'user', '', {
				parts: [imagePart('image/png')]
			});
			expect(imgOnly.content).toBe('');

			for (const noise of [IMAGE_BASE64_NOISE, 'data:image/png']) {
				const hits = await repos.search.search(noise);
				expect(hits.filter((h) => h.kind === 'message')).toEqual([]);
			}

			const sibling = await repos.messages.append(
				chat.id,
				'assistant',
				'platypus sibling still findable'
			);
			const hits = await repos.search.search('platypus');
			const siblingHit = hits.find((h) => h.kind === 'message' && h.refId === sibling.id);
			expect(siblingHit).toBeDefined();
		});
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
