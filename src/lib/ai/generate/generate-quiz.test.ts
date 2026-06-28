import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_QUIZ_PROMPT,
	DEFAULT_GRADE_PROMPT,
	QuizGenerationError,
	GradeError,
	generateQuiz,
	gradeShortAnswer,
	type GenerateQuizOptions,
	type GradeShortAnswerOptions
} from './generate-quiz';
import type { ChatMessage } from '../types';
import type { GeneratedQuiz, GradedAnswer } from './quiz';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
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

const { generateObject } = await import('ai');
const mockedGenerateObject = vi.mocked(generateObject);

const mockModel = {} as LanguageModel;

const validQuiz: GeneratedQuiz = {
	questions: [
		{ type: 'mcq', prompt: 'p1', payload: { options: ['a', 'b', 'c', 'd'], answerIndex: 1 } },
		{ type: 'flashcard', prompt: 'p2', payload: { front: 'f', back: 'b' } },
		{ type: 'short', prompt: 'p3', payload: { rubric: 'must mention X' } }
	]
};

const validGrade: GradedAnswer = { isCorrect: true, feedback: 'good' };

function quizOpts(prompt: string): GenerateQuizOptions {
	return { prompt };
}

function gradeOpts(prompt: string): GradeShortAnswerOptions {
	return { prompt };
}

const messages: ChatMessage[] = [{ role: 'user', content: 'go' }];

describe('generateQuiz', () => {
	beforeEach(() => {
		mockedGenerateObject.mockReset();
	});

	it('returns the parsed quiz on success', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		const quiz = await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(quiz).toEqual(validQuiz);
	});

	it('passes the prompt as the system instruction', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		await generateQuiz(mockModel, messages, quizOpts('MY QUIZ PROMPT'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY QUIZ PROMPT' })
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: 'user', content: 'go' }]
			})
		);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		const ac = new AbortController();
		await generateQuiz(mockModel, messages, { prompt: 'p', signal: ac.signal });
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in QuizGenerationError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('boom'));
		await expect(generateQuiz(mockModel, messages, quizOpts('p'))).rejects.toThrow(
			QuizGenerationError
		);
	});

	it('carries raw message in QuizGenerationError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('parse fail'));
		try {
			await generateQuiz(mockModel, messages, quizOpts('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(QuizGenerationError);
			expect((e as QuizGenerationError).raw).toBe('parse fail');
		}
	});

	it('carries responseBody from APICallError as raw', async () => {
		const { APICallError } = await import('ai');
		const apiErr = new (APICallError as unknown as new (
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) => InstanceType<typeof APICallError>)('fail', {
			statusCode: 500,
			responseBody: 'raw quiz body'
		});
		mockedGenerateObject.mockRejectedValue(apiErr);
		try {
			await generateQuiz(mockModel, messages, quizOpts('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(QuizGenerationError);
			expect((e as QuizGenerationError).raw).toBe('raw quiz body');
		}
	});

	it('preserves multiple message roles', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validQuiz } as never);
		const multi: ChatMessage[] = [
			{ role: 'user', content: 'q1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'q2' }
		];
		await generateQuiz(mockModel, multi, quizOpts('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: 'user', content: 'q1' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'q2' }
				]
			})
		);
	});
});

describe('gradeShortAnswer', () => {
	beforeEach(() => {
		mockedGenerateObject.mockReset();
	});

	it('returns the graded answer on success', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		const grade = await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context: [] },
			gradeOpts('p')
		);
		expect(grade).toEqual(validGrade);
	});

	it('passes the grade prompt as the system instruction', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('MY GRADE PROMPT')
		);
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY GRADE PROMPT' })
		);
	});

	it('includes context messages in the generated call', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		const context: ChatMessage[] = [{ role: 'user', content: 'ctx msg' }];
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context },
			gradeOpts('p')
		);
		const callArgs = mockedGenerateObject.mock.calls[0][0];
		expect(callArgs.messages).toContainEqual({ role: 'user', content: 'ctx msg' });
	});

	it('includes a final user turn with rubric and answer', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context: [] },
			gradeOpts('p')
		);
		const callArgs = mockedGenerateObject.mock.calls[0][0];
		const last = callArgs.messages?.at(-1);
		expect(last?.role).toBe('user');
		expect(last?.content).toContain('must mention X');
		expect(last?.content).toContain('my answer');
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('p')
		);
		expect(mockedGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in GradeError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('grade boom'));
		await expect(
			gradeShortAnswer(
				mockModel,
				{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
				gradeOpts('p')
			)
		).rejects.toThrow(GradeError);
	});

	it('carries raw message in GradeError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('grade fail'));
		try {
			await gradeShortAnswer(
				mockModel,
				{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
				gradeOpts('p')
			);
		} catch (e) {
			expect(e).toBeInstanceOf(GradeError);
			expect((e as GradeError).raw).toBe('grade fail');
		}
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validGrade } as never);
		const ac = new AbortController();
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			{ prompt: 'p', signal: ac.signal }
		);
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});
});

describe('DEFAULT_QUIZ_PROMPT', () => {
	it('instructs the model to emit a json fence with the exact shape', () => {
		expect(DEFAULT_QUIZ_PROMPT).toContain('```json');
		expect(DEFAULT_QUIZ_PROMPT).toContain('questions');
		expect(DEFAULT_QUIZ_PROMPT).toContain('mcq');
		expect(DEFAULT_QUIZ_PROMPT).toContain('flashcard');
		expect(DEFAULT_QUIZ_PROMPT).toContain('short');
	});
});

describe('DEFAULT_GRADE_PROMPT', () => {
	it('instructs the model to emit a json fence with isCorrect/feedback', () => {
		expect(DEFAULT_GRADE_PROMPT).toContain('```json');
		expect(DEFAULT_GRADE_PROMPT).toContain('isCorrect');
		expect(DEFAULT_GRADE_PROMPT).toContain('feedback');
	});
});
