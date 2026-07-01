import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { McqPayload, FlashcardPayload, ShortPayload } from '$lib/db';
import type { ProviderConfig } from '$lib/ai/types';
import type { GeneratedQuiz, GradedAnswer } from '$lib/ai/generate/quiz';
import type { LanguageModel } from 'ai';

vi.mock('$lib/ai/client', () => ({
	getActiveSdkProvider: vi.fn()
}));

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	APICallError: class extends Error {
		statusCode: number;
		responseBody?: string;
		responseHeaders?: Record<string, string>;
		constructor(
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) {
			super(msg);
			this.statusCode = opts?.statusCode ?? 0;
			this.responseBody = opts?.responseBody;
			this.responseHeaders = opts?.responseHeaders;
		}
	}
}));

const { getActiveSdkProvider } = await import('$lib/ai/client');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

import { quizzesStore } from './quizzes.svelte';

const stubConfig: ProviderConfig = {
	id: 'stub',
	kind: 'openai-compatible',
	name: 'stub',
	baseUrl: 'http://stub',
	defaultModel: 'stub-model',
	models: ['stub-model']
};

const validQuiz: GeneratedQuiz = {
	questions: [
		{ type: 'mcq', prompt: '2+2?', payload: { options: ['3', '4', '5'], answerIndex: 1 } },
		{ type: 'flashcard', prompt: 'capitol of France', payload: { front: 'France', back: 'Paris' } },
		{ type: 'short', prompt: 'explain X', payload: { rubric: 'must mention Y' } }
	]
};

const oneMcqQuiz: GeneratedQuiz = {
	questions: [
		{ type: 'mcq', prompt: '2+2?', payload: { options: ['3', '4', '5'], answerIndex: 1 } }
	]
};

const oneShortQuiz: GeneratedQuiz = {
	questions: [{ type: 'short', prompt: 'explain X', payload: { rubric: 'must mention Y' } }]
};

const gradedCorrect: GradedAnswer = { isCorrect: true, feedback: 'good' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	mockedGetActiveSdkProvider.mockReset();
	mockedGenerateText.mockReset();
	quizzesStore.list = [];
	quizzesStore.current = null;
	quizzesStore.questions = [];
	quizzesStore.activeAttempt = null;
	quizzesStore.answers = {};
	quizzesStore.history = [];
	quizzesStore.generating = false;
	quizzesStore.loading = false;
	quizzesStore.gradingQuestionId = null;
	quizzesStore.error = null;
});

async function seedChat(): Promise<string> {
	const chat = await repos.chats.createRoot({ title: 'C' });
	await repos.messages.append(chat.id, 'user', 'teach me something');
	return chat.id;
}

function mockProviderReturningQuiz(_quiz: GeneratedQuiz) {
	mockedGetActiveSdkProvider.mockResolvedValue({
		model: {} as LanguageModel,
		config: stubConfig,
		toolCapability: true
	});
}

function mockGenerateReturningQuiz(quiz: GeneratedQuiz) {
	mockedGenerateText.mockResolvedValue({
		toolCalls: [{ toolName: 'json', input: quiz }],
		text: ''
	} as never);
}

describe('quizzesStore.generate', () => {
	it('persists a generated quiz and its questions, returning the id', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockGenerateReturningQuiz(validQuiz);
		const chatId = await seedChat();

		const id = await quizzesStore.generate(chatId);

		expect(id).not.toBeNull();
		const quiz = await repos.quizzes.getById(id!);
		expect(quiz).not.toBeNull();
		expect(quiz!.model).toBe('stub-model');
		const questions = await repos.quizQuestions.listByQuiz(id!);
		expect(questions).toHaveLength(3);
		expect(questions.map((q) => q.type)).toEqual(['mcq', 'flashcard', 'short']);
		const mcq = repos.quizQuestions.parsePayload<McqPayload>(questions[0].payload);
		expect(mcq.options).toHaveLength(3);
		expect(new Set(mcq.options)).toEqual(new Set(['3', '4', '5']));
		expect(mcq.options[mcq.answerIndex]).toBe('4');
		const fc = repos.quizQuestions.parsePayload<FlashcardPayload>(questions[1].payload);
		expect(fc.front).toBe('France');
		expect(fc.back).toBe('Paris');
		const sh = repos.quizQuestions.parsePayload<ShortPayload>(questions[2].payload);
		expect(sh.rubric).toBe('must mention Y');
		expect(quizzesStore.list[0].id).toBe(id);
		expect(quizzesStore.generating).toBe(false);
		expect(quizzesStore.error).toBeNull();
	});

	it('sets a typed error and persists nothing on QuizGenerationError', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockedGenerateText.mockRejectedValue(new Error('generation failed'));
		const chatId = await seedChat();

		const id = await quizzesStore.generate(chatId);

		expect(id).toBeNull();
		expect(quizzesStore.error).not.toBeNull();
		expect(quizzesStore.error!.title).toBe('Quiz generation failed');
		expect(await repos.quizzes.listAll()).toEqual([]);
	});

	it('surfaces a formatted error when there is no active provider', async () => {
		const { MissingKeyError } = await import('$lib/ai/types');
		mockedGetActiveSdkProvider.mockRejectedValue(new MissingKeyError('no provider'));
		const chatId = await seedChat();

		const id = await quizzesStore.generate(chatId);

		expect(id).toBeNull();
		expect(quizzesStore.error).not.toBeNull();
		expect(quizzesStore.error!.title).toBe('Missing API key');
	});

	it('is a no-op while already generating', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockGenerateReturningQuiz(validQuiz);
		const chatId = await seedChat();
		quizzesStore.generating = true;
		const id = await quizzesStore.generate(chatId);
		expect(id).toBeNull();
	});
});

