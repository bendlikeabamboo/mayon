import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { Provider } from '$lib/ai/types';
import { chatStore, ExcerptOverlapError } from './chat.svelte';
import { assembleContext } from '$lib/chat/context';
import { buildExpoundPrompt } from '$lib/chat/expound';

// `chatStore.send()` calls `getActiveProvider()`; mock it so the pendingPrompt
// drain test can stream a deterministic reply without a real provider.
vi.mock('$lib/ai/client', () => ({
	getActiveProvider: vi.fn()
}));

const { getActiveProvider } = await import('$lib/ai/client');
const mockedGetActiveProvider = vi.mocked(getActiveProvider);

/** Stub provider whose `chatStream` yields the given tokens, tracking call count. */
function streamingProvider(tokens: string[]): { provider: Provider; streamCalls: () => number } {
	let calls = 0;
	const provider: Provider = {
		kind: 'openai-compatible',
		config: {
			id: 'stub',
			kind: 'openai-compatible',
			name: 'stub',
			baseUrl: 'http://stub',
			defaultModel: 'stub-model',
			models: ['stub-model']
		},
		async *chatStream() {
			calls++;
			for (const t of tokens) yield { text: t };
		},
		generateLab: () => Promise.reject(new Error('unused')),
		generateQuiz: () => Promise.reject(new Error('unused')),
		gradeShortAnswer: () => Promise.reject(new Error('unused'))
	};
	return { provider, streamCalls: () => calls };
}

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	mockedGetActiveProvider.mockReset();
	chatStore.pendingPrompt = null;
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

describe('chatStore.createExpoundBranch', () => {
	it('records a branch_source, stages the prompt, and the child context leads with the excerpt', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const prompt = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: 'elaborate',
			toggles: ['diagrams', 'code']
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			prompt
		);

		// branch_source recorded against the resolved span.
		const src = await repos.branchSources.getByBranchChat(childId);
		expect(src).not.toBeNull();
		expect(src!.excerpt).toBe('powerhouse of the cell');
		expect(src!.startChar).toBe(start);
		expect(src!.endChar).toBe(end);

		// The staged prompt matches the built expound prompt.
		expect(chatStore.pendingPrompt).toBe(prompt);

		// The child context leads with the excerpt system note.
		const ctx = await assembleContext(childId);
		expect(ctx[0].role).toBe('system');
		expect(ctx[0].content).toContain('powerhouse of the cell');
	});

	it('throws ExcerptOverlapError and creates nothing for an overlapping selection', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const sel = {
			excerpt: 'powerhouse of the cell',
			containerText: reply,
			startInContainer: start,
			endInContainer: end
		};

		// First expound succeeds.
		await chatStore.createExpoundBranch(assistant.id, reply, sel, 'first prompt');
		const beforeCount = (await repos.branchSources.listBySourceMessage(assistant.id)).length;

		// An exact-span re-select is treated as overlap.
		await expect(
			chatStore.createExpoundBranch(assistant.id, reply, sel, 'second prompt')
		).rejects.toBeInstanceOf(ExcerptOverlapError);

		// No new branch_source row was created.
		const afterCount = (await repos.branchSources.listBySourceMessage(assistant.id)).length;
		expect(afterCount).toBe(beforeCount);
		// pendingPrompt is NOT updated on failure (stays as the first prompt).
		expect(chatStore.pendingPrompt).toBe('first prompt');
	});

	it('throws ExcerptOverlapError for a partially overlapping selection', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell. Remember this.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		// First expound over "powerhouse of the cell".
		await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			'p'
		);

		// Second expound over "the cell. Remember" overlaps the prior span.
		const s2 = reply.indexOf('the cell');
		const e2 = s2 + 'the cell. Remember'.length;
		await expect(
			chatStore.createExpoundBranch(
				assistant.id,
				reply,
				{
					excerpt: 'the cell. Remember',
					containerText: reply,
					startInContainer: s2,
					endInContainer: e2
				},
				'p2'
			)
		).rejects.toBeInstanceOf(ExcerptOverlapError);
	});

	it('allows an adjacent (non-overlapping) second expound', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'Alpha beta gamma delta epsilon zeta eta theta.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const s1 = reply.indexOf('Alpha');
		const e1 = s1 + 'Alpha beta gamma'.length;
		await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'Alpha beta gamma',
				containerText: reply,
				startInContainer: s1,
				endInContainer: e1
			},
			'p1'
		);

		// Adjacent: starts exactly where the first ended.
		const s2 = e1 + 1; // skip the space
		const e2 = s2 + 'delta epsilon zeta'.length;
		const childId2 = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'delta epsilon zeta',
				containerText: reply,
				startInContainer: s2,
				endInContainer: e2
			},
			'p2'
		);

		const all = await repos.branchSources.listBySourceMessage(assistant.id);
		expect(all).toHaveLength(2);
		expect(all.some((s) => s.branchChatId === childId2)).toBe(true);
	});

	it('draining pendingPrompt (simulating route load) sends exactly once', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const reply = 'The mitochondrion is the powerhouse of the cell.';
		const assistant = await repos.messages.append(parent.id, 'assistant', reply);
		await chatStore.load(parent.id);

		const start = reply.indexOf('powerhouse');
		const end = start + 'powerhouse of the cell'.length;
		const prompt = buildExpoundPrompt({
			excerpt: 'powerhouse of the cell',
			customInstructions: '',
			toggles: ['tables']
		});

		const childId = await chatStore.createExpoundBranch(
			assistant.id,
			reply,
			{
				excerpt: 'powerhouse of the cell',
				containerText: reply,
				startInContainer: start,
				endInContainer: end
			},
			prompt
		);

		const { provider, streamCalls } = streamingProvider(['Hello ', 'world']);
		mockedGetActiveProvider.mockResolvedValue(provider);

		// Simulate the route's loadAll: load the branch, then drain.
		await chatStore.load(childId);
		expect(chatStore.pendingPrompt).toBe(prompt);
		const drained = chatStore.pendingPrompt;
		if (drained) {
			chatStore.clearPendingPrompt();
			await chatStore.send(drained);
		}

		// Streamed exactly once, prompt cleared, and both rows persisted.
		expect(streamCalls()).toBe(1);
		expect(chatStore.pendingPrompt).toBeNull();
		const msgs = await repos.messages.listByChat(childId);
		expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(msgs.find((m) => m.role === 'user')?.content).toBe(prompt);
		expect(msgs.find((m) => m.role === 'assistant')?.content).toBe('Hello world');
	});
});

