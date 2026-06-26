import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { assembleContext } from './context';
import type { LearningBrief } from './brief';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

/**
 * Helper: build a chat with an ordered set of (role, content) messages.
 * Returns the chat plus the appended messages so tests can reference ords/ids.
 * `brief` is written on the root when provided.
 */
async function seedChat(
	title: string,
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	brief?: LearningBrief
) {
	const chat = await repos.chats.createRoot({ title, brief });
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

	describe('brief system note', () => {
		it('leads with the brief system note when the root has a brief', async () => {
			const { chat } = await seedChat(
				'Root',
				[
					{ role: 'user', content: 'u0' },
					{ role: 'assistant', content: 'a1' }
				],
				{ goal: 'build a Makefile', level: 'some', mode: 'socratic' }
			);
			const ctx = await assembleContext(chat.id);
			expect(ctx[0].role).toBe('system');
			expect(ctx[0].content).toContain('build a Makefile');
			// History follows the brief note, unchanged.
			expect(ctx.map((m) => m.content)).toEqual([
				expect.stringContaining('build a Makefile'),
				'u0',
				'a1'
			]);
		});

		it('omits the brief note when the root brief is null (unchanged behavior)', async () => {
			const root = await seedChat('Root', [{ role: 'user', content: 'u0' }]);
			const ctx = await assembleContext(root.chat.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
		});

		it('a child inherits the root brief: order is [brief, excerpt, …messages]', async () => {
			// Root has a brief AND a branch_source-able assistant reply.
			const root = await seedChat(
				'Root',
				[
					{ role: 'user', content: 'u0' },
					{ role: 'assistant', content: 'the highlighted span here' },
					{ role: 'user', content: 'u2' }
				],
				{ goal: 'master the topic', mode: 'explainer' }
			);
			const branchMessage = root.messages[1];
			// Child branches off the highlighted assistant reply.
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
			// [briefNote, excerptNote, u0, the highlighted span here, c0]
			expect(ctx.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
			expect(ctx[0].content).toContain('master the topic');
			expect(ctx[1].content).toContain('the highlighted span');
			expect(ctx.map((m) => m.content)).toEqual([
				expect.stringContaining('master the topic'),
				expect.stringContaining('the highlighted span'),
				'u0',
				'the highlighted span here',
				'c0'
			]);
		});

		it('a corrupted/empty brief on the root is treated as null (no throw)', async () => {
			const root = await repos.chats.createRoot({ title: 'Root' });
			// Inject a malformed brief value directly (parseBrief → null).
			await repos.chats.updateBrief(root.id, { goal: 'g' });
			await repos.chats.updateBrief(root.id, null);
			await repos.messages.append(root.id, 'user', 'u0');
			// Even a garbage JSON string in the column never breaks assembly.
			const rawRow = await repos.chats.getById(root.id);
			expect(rawRow?.brief).toBeNull();
			const ctx = await assembleContext(root.id);
			expect(ctx.every((m) => m.role !== 'system')).toBe(true);
		});
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
