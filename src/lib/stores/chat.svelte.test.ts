import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { chatStore } from './chat.svelte';
import { assembleContext } from '$lib/chat/context';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

describe('chatStore branching round-trip', () => {
	it('branchFromSelection records offsets + excerpt, and the child context includes them', async () => {
		// Seed a parent chat with one assistant reply containing highlightable prose.
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);

		// Load the store as if the user navigated to the parent chat.
		await chatStore.load(parent.id);

		// Simulate a selection of "powerhouse of the cell" from the rendered text.
		// The rendered text equals the raw prose here (no markdown), so offsets
		// map cleanly.
		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;

		const childId = await chatStore.branchFromSelection(assistant.id, reply, {
			excerpt: 'powerhouse of the cell',
			containerText: reply,
			startInContainer: start,
			endInContainer: end
		});

		// A branch_source row was recorded with the resolved offsets.
		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.excerpt).toBe('powerhouse of the cell');
		expect(src!.sourceMessageId).toBe(assistant.id);

		// The child chat points back at the parent + branch message.
		const child = await repos.chats.getById(childId);
		expect(child!.parentId).toBe(parent.id);
		expect(child!.branchPointMessageId).toBe(assistant.id);

		// assembleContext(child) leads with the excerpt system note.
		const ctx = await assembleContext(childId);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('powerhouse of the cell');
	});

	it('branchFromSelection falls back to full-span offsets when the selection cannot be mapped', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		// Raw contains a mermaid fence; the "rendered" selection touches SVG text
		// that never existed in raw → mapping fails → fallback offsets apply.
		const reply = '```mermaid\ngraph TD\nA-->B\n```\nAfter diagram.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const childId = await chatStore.branchFromSelection(assistant.id, reply, {
			excerpt: 'Diagram renders as SVG',
			containerText: 'Diagram renders as SVG. After diagram.',
			startInContainer: 0,
			endInContainer: 'Diagram renders as SVG'.length
		});

		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		// Fallback: startChar=0, endChar=excerpt.length.
		expect(src!.startChar).toBe(0);
		expect(src!.endChar).toBe('Diagram renders as SVG'.length);
		expect(src!.excerpt).toBe('Diagram renders as SVG');
	});

	it('branchFromMessage creates a child without a branch_source row', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(parent.id, 'user', 'hello');
		const assistant = await repos.messages.append(parent.id, 'assistant', 'hi there');
		await chatStore.load(parent.id);

		const childId = await chatStore.branchFromMessage(assistant.id);
		const child = await repos.chats.getById(childId);
		expect(child!.parentId).toBe(parent.id);
		expect(child!.branchPointMessageId).toBe(assistant.id);

		// No excerpt row for a whole-message branch.
		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).toBeNull();
	});

	it('load resets state when switching chats (no message leak)', async () => {
		const a = await repos.chats.createRoot({ title: 'A' });
		const b = await repos.chats.createRoot({ title: 'B' });
		await repos.messages.append(a.id, 'user', 'msg-in-A');
		await repos.messages.append(b.id, 'user', 'msg-in-B');

		await chatStore.load(a.id);
		expect(chatStore.messages.map((m) => m.content)).toEqual(['msg-in-A']);
		await chatStore.load(b.id);
		expect(chatStore.messages.map((m) => m.content)).toEqual(['msg-in-B']);
		expect(chatStore.chat?.id).toBe(b.id);
	});
});
