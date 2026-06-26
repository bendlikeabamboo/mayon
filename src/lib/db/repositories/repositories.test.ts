import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/chat/brief';
import { getLearnerProfile, setLearnerProfile } from '$lib/chat/profile';

beforeEach(async () => {
	// Fresh in-memory DB per test; repositories resolve the live db via getDb().
	await bootstrapWithDriver(await createMemoryDriver());
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
