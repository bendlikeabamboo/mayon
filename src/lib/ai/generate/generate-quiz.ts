/**
 * Quiz generation + grading orchestrator (architecture.md §7, P4).
 *
 * Uses the Vercel AI SDK's `generateObject` with Zod schemas for both quiz
 * generation and short-answer grading. Retry logic is handled internally by
 * the SDK via `maxRetries`.
 */
import { generateObject, APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';
import {
	GeneratedQuizSchema,
	GradedAnswerSchema,
	type GeneratedQuiz,
	type GradedAnswer
} from './quiz';

const EXAMPLE_BACKTICK = String.fromCharCode(96);

const FENCE = EXAMPLE_BACKTICK.repeat(3);

const QUIZ_EXAMPLE = [
	'{',
	'  "questions": [',
	'    {',
	'      "type": "mcq",',
	'      "prompt": "What does the `make` command do?",',
	'      "payload": {',
	'        "options": ["Builds targets defined in a Makefile", "Lists files", "Deletes files", "Prints the date"],',
	'        "answerIndex": 0',
	'      }',
	'    },',
	'    {',
	'      "type": "flashcard",',
	'      "prompt": "Recall what a Makefile target is.",',
	'      "payload": {',
	'        "front": "target",',
	`        "back": "the file or action a rule builds, e.g. ${EXAMPLE_BACKTICK}make${EXAMPLE_BACKTICK}"`,
	'      }',
	'    },',
	'    {',
	'      "type": "short",',
	'      "prompt": "Explain why `make` is preferred over recompiling by hand.",',
	'      "payload": {',
	'        "rubric": "must mention incremental rebuilds / only rebuilding changed files"',
	'      }',
	'    }',
	'  ]',
	'}'
].join('\n');

/**
 * The default system prompt instructing the model to emit a MIXED quiz
 * (`mcq` + `flashcard` + `short`) as the exact JSON shape inside a ```json fence.
 * Mirrored in the Settings UI as the "reset to default" preview. Editable via
 * the `quizPrompt` settings KV override.
 */
export const DEFAULT_QUIZ_PROMPT = [
	'You are a quiz designer. Given a conversation, produce a mixed quiz that lets a learner self-check the topic.',
	'',
	`Reply with ONLY a single JSON object wrapped in one ${FENCE}json fenced block. No prose before or after the block. The JSON must have EXACTLY one field:`,
	'',
	'- "questions": array of question objects, each {"type", "prompt", "payload"}.',
	'',
	'Each question has a type and a type-specific payload:',
	'- "type": "mcq" — payload is {"options": array of >=2 strings, "answerIndex": 0-based index of the correct option}.',
	'- "type": "flashcard" — payload is {"front": string, "back": string}.',
	'- "type": "short" — payload is {"rubric": what a correct answer must include}.',
	'',
	'Aim for roughly 6-10 questions mixing the three types.',
	'',
	'Example of the exact shape (use this structure):',
	'',
	`${FENCE}json`,
	QUIZ_EXAMPLE,
	FENCE,
	'',
	'The conversation may open with a learner brief (goal/level/mode/scope). Align the quiz to that goal and level; make the questions test whether the learner can DO the goal.',
	'',
	'Critical rules:',
	`- Output ONE ${FENCE}json block containing ONE JSON object of the form {"questions": [...]}. Do not nest code fences inside the JSON — if a prompt, option, front, back, or rubric needs code, escape backticks inside the JSON string (e.g. "Run ${EXAMPLE_BACKTICK}make${EXAMPLE_BACKTICK}"), never open a new fence.`,
	`- Every backtick and newline inside a JSON string MUST be escaped (backtick as backslash-${EXAMPLE_BACKTICK}, newline as backslash-n) so the whole block stays valid JSON.`,
	'- Field names are lowercase and exactly as shown; payloads must match their type.',
	'- Do NOT include ids or ordering — emit only type/prompt/payload (ordering is assigned at save time).',
	'- "answerIndex" must be a valid 0-based index into "options"; mcq needs >=2 options.',
	'- "questions" is a non-empty array.'
].join('\n');

const GRADE_EXAMPLE = [
	'{',
	'  "isCorrect": true,',
	`  "feedback": "Yes — you correctly described what ${EXAMPLE_BACKTICK}make${EXAMPLE_BACKTICK} does."`,
	'}'
].join('\n');

/**
 * The default system prompt instructing the model to grade a learner's short
 * answer against a rubric, grounded in the provided source conversation. Output
 * is the exact {@link GradedAnswer} shape inside a ```json fence.
 */
export const DEFAULT_GRADE_PROMPT = [
	"You grade a learner's short answer against a rubric, using the provided source conversation as grounding.",
	'',
	`Reply with ONLY a single JSON object wrapped in one ${FENCE}json fenced block. No prose before or after the block. The JSON must have EXACTLY these two fields:`,
	'',
	'- "isCorrect": boolean — true only if the answer satisfies the rubric.',
	'- "feedback": string — one or two sentences explaining the verdict (what was right or missing).',
	'',
	'Example of the exact shape (use this structure):',
	'',
	`${FENCE}json`,
	GRADE_EXAMPLE,
	FENCE,
	'',
	'Critical rules:',
	`- Output ONE ${FENCE}json block containing ONE JSON object {"isCorrect": boolean, "feedback": string} and nothing else.`,
	`- Every backtick and newline inside the feedback string MUST be escaped (backtick as backslash-${EXAMPLE_BACKTICK}, newline as backslash-n) so the whole block stays valid JSON.`,
	"- Be lenient on phrasing and word choice; grade on whether the rubric's substance is present, not exact wording."
].join('\n');

export class QuizGenerationError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'QuizGenerationError';
	}
}