describe('quizzesStore.startAttempt + answerMcq', () => {
	it('starts an attempt (empty answers, history grows) and auto-scores a correct mcq', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockGenerateReturningQuiz(validQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);

		await quizzesStore.startAttempt();

		expect(quizzesStore.activeAttempt).not.toBeNull();
		expect(Object.keys(quizzesStore.answers)).toHaveLength(0);
		expect(quizzesStore.history).toHaveLength(1);

		const mcqId = quizzesStore.questions[0].id;
		const mcqPayload = repos.quizQuestions.parsePayload<McqPayload>(
			quizzesStore.questions[0].payload
		);
		await quizzesStore.answerMcq(mcqId, mcqPayload.answerIndex);
		expect(quizzesStore.answers[mcqId]).toBeDefined();
		expect(quizzesStore.answers[mcqId].isCorrect).toBe(1);
	});

	it('auto-scores an incorrect mcq pick as wrong', async () => {
		mockProviderReturningQuiz(oneMcqQuiz);
		mockGenerateReturningQuiz(oneMcqQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();

		const mcqPayload = repos.quizQuestions.parsePayload<McqPayload>(
			quizzesStore.questions[0].payload
		);
		const wrongIndex = mcqPayload.answerIndex === 0 ? 1 : 0;
		await quizzesStore.answerMcq(quizzesStore.questions[0].id, wrongIndex);

		expect(quizzesStore.answers[quizzesStore.questions[0].id].isCorrect).toBe(0);
		expect(quizzesStore.score).toBe(0);
	});
});

describe('quizzesStore.answerFlashcard', () => {
	it('self-marks got/missed', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockGenerateReturningQuiz(validQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		const fcId = quizzesStore.questions[1].id;

		await quizzesStore.startAttempt();
		await quizzesStore.answerFlashcard(fcId, true);
		expect(quizzesStore.answers[fcId].isCorrect).toBe(1);

		await quizzesStore.startAttempt();
		await quizzesStore.answerFlashcard(fcId, false);
		expect(quizzesStore.answers[fcId].isCorrect).toBe(0);
	});
});

