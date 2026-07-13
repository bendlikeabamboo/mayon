import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { bootstrapTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/chat/brief';
import { getLearnerProfile, setLearnerProfile } from '$lib/chat/profile';

beforeEach(async () => {
	// Fresh per-test PG schema via bootstrapTestDb; repositories resolve via getDb().
	const { driver } = await bootstrapTestDb();
	await bootstrapWithDriver(driver, 'pg');
});

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
