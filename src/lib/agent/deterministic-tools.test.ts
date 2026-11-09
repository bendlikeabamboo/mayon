import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '#lib/db/driver/pg-test.js';
import { repos } from '#lib/db/index.js';
import { toolsRun } from '#lib/agent/registry.js';
import type { ToolContext } from '#lib/agent/registry.js';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '#lib/ai/types.js';
import { generateBranchArtifactSummary } from '#lib/ai/generate/generate-branch-artifact-summary.js';
import type { BranchArtifactSummary } from '#lib/ai/generate/generate-branch-artifact-summary.js';
import { acquirePropagationLatch, releasePropagationLatch } from '#lib/chat/propagation.js';
import type { BranchArtifactMetadata, ImagePart, MessagePart, TextPart } from '#lib/chat/kinds.js';

vi.mock('#lib/ai/generate/generate-branch-artifact-summary.js', () => ({
	generateBranchArtifactSummary: vi.fn()
}));

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

function ctx(chatId: string, rootChatId: string): ToolContext {
	return {
		chatId,
		rootChatId,
		budget: { subCalls: 0, maxSubCalls: 0 },
		model: null as unknown as LanguageModel,
		config: null as unknown as ProviderConfig
	};
}

describe('branch_chat', () => {
	it('creates a child off the last message; detail.artifact.id is the child id; title falls back to Deeper dive', async () => {
		const chat = await repos.chats.createRoot({ title: 'Parent' });
		await repos.messages.append(chat.id, 'user', 'hello');
		const last = await repos.messages.append(chat.id, 'assistant', 'world');

		const result = await toolsRun('branch_chat', { topic: 'My branch' }, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('My branch');

		const detail = result.detail as { artifact: { kind: string; id: string } };
		expect(detail.artifact.kind).toBe('chat');
		expect(detail.artifact.id).toBeTruthy();

		const child = await repos.chats.getById(detail.artifact.id);
		expect(child).not.toBeNull();
		expect(child!.parentId).toBe(chat.id);
		expect(child!.branchPointMessageId).toBe(last.id);
	});

	it('falls back to "Deeper dive" when no topic given', async () => {
		const chat = await repos.chats.createRoot({ title: 'Parent' });
		await repos.messages.append(chat.id, 'user', 'hello');

		const result = await toolsRun('branch_chat', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('Deeper dive');
	});

	it('returns ok false when no messages in chat', async () => {
		const chat = await repos.chats.createRoot({ title: 'Empty' });

		const result = await toolsRun('branch_chat', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('no messages');
	});
});

describe('save_brief', () => {
	it('upserts brief on root; follow-up getById carries the new brief', async () => {
		const chat = await repos.chats.createRoot({ title: 'Root' });
		const brief = { goal: 'learn Docker', level: 'novice', mode: 'socratic' };

		const result = await toolsRun('save_brief', brief, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);

		const row = await repos.chats.getById(chat.id);
		expect(row!.brief).not.toBeNull();
		expect(row!.brief).toContain('learn Docker');

		const detail = result.detail as { brief: Record<string, unknown> };
		expect(detail.brief.goal).toBe('learn Docker');
	});

	it('missing goal returns ok false', async () => {
		const chat = await repos.chats.createRoot({ title: 'Root' });

		const result = await toolsRun('save_brief', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('missing goal');
	});
});

describe('draft_lab_skeleton', () => {
	it('returns markdown in detail with expected sections', async () => {
		const chat = await repos.chats.createRoot({
			title: 'Root',
			brief: { goal: 'test goal' }
		});

		const result = await toolsRun(
			'draft_lab_skeleton',
			{ topic: 'Docker 101' },
			ctx(chat.id, chat.id)
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('sections');

		const detail = result.detail as { markdown: string };
		expect(typeof detail.markdown).toBe('string');
		expect(detail.markdown).toContain('# Lab: Docker 101');
		expect(detail.markdown).toContain('## Objective');
		expect(detail.markdown).toContain('## Prerequisites');
		expect(detail.markdown).toContain('## Setup');
		expect(detail.markdown).toContain('## Step');
		expect(detail.markdown).toContain('## Checkpoint');
		expect(detail.markdown).toContain('## Reflection');
	});
});

describe('draft_quiz_outline', () => {
	it('returns markdown in detail with expected number of questions', async () => {
		const result = await toolsRun(
			'draft_quiz_outline',
			{ topic: 'SQL', questionCount: 3 },
			ctx('c', 'c')
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('3 questions');

		const detail = result.detail as { markdown: string };
		expect(typeof detail.markdown).toBe('string');
		expect(detail.markdown).toContain('# Quiz: SQL');
		expect(detail.markdown).toContain('## Q1');
		expect(detail.markdown).toContain('## Q2');
		expect(detail.markdown).toContain('## Q3');
		expect(detail.markdown).toContain('**Answer:**');
	});

	it('defaults to 5 questions when no questionCount given', async () => {
		const result = await toolsRun('draft_quiz_outline', {}, ctx('c', 'c'));
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('5 questions');

		const detail = result.detail as { markdown: string };
		expect(detail.markdown).toContain('## Q5');
	});
});

describe('toggle_checklist_item', () => {
	it('flips a step and returns new state', async () => {
		const chat = await repos.chats.createRoot({ title: 'Root' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'Lab',
			content: 'content',
			checklist: [
				{ id: 's1', text: 'Step 1', done: false },
				{ id: 's2', text: 'Step 2', done: true }
			]
		});

		const result = await toolsRun(
			'toggle_checklist_item',
			{ labId: lab.id, itemId: 's1' },
			ctx(chat.id, chat.id)
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('checked');

		const detail = result.detail as { checklist: Array<{ id: string; done: boolean }> };
		const item = detail.checklist.find((i) => i.id === 's1');
		expect(item?.done).toBe(true);
	});

	it('returns ok false for unknown lab/item', async () => {
		const result = await toolsRun(
			'toggle_checklist_item',
			{ labId: 'nonexistent', itemId: 'nonexistent' },
			ctx('c', 'c')
		);
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('not found');
	});

	it('returns ok false when missing labId or itemId', async () => {
		const result = await toolsRun('toggle_checklist_item', {}, ctx('c', 'c'));
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('missing');
	});
});

describe('propagate_to_parent', () => {
	beforeEach(() => {
		vi.mocked(generateBranchArtifactSummary).mockReset();
	});
	afterEach(() => releasePropagationLatch());

	/** Parent with ords 0/1 and a recorded child branch off the first row, with two own turns. */
	async function seedBranch() {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const a = await repos.messages.append(parent.id, 'user', 'hello');
		const b = await repos.messages.append(parent.id, 'assistant', 'world');
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: a.id,
			title: 'Branch of Root'
		});
		await repos.messages.append(child.id, 'user', 'branch question');
		await repos.messages.append(child.id, 'assistant', 'branch answer');
		return { parent, a, b, child };
	}

	it('refuses a root chat with the not-a-branch reason and zero writes', async () => {
		const root = await repos.chats.createRoot({ title: 'Root' });
		await repos.messages.append(root.id, 'user', 'hello');
		const before = await repos.messages.listByChat(root.id);

		const result = await toolsRun('propagate_to_parent', {}, ctx(root.id, root.id));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('not a branch');
		const after = await repos.messages.listByChat(root.id);
		expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
	});

	it('refuses an empty branch with the no-messages reason', async () => {
		const parent = await repos.chats.createRoot({ title: 'Root' });
		const child = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: null,
			title: 'Empty branch'
		});

		const result = await toolsRun('propagate_to_parent', {}, ctx(child.id, parent.id));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('no messages yet');
	});

	it('refuses while the propagation latch is held', async () => {
		const { parent, child } = await seedBranch();
		expect(acquirePropagationLatch()).toBe(true);

		const result = await toolsRun('propagate_to_parent', {}, ctx(child.id, parent.id));

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('already running');
	});

	it('rejects an invalid mode at run level', async () => {
		const { parent, child } = await seedBranch();

		const result = await toolsRun(
			'propagate_to_parent',
			{ mode: 'banana' },
			ctx(child.id, parent.id)
		);

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('invalid mode');
	});

	it('raw happy path: one verbatim artifact at the midpoint, 020 metadata shape, latch released', async () => {
		const { parent, a, b, child } = await seedBranch();

		const result = await toolsRun('propagate_to_parent', {}, ctx(child.id, parent.id));

		expect(result.ok).toBe(true);
		expect(result.summary).toContain('Root');
		expect(result.summary).toContain('raw');

		const rows = await repos.messages.listByChat(parent.id);
		const artifacts = rows.filter((m) => m.kind === 'branch_artifact');
		expect(artifacts).toHaveLength(1);
		const art = artifacts[0]!;
		expect(art.ord).toBe((a.ord + b.ord) / 2);
		expect(art.content).toBe(
			[
				'[excerpt]',
				'hello',
				'[/excerpt]',
				'',
				'[user] branch question',
				'[assistant] branch answer'
			].join('\n')
		);
		const meta = JSON.parse(art.metadata!) as BranchArtifactMetadata;
		expect(meta).toEqual({
			mode: 'raw',
			sourceChatId: child.id,
			sourceChatTitle: 'Branch of Root',
			branchPointMessageId: a.id,
			anchor: 'recorded',
			summaryTraceId: null,
			regeneratedAt: null
		});
		expect(result.detail).toEqual({ parentChatId: parent.id, mode: 'raw' });

		const again = await toolsRun('propagate_to_parent', {}, ctx(child.id, parent.id));
		expect(again.ok).toBe(true);
		const afterRows = await repos.messages.listByChat(parent.id);
		expect(afterRows.filter((m) => m.kind === 'branch_artifact')).toHaveLength(2);

		const firstAgain = afterRows.find((m) => m.id === art.id)!;
		expect(firstAgain.content).toBe(art.content);
		expect(firstAgain.metadata).toBe(art.metadata);
	});

	it("carries the branch turns' image parts on the artifact row (030 T021)", async () => {
		const { parent, child } = await seedBranch();
		const image: ImagePart = {
			type: 'image',
			data: 'data:image/png;base64,Zm9v',
			mimeType: 'image/png',
			width: 4,
			height: 4,
			bytes: 8
		};
		await repos.messages.append(child.id, 'assistant', 'see  pic', {
			parts: [{ type: 'text', text: 'see ' }, image, { type: 'text', text: ' pic' }]
		});

		const result = await toolsRun('propagate_to_parent', {}, ctx(child.id, parent.id));
		expect(result.ok).toBe(true);

		const art = (await repos.messages.listByChat(parent.id)).find(
			(m) => m.kind === 'branch_artifact'
		)!;
		expect(art.content).toContain('[assistant] see [image] pic');
		const parts = JSON.parse(art.parts!) as MessagePart[];
		expect(parts.filter((p) => p.type === 'image')).toHaveLength(1);
		expect(
			parts
				.filter((p): p is TextPart => p.type === 'text')
				.map((p) => p.text)
				.join('')
		).toBe(art.content);
	});

	it('aborted before start: returns aborted, zero writes, latch released', async () => {
		const { parent, child } = await seedBranch();
		const before = await repos.messages.listByChat(parent.id);
		const ctrl = new AbortController();
		ctrl.abort();

		const result = await toolsRun(
			'propagate_to_parent',
			{},
			{
				...ctx(child.id, parent.id),
				signal: ctrl.signal
			}
		);

		expect(result).toEqual({ ok: false, summary: 'aborted' });
		const after = await repos.messages.listByChat(parent.id);
		expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
		expect(acquirePropagationLatch()).toBe(true);
	});

	it('aborted mid-summary: returns aborted (not generation-failed), zero writes, latch released', async () => {
		const { parent, child } = await seedBranch();
		const before = await repos.messages.listByChat(parent.id);
		let rejectGen!: (err: unknown) => void;
		vi.mocked(generateBranchArtifactSummary).mockImplementation(
			() =>
				new Promise<BranchArtifactSummary>((_resolve, reject) => {
					rejectGen = reject;
				})
		);
		const ctrl = new AbortController();

		const pending = toolsRun(
			'propagate_to_parent',
			{ mode: 'summary' },
			{ ...ctx(child.id, parent.id), signal: ctrl.signal }
		);
		ctrl.abort();
		await vi.waitFor(() => expect(generateBranchArtifactSummary).toHaveBeenCalled());
		rejectGen(new DOMException('The operation was aborted.', 'AbortError'));

		const result = await pending;

		expect(result).toEqual({ ok: false, summary: 'aborted' });
		const after = await repos.messages.listByChat(parent.id);
		expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
		expect(acquirePropagationLatch()).toBe(true);
	});

	it('never calls ctx.requestApproval when provided (decline handling is loop-owned)', async () => {
		const { parent, child } = await seedBranch();
		const requestApproval = vi.fn();

		const result = await toolsRun(
			'propagate_to_parent',
			{},
			{
				...ctx(child.id, parent.id),
				requestApproval
			}
		);

		expect(result.ok).toBe(true);
		expect(requestApproval).not.toHaveBeenCalled();
	});

	it('summary happy path: artifact carries mocked text and trace id, result names summary mode', async () => {
		const { parent, child } = await seedBranch();
		vi.mocked(generateBranchArtifactSummary).mockResolvedValue({
			summary: 'Branch summary text',
			traceId: 'trace-9'
		});

		const result = await toolsRun(
			'propagate_to_parent',
			{ mode: 'summary' },
			ctx(child.id, parent.id)
		);

		expect(result.ok).toBe(true);
		expect(result.summary).toContain('summary');

		const rows = await repos.messages.listByChat(parent.id);
		const artifacts = rows.filter((m) => m.kind === 'branch_artifact');
		expect(artifacts).toHaveLength(1);
		const art = artifacts[0]!;
		expect(art.content).toBe('Branch summary text');
		const meta = JSON.parse(art.metadata!) as BranchArtifactMetadata;
		expect(meta.mode).toBe('summary');
		expect(meta.summaryTraceId).toBe('trace-9');
	});

	it('summary generation failure inserts nothing (generate-first ordering)', async () => {
		const { parent, child } = await seedBranch();
		const before = await repos.messages.listByChat(parent.id);
		vi.mocked(generateBranchArtifactSummary).mockRejectedValue(new Error('provider down'));

		const result = await toolsRun(
			'propagate_to_parent',
			{ mode: 'summary' },
			ctx(child.id, parent.id)
		);

		expect(result.ok).toBe(false);
		expect(result.summary).toContain('summary generation failed');
		const after = await repos.messages.listByChat(parent.id);
		expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
	});
});