describe('chatStore auto-title', () => {
	/**
	 * Provider that returns `reply` for the chat stream and `title` for a title
	 * request (distinguished by the leading system message generateTitle prepends).
	 */
	function titleAwareProvider(reply: string, title: string): Provider {
		return {
			kind: 'openai-compatible',
			config: {
				id: 'stub',
				kind: 'openai-compatible',
				name: 'stub',
				baseUrl: 'http://stub',
				defaultModel: 'stub-model',
				models: ['stub-model']
			},
			async *chatStream(messages) {
				yield { text: messages[0]?.role === 'system' ? title : reply };
			},
			generateLab: () => Promise.reject(new Error('unused')),
			generateQuiz: () => Promise.reject(new Error('unused')),
			gradeShortAnswer: () => Promise.reject(new Error('unused'))
		};
	}

	/** Poll for the auto-title (fire-and-forget) to land, with a generous cap. */
	async function waitForTitle(expected: string): Promise<void> {
		for (let i = 0; i < 200; i++) {
			if (chatStore.chat?.title === expected) return;
			await new Promise((r) => setTimeout(r, 5));
		}
	}

	it('auto-generates and persists a title after a root chat first exchange', async () => {
		const root = await repos.chats.createRoot({ title: 'New chat' });
		mockedGetActiveProvider.mockResolvedValue(titleAwareProvider('the answer', 'Docker Volumes'));
		await chatStore.load(root.id);
		expect(chatStore.chat?.title).toBe('New chat');

		await chatStore.send('how do volumes work');

		// Title is persisted on the row…
		await waitForTitle('Docker Volumes');
		const row = await repos.chats.getById(root.id);
		expect(row?.title).toBe('Docker Volumes');
		// …and reflected in the store.
		expect(chatStore.chat?.title).toBe('Docker Volumes');
	});

	it('does not retitle a chat whose title is no longer the placeholder', async () => {
		const root = await repos.chats.createRoot({ title: 'Custom Title' });
		mockedGetActiveProvider.mockResolvedValue(titleAwareProvider('the answer', 'Should Not Apply'));
		await chatStore.load(root.id);

		await chatStore.send('hi');
		await waitForTitle('Should Not Apply');

		// The custom title is left untouched.
		const row = await repos.chats.getById(root.id);
		expect(row?.title).toBe('Custom Title');
	});

	it('does not retitle a child (branched) chat', async () => {
		const parent = await repos.chats.createRoot({ title: 'New chat' });
		const child = await repos.chats.createChild({
			parentId: parent.id,
			title: 'New chat'
		});
		mockedGetActiveProvider.mockResolvedValue(titleAwareProvider('reply', 'Ignored Title'));
		await chatStore.load(child.id);

		await chatStore.send('hello');
		await waitForTitle('Ignored Title');

		expect((await repos.chats.getById(child.id))?.title).toBe('New chat');
	});
});

describe('chatStore.deleteChat', () => {
	it('removes the whole tree plus all attached artifacts', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const assistant = await repos.messages.append(root.id, 'assistant', 'source text');
		const child = await repos.chats.createChild({
			parentId: root.id,
			branchPointMessageId: assistant.id,
			title: 'Child'
		});
		await repos.branchSources.create({
			sourceMessageId: assistant.id,
			startChar: 0,
			endChar: 4,
			excerpt: 'sour',
			branchChatId: child.id
		});
		await repos.messages.append(child.id, 'user', 'more');
		await repos.labs.create({ chatId: root.id, title: 'L', content: 'c' });
		const quiz = await repos.quizzes.create({ chatId: root.id });

		await chatStore.deleteChat(root.id);

		// Chats, messages, branch_sources, labs, quizzes all gone.
		expect(await repos.chats.getById(root.id)).toBeNull();
		expect(await repos.chats.getById(child.id)).toBeNull();
		expect(await repos.messages.listByChat(root.id)).toEqual([]);
		expect(await repos.messages.listByChat(child.id)).toEqual([]);
		expect(await repos.branchSources.getByBranchChat(child.id)).toBeNull();
		expect(await repos.labs.listByChat(root.id)).toEqual([]);
		expect(await repos.quizzes.getById(quiz.id)).toBeNull();
	});

	it('clears the active view when the deleted tree contained it', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		const child = await repos.chats.createChild({ parentId: root.id, title: 'Child' });
		await repos.messages.append(child.id, 'user', 'hi');
		await chatStore.load(child.id);
		expect(chatStore.chat?.id).toBe(child.id);

		// Deleting the root (the child's tree) should clear the view.
		await chatStore.deleteChat(root.id);
		expect(chatStore.chat).toBeNull();
		expect(chatStore.chatId).toBeNull();
		expect(chatStore.messages).toEqual([]);
	});
});
