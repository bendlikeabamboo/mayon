/**
 * Quiz generation + grading orchestrator (architecture.md §7, P4).
 *
 * Provider-agnostic: lives outside the adapters because quiz generation and
 * short-answer grading are prompt-driven (no per-adapter wire support for JSON
 * mode). Every adapter's `generateQuiz` / `gradeShortAnswer` method is a thin
 * wrapper that calls {@link generateQuiz} / {@link gradeShortAnswer} here.
 *
 * Flow (mirrors {@link module:generate.generateLab}):
 *   1. Prepend the relevant prompt as a leading `system` message.
 *   2. Stream the reply via `provider.chatStream`, accumulating tokens into a
 *      string (same loop as `chatStore.send`).
 *   3. `parseGeneratedQuiz` / `parseGradedAnswer` the result.
 *   4. On the matching parse error, retry up to 2× total: feed the model its own
 *      bad output back as an assistant turn plus a corrective user instruction,
 *      then re-stream. After max attempts, throw {@link QuizGenerationError} /
 *      {@link GradeError} carrying the last raw text.
 *
 * Abort handling mirrors `chatStore.send`: an `AbortError` from the stream is
 * propagated unchanged for the store to swallow.
 */
import type { ChatMessage, ChatStreamOptions, Provider } from '../types';
import {
	parseGeneratedQuiz,
	parseGradedAnswer,
	type GeneratedQuiz,
	type GradedAnswer
} from './quiz';

/** Max total attempts (initial + retries). Capped at 3 so retry cost is bounded. */
const MAX_ATTEMPTS = 3;

/**
 * The worked example embedded in {@link DEFAULT_QUIZ_PROMPT} /
 * {@link DEFAULT_GRADE_PROMPT}. Built as a plain string (not a template
 * literal) so the backticks it shows the model — which MUST be escaped inside a
 * JSON string value — don't collide with template-literal syntax or trigger
 * `no-useless-escape`.
 *
 * The backticks here appear VERBATIM in the prompt to teach the model to escape
 * them as backslash-backtick within JSON strings.
 */
const EXAMPLE_BACKTICK = String.fromCharCode(96); // backtick, kept out of source literals

// ``` markers for the prompt, built without escaping backticks in the source.
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

/** The corrective instruction appended on a quiz retry. */
const QUIZ_CORRECTION_INSTRUCTION =
	'That was not valid JSON matching the schema. Common causes: (a) a code fence opened inside a JSON string — escape backticks as backslash-backtick instead; (b) a wrong payload shape for the question type; (c) an unknown "type"; (d) "answerIndex" out of range; (e) fewer than 2 options for an mcq; (f) unescaped newlines/backticks. Output ONLY one ```json block with {"questions":[{"type":"mcq"|"flashcard"|"short","prompt":"...","payload":{...}}]} and nothing else.';

/** The corrective instruction appended on a grading retry. */
const GRADE_CORRECTION_INSTRUCTION =
	'That was not valid JSON matching the schema. Output ONLY one ```json block with exactly {"isCorrect": true|false, "feedback": "..."} and nothing else.';

/**
 * Raised when quiz generation exhausts its retries. Carries the last raw model
 * output so the caller can offer to persist it as raw text. Not a transport
 * error; surfaced by the caller, not `formatProviderError`.
 */
export class QuizGenerationError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'QuizGenerationError';
	}
}

/**
 * Raised when grading exhausts its retries. Carries the last raw model output.
 * Same rationale as {@link QuizGenerationError}.
 */
export class GradeError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'GradeError';
	}
}

/**
 * Read the effective quiz prompt: the `quizPrompt` settings KV override if set,
 * otherwise {@link DEFAULT_QUIZ_PROMPT}. Mirrors {@link readLabPrompt} in
 * generate.ts (same settings-read pattern as `getActiveProvider` in client.ts).
 */
export async function readQuizPrompt(): Promise<string> {
	const { repos } = await import('$lib/db');
	const override = await repos.settings.get<string>('quizPrompt');
	return override && override.trim().length > 0 ? override : DEFAULT_QUIZ_PROMPT;
}

export interface GenerateQuizOptions extends ChatStreamOptions {
	/** The prompt prepended as a leading system message (defaults via readQuizPrompt). */
	prompt?: string;
}

export interface GradeShortAnswerInput {
	prompt: string;
	rubric: string;
	answer: string;
	context: ChatMessage[];
}

