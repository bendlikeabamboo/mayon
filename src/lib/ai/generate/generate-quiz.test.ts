import { describe, expect, it } from 'vitest';
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
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import type { GeneratedQuiz, GradedAnswer } from './quiz';

/**
 * A controllable stub provider for orchestrator tests. It emits one scripted
 * full-string reply per `chatStream` call (regardless of the message list), in
 * order, so tests can simulate "bad then good" retry sequences and aborts.
 */
function scriptedProvider(replies: string[]): Provider {
	let call = 0;
	const calls: ChatMessage[][] = [];
	const config: ProviderConfig = {
		id: 'stub',
		kind: 'openai-compatible',
		name: 'stub',
		baseUrl: 'http://stub',
		defaultModel: 'stub-model',
		models: ['stub-model']
	};
	return {
		kind: 'openai-compatible',
		config,
		async *chatStream(messages: ChatMessage[], opts?: ChatStreamOptions): AsyncIterable<Token> {
			calls.push(messages);
			// Honor an abort signal between/within calls (simulates mid-stream cancel).
			if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const reply = replies[Math.min(call, replies.length - 1)] ?? '';
			call += 1;
			// Yield the reply one char at a time to exercise accumulation.
			for (const ch of reply) {
				if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				yield { text: ch };
			}
		},
		generateLab: () => {
			throw new Error('not used — orchestrator drives chatStream directly');
		},
		generateQuiz: () => Promise.reject(new Error('P4')),
		gradeShortAnswer: () => Promise.reject(new Error('P4'))
	};
}

const validQuiz: GeneratedQuiz = {
	questions: [
		{ type: 'mcq', prompt: 'p1', payload: { options: ['a', 'b', 'c', 'd'], answerIndex: 1 } },
		{ type: 'flashcard', prompt: 'p2', payload: { front: 'f', back: 'b' } },
		{ type: 'short', prompt: 'p3', payload: { rubric: 'must mention X' } }
	]
};
const validQuizJson = JSON.stringify(validQuiz);
const fencedValidQuiz = '```json\n' + validQuizJson + '\n```';

const validGrade: GradedAnswer = { isCorrect: true, feedback: 'good' };
const validGradeJson = JSON.stringify(validGrade);
const fencedValidGrade = '```json\n' + validGradeJson + '\n```';

function quizOpts(prompt: string): GenerateQuizOptions {
	return { prompt };
}

function gradeOpts(prompt: string): GradeShortAnswerOptions {
	return { prompt };
}

