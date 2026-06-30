/**
 * Quiz generation + grading orchestrator (architecture.md §7, P4).
 *
 * Uses the tool-calling structured-output helper (`generateObjectViaTool`) with
 * Zod schemas for both quiz generation and short-answer grading. Tool calling
 * is the provider-native path (see `object-tool.ts`). Retry logic is handled
 * internally by the SDK via `maxRetries`.
 */
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';
import {
	GeneratedQuizSchema,
	GradedAnswerSchema,
	type GeneratedQuiz,
	type GradedAnswer
} from './quiz';
import { generateObjectViaTool, extractObjectErrorRaw } from './object-tool';
import { splitContextForGeneration } from './context-split';

export const DEFAULT_QUIZ_PROMPT = [
	'You are a quiz designer. Given a conversation, produce a mixed quiz that lets a learner self-check the topic.',
	'',
	'The output must be a JSON object with EXACTLY one field:',
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
	'        "back": "the file or action a rule builds, e.g. `make`"',
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
	'}',
	'',
	'The conversation may open with a learner brief (goal/level/mode/scope). Align the quiz to that goal and level; make the questions test whether the learner can DO the goal.',
	'',
	'Rules:',
	'- Field names are lowercase and exactly as shown; payloads must match their type.',
	'- Do NOT include ids or ordering — emit only type/prompt/payload (ordering is assigned at save time).',
	'- "answerIndex" must be a valid 0-based index into "options"; mcq needs >=2 options.',
	'- "questions" is a non-empty array.'
].join('\n');

export const DEFAULT_GRADE_PROMPT = [
	"You grade a learner's short answer against a rubric, using the provided source conversation as grounding.",
	'',
	'The output must be a JSON object with EXACTLY these two fields:',
	'',
	'- "isCorrect": boolean — true only if the answer satisfies the rubric.',
	'- "feedback": string — one or two sentences explaining the verdict (what was right or missing).',
	'',
	'Example of the exact shape (use this structure):',
	'',
	'{',
	'  "isCorrect": true,',
	'  "feedback": "Yes — you correctly described what `make` does."',
	'}',
	'',
	'Rules:',
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
	onTrace?: (t: {
		request: import('$lib/agent/trace').ObjectTraceRequest;
		result?: { object: unknown };
		error?: string;
		raw?: string;
	}) => void;
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
	onTrace?: (t: {
		request: import('$lib/agent/trace').ObjectTraceRequest;
		result?: { object: unknown };
		error?: string;
		raw?: string;
		questionId?: string;
		prompt?: string;
		rubric?: string;
		answer?: string;
	}) => void;
}

export async function generateQuiz(
	model: LanguageModel,
	messages: ChatMessage[],
	opts: GenerateQuizOptions = {}
): Promise<GeneratedQuiz> {
	const prompt = opts.prompt ?? (await readQuizPrompt());
	const { system, messages: core } = splitContextForGeneration(messages, prompt, {
		includeSystemNotes: false
	});
	const request = {
		system,
		messages: core.map((m) => ({ role: m.role, content: String(m.content) })),
		schema: 'GeneratedQuizSchema'
	};
	try {
		const { object } = await generateObjectViaTool(model, {
			schema: GeneratedQuizSchema,
			system,
			messages: core,
			signal: opts.signal,
			maxRetries: 2
		});
		opts.onTrace?.({ request, result: { object } });
		return object;
	} catch (err) {
		opts.onTrace?.({
			request,
			error: err instanceof Error ? err.message : String(err),
			raw: extractObjectErrorRaw(err)
		});
		throw new QuizGenerationError('Quiz generation failed.', extractObjectErrorRaw(err));
	}
}

export async function gradeShortAnswer(
	model: LanguageModel,
	input: GradeShortAnswerInput,
	opts: GradeShortAnswerOptions = {}
): Promise<GradedAnswer> {
	const prompt = opts.prompt ?? DEFAULT_GRADE_PROMPT;
	const { system, messages: core } = splitContextForGeneration(input.context, prompt, {
		includeSystemNotes: false
	});
	const finalMessages = [...core, { role: 'user' as const, content: gradeUserBlock(input) }];
	const request = {
		system,
		messages: finalMessages.map((m) => ({ role: m.role, content: String(m.content) })),
		schema: 'GradedAnswerSchema'
	};
	try {
		const { object } = await generateObjectViaTool(model, {
			schema: GradedAnswerSchema,
			system,
			messages: finalMessages,
			signal: opts.signal,
			maxRetries: 2
		});
		opts.onTrace?.({ request, result: { object } });
		return object;
	} catch (err) {
		opts.onTrace?.({
			request,
			error: err instanceof Error ? err.message : String(err),
			raw: extractObjectErrorRaw(err),
			prompt: input.prompt,
			rubric: input.rubric,
			answer: input.answer
		});
		throw new GradeError('Grading failed.', extractObjectErrorRaw(err));
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
