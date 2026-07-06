import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import { toolsRun } from '$lib/agent/registry';
import type { ToolContext } from '$lib/agent/registry';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';
import { QuizGenerationError } from '$lib/ai/generate/generate-quiz';
import { LabGenerationError } from '$lib/ai/generate/generate';

vi.mock('$lib/chat/context', () => ({
	assembleContext: vi.fn(async () => []),
	toCoreMessages: vi.fn((msgs) => msgs)
}));

vi.mock('$lib/ai/generate/generate-quiz', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/ai/generate/generate-quiz')>();
	return { ...actual, generateQuiz: vi.fn() };
});

vi.mock('$lib/ai/generate/generate', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/ai/generate/generate')>();
	return { ...actual, generateLab: vi.fn() };
});

import type { GeneratedQuiz } from '$lib/ai/generate/quiz';

const { generateQuiz } = await import('$lib/ai/generate/generate-quiz');
const mockedGenerateQuiz = vi.mocked(generateQuiz);

const { generateLab } = await import('$lib/ai/generate/generate');
const mockedGenerateLab = vi.mocked(generateLab);

const cannedQuiz: GeneratedQuiz = {
	questions: [
		{
			type: 'mcq' as const,
			prompt: 'What is 2+2?',
			payload: { options: ['3', '4', '5'], answerIndex: 1 }
		},
		{ type: 'flashcard' as const, prompt: 'Recall X', payload: { front: 'X', back: 'Y' } },
		{ type: 'short' as const, prompt: 'Explain Z', payload: { rubric: 'must mention W' } }
	]
};

const cannedLab = {
	title: 'Docker Basics',
	intro: 'Learn Docker fundamentals',
	steps: ['Install Docker', 'Run hello-world'],
	checklist: [{ text: 'Docker installed' }, { text: 'hello-world runs' }]
};

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	vi.clearAllMocks();
});

function ctx(chatId: string, rootChatId: string, signal?: AbortSignal): ToolContext {
	return {
		chatId,
		rootChatId,
		signal,
		budget: { subCalls: 0, maxSubCalls: 1 },
		model: null as unknown as LanguageModel,
		config: { defaultModel: 'test-model' } as unknown as ProviderConfig
	};
}

describe('create_quiz', () => {
	it('generates quiz and persists quiz + questions; artifact returned with correct count and route', async () => {
		mockedGenerateQuiz.mockResolvedValue(cannedQuiz);
		const chat = await repos.chats.createRoot({ title: 'C' });

		const result = await toolsRun('create_quiz', { topic: 'Math' }, ctx(chat.id, chat.id));

		expect(result.ok).toBe(true);
		expect(result.detail).toMatchObject({ artifact: { kind: 'quiz' } });
		const artifact = (result.detail as { artifact: { id: string } }).artifact;
		expect(artifact.id).toBeTruthy();
		expect(result.summary).toContain('3 questions');
		expect(result.summary).toContain('/quiz/');
		expect(result.summary).toContain('Do not reproduce');

		const quiz = await repos.quizzes.getById(artifact.id);
		expect(quiz).not.toBeNull();
		expect(quiz!.model).toBe('test-model');

		const questions = await repos.quizQuestions.listByQuiz(artifact.id);
		expect(questions).toHaveLength(3);
	});

	it('no-orphan: signal aborted after generate resolves → no quiz persisted', async () => {
		const createSpy = vi.spyOn(repos.quizzes, 'create');
		const ac = new AbortController();

		mockedGenerateQuiz.mockImplementation(async () => {
			ac.abort();
			return cannedQuiz;
		});

		const result = await toolsRun('create_quiz', {}, ctx('c', 'c', ac.signal));
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('aborted');
		expect(createSpy).not.toHaveBeenCalled();
		createSpy.mockRestore();
	});

	it('QuizGenerationError → { ok:false, summary:quiz generation failed }; no artifact created', async () => {
		mockedGenerateQuiz.mockRejectedValue(new QuizGenerationError('fail', 'raw'));
		const createSpy = vi.spyOn(repos.quizzes, 'create');

		const result = await toolsRun('create_quiz', {}, ctx('c', 'c'));
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('quiz generation failed');
		expect(createSpy).not.toHaveBeenCalled();
		createSpy.mockRestore();
	});

	it('missing optional topic still works', async () => {
		mockedGenerateQuiz.mockResolvedValue(cannedQuiz);
		const chat = await repos.chats.createRoot({ title: 'C' });

		const result = await toolsRun('create_quiz', {}, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.summary).toContain('3 questions');
	});
});

describe('create_lab', () => {
	it('generates lab and persists with toLabContent-flattened content + checklist and route', async () => {
		mockedGenerateLab.mockResolvedValue(cannedLab);
		const chat = await repos.chats.createRoot({ title: 'C' });

		const result = await toolsRun('create_lab', { topic: 'Docker' }, ctx(chat.id, chat.id));
		expect(result.ok).toBe(true);
		expect(result.detail).toMatchObject({ artifact: { kind: 'lab' } });
		const artifact = (result.detail as { artifact: { id: string } }).artifact;
		expect(artifact.id).toBeTruthy();
		expect(result.summary).toContain('Docker Basics');
		expect(result.summary).toContain('/lab/');
		expect(result.summary).toContain('Do not reproduce');

		const lab = await repos.labs.getById(artifact.id);
		expect(lab).not.toBeNull();
		expect(lab!.title).toBe('Docker Basics');
		expect(lab!.content).toContain('Install Docker');
		expect(lab!.model).toBe('test-model');

		const checklist = repos.labs.parseChecklist(lab!.checklist);
		expect(checklist).toHaveLength(2);
		expect(checklist[0].text).toBe('Docker installed');
	});

	it('no-orphan: signal aborted after generate resolves → no lab persisted', async () => {
		const createSpy = vi.spyOn(repos.labs, 'create');
		const ac = new AbortController();

		mockedGenerateLab.mockImplementation(async () => {
			ac.abort();
			return cannedLab;
		});

		const result = await toolsRun('create_lab', {}, ctx('c', 'c', ac.signal));
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('aborted');
		expect(createSpy).not.toHaveBeenCalled();
		createSpy.mockRestore();
	});

	it('LabGenerationError → { ok:false, summary:lab generation failed }; no artifact created', async () => {
		mockedGenerateLab.mockRejectedValue(new LabGenerationError('fail', 'raw'));
		const createSpy = vi.spyOn(repos.labs, 'create');

		const result = await toolsRun('create_lab', {}, ctx('c', 'c'));
		expect(result.ok).toBe(false);
		expect(result.summary).toBe('lab generation failed');
		expect(createSpy).not.toHaveBeenCalled();
		createSpy.mockRestore();
	});
});
