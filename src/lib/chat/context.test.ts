import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { assembleContext } from './context';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

/**
 * Helper: build a chat with an ordered set of (role, content) messages.
 * Returns the chat plus the appended messages so tests can reference ords/ids.
 */
async function seedChat(
	title: string,
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
) {
	const chat = await repos.chats.createRoot({ title });
	const rows = [];
	for (const m of messages) rows.push(await repos.messages.append(chat.id, m.role, m.content));
	return { chat, messages: rows };
}

describe('assembleContext', () => {
	it('returns the chat own messages when it is a root', async () => {
		const { chat } = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const ctx = await assembleContext(chat.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1']);
		expect(ctx.every((m) => m.role !== 'system')).toBe(true);
	});

	it('includes ancestor messages up to the branch-point cutoff and excludes the rest', async () => {
		// Root: u0, a1, u2, a3, u4   (ords 0..4)
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' },
			{ role: 'user', content: 'u4' }
		]);
		// Child branches off root at message a1 (ord 1). It should see root's
		// u0..a1, but NOT u2/a3/u4.
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		await repos.messages.append(child.id, 'assistant', 'c1');

		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0', 'c1']);
	});

	it('walks multiple ancestors (grandchild) applying each cutoff', async () => {
		// Root: u0, a1, u2, a3   (ords 0..3)
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'u2' },
			{ role: 'assistant', content: 'a3' }
		]);
		// Child branches at a3 (ord 3) → sees all of root.
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[3].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		await repos.messages.append(child.id, 'assistant', 'c1');
		await repos.messages.append(child.id, 'user', 'c2'); // after the grandchild's fork

		// Grandchild branches off child at c1 (ord 1) → sees child's c0,c1 (not c2)
		// plus all of root.
		const grand = await repos.chats.createChild({
			parentId: child.id,
			branchPointMessageId: (await repos.messages.listByChat(child.id))[1].id,
			title: 'Grand'
		});
		await repos.messages.append(grand.id, 'user', 'g0');

		const ctx = await assembleContext(grand.id);
		// Ordered by depth asc, then ord asc: root (0..3), child (0..1), grand (0).
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'u2', 'a3', 'c0', 'c1', 'g0']);
	});

	it('sorts parts by depth asc then ord asc', async () => {
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');

		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0']);
	});

	it('injects the branch excerpt as a leading system note when a branch_source exists', async () => {
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'the highlighted span here' },
			{ role: 'user', content: 'u2' }
		]);
		const branchMessage = root.messages[1];
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: branchMessage.id,
			title: 'Child'
		});
		await repos.branchSources.create({
			sourceMessageId: branchMessage.id,
			startChar: 0,
			endChar: 19,
			excerpt: 'the highlighted span',
			branchChatId: child.id
		});
		await repos.messages.append(child.id, 'user', 'c0');

		const ctx = await assembleContext(child.id);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('the highlighted span');
		// The excerpt note leads, then the assembled history.
		expect(ctx.map((m) => m.content)).toEqual([
			expect.stringContaining('the highlighted span'),
			'u0',
			'the highlighted span here',
			'c0'
		]);
	});

	it('omits the system note when there is no branch_source', async () => {
		const root = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
		const ctx = await assembleContext(root.chat.id);
		expect(ctx.every((m) => m.role !== 'system')).toBe(true);
	});

	it('throws when the target chat does not exist', async () => {
		await expect(assembleContext('nope')).rejects.toThrow(/not found/);
	});

	it('treats a root ancestor (null branch point) as "include all" of its messages', async () => {
		// A child branching at the LAST root message should see every root message.
		const root = await seedChat('Root', [
			{ role: 'user', content: 'u0' },
			{ role: 'assistant', content: 'a1' }
		]);
		const child = await repos.chats.createChild({
			parentId: root.chat.id,
			branchPointMessageId: root.messages[1].id,
			title: 'Child'
		});
		await repos.messages.append(child.id, 'user', 'c0');
		const ctx = await assembleContext(child.id);
		expect(ctx.map((m) => m.content)).toEqual(['u0', 'a1', 'c0']);
	});
});