describe('quizzesStore.answerShort', () => {
	it('records the answer and applies the AI grade', async () => {
		mockProviderReturningQuiz(validQuiz);
		mockedGenerateText
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: validQuiz }],
				text: ''
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: gradedCorrect }],
				text: ''
			} as never);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const shortId = quizzesStore.questions[2].id;

		await quizzesStore.answerShort(shortId, 'my answer');

		expect(quizzesStore.answers[shortId]).toBeDefined();
		expect(quizzesStore.answers[shortId].isCorrect).toBe(1);
		expect(quizzesStore.answers[shortId].aiFeedback).toBe('good');
		const rows = await repos.quizAnswers.listByAttempt(quizzesStore.activeAttempt!.id);
		const row = rows.find((r) => r.questionId === shortId);
		expect(row).toBeDefined();
		expect(row!.isCorrect).toBe(1);
		expect(row!.aiFeedback).toBe('good');
	});

	it('leaves the answer ungraded with a message when grading fails', async () => {
		mockProviderReturningQuiz(oneShortQuiz);
		mockedGenerateText
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: oneShortQuiz }],
				text: ''
			} as never)
			.mockRejectedValueOnce(new Error('grade failed'));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const shortId = quizzesStore.questions[0].id;

		await quizzesStore.answerShort(shortId, 'my answer');

		expect(quizzesStore.answers[shortId]).toBeDefined();
		expect(quizzesStore.answers[shortId].isCorrect).toBeNull();
		expect(quizzesStore.answers[shortId].aiFeedback).toContain('Grading failed');
		const rows = await repos.quizAnswers.listByAttempt(quizzesStore.activeAttempt!.id);
		const row = rows.find((r) => r.questionId === shortId);
		expect(row).toBeDefined();
		expect(row!.isCorrect).toBeNull();
		expect(quizzesStore.score).toBe(0);
		expect(quizzesStore.isComplete).toBe(false);
		expect(quizzesStore.error).toBeNull();
	});

	it('re-grades a previously failed answer on regrade()', async () => {
		mockProviderReturningQuiz(oneShortQuiz);
		mockedGenerateText
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: oneShortQuiz }],
				text: ''
			} as never)
			.mockRejectedValueOnce(new Error('grade failed'))
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: gradedCorrect }],
				text: ''
			} as never);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const shortId = quizzesStore.questions[0].id;

		await quizzesStore.answerShort(shortId, 'my answer');
		expect(quizzesStore.answers[shortId].isCorrect).toBeNull();

		await quizzesStore.regrade(shortId);
		expect(quizzesStore.answers[shortId].isCorrect).toBe(1);
		expect(quizzesStore.answers[shortId].aiFeedback).toBe('good');
	});
});

describe('quizzesStore live score + finalisation', () => {
	it('finalises the attempt with the correct score once all are answered', async () => {
		mockProviderReturningQuiz(oneMcqQuiz);
		mockGenerateReturningQuiz(oneMcqQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const mcqId = quizzesStore.questions[0].id;
		const mcqPayload = repos.quizQuestions.parsePayload<McqPayload>(
			quizzesStore.questions[0].payload
		);

		await quizzesStore.answerMcq(mcqId, mcqPayload.answerIndex);

		expect(quizzesStore.score).toBe(1);
		expect(quizzesStore.allAnswered).toBe(true);
		expect(quizzesStore.isComplete).toBe(true);
		const row = await repos.quizAttempts.getById(quizzesStore.activeAttempt!.id);
		expect(row).not.toBeNull();
		expect(row!.finishedAt).not.toBeNull();
		expect(row!.score).toBe(1);
	});

	it('retake starts a fresh attempt that resets answers', async () => {
		mockProviderReturningQuiz(oneMcqQuiz);
		mockGenerateReturningQuiz(oneMcqQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const mcqPayload = repos.quizQuestions.parsePayload<McqPayload>(
			quizzesStore.questions[0].payload
		);
		await quizzesStore.answerMcq(quizzesStore.questions[0].id, mcqPayload.answerIndex);
		expect(quizzesStore.isComplete).toBe(true);
		const beforeId = quizzesStore.activeAttempt!.id;

		await quizzesStore.retake();

		expect(quizzesStore.activeAttempt!.id).not.toBe(beforeId);
		expect(quizzesStore.answers).toEqual({});
		expect(quizzesStore.activeAttempt!.finishedAt).toBeNull();
		expect(quizzesStore.history).toHaveLength(2);
	});
});

describe('quizzesStore.loadHistory', () => {
	it('refreshes attempts newest-first', async () => {
		mockProviderReturningQuiz(oneMcqQuiz);
		mockGenerateReturningQuiz(oneMcqQuiz);
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);

		await quizzesStore.startAttempt();
		const first = quizzesStore.activeAttempt!.id;
		await repos.quizAttempts.finish(first, 1);
		await sleep(5);
		await quizzesStore.startAttempt();
		const second = quizzesStore.activeAttempt!.id;

		await quizzesStore.loadHistory();

		expect(quizzesStore.history).toHaveLength(2);
		expect(quizzesStore.history[0].id).toBe(second);
		expect(quizzesStore.history[1].id).toBe(first);
	});
});

describe('quizzesStore.loadList / loadQuiz', () => {
	it('loadList is a no-op under SSR (does not throw)', async () => {
		await quizzesStore.loadList();
		expect(Array.isArray(quizzesStore.list)).toBe(true);
	});

	it('loadQuiz is a no-op under SSR (does not throw)', async () => {
		await quizzesStore.loadQuiz('nope');
		expect(quizzesStore.current).toBeNull();
	});
});
