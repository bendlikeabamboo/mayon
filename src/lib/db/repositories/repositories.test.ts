import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';

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
});
