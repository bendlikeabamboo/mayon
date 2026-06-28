/**
 * Quiz payload + grading schema/parser (architecture.md §7, P4).
 *
 * Generation is prompt-driven (no per-adapter wire support for JSON mode): the
 * model is asked to emit a ```json fenced block whose content matches
 * {@link GeneratedQuiz} (for question generation) or {@link GradedAnswer} (for
 * per-answer grading). This module owns the shapes, the strict Zod schemas, the
 * shared fenced-JSON extractor, the typed parse errors, and the flattening into
 * the `{ type, prompt, payload }` shape the `quizQuestions` table stores.
 *
 * Kept provider-agnostic on purpose: every adapter delegates to the orchestrator
 * in `generate.ts`, which calls `parseGeneratedQuiz` / `parseGradedAnswer` here.
 */
import { z } from 'zod';
import { extractFencedJson } from './generate-gate';
import type { QuizQuestionType } from '$lib/db/schema';
import type { QuizPayload } from '$lib/db/repositories/quizzes';

/**
 * The per-variant payloads we ask the model to emit. These mirror the storage
 * payloads in `repositories/quizzes.ts` but are owned here so generation never
 * imports repository internals.
 */
export interface GeneratedMcqPayload {
	options: string[];
	answerIndex: number;
}
export interface GeneratedFlashcardPayload {
	front: string;
	back: string;
}
export interface GeneratedShortPayload {
	rubric: string;
}

/**
 * The shape we ask the model to emit. Each question carries only its variant
 * discriminator, prompt, and payload — ids and ordering are assigned at persist
 * time (see {@link toQuizQuestions}).
 */
export type GeneratedQuizQuestion =
	| { type: 'mcq'; prompt: string; payload: GeneratedMcqPayload }
	| { type: 'flashcard'; prompt: string; payload: GeneratedFlashcardPayload }
	| { type: 'short'; prompt: string; payload: GeneratedShortPayload };

export interface GeneratedQuiz {
	questions: GeneratedQuizQuestion[];
}

/**
 * The per-answer grading shape the model emits. `feedback` is free-form prose;
 * `isCorrect` is the model's own rubric verdict (for short-answer questions
 * where exact matching isn't possible).
 */
export interface GradedAnswer {
	isCorrect: boolean;
	feedback: string;
}

/**
 * Strict Zod schemas: reject unknown keys so a chatty model can't smuggle
 * fields past us. Mirrors the approach in `lab.ts` (different shape).
 */
const McqPayloadSchema = z
	.object({
		options: z.array(z.string().min(1)).min(2),
		answerIndex: z.number().int().nonnegative()
	})
	.strict();
const FlashcardPayloadSchema = z
	.object({
		front: z.string().min(1),
		back: z.string().min(1)
	})
	.strict();
const ShortPayloadSchema = z
	.object({
		rubric: z.string().min(1)
	})
	.strict();

const QuizQuestionSchema = z.discriminatedUnion('type', [
	z
		.object({
			type: z.literal('mcq'),
			prompt: z.string().min(1),
			payload: McqPayloadSchema
		})
		.strict()
		.superRefine((q, ctx) => {
			// Validate 0 <= answerIndex < options.length. The number is already
			// constrained to a non-negative int above; only the upper bound is
			// relational and so can't be expressed declaratively.
			if (q.payload.answerIndex >= q.payload.options.length) {
				ctx.addIssue({
					code: 'custom',
					message: 'answerIndex out of range',
					path: ['payload', 'answerIndex']
				});
			}
		}),
	z
		.object({
			type: z.literal('flashcard'),
			prompt: z.string().min(1),
			payload: FlashcardPayloadSchema
		})
		.strict(),
	z
		.object({
			type: z.literal('short'),
			prompt: z.string().min(1),
			payload: ShortPayloadSchema
		})
		.strict()
]);

/** Strict Zod schema: rejects unknown keys so a chatty model can't smuggle
 *  fields past us. Requires a non-empty questions array. */
export const GeneratedQuizSchema: z.ZodType<GeneratedQuiz> = z
	.object({ questions: z.array(QuizQuestionSchema).nonempty() })
	.strict();

/** Strict Zod schema for the per-answer grading payload. */
export const GradedAnswerSchema: z.ZodType<GradedAnswer> = z
	.object({ isCorrect: z.boolean(), feedback: z.string() })
	.strict();

/**
 * Internal error raised when the model output can't be turned into a
 * {@link GeneratedQuiz}. Not a transport error (it's not surfaced through
 * `formatProviderError`). Lives here (not in `errors.ts`) so the provider layer
 * stays unaware of generation internals.
 */
export class QuizParseError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'QuizParseError';
	}
}

/**
 * Internal error raised when the model output can't be turned into a
 * {@link GradedAnswer}. Same rationale as {@link QuizParseError}.
 */
export class GradeParseError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'GradeParseError';
	}
}

/**
 * Parse model output into a {@link GeneratedQuiz}. Throws {@link QuizParseError}
 * (carrying the raw text) on any failure — JSON syntax error, schema mismatch,
 * or extra/missing fields.
 */
export function parseGeneratedQuiz(raw: string): GeneratedQuiz {
	const jsonText = extractFencedJson(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		throw new QuizParseError(
			`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			raw
		);
	}
	const result = GeneratedQuizSchema.safeParse(parsed);
	if (!result.success) {
		// Join the issues into a single readable line; the first issue is usually
		// the actionable one.
		const first = result.error.issues[0];
		const path = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
		const msg = first ? `${first.message}${path}` : 'schema validation failed';
		throw new QuizParseError(`Model output did not match the quiz schema: ${msg}`, raw);
	}
	return result.data;
}

/**
 * Parse model output into a {@link GradedAnswer}. Throws {@link GradeParseError}
 * (carrying the raw text) on any failure — JSON syntax error, schema mismatch,
 * or extra/missing fields.
 */
export function parseGradedAnswer(raw: string): GradedAnswer {
	const jsonText = extractFencedJson(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		throw new GradeParseError(
			`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			raw
		);
	}
	const result = GradedAnswerSchema.safeParse(parsed);
	if (!result.success) {
		const first = result.error.issues[0];
		const path = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
		const msg = first ? `${first.message}${path}` : 'schema validation failed';
		throw new GradeParseError(`Model output did not match the grade schema: ${msg}`, raw);
	}
	return result.data;
}

/**
 * Flatten a {@link GeneratedQuiz} into the storage shape `quizQuestionsRepo.add`
 * consumes: `{ type, prompt, payload }` per question, in order. The model emits
 * no ids or ordering; both `id` (uuid) and `ord` are assigned at persist time by
 * `quizQuestionsRepo.add` (which computes `ord` from the current count), so this
 * helper must not assign them.
 */
export function toQuizQuestions(
	gen: GeneratedQuiz
): Array<{ type: QuizQuestionType; prompt: string; payload: QuizPayload }> {
	return gen.questions.map((q) => ({ type: q.type, prompt: q.prompt, payload: q.payload }));
}
