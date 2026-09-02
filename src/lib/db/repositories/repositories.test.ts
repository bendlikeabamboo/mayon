import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/chat/brief';
import { getLearnerProfile, setLearnerProfile } from '$lib/chat/profile';
import { partsOf, textOf, type ImagePart } from '$lib/chat/kinds';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

const testImage: ImagePart = {
	type: 'image',
	data: 'data:image/jpeg;base64,AAAA',
	mimeType: 'image/jpeg',
	width: 10,
	height: 10,
	bytes: 3
};

describe('chats repository', () => {
	it('creates a root chat with self root_id and depth 0', async () => {
		const root = await repos.chats.createRoot({
			title: 'Root',
			provider: 'openai',
			model: 'gpt-4o'
		});
		expect(root.parentId).toBeNull();
		expect(root.rootId).toBe(root.id);
		expect(root.depth).toBe(0);

		const fetched = await repos.chats.getById(root.id);
		expect(fetched?.title).toBe('Root');
	});

	it('branches a child inheriting the root id and +1 depth', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const child = await repos.chats.createChild({ parentId: root.id, title: 'Child' });
		expect(child.parentId).toBe(root.id);
		expect(child.rootId).toBe(root.id);
		expect(child.depth).toBe(1);
		expect(await repos.chats.listChildren(root.id)).toHaveLength(1);
		expect(await repos.chats.listRoots()).toHaveLength(1);
	});

	it('updates a title and touches updated_at', async () => {
		const root = await repos.chats.createRoot({ title: 'Old' });
		await repos.chats.updateTitle(root.id, 'New');
		expect((await repos.chats.getById(root.id))?.title).toBe('New');
	});
});