describe('generateQuiz', () => {
	it('parses a valid fenced reply on the first attempt', async () => {
		const provider = scriptedProvider([fencedValidQuiz]);
		const quiz = await generateQuiz(provider, [{ role: 'user', content: 'go' }], quizOpts('p'));
		expect(quiz).toEqual(validQuiz);
	});

	it('prepends the quiz prompt as a leading system message', async () => {
		const provider = scriptedProvider([fencedValidQuiz]);
		const seen: ChatMessage[][] = [];
		// Wrap to capture the messages handed to chatStream.
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await generateQuiz(provider, [{ role: 'user', content: 'ctx' }], quizOpts('MY QUIZ PROMPT'));
		expect(seen[0][0]).toEqual({ role: 'system', content: 'MY QUIZ PROMPT' });
		// Original context follows.
		expect(seen[0][1]).toEqual({ role: 'user', content: 'ctx' });
	});

	it('retries once and succeeds when the second reply is valid', async () => {
		const provider = scriptedProvider(['garbage', fencedValidQuiz]);
		const quiz = await generateQuiz(provider, [{ role: 'user', content: 'x' }], quizOpts('p'));
		expect(quiz).toEqual(validQuiz);
	});

	it('feeds the bad output back as an assistant turn + correction on retry', async () => {
		const provider = scriptedProvider(['garbage', fencedValidQuiz]);
		const seen: ChatMessage[][] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await generateQuiz(provider, [{ role: 'user', content: 'x' }], quizOpts('p'));
		// Second call's tail: [..., assistant:garbage, user:correction].
		const second = seen[1];
		expect(second.at(-2)).toEqual({ role: 'assistant', content: 'garbage' });
		expect(second.at(-1)?.role).toBe('user');
		expect(second.at(-1)?.content).toContain('not valid JSON');
	});

	it('throws QuizGenerationError (with raw) after exhausting retries', async () => {
		const provider = scriptedProvider(['bad1', 'bad2', 'bad3']);
		let err: unknown;
		try {
			await generateQuiz(provider, [{ role: 'user', content: 'x' }], quizOpts('p'));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(QuizGenerationError);
		expect((err as QuizGenerationError).raw).toBe('bad3');
	});

	it('propagates AbortError from the stream (does not retry)', async () => {
		const provider = scriptedProvider([fencedValidQuiz]);
		const ac = new AbortController();
		ac.abort();
		await expect(
			generateQuiz(provider, [{ role: 'user', content: 'x' }], {
				...quizOpts('p'),
				signal: ac.signal
			})
		).rejects.toThrow(/Aborted/);
	});

	it('does not retry on a non-parse stream error (propagates)', async () => {
		const provider: Provider = {
			...scriptedProvider([fencedValidQuiz]),
			chatStream(): AsyncIterable<Token> {
				// A throwing async iterable (no yield) so the orchestrator surfaces
				// the transport error instead of treating it as a parse failure.
				// eslint-disable-next-line require-yield -- intentionally throws before yielding
				return (async function* () {
					throw new Error('network down');
				})();
			}
		};
		await expect(
			generateQuiz(provider, [{ role: 'user', content: 'x' }], quizOpts('p'))
		).rejects.toThrow('network down');
	});
});

describe('gradeShortAnswer', () => {
	it('parses a valid fenced reply on the first attempt', async () => {
		const provider = scriptedProvider([fencedValidGrade]);
		const grade = await gradeShortAnswer(
			provider,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context: [] },
			gradeOpts('p')
		);
		expect(grade).toEqual(validGrade);
	});

	it('prepends the grade prompt as a leading system message', async () => {
		const provider = scriptedProvider([fencedValidGrade]);
		const seen: ChatMessage[][] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await gradeShortAnswer(
			provider,
			{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
			gradeOpts('MY GRADE PROMPT')
		);
		expect(seen[0][0]).toEqual({ role: 'system', content: 'MY GRADE PROMPT' });
	});

	it('includes context messages and a final user turn with rubric + answer', async () => {
		const provider = scriptedProvider([fencedValidGrade]);
		const seen: ChatMessage[][] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		const context: ChatMessage[] = [{ role: 'user', content: 'ctx msg' }];
		await gradeShortAnswer(
			provider,
			{ prompt: 'q', rubric: 'must mention X', answer: 'my answer', context },
			gradeOpts('p')
		);
		// Context message appears in the turns handed to chatStream.
		expect(seen[0]).toContainEqual({ role: 'user', content: 'ctx msg' });
		// Final user turn carries the rubric and the learner's answer.
		const last = seen[0].at(-1);
		expect(last?.role).toBe('user');
		expect(last?.content).toContain('must mention X');
		expect(last?.content).toContain('my answer');
	});

	it('throws GradeError (with raw) after exhausting retries', async () => {
		const provider = scriptedProvider(['bad1', 'bad2', 'bad3']);
		let err: unknown;
		try {
			await gradeShortAnswer(
				provider,
				{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
				gradeOpts('p')
			);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(GradeError);
		expect((err as GradeError).raw).toBe('bad3');
	});

	it('propagates AbortError from the stream (does not retry)', async () => {
		const provider = scriptedProvider([fencedValidGrade]);
		const ac = new AbortController();
		ac.abort();
		await expect(
			gradeShortAnswer(
				provider,
				{ prompt: 'q', rubric: 'r', answer: 'a', context: [] },
				{ ...gradeOpts('p'), signal: ac.signal }
			)
		).rejects.toThrow(/Aborted/);
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
