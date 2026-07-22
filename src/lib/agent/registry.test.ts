import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { toolsRun, getToolDefinitions } from '$lib/agent/registry';
import type { ToolContext } from '$lib/agent/registry';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';

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

describe('toolsRun', () => {
	it('dispatches read_checklist and returns expected result', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'Lab 1',
			content: 'steps...',
			checklist: [
				{ id: 's1', text: 'Step 1', done: true },
				{ id: 's2', text: 'Step 2', done: false }
			]
		});

		const result = await toolsRun('read_checklist', { labId: lab.id }, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('1/2 steps done');
		expect(Array.isArray(result.detail)).toBe(true);
		expect((result.detail as Array<{ done: boolean }>).filter((i) => i.done)).toHaveLength(1);
	});

	it('returns unknown tool for unrecognized id (never throws)', async () => {
		const result = await toolsRun('nonexistent_tool', {}, ctx('a', 'a'));
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('unknown tool: nonexistent_tool');
	});
});

describe('read_checklist', () => {
	it('with valid labId returns ok with steps', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'Lab',
			content: 'content',
			checklist: [
				{ id: 'a', text: 'First', done: true },
				{ id: 'b', text: 'Second', done: true },
				{ id: 'c', text: 'Third', done: false }
			]
		});

		const result = await toolsRun('read_checklist', { labId: lab.id }, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('2/3 steps done');
		expect(result.detail as Array<{ id: string }>).toHaveLength(3);
	});

	it('with missing labId returns ok false', async () => {
		const result = await toolsRun('read_checklist', {}, ctx('a', 'a'));
		expect(result.ok).toBe(false);
		expect(result.summary).toContain('missing');
	});
});

describe('list_artifacts', () => {
	it('with labs and quizzes returns summary with counts', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.labs.create({ chatId: chat.id, title: 'Lab A', content: 'x' });
		await repos.labs.create({ chatId: chat.id, title: 'Lab B', content: 'x' });
		await repos.quizzes.create({ chatId: chat.id });

		const result = await toolsRun('list_artifacts', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('2 labs, 1 quiz');
		expect(Array.isArray(result.detail)).toBe(true);
		expect(result.detail as Array<{ kind: string }>).toHaveLength(3);
	});
});

describe('read_artifact', () => {
	it('for a lab returns full lab payload in detail', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const lab = await repos.labs.create({
			chatId: chat.id,
			title: 'My Lab',
			content: 'lab content here',
			checklist: [{ id: 'c1', text: 'Check', done: true }]
		});

		const result = await toolsRun(
			'read_artifact',
			{ kind: 'lab', id: lab.id },
			ctx(chat.id, chat.id)
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('Lab: My Lab');
		const detail = result.detail as { title: string; checklist: Array<{ id: string }> };
		expect(detail.title).toBe('My Lab');
		expect(detail.checklist).toHaveLength(1);
	});

	it('for a quiz returns quiz with questions in detail', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		const quiz = await repos.quizzes.create({ chatId: chat.id });
		await repos.quizQuestions.add({
			quizId: quiz.id,
			type: 'mcq',
			prompt: 'What is 2+2?',
			payload: { options: ['3', '4', '5'], answerIndex: 1 }
		});

		const result = await toolsRun(
			'read_artifact',
			{ kind: 'quiz', id: quiz.id },
			ctx(chat.id, chat.id)
		);
		expect(result.ok).toBe(true);
		expect(result.summary).toBe('Quiz: 1 questions');
		const detail = result.detail as {
			questions: Array<{ payload: { options: string[]; answerIndex: number } }>;
		};
		expect(detail.questions).toHaveLength(1);
		expect(detail.questions[0].payload.options).toEqual(['3', '4', '5']);
	});
});

describe('summarize_progress', () => {
	it('is purely local synthesis with no LLM call', async () => {
		const chat = await repos.chats.createRoot({ title: 'C' });
		await repos.labs.create({
			chatId: chat.id,
			title: 'Lab A',
			content: 'x',
			checklist: [
				{ id: 's1', text: 'Step 1', done: true },
				{ id: 's2', text: 'Step 2', done: false }
			]
		});
		await repos.quizzes.create({ chatId: chat.id });

		const result = await toolsRun('summarize_progress', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('1 lab, 1 quiz');
		expect(result.summary).toContain('1/2 checklist steps complete');
		const detail = result.detail as {
			labs: Array<{ done: number; total: number }>;
			quizCount: number;
		};
		expect(detail.labs).toHaveLength(1);
		expect(detail.labs[0].done).toBe(1);
		expect(detail.labs[0].total).toBe(2);
		expect(detail.quizCount).toBe(1);
	});
});

describe('getToolDefinitions', () => {
	it('returns 12 tools: 5 readonly + 3 deterministic low + 2 deterministic high + 2 generative high', () => {
		const defs = getToolDefinitions();
		expect(defs).toHaveLength(12);

		const readonly = defs.filter((d) => d.risk === 'readonly');
		expect(readonly).toHaveLength(5);
		expect(readonly.map((d) => d.id).sort()).toEqual([
			'list_artifacts',
			'present_choices',
			'read_artifact',
			'read_checklist',
			'summarize_progress'
		]);

		const low = defs.filter((d) => d.risk === 'low');
		expect(low).toHaveLength(3);
		expect(low.map((d) => d.id).sort()).toEqual([
			'draft_lab_skeleton',
			'draft_quiz_outline',
			'toggle_checklist_item'
		]);

		const high = defs.filter((d) => d.risk === 'high');
		expect(high).toHaveLength(4);
		expect(high.map((d) => d.id).sort()).toEqual([
			'branch_chat',
			'create_lab',
			'create_quiz',
			'save_brief'
		]);

		const generative = defs.filter((d) => d.generative === true);
		expect(generative).toHaveLength(2);
		expect(generative.map((d) => d.id).sort()).toEqual(['create_lab', 'create_quiz']);
		for (const d of generative) {
			expect(d.risk).toBe('high');
		}

		const nonGenerative = defs.filter((d) => d.generative === false);
		expect(nonGenerative).toHaveLength(10);
	});
});