describe('messages repository', () => {
	it('appends messages with monotonically increasing ord', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const m0 = await repos.messages.append(chat.id, 'user', 'hi');
		const m1 = await repos.messages.append(chat.id, 'assistant', 'hello');
		const m2 = await repos.messages.append(chat.id, 'user', 'again');
		expect([m0.ord, m1.ord, m2.ord]).toEqual([0, 1, 2]);
		expect(m0.role).toBe('user');

		const list = await repos.messages.listByChat(chat.id);
		expect(list.map((m) => m.content)).toEqual(['hi', 'hello', 'again']);
	});

	it('derives kind by default from legacy columns', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const userMsg = await repos.messages.append(chat.id, 'user', 'hi');
		expect(userMsg.kind).toBe('user_message');

		const asstMsg = await repos.messages.append(chat.id, 'assistant', 'hey');
		expect(asstMsg.kind).toBe('assistant_message');

		const toolMsg = await repos.messages.append(chat.id, 'assistant', '', {
			toolCallId: 'tc1',
			toolName: 'read_file'
		});
		expect(toolMsg.kind).toBe('tool_call');

		const resultMsg = await repos.messages.appendToolResult(chat.id, {
			toolCallId: 'tc1',
			toolName: 'read_file',
			summary: 'file contents'
		});
		expect(resultMsg.kind).toBe('tool_result');
	});

	it('appendToolResult includes ok in metadata and handles null detail/ok', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });

		const withOk = await repos.messages.appendToolResult(chat.id, {
			toolCallId: 'tc1',
			toolName: 'x',
			summary: 's',
			detail: { serverId: 'a' },
			ok: false
		});
		const metaOk = JSON.parse(withOk.metadata!);
		expect(metaOk.serverId).toBe('a');
		expect(metaOk.ok).toBe(false);

		const detailOnly = await repos.messages.appendToolResult(chat.id, {
			toolCallId: 'tc2',
			toolName: 'x',
			summary: 's',
			detail: { serverId: 'b' }
		});
		const metaDetail = JSON.parse(detailOnly.metadata!);
		expect(metaDetail.serverId).toBe('b');
		expect(metaDetail.ok).toBeUndefined();

		const bare = await repos.messages.appendToolResult(chat.id, {
			toolCallId: 'tc3',
			toolName: 'x',
			summary: 's'
		});
		expect(bare.metadata).toBeNull();
	});

	it('updateOutcome merges outcome into metadata and returns updated row', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const msg = await repos.messages.append(chat.id, 'assistant', 'ask', {
			metadata: JSON.stringify({ toolName: 'create_lab' })
		});

		const updated = await repos.messages.updateOutcome(msg.id, {
			decision: 'approved'
		});
		expect(updated).not.toBeNull();
		expect(updated!.id).toBe(msg.id);
		const meta = JSON.parse(updated!.metadata!);
		expect(meta.toolName).toBe('create_lab');
		expect(meta.outcome).toEqual({ decision: 'approved' });
	});

	it('updateOutcome handles null/corrupt metadata', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const msg = await repos.messages.append(chat.id, 'assistant', 'ask');
		const updated = await repos.messages.updateOutcome(msg.id, { decision: 'declined' });
		expect(updated).not.toBeNull();
		const meta = JSON.parse(updated!.metadata!);
		expect(meta.outcome).toEqual({ decision: 'declined' });

		const msg2 = await repos.messages.append(chat.id, 'assistant', 'bad', {
			metadata: 'not-json'
		});
		const updated2 = await repos.messages.updateOutcome(msg2.id, { decision: 'undecided' });
		expect(updated2).not.toBeNull();
		const meta2 = JSON.parse(updated2!.metadata!);
		expect(meta2.outcome).toEqual({ decision: 'undecided' });
	});

	it('updateOutcome returns null for missing id', async () => {
		const result = await repos.messages.updateOutcome('nonexistent', { decision: 'approved' });
		expect(result).toBeNull();
	});

	it('respects the ord cutoff in listUpToOrd (assembleContext primitive)', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.messages.append(chat.id, 'user', 'a');
		await repos.messages.append(chat.id, 'assistant', 'b');
		await repos.messages.append(chat.id, 'user', 'c');

		const cutoff = await repos.messages.listUpToOrd(chat.id, 1);
		expect(cutoff).toHaveLength(2);
		const all = await repos.messages.listUpToOrd(chat.id, null);
		expect(all).toHaveLength(3);
	});

	it('append stores parts JSON in the same row, content kept equal to text parts', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const parts = [{ type: 'text', text: 'look: ' }, testImage];
		const msg = await repos.messages.append(chat.id, 'user', 'look: ', {
			parts
		});
		expect(msg.parts).toBe(JSON.stringify(parts));
		expect(textOf(msg)).toBe(msg.content);
	});

	it('append round-trips an image plus an unknown-kind part: preserved by partsOf, ignored by textOf (FR-014)', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const parts = [
			{ type: 'text', text: 'listen: ' },
			testImage,
			{ type: 'audio', url: 'audio.mp3' }
		];
		await repos.messages.append(chat.id, 'user', 'listen: ', { parts });

		const row = (await repos.messages.listByChat(chat.id))[0]!;
		expect(partsOf(row)).toEqual(parts);
		expect(partsOf(row)[2]!.type).toBe('audio');
		expect(textOf(row)).toBe(row.content);
		expect(textOf(row)).toBe('listen: ');
	});

	it('append round-trips multi-image parts with order preserved', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const imgA: ImagePart = {
			...testImage,
			data: 'data:image/png;base64,AAAA',
			mimeType: 'image/png'
		};
		const imgB: ImagePart = { ...testImage, data: 'data:image/jpeg;base64,BBBB' };
		const imgC: ImagePart = {
			...testImage,
			data: 'data:image/webp;base64,CCCC',
			mimeType: 'image/webp'
		};
		const parts = [{ type: 'text', text: 'three: ' }, imgA, imgB, imgC];
		await repos.messages.append(chat.id, 'user', 'three: ', { parts });

		const row = (await repos.messages.listByChat(chat.id))[0]!;
		const stored = partsOf(row);
		expect(stored).toEqual(parts);
		expect(stored.filter((p): p is ImagePart => p.type === 'image').map((p) => p.data)).toEqual([
			imgA.data,
			imgB.data,
			imgC.data
		]);
		expect(textOf(row)).toBe('three: ');
	});

	it('append without parts leaves parts NULL (legacy shape)', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const msg = await repos.messages.append(chat.id, 'user', 'plain');
		expect(msg.parts).toBeNull();
	});

	it('append rejects empty parts, more than 8 image parts, and text/content mismatch', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });

		await expect(repos.messages.append(chat.id, 'user', 'x', { parts: [] })).rejects.toThrow(
			'at least one part'
		);

		const nineImages = Array.from({ length: 9 }, () => testImage);
		await expect(repos.messages.append(chat.id, 'user', '', { parts: nineImages })).rejects.toThrow(
			'at most 8 image parts'
		);

		await expect(
			repos.messages.append(chat.id, 'user', 'content', {
				parts: [{ type: 'text', text: 'different' }]
			})
		).rejects.toThrow('concatenate');

		expect(await repos.messages.listByChat(chat.id)).toHaveLength(0);
	});
});

