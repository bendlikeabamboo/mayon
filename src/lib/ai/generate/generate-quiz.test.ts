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

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

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
		mockedGenerateText.mockReset();
	});

	it('returns the parsed quiz on success', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		const quiz = await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(quiz).toEqual(validQuiz);
	});

	it('passes the prompt as the system instruction', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		await generateQuiz(mockModel, messages, quizOpts('MY QUIZ PROMPT'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY QUIZ PROMPT' })
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: 'user', content: 'go' }]
			})
		);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		const ac = new AbortController();
		await generateQuiz(mockModel, messages, { prompt: 'p', signal: ac.signal });
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in QuizGenerationError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('boom'));
		await expect(generateQuiz(mockModel, messages, quizOpts('p'))).rejects.toThrow(
			QuizGenerationError
		);
	});

	it('carries raw message in QuizGenerationError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('parse fail'));
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
		mockedGenerateText.mockRejectedValue(apiErr);
		try {
			await generateQuiz(mockModel, messages, quizOpts('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(QuizGenerationError);
			expect((e as QuizGenerationError).raw).toBe('raw quiz body');
		}
	});

	it('preserves multiple message roles', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		const multi: ChatMessage[] = [
			{ role: 'user', content: 'q1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'q2' }
		];
		await generateQuiz(mockModel, multi, quizOpts('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: 'user', content: 'q1' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'q2' }
				]
			})
		);
	});

	it('calls the model only once on success (no corrective retry)', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
	});

	it('retries once with corrective feedback when the tool input fails the schema', async () => {
		const badInput = {
			questions: [{ type: 'dropdown', prompt: 'x', payload: {} }]
		};
		mockedGenerateText
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: badInput }],
				text: 'here is your quiz'
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: validQuiz }],
				text: ''
			} as never);

		const quiz = await generateQuiz(mockModel, messages, quizOpts('p'));

		expect(quiz).toEqual(validQuiz);
		expect(mockedGenerateText).toHaveBeenCalledTimes(2);
		const retryArgs = mockedGenerateText.mock.calls[1][0] as {
			messages: Array<{ role: string; content: string }>;
		};
		const last = retryArgs.messages.at(-1);
		expect(last?.role).toBe('user');
		expect(last?.content).toContain('rejected by validation');
		expect(last?.content).toContain('"mcq"');
		// The corrective turn is appended after the original context, not replacing it.
		expect(retryArgs.messages[0]).toEqual({ role: 'user', content: 'go' });
	});

	it('gives up after two corrective retries if the model still fails the schema', async () => {
		const badInput = { questions: [] };
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: badInput }],
			text: 'nope'
		} as never);
		await expect(generateQuiz(mockModel, messages, quizOpts('p'))).rejects.toThrow(
			QuizGenerationError
		);
		expect(mockedGenerateText).toHaveBeenCalledTimes(3);
	});

	it('recovers on the second corrective retry (three calls)', async () => {
		mockedGenerateText
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: { questions: [] } }],
				text: ''
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [
					{
						toolName: 'json',
						input: { questions: [{ type: 'dropdown', prompt: '', payload: {} }] }
					}
				],
				text: ''
			} as never)
			.mockResolvedValueOnce({
				toolCalls: [{ toolName: 'json', input: validQuiz }],
				text: ''
			} as never);

		const quiz = await generateQuiz(mockModel, messages, quizOpts('p'));

		expect(quiz).toEqual(validQuiz);
		expect(mockedGenerateText).toHaveBeenCalledTimes(3);
		const retryMessages = mockedGenerateText.mock.calls
			.slice(1)
			.map((call) =>
				(call[0] as { messages: Array<{ role: string; content: string }> }).messages.at(-1)
			);
		for (const last of retryMessages) {
			expect(last?.role).toBe('user');
			expect(last?.content).toContain('rejected by validation');
		}
	});

	it('repairs a fence-wrapped double-serialized tool input without a retry', async () => {
		const serializedTwice = JSON.stringify(JSON.stringify(validQuiz));
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: '```json\n' + serializedTwice + '\n```' }],
			text: ''
		} as never);
		const quiz = await generateQuiz(mockModel, messages, quizOpts('p'));
		expect(quiz).toEqual(validQuiz);
		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
	});

	it('does not retry on transport failures', async () => {
		mockedGenerateText.mockRejectedValue(new Error('boom'));
		await expect(generateQuiz(mockModel, messages, quizOpts('p'))).rejects.toThrow(
			QuizGenerationError
		);
		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
	});

	it('skips the corrective retry when the signal is already aborted', async () => {
		const badInput = { questions: [] };
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: badInput }],
			text: ''
		} as never);
		const ac = new AbortController();
		ac.abort();
		await expect(
			generateQuiz(mockModel, messages, { prompt: 'p', signal: ac.signal })
		).rejects.toThrow(QuizGenerationError);
		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
	});
});

