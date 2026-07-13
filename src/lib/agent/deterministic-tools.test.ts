import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { bootstrapTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { toolsRun } from '$lib/agent/registry';
import type { ToolContext } from '$lib/agent/registry';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';

beforeEach(async () => {
	const { driver } = await bootstrapTestDb();
	await bootstrapWithDriver(driver, 'pg');
});

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