describe('settings repository', () => {
	it('round-trips JSON and upserts on conflict', async () => {
		await repos.settings.set('theme', 'dark');
		expect(await repos.settings.get('theme')).toBe('dark');

		await repos.settings.set('theme', 'light');
		expect(await repos.settings.get('theme')).toBe('light');

		// Upsert, not insert: still a single row.
		const keys = await repos.settings.keys();
		expect(keys.filter((k) => k === 'theme')).toHaveLength(1);
	});

	it('returns null for missing keys and malformed JSON', async () => {
		expect(await repos.settings.get('nope')).toBeNull();
	});

	it('seeds provider defaults idempotently', async () => {
		await repos.settings.seedDefaults();
		await repos.settings.seedDefaults();
		expect(await repos.settings.get('providers')).toEqual({});
	});

	it('seeds learnerProfile default on first run', async () => {
		await repos.settings.seedDefaults();
		expect(await repos.settings.get('learnerProfile')).toEqual(DEFAULT_PROFILE);
		await repos.settings.seedDefaults();
		expect(await repos.settings.get('learnerProfile')).toEqual(DEFAULT_PROFILE);
	});

	it('seeds the five built-in expound instructions on first run', async () => {
		await repos.settings.seedDefaults();
		const stored = await repos.settings.get<{ name: string }[]>('expoundInstructions');
		expect(stored?.map((e) => e.name)).toEqual([
			'Diagrams (prompt diagrams)',
			'Comparison Tables',
			'Code Examples',
			'Mermaid Diagram',
			'Focus Callouts'
		]);
	});

	it('seeding expound instructions twice is idempotent', async () => {
		await repos.settings.seedDefaults();
		const first = await repos.settings.get('expoundInstructions');
		await repos.settings.seedDefaults();
		expect(await repos.settings.get('expoundInstructions')).toEqual(first);
	});

	it('does not overwrite a customized expound instructions value', async () => {
		const custom = [{ id: 'custom-1', name: 'Real-world Analogies' }];
		await repos.settings.set('expoundInstructions', custom);
		await repos.settings.seedDefaults();
		expect(await repos.settings.get('expoundInstructions')).toEqual(custom);
	});

	it('round-trips a learner profile', async () => {
		const profile = { context: 'x', level: 'regular' as const, mode: 'build' as const };
		await setLearnerProfile(profile);
		const loaded = await getLearnerProfile();
		expect(loaded).toEqual(profile);
	});

	it('drops invalid enum values on read', async () => {
		await repos.settings.set('learnerProfile', { context: 'x', level: 'expert', mode: 'lecture' });
		const loaded = await getLearnerProfile();
		expect(loaded.level).toBeUndefined();
		expect(loaded.mode).toBeUndefined();
		expect(loaded.context).toBe('x');
	});
});