export interface GradeShortAnswerOptions extends ChatStreamOptions {
	/** The grade prompt prepended as a leading system message (defaults to DEFAULT_GRADE_PROMPT). */
	prompt?: string;
}

/**
 * Generate a mixed quiz from `messages` (the chat context). Streams tokens from
 * `provider.chatStream`, parses the fenced JSON, and retries on parse failure.
 *
 * `AbortError` from the underlying stream propagates unchanged.
 */
export async function generateQuiz(
	provider: Provider,
	messages: ChatMessage[],
	opts: GenerateQuizOptions = {}
): Promise<GeneratedQuiz> {
	const prompt = opts.prompt ?? (await readQuizPrompt());
	const signal = opts.signal;

	let attempt = 0;
	// The running message list: starts with [system:prompt, ...messages]; on a
	// retry we append the bad assistant output + a corrective user turn.
	const turns: ChatMessage[] = [{ role: 'system', content: prompt }, ...messages];

	let lastRaw = '';
	while (attempt < MAX_ATTEMPTS) {
		attempt += 1;
		lastRaw = await accumulate(provider, turns, signal);

		try {
			return parseGeneratedQuiz(lastRaw);
		} catch (err) {
			// Only retry on a parse failure; anything else (transport error,
			// AbortError) propagates immediately.
			if (!(err instanceof Error && err.name === 'QuizParseError')) throw err;
			if (attempt >= MAX_ATTEMPTS) break;
			// Feed the model its previous output + the correction, then loop.
			turns.push({ role: 'assistant', content: lastRaw });
			turns.push({ role: 'user', content: QUIZ_CORRECTION_INSTRUCTION });
		}
	}

	throw new QuizGenerationError(
		`Quiz generation failed after ${MAX_ATTEMPTS} attempts; the model output never matched the schema.`,
		lastRaw
	);
}

/**
 * Grade a learner's short answer against `input.rubric`, grounded in
 * `input.context`. Streams tokens from `provider.chatStream`, parses the fenced
 * JSON, and retries on parse failure.
 *
 * `AbortError` from the underlying stream propagates unchanged.
 */
export async function gradeShortAnswer(
	provider: Provider,
	input: GradeShortAnswerInput,
	opts: GradeShortAnswerOptions = {}
): Promise<GradedAnswer> {
	const prompt = opts.prompt ?? DEFAULT_GRADE_PROMPT;
	const signal = opts.signal;

	let attempt = 0;
	// The running message list: [system:prompt, ...context, user:gradeBlock]; on
	// a retry we append the bad assistant output + a corrective user turn.
	const turns: ChatMessage[] = [
		{ role: 'system', content: prompt },
		...input.context,
		{ role: 'user', content: gradeUserBlock(input) }
	];

	let lastRaw = '';
	while (attempt < MAX_ATTEMPTS) {
		attempt += 1;
		lastRaw = await accumulate(provider, turns, signal);

		try {
			return parseGradedAnswer(lastRaw);
		} catch (err) {
			// Only retry on a parse failure; anything else (transport error,
			// AbortError) propagates immediately.
			if (!(err instanceof Error && err.name === 'GradeParseError')) throw err;
			if (attempt >= MAX_ATTEMPTS) break;
			// Feed the model its previous output + the correction, then loop.
			turns.push({ role: 'assistant', content: lastRaw });
			turns.push({ role: 'user', content: GRADE_CORRECTION_INSTRUCTION });
		}
	}

	throw new GradeError(
		`Grading failed after ${MAX_ATTEMPTS} attempts; the model output never matched the schema.`,
		lastRaw
	);
}

/**
 * Render the grading user turn: the question, the rubric, and the learner's
 * answer, followed by the grading instruction that points at the conversation
 * above for grounding.
 */
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

/**
 * Stream a full reply from `provider` into a string. Same token-accumulation
 * loop as `chatStore.send`: reads `token.text ?? token.delta ?? ''` per chunk.
 * `AbortError` and transport errors propagate to the caller.
 */
async function accumulate(
	provider: Provider,
	turns: ChatMessage[],
	signal?: AbortSignal
): Promise<string> {
	let buffer = '';
	for await (const token of provider.chatStream(turns, { signal })) {
		buffer += token.text ?? token.delta ?? '';
	}
	return buffer;
}
