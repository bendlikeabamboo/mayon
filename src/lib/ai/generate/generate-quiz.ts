/**
 * Quiz generation + grading orchestrator (architecture.md §7, P4).
 *
 * Uses the tool-calling structured-output helper (`generateObjectViaTool`) with
 * Zod schemas for both quiz generation and short-answer grading. Tool calling
 * is the provider-native path (see `object-tool.ts`). Retry logic is handled
 * internally by the SDK via `maxRetries`.
 */
import type { LanguageModel } from 'ai';
import type { ChatMessage, ResolvedRequestSettings } from '../types';
import {
	GeneratedQuizSchema,
	GradedAnswerSchema,
	type GeneratedQuiz,
	type GradedAnswer
} from './quiz';
import { generateObjectViaTool, extractObjectErrorRaw, ObjectToolError } from './object-tool';
import { splitContextForGeneration } from './context-split';

export const DEFAULT_QUIZ_PROMPT = [
	'You are a quiz designer. Given a conversation, produce a mixed quiz that lets a learner self-check the topic.',
	'',
	'# Output shape',
	'',
	'Return ONE JSON object with exactly one top-level field:',
	'- "questions": a non-empty array of question objects.',
	'',
	'Every question object has EXACTLY three keys: "type", "prompt", "payload".',
	'"prompt" sits NEXT TO "type" on the question. NEVER inside "payload".',
	'"payload" contains ONLY the variant fields listed below — never "type", never "prompt":',
	'"type" is EXACTLY one of "mcq", "flashcard", "short" (lowercase), and its payload is:',
	'- {"type": "mcq",       "payload": {"options": ["...", "at least 2 strings"], "answerIndex": <0-based index into options>}}',
	'- {"type": "flashcard", "payload": {"front": "...", "back": "..."}}',
	'- {"type": "short",     "payload": {"rubric": "<what a correct answer must include>"}}',
	'',
	'Aim for roughly 6-10 questions mixing the three types.',
	'',
	'# Example of the exact structure',
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
	'# Content guidance',
	'',
	'The conversation may open with a learner brief (goal/level/mode/scope). Align the quiz to that goal and level; make the questions test whether the learner can DO the goal.',
	'',
	'# Hard rules',
	'',
	'- Field names are lowercase and exactly as shown.',
	'- "payload" holds ONLY its variant fields: {"options", "answerIndex"} for mcq, {"front", "back"} for flashcard, {"rubric"} for short. Do not repeat "type" or "prompt" inside "payload".',
	'- Every mcq satisfies 0 <= answerIndex < options.length.',
	'- No ids, no ordering field — emit only type/prompt/payload per question (ordering is assigned at save time).',
	'- Return raw JSON as the tool arguments only: no prose around it, no markdown code fences, no stringified encoding.'
].join('\n');

/**
 * Tool-description contract for quiz generation. Some providers weight the
 * tool description alongside the system prompt, so we restate the discriminated
 * union here compactly — including the observed drift modes (flat payloads,
 * stray type/prompt keys inside payload, alias type names, stringified
 * arguments).
 */
const QUIZ_TOOL_DESCRIPTION = [
	'Emit the generated quiz for the conversation above.',
	'Call this tool exactly once with the complete quiz object as the arguments: {"questions": [{type, prompt, payload}]}.',
	'Each question carries "type" and "prompt" at its top level; "payload" contains ONLY the variant fields — never "type", never "prompt":',
	'- {"type": "mcq", "prompt": "...", "payload": {"options": ["...", "..."], "answerIndex": 0}}',
	'- {"type": "flashcard", "prompt": "...", "payload": {"front": "...", "back": "..."}}',
	'- {"type": "short", "prompt": "...", "payload": {"rubric": "..."}}'
].join('\n');