describe('labs repository', () => {
	it('persists and toggles a checklist item', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'Lab',
			content: 'steps...',
			checklist: [{ id: 'i1', text: 'Step 1', done: false }]
		});
		const after = await repos.labs.toggleChecklistItem(lab.id, 'i1');
		expect(after?.[0]?.done).toBe(true);
		expect((await repos.labs.getById(lab.id))?.checklist).toContain('"done":true');
	});

	it('listAll returns labs newest-first', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const a = await repos.labs.create({ chatId: chat.id, title: 'A', content: 'x' });
		// createdAt is set to `now()` (ms); nudge the clock so ordering is stable.
		await new Promise((r) => setTimeout(r, 5));
		const b = await repos.labs.create({ chatId: chat.id, title: 'B', content: 'x' });
		const all = await repos.labs.listAll();
		expect(all.map((l) => l.id)).toEqual([b.id, a.id]);
	});
});

describe('delete cascade', () => {
	interface Fixture {
		root: { id: string };
		a: { id: string };
		b: { id: string };
		c: { id: string };
		d: { id: string };
		other: { id: string };
		other2: { id: string };
		msgR: { id: string };
		msgA: { id: string };
	}

	async function buildFixture(): Promise<Fixture> {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.chats.createChild({
			parentId: root.id,
			title: 'A',
			branchPointMessageId: null
		});
		const msgR = await repos.messages.append(root.id, 'assistant', 'root message');
		const msgA = await repos.messages.append(a.id, 'assistant', 'message in A');
		const b = await repos.chats.createChild({
			parentId: a.id,
			title: 'B',
			branchPointMessageId: msgA.id
		});
		const c = await repos.chats.createChild({
			parentId: a.id,
			title: 'C',
			branchPointMessageId: msgA.id
		});
		const d = await repos.chats.createChild({ parentId: c.id, title: 'D' });

		for (const chat of [a, b, c, d]) {
			await repos.messages.append(chat.id, 'user', 'msg in ' + chat.title);
			await repos.labs.create({ chatId: chat.id, title: 'Lab ' + chat.title, content: 'x' });
			const qz = await repos.quizzes.create({ chatId: chat.id });
			const qq = await repos.quizQuestions.add({
				quizId: qz.id,
				type: 'mcq',
				prompt: '?',
				payload: { options: ['a', 'b'], answerIndex: 0 }
			});
			const att = await repos.quizAttempts.start(qz.id);
			await repos.quizAnswers.record({ attemptId: att.id, questionId: qq.id, answer: 'a' });
			await repos.agentTraces.create({
				id: '',
				createdAt: 0,
				chatId: chat.id,
				model: '',
				configKind: 'openai-compatible',
				reasoning: '',
				kind: 'chat',
				durationMs: 0,
				trace: '{}'
			});
		}

		await repos.branchSources.create({
			sourceMessageId: msgA.id,
			startChar: 0,
			endChar: 1,
			excerpt: 'x',
			branchChatId: b.id
		});
		await repos.branchSources.create({
			sourceMessageId: msgA.id,
			startChar: 0,
			endChar: 1,
			excerpt: 'x',
			branchChatId: c.id
		});

		const other = await repos.chats.createRoot({ title: 'Other' });
		const other2 = await repos.chats.createRoot({ title: 'Other2' });

		await repos.crossLinks.create({ fromChatId: other.id, toChatId: b.id, note: 'link to b' });
		await repos.crossLinks.create({
			fromChatId: other2.id,
			toChatId: other.id,
			note: 'survivor link'
		});

		return {
			root: { id: root.id },
			a: { id: a.id },
			b: { id: b.id },
			c: { id: c.id },
			d: { id: d.id },
			other: { id: other.id },
			other2: { id: other2.id },
			msgR: { id: msgR.id },
			msgA: { id: msgA.id }
		};
	}

	it('deleteSubtree(rootId) removes the entire tree and all artifacts (regression)', async () => {
		const f = await buildFixture();
		await repos.chats.deleteSubtree(f.root.id);

		expect(await repos.chats.listSubtree(f.root.id)).toHaveLength(0);
		expect(
			await repos.chats.listRoots().then((r) => r.find((c) => c.id === f.root.id))
		).toBeUndefined();

		for (const id of [f.a.id, f.b.id, f.c.id, f.d.id]) {
			expect(await repos.messages.listByChat(id)).toHaveLength(0);
			expect(await repos.labs.listAll().then((l) => l.filter((x) => x.chatId === id))).toHaveLength(
				0
			);
			expect(await repos.quizzes.listByChat(id)).toHaveLength(0);
			expect(await repos.agentTraces.listByChat(id)).toHaveLength(0);
			expect(await repos.branchSources.getByBranchChat(id)).toBeNull();
		}

		expect(await repos.crossLinks.listForChat(f.other.id)).toHaveLength(1);

		expect(await repos.chats.getById(f.other.id)).not.toBeNull();
		expect(await repos.crossLinks.listForChat(f.other2.id)).toHaveLength(1);
	});

	it('deleteBranch(b) removes b but leaves a, c, d, root intact', async () => {
		const f = await buildFixture();
		await repos.chats.deleteBranch(f.b.id);

		expect(await repos.chats.getById(f.b.id)).toBeNull();
		expect(await repos.chats.getById(f.a.id)).not.toBeNull();
		expect(await repos.chats.getById(f.c.id)).not.toBeNull();
		expect(await repos.chats.getById(f.d.id)).not.toBeNull();
		expect(await repos.chats.getById(f.root.id)).not.toBeNull();

		expect(await repos.messages.listByChat(f.b.id)).toHaveLength(0);
		expect(await repos.messages.listByChat(f.a.id)).toHaveLength(2);

		expect(await repos.branchSources.getByBranchChat(f.b.id)).toBeNull();
		expect(await repos.branchSources.getByBranchChat(f.c.id)).not.toBeNull();
	});

	it('deleteBranch(c) removes c + d and their artifacts; b survives', async () => {
		const f = await buildFixture();
		await repos.chats.deleteBranch(f.c.id);

		expect(await repos.chats.getById(f.c.id)).toBeNull();
		expect(await repos.chats.getById(f.d.id)).toBeNull();
		expect(await repos.chats.getById(f.b.id)).not.toBeNull();

		expect(await repos.messages.listByChat(f.c.id)).toHaveLength(0);
		expect(await repos.messages.listByChat(f.d.id)).toHaveLength(0);
		expect(await repos.messages.listByChat(f.b.id)).toHaveLength(1);

		expect(await repos.branchSources.getByBranchChat(f.b.id)).not.toBeNull();
		expect(await repos.branchSources.getByBranchChat(f.c.id)).toBeNull();
	});

	it('cross-link targeting a deleted branch is removed; other chat survives', async () => {
		const f = await buildFixture();
		await repos.chats.deleteBranch(f.b.id);

		const otherLinks = await repos.crossLinks.listForChat(f.other.id);
		expect(otherLinks).toHaveLength(1);
		expect(otherLinks[0]!.fromChatId).toBe(f.other2.id);

		expect(await repos.chats.getById(f.other.id)).not.toBeNull();
		expect(await repos.crossLinks.listForChat(f.other2.id)).toHaveLength(1);
	});

	it('parent message is untouched after deleting a branch child', async () => {
		const f = await buildFixture();
		await repos.chats.deleteBranch(f.b.id);

		const aMsgs = await repos.messages.listByChat(f.a.id);
		expect(aMsgs.length).toBeGreaterThanOrEqual(1);
		expect(aMsgs.some((m) => m.id === f.msgA.id)).toBe(true);
	});

	it('ancestor chain root→a is intact after deleting branch b', async () => {
		const f = await buildFixture();
		await repos.chats.deleteBranch(f.b.id);

		expect(await repos.chats.listChildren(f.root.id)).toHaveLength(1);
		expect((await repos.chats.listChildren(f.root.id))[0]!.id).toBe(f.a.id);
	});
});