describe('gradeShortAnswer', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it('returns the graded answer on success', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		const grade = await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context: [] },
			gradeOpts('p')
		);
		expect(grade).toEqual(validGrade);
	});

	it('passes the grade prompt as the system instruction', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('MY GRADE PROMPT')
		);
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY GRADE PROMPT' })
		);
	});

	it('includes context messages in the generated call', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		const context: ChatMessage[] = [{ role: 'user', content: 'ctx msg' }];
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context },
			gradeOpts('p')
		);
		const callArgs = mockedGenerateText.mock.calls[0][0];
		expect(callArgs.messages).toContainEqual({ role: 'user', content: 'ctx msg' });
	});

	it('includes a final user turn with rubric and answer', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context: [] },
			gradeOpts('p')
		);
		const callArgs = mockedGenerateText.mock.calls[0][0];
		const last = callArgs.messages?.at(-1);
		expect(last?.role).toBe('user');
		expect(last?.content).toContain('must mention X');
		expect(last?.content).toContain('my answer');
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('p')
		);
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in GradeError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('grade boom'));
		await expect(
			gradeShortAnswer(
				mockModel,
				{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
				gradeOpts('p')
			)
		).rejects.toThrow(GradeError);
	});

	it('carries raw message in GradeError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('grade fail'));
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
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		const ac = new AbortController();
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			{ prompt: 'p', signal: ac.signal }
		);
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});
});

describe('DEFAULT_QUIZ_PROMPT', () => {
	it('describes the exact JSON shape without fenced blocks', () => {
		expect(DEFAULT_QUIZ_PROMPT).not.toContain('```json');
		expect(DEFAULT_QUIZ_PROMPT).toContain('questions');
		expect(DEFAULT_QUIZ_PROMPT).toContain('mcq');
		expect(DEFAULT_QUIZ_PROMPT).toContain('flashcard');
		expect(DEFAULT_QUIZ_PROMPT).toContain('short');
	});

	it('calls out the observed drift modes explicitly', () => {
		// These mirror the local repairs in quiz.ts / object-tool.ts: flat
		// payloads, prompt-in-payload, duplicate type-in-payload, out-of-range
		// answerIndex, fences/stringified arguments.
		expect(DEFAULT_QUIZ_PROMPT).toMatch(/NEXT TO "type"/);
		expect(DEFAULT_QUIZ_PROMPT).toMatch(/never "type", never "prompt"/);
		expect(DEFAULT_QUIZ_PROMPT).toMatch(/0 <= answerIndex < options\.length/);
		expect(DEFAULT_QUIZ_PROMPT).toMatch(/no markdown code fences/);
	});
});

describe('DEFAULT_GRADE_PROMPT', () => {
	it('describes the exact JSON shape with isCorrect/feedback without fenced blocks', () => {
		expect(DEFAULT_GRADE_PROMPT).not.toContain('```json');
		expect(DEFAULT_GRADE_PROMPT).toContain('isCorrect');
		expect(DEFAULT_GRADE_PROMPT).toContain('feedback');
	});
});

describe('tool description pass-through', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	function calledToolDescription(): string | undefined {
		const args = mockedGenerateText.mock.calls[0][0] as {
			tools?: { json?: { description?: string } };
		};
		return args.tools?.json?.description;
	}

	it('sends the quiz-specific `json` tool description', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validQuiz }],
			text: ''
		} as never);
		await generateQuiz(mockModel, messages, quizOpts('p'));
		const description = calledToolDescription();
		expect(description).toContain('"mcq"');
		expect(description).toContain('"payload"');
		expect(description).toContain('exactly once');
	});

	it('sends the grading-specific `json` tool description', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validGrade }],
			text: ''
		} as never);
		await gradeShortAnswer(
			mockModel,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('p')
		);
		const description = calledToolDescription();
		expect(description).toContain('"isCorrect"');
		expect(description).toContain('"feedback"');
	});
});