export const DEFAULT_GRADE_PROMPT = [
	"You grade a learner's short answer against a rubric, using the provided source conversation as grounding.",
	'',
	'# Output shape',
	'',
	'Return ONE JSON object with exactly these two fields:',
	'- "isCorrect": boolean — true only if the answer satisfies the rubric.',
	'- "feedback": string — one or two sentences explaining the verdict (what was right or missing).',
	'',
	'# Example of the exact structure',
	'',
	'{',
	'  "isCorrect": true,',
	'  "feedback": "Yes — you correctly described what `make` does."',
	'}',
	'',
	'# Rules',
	'',
	"- Be lenient on phrasing and word choice; grade on whether the rubric's substance is present, not exact wording.",
	'- Return raw JSON as the tool arguments only: no prose around it, no markdown code fences.'
].join('\n');

/** Tool-description contract for grading — see QUIZ_TOOL_DESCRIPTION rationale. */
const GRADE_TOOL_DESCRIPTION =
	'Emit the grading verdict for the learner\'s short answer. Call this tool exactly once with the verdict object as the arguments: {"isCorrect": boolean, "feedback": string} — no other fields, no nesting, no stringified encoding.';

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
	requestSettings?: ResolvedRequestSettings;
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

/**
 * Corrective feedback appended as a final user turn when the model's structured
 * output failed schema validation. Feeding the concrete validation error back
 * (plus the allowed shape) lets the model fix payload drift that alias
 * normalization can't repair.
 */
function correctionMessage(detail: string): string {
	return [
		'Your previous structured output was rejected by validation:',
		detail,
		'',
		'Try again: call the `json` tool with a corrected object.',
		'- Each question "type" must be exactly "mcq", "flashcard", or "short" (lowercase).',
		'- Each question has exactly {type, prompt, payload}: "prompt" next to "type", never inside "payload".',
		'- "payload" contains ONLY variant fields — no "type"/"prompt"/id inside it:',
		'- mcq payload: {"options": array of >=2 strings, "answerIndex": 0-based index into options}.',
		'- flashcard payload: {"front": string, "back": string}.',
		'- short payload: {"rubric": string}.',
		'- Emit only {"questions": [...]} with no extra fields; no prose, no ids.'
	].join('\n');
}

/**
 * Corrective schema-mismatch re-asks allowed beyond the initial generation
 * call. Observed drift sometimes survives one correction (fixing issue A then
 * surfaces issue B), so we allow up to two before giving up. Transport errors
 * and missing results stay fatal immediately.
 */
const MAX_CORRECTIVE_RETRIES = 2;

export async function generateQuiz(
	model: LanguageModel,
	messages: ChatMessage[],
	opts: GenerateQuizOptions = {}
): Promise<GeneratedQuiz> {
	const prompt = opts.prompt ?? (await readQuizPrompt());
	const { system, messages: core } = splitContextForGeneration(messages, prompt, {
		includeSystemNotes: false
	});
	// Up to MAX_CORRECTIVE_RETRIES corrective retries: models occasionally emit
	// alias discriminators or drift on payload shape (observed with Z.AI/GLM).
	// On a schema mismatch we re-ask with the validation errors appended;
	// anything else (transport errors, no result) is fatal immediately.
	const toTraceRequest = (msgs: typeof core) => ({
		system,
		messages: msgs.map((m) => ({ role: m.role, content: String(m.content) })),
		schema: 'GeneratedQuizSchema' as const,
		providerOptions: opts.requestSettings?.providerOptions,
		callSettings: opts.requestSettings?.callSettings
	});
	let attemptMessages = core;
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				const { object } = await generateObjectViaTool(model, {
					schema: GeneratedQuizSchema,
					system,
					toolDescription: QUIZ_TOOL_DESCRIPTION,
					messages: attemptMessages,
					signal: opts.signal,
					maxRetries: 2,
					requestSettings: opts.requestSettings
				});
				opts.onTrace?.({ request: toTraceRequest(attemptMessages), result: { object } });
				return object;
			} catch (err) {
				if (
					attempt < MAX_CORRECTIVE_RETRIES &&
					err instanceof ObjectToolError &&
					err.code === 'schema_mismatch' &&
					!opts.signal?.aborted
				) {
					attemptMessages = [
						...core,
						{ role: 'user' as const, content: correctionMessage(err.message) }
					];
					continue;
				}
				throw err;
			}
		}
	} catch (err) {
		opts.onTrace?.({
			request: toTraceRequest(attemptMessages),
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
			toolDescription: GRADE_TOOL_DESCRIPTION,
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