export class GradeError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'GradeError';
	}
}

export async function readQuizPrompt(): Promise<string> {
	const { repos } = await import('$lib/db');
	const override = await repos.settings.get<string>('quizPrompt');
	return override && override.trim().length > 0 ? override : DEFAULT_QUIZ_PROMPT;
}

export interface GenerateQuizOptions {
	prompt?: string;
	signal?: AbortSignal;
}

export interface GradeShortAnswerInput {
	prompt: string;
	rubric: string;
	answer: string;
	context: ChatMessage[];
}

export interface GradeShortAnswerOptions {
	prompt?: string;
	signal?: AbortSignal;
}

function extractRaw(err: unknown): string {
	if (err instanceof APICallError) {
		return err.responseBody ?? err.message ?? '';
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

export async function generateQuiz(
	model: LanguageModel,
	messages: ChatMessage[],
	opts: GenerateQuizOptions = {}
): Promise<GeneratedQuiz> {
	const prompt = opts.prompt ?? (await readQuizPrompt());
	try {
		const result = await generateObject({
			model,
			schema: GeneratedQuizSchema,
			system: prompt,
			messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
			abortSignal: opts.signal,
			maxRetries: 2
		});
		return result.object;
	} catch (err) {
		throw new QuizGenerationError('Quiz generation failed.', extractRaw(err));
	}
}

export async function gradeShortAnswer(
	model: LanguageModel,
	input: GradeShortAnswerInput,
	opts: GradeShortAnswerOptions = {}
): Promise<GradedAnswer> {
	const prompt = opts.prompt ?? DEFAULT_GRADE_PROMPT;
	try {
		const result = await generateObject({
			model,
			schema: GradedAnswerSchema,
			system: prompt,
			messages: [
				...input.context.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
				{ role: 'user', content: gradeUserBlock(input) }
			],
			abortSignal: opts.signal,
			maxRetries: 2
		});
		return result.object;
	} catch (err) {
		throw new GradeError('Grading failed.', extractRaw(err));
	}
}

function gradeUserBlock(input: GradeShortAnswerInput): string {
	return [
		'Question:',
		input.prompt,
		'',
		'Rubric:',
		input.rubric,
		'',
		"Learner's answer:",
		input.answer,
		'',
		"Grade the learner's answer against the rubric (use the conversation above as grounding)."
	].join('\n');
}
