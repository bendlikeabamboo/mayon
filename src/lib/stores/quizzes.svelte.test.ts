import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';
import { repos } from '$lib/db';
import type { McqPayload, FlashcardPayload, ShortPayload } from '$lib/db';
import type { Provider } from '$lib/ai/types';
import type { GeneratedQuiz, GradedAnswer } from '$lib/ai/generate/quiz';
import { QuizGenerationError, GradeError } from '$lib/ai/generate/generate-quiz';

/**
 * quizzesStore tests. The store calls `getActiveProvider()` (which reads
 * settings), so we mock `$lib/ai/client` to hand back a controllable stub
 * provider. DB state is real (in-memory driver), so persistence, auto-scoring,
 * AI grading, and attempt finalisation are exercised end-to-end through the
 * repository layer.
 */

// --- Stub provider -----------------------------------------------------------
// The store calls `provider.generateQuiz(...)` (generation) and
// `provider.gradeShortAnswer(...)` (short-answer grading). In real adapters both
// delegate to the orchestrator; in these store tests we control the outcome
// directly — returning a GeneratedQuiz / GradedAnswer, or throwing a typed
// generation/grade error — so we cover the store's success / error / ungraded
// branches without re-testing the orchestrator (covered in generate-quiz tests).
function baseProvider(
	generateQuizImpl: () => Promise<GeneratedQuiz>,
	gradeShortAnswerImpl: () => Promise<GradedAnswer>
): Provider {
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
		// Unused by the store path, but required by the interface.
		async *chatStream() {
			yield { text: '' };
		},
		generateLab: () => Promise.reject(new Error('not used')),
		generateQuiz: generateQuizImpl,
		gradeShortAnswer: gradeShortAnswerImpl
	};
}

/** Provider whose `generateQuiz` returns `quiz` (grading unused). */
function providerReturningQuiz(quiz: GeneratedQuiz): Provider {
	return baseProvider(
		async () => quiz,
		async () => Promise.reject(new Error('grade not used'))
	);
}

/** Provider whose `generateQuiz` throws `err` (generation failure). */
function providerQuizError(err: Error): Provider {
	return baseProvider(
		async () => Promise.reject(err),
		async () => Promise.reject(new Error('grade not used'))
	);
}

/** Provider whose `generateQuiz` returns `quiz` and `gradeShortAnswer` returns `grade`. */
function providerQuizAndGrade(quiz: GeneratedQuiz, grade: GradedAnswer): Provider {
	return baseProvider(
		async () => quiz,
		async () => grade
	);
}

/** Provider whose `generateQuiz` returns `quiz` and `gradeShortAnswer` throws `err`. */
function providerGradeError(quiz: GeneratedQuiz, err: Error): Provider {
	return baseProvider(
		async () => quiz,
		async () => Promise.reject(err)
	);
}

// --- Fixtures ----------------------------------------------------------------
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

// --- Mocks -------------------------------------------------------------------
// `assembleContext` is real (reads messages) but we only need it to return a
// non-empty list; seed a chat with one message to satisfy it.
vi.mock('$lib/ai/client', () => ({
	getActiveProvider: vi.fn()
}));

// Pull the mocked fn after mock registration.
const { getActiveProvider } = await import('$lib/ai/client');
const mockedGetActiveProvider = vi.mocked(getActiveProvider);

// The store module imports `$app/environment` (for `browser` guards). Vitest
// resolves it via the svelte vite config; in the test env `browser` is false,
// which makes loadList/loadQuiz no-op. We import the store fresh and set up
// state by exercising `generate`/`startAttempt`/`answer*`, which do not guard
// on `browser`.
import { quizzesStore } from './quizzes.svelte';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
	mockedGetActiveProvider.mockReset();
	// Reset singleton state between tests.
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

describe('quizzesStore.generate', () => {
	it('persists a generated quiz and its questions, returning the id', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(validQuiz));
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
		expect(mcq.options).toEqual(['3', '4', '5']);
		expect(mcq.answerIndex).toBe(1);
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
		mockedGetActiveProvider.mockResolvedValue(
			providerQuizError(new QuizGenerationError('bad', 'raw'))
		);
		const chatId = await seedChat();

		const id = await quizzesStore.generate(chatId);

		expect(id).toBeNull();
		expect(quizzesStore.error).not.toBeNull();
		expect(quizzesStore.error!.title).toBe('Quiz generation failed');
		expect(await repos.quizzes.listAll()).toEqual([]);
	});

	it('surfaces a formatted error when there is no active provider', async () => {
		const { MissingKeyError } = await import('$lib/ai/types');
		mockedGetActiveProvider.mockRejectedValue(new MissingKeyError('no provider'));
		const chatId = await seedChat();

		const id = await quizzesStore.generate(chatId);

		expect(id).toBeNull();
		expect(quizzesStore.error).not.toBeNull();
		expect(quizzesStore.error!.title).toBe('Missing API key');
	});

	it('is a no-op while already generating', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(validQuiz));
		const chatId = await seedChat();
		quizzesStore.generating = true;
		const id = await quizzesStore.generate(chatId);
		expect(id).toBeNull();
	});
});

