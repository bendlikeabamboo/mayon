import { describe, expect, it } from 'vitest';
import {
	GeneratedQuizSchema,
	GradedAnswerSchema,
	GradeParseError,
	QuizParseError,
	parseGeneratedQuiz,
	parseGradedAnswer,
	toQuizQuestions,
	type GeneratedQuiz
} from './quiz';
import { extractFencedJson } from './fence';
import { extractFencedJson as extractFencedJsonFromLab } from './lab';

const validMcq: GeneratedQuiz['questions'][number] = {
	type: 'mcq',
	prompt: 'What is 2 + 2?',
	payload: { options: ['3', '4', '5', '6'], answerIndex: 1 }
};
const validFlashcard: GeneratedQuiz['questions'][number] = {
	type: 'flashcard',
	prompt: 'Define ATP',
	payload: { front: 'ATP', back: 'Adenosine triphosphate' }
};
const validShort: GeneratedQuiz['questions'][number] = {
	type: 'short',
	prompt: 'Explain osmosis.',
	payload: { rubric: 'Mentions water moving across a semi-permeable membrane.' }
};

const mixedQuiz: GeneratedQuiz = {
	questions: [validMcq, validFlashcard, validShort]
};

function fence(obj: unknown): string {
	return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
}

describe('GeneratedQuizSchema (strict)', () => {
	it('accepts a well-formed mixed quiz', () => {
		expect(GeneratedQuizSchema.parse(mixedQuiz)).toEqual(mixedQuiz);
	});

	it('accepts a quiz with only one question', () => {
		const out = GeneratedQuizSchema.parse({ questions: [validMcq] });
		expect(out.questions).toHaveLength(1);
	});

	it('rejects an extra (unknown) field at top level', () => {
		expect(() => GeneratedQuizSchema.parse({ ...mixedQuiz, surprise: 'no' })).toThrow();
	});

	it('rejects an empty questions array', () => {
		expect(() => GeneratedQuizSchema.parse({ questions: [] })).toThrow();
	});

	it('rejects an unknown type', () => {
		expect(() =>
			GeneratedQuizSchema.parse({
				questions: [{ type: 'dropdown', prompt: 'x', payload: {} }]
			})
		).toThrow();
	});

	it('rejects an mcq whose answerIndex is out of range', () => {
		const outOfRange = { ...validMcq, payload: { ...validMcq.payload, answerIndex: 4 } };
		expect(() => GeneratedQuizSchema.parse({ questions: [outOfRange] })).toThrow();
	});

	it('rejects an mcq with fewer than 2 options', () => {
		const oneOption = { ...validMcq, payload: { options: ['only'], answerIndex: 0 } };
		expect(() => GeneratedQuizSchema.parse({ questions: [oneOption] })).toThrow();
	});

	it('rejects a flashcard payload missing back', () => {
		const { back, ...noBack } = validFlashcard.payload;
		void back;
		expect(() =>
			GeneratedQuizSchema.parse({
				questions: [{ type: 'flashcard', prompt: 'x', payload: noBack }]
			})
		).toThrow();
	});

	it('rejects a short payload missing rubric', () => {
		expect(() =>
			GeneratedQuizSchema.parse({
				questions: [{ type: 'short', prompt: 'x', payload: {} }]
			})
		).toThrow();
	});

	it('rejects an extra key inside a payload', () => {
		const extra = { ...validMcq.payload, extra: 'no' };
		expect(() =>
			GeneratedQuizSchema.parse({
				questions: [{ type: 'mcq', prompt: 'x', payload: extra }]
			})
		).toThrow();
	});
});

describe('extractFencedJson', () => {
	it('pulls the first ```json fenced block', () => {
		const raw = `Here is the quiz:\n${fence(mixedQuiz)}\nThanks!`;
		expect(JSON.parse(extractFencedJson(raw))).toEqual(mixedQuiz);
	});

	it('falls back to the trimmed whole string when there is no fence', () => {
		const raw = '\n  ' + JSON.stringify(mixedQuiz) + '  \n';
		expect(JSON.parse(extractFencedJson(raw))).toEqual(mixedQuiz);
	});

	it('is still re-exported from ./lab (back-compat)', () => {
		// P3's lab.test.ts imports extractFencedJson from './lab'; the move to
		// ./fence must not break that import path.
		const raw = fence(mixedQuiz);
		expect(JSON.parse(extractFencedJsonFromLab(`prose\n${raw}`))).toEqual(mixedQuiz);
		expect(extractFencedJsonFromLab).toBe(extractFencedJson);
	});
});

describe('parseGeneratedQuiz', () => {
	it('parses a fenced JSON block', () => {
		expect(parseGeneratedQuiz('prose\n' + fence(mixedQuiz))).toEqual(mixedQuiz);
	});

	it('parses bare JSON', () => {
		expect(parseGeneratedQuiz(JSON.stringify(mixedQuiz))).toEqual(mixedQuiz);
	});

	it('throws QuizParseError (carrying raw) on non-JSON text', () => {
		const raw = 'this is not json at all';
		let err: unknown;
		try {
			parseGeneratedQuiz(raw);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(QuizParseError);
		expect((err as QuizParseError).raw).toBe(raw);
	});

	it('throws QuizParseError on a schema mismatch (extra field)', () => {
		const raw = fence({ ...mixedQuiz, extra: 1 });
		expect(() => parseGeneratedQuiz(raw)).toThrow(QuizParseError);
	});
});

describe('parseGradedAnswer', () => {
	it('parses a graded answer', () => {
		const graded = { isCorrect: true, feedback: 'good' };
		expect(parseGradedAnswer(fence(graded))).toEqual(graded);
		expect(GradedAnswerSchema.parse(graded)).toEqual(graded);
	});

	it('throws GradeParseError (carrying raw) on non-JSON text', () => {
		const raw = 'not json';
		let err: unknown;
		try {
			parseGradedAnswer(raw);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(GradeParseError);
		expect((err as GradeParseError).raw).toBe(raw);
	});

	it('throws GradeParseError on an extra field', () => {
		const raw = fence({ isCorrect: true, feedback: 'good', extra: 1 });
		expect(() => parseGradedAnswer(raw)).toThrow(GradeParseError);
	});
});

describe('toQuizQuestions', () => {
	it('preserves order and returns {type, prompt, payload} per question', () => {
		const out = toQuizQuestions(mixedQuiz);
		expect(out).toHaveLength(3);
		expect(out.map((q) => q.type)).toEqual(['mcq', 'flashcard', 'short']);
		expect(out.map((q) => q.prompt)).toEqual(['What is 2 + 2?', 'Define ATP', 'Explain osmosis.']);
		expect(out[0].payload).toEqual({
			options: ['3', '4', '5', '6'],
			answerIndex: 1
		});
		expect(out[1].payload).toEqual({ front: 'ATP', back: 'Adenosine triphosphate' });
		expect(out[2].payload).toEqual({
			rubric: 'Mentions water moving across a semi-permeable membrane.'
		});
	});

	it('does not assign id or ord (repository does that at persist time)', () => {
		const out = toQuizQuestions({ questions: [validMcq] });
		expect(out[0]).not.toHaveProperty('id');
		expect(out[0]).not.toHaveProperty('ord');
	});
});