describe('quizzesStore.startAttempt + answerMcq', () => {
	it('starts an attempt (empty answers, history grows) and auto-scores a correct mcq', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(validQuiz));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);

		await quizzesStore.startAttempt();

		expect(quizzesStore.activeAttempt).not.toBeNull();
		expect(Object.keys(quizzesStore.answers)).toHaveLength(0);
		expect(quizzesStore.history).toHaveLength(1);

		const mcqId = quizzesStore.questions[0].id;
		await quizzesStore.answerMcq(mcqId, 1);
		expect(quizzesStore.answers[mcqId]).toBeDefined();
		expect(quizzesStore.answers[mcqId].isCorrect).toBe(1);
	});

	it('auto-scores an incorrect mcq pick as wrong', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(oneMcqQuiz));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();

		await quizzesStore.answerMcq(quizzesStore.questions[0].id, 0);

		expect(quizzesStore.answers[quizzesStore.questions[0].id].isCorrect).toBe(0);
		expect(quizzesStore.score).toBe(0);
	});
});

describe('quizzesStore.answerFlashcard', () => {
	it('self-marks got/missed', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(validQuiz));
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
		mockedGetActiveProvider.mockResolvedValue(providerQuizAndGrade(validQuiz, gradedCorrect));
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
		// Persisted to the row.
		const rows = await repos.quizAnswers.listByAttempt(quizzesStore.activeAttempt!.id);
		const row = rows.find((r) => r.questionId === shortId);
		expect(row).toBeDefined();
		expect(row!.isCorrect).toBe(1);
		expect(row!.aiFeedback).toBe('good');
	});

	it('leaves the answer ungraded with a message when grading fails', async () => {
		mockedGetActiveProvider.mockResolvedValue(
			providerGradeError(oneShortQuiz, new GradeError('nope', 'raw'))
		);
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
		// The DB row is ungraded.
		const rows = await repos.quizAnswers.listByAttempt(quizzesStore.activeAttempt!.id);
		const row = rows.find((r) => r.questionId === shortId);
		expect(row).toBeDefined();
		expect(row!.isCorrect).toBeNull();
		// Excluded from the score, and the attempt is NOT auto-finalised.
		expect(quizzesStore.score).toBe(0);
		expect(quizzesStore.isComplete).toBe(false);
		expect(quizzesStore.error).toBeNull();
	});

	it('re-grades a previously failed answer on regrade()', async () => {
		// generate (call 1): succeeds.
		mockedGetActiveProvider.mockResolvedValueOnce(providerReturningQuiz(oneShortQuiz));
		// answerShort grading (call 2): fails.
		mockedGetActiveProvider.mockResolvedValueOnce(
			providerGradeError(oneShortQuiz, new GradeError('nope', 'raw'))
		);
		// regrade grading (call 3): succeeds.
		mockedGetActiveProvider.mockResolvedValueOnce(
			providerQuizAndGrade(oneShortQuiz, gradedCorrect)
		);
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
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(oneMcqQuiz));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		const mcqId = quizzesStore.questions[0].id;

		await quizzesStore.answerMcq(mcqId, 1);

		expect(quizzesStore.score).toBe(1);
		expect(quizzesStore.allAnswered).toBe(true);
		expect(quizzesStore.isComplete).toBe(true);
		const row = await repos.quizAttempts.getById(quizzesStore.activeAttempt!.id);
		expect(row).not.toBeNull();
		expect(row!.finishedAt).not.toBeNull();
		expect(row!.score).toBe(1);
	});

	it('retake starts a fresh attempt that resets answers', async () => {
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(oneMcqQuiz));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);
		quizzesStore.questions = await repos.quizQuestions.listByQuiz(id!);
		await quizzesStore.startAttempt();
		await quizzesStore.answerMcq(quizzesStore.questions[0].id, 1);
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
		mockedGetActiveProvider.mockResolvedValue(providerReturningQuiz(oneMcqQuiz));
		const chatId = await seedChat();
		const id = await quizzesStore.generate(chatId);
		quizzesStore.current = await repos.quizzes.getById(id!);

		await quizzesStore.startAttempt();
		const first = quizzesStore.activeAttempt!.id;
		await repos.quizAttempts.finish(first, 1);
		// Guarantee a later startedAt so newest-first ordering is deterministic.
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
