/**
 * Lab generation orchestrator (architecture.md §7, P3).
 *
 * Uses the Vercel AI SDK's `generateObject` with a Zod schema to produce
 * structured lab output. Retry logic is handled internally by the SDK via
 * `maxRetries`.
 */
import { generateObject, APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';
import { GeneratedLabSchema, type GeneratedLab } from './lab';

/**
 * The default system prompt instructing the model to emit the exact JSON shape
 * inside a ```json fence. Mirrored in the Settings UI as the "reset to default"
 * preview. Editable via the `labPrompt` settings KV override.
 */
/**
 * The worked example embedded in {@link DEFAULT_LAB_PROMPT}. Built as a plain
 * string (not a template literal) so the backticks it shows the model — which
 * MUST be escaped inside a JSON string value — don't collide with template-
 * literal syntax or trigger `no-useless-escape`.
 *
 * The backticks here appear VERBATIM in the prompt to teach the model to escape
 * them as backslash-backtick within JSON strings.
 */
const EXAMPLE_BACKTICK = String.fromCharCode(96); // backtick, kept out of source literals

const LAB_EXAMPLE = [
	'{',
	'  "title": "Your First Makefile",',
	'  "intro": "Practice build automation by writing a minimal Makefile.",',
	'  "steps": [',
	`    "Create a file named ${EXAMPLE_BACKTICK}Makefile${EXAMPLE_BACKTICK} in an empty directory.",`,
	'    "Add a target that compiles a hello-world program.",',
	`    "Run ${EXAMPLE_BACKTICK}make${EXAMPLE_BACKTICK} and confirm the binary is produced."`,
	'  ],',
	'  "checklist": [',
	'    {"text": "The Makefile exists and has a valid target"},',
	'    {"text": "Running make produced the binary without errors"}',
	'  ]',
	'}'
].join('\n');

// ``` markers for the prompt, built without escaping backticks in the source.
const FENCE = EXAMPLE_BACKTICK.repeat(3);

export const DEFAULT_LAB_PROMPT = [
	'You are a learning lab designer. Given a conversation, produce a hands-on lab that lets a learner practice the topic.',
	'',
	`Reply with ONLY a single JSON object wrapped in one ${FENCE}json fenced block. No prose before or after the block. The JSON must have EXACTLY these four fields:`,
	'',
	'- "title": string — a short lab title.',
	'- "intro": string — 1-2 sentence orientation.',
	'- "steps": array of strings — ordered, concrete instructions. Each step is one string.',
	'- "checklist": array of objects, each {"text": "..."} — verifiable completion criteria.',
	'',
	'Example of the exact shape (use this structure):',
	'',
	`${FENCE}json`,
	LAB_EXAMPLE,
	FENCE,
	'',
	'The conversation may open with a learner brief (goal/level/mode/scope). Align the lab to that goal and level; make the checklist criteria test whether the learner can DO the goal.',
	'',
	'Critical rules:',
	`- Output ONE ${FENCE}json block containing ONE JSON object. Do not nest code fences inside the JSON — if a step needs code, escape backticks inside the JSON string (e.g. "Run ${EXAMPLE_BACKTICK}make${EXAMPLE_BACKTICK}"), never open a new fence.`,
	`- Every backtick and newline inside a JSON string MUST be escaped (backtick as backslash-${EXAMPLE_BACKTICK}, newline as backslash-n) so the whole block stays valid JSON.`,
	'- Field names are lowercase and exactly as shown; checklist items are objects with a "text" key (not bare strings).',
	'- Do NOT include ids, done flags, or any field other than title/intro/steps/checklist.',
	'- steps and checklist are non-empty arrays.'
].join('\n');

/**
 * Raised when generation exhausts its retries. Carries the last raw model
 * output so the caller (labs store) can offer to persist it as a raw lab.
 * Not a transport error; surfaced via the store's `rawOffer` state, not
 * `formatProviderError`.
 */
export class LabGenerationError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'LabGenerationError';
	}
}

/**
 * Read the effective lab prompt: the `labPrompt` settings KV override if set,
 * otherwise {@link DEFAULT_LAB_PROMPT}. Mirrors the settings-read pattern in
 * `getActiveProvider` (client.ts).
 */
export async function readLabPrompt(): Promise<string> {
	const { repos } = await import('$lib/db');
	const override = await repos.settings.get<string>('labPrompt');
	return override && override.trim().length > 0 ? override : DEFAULT_LAB_PROMPT;
}

export interface GenerateLabOptions {
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

export async function generateLab(
	model: LanguageModel,
	messages: ChatMessage[],
	opts: GenerateLabOptions = {}
): Promise<GeneratedLab> {
	const prompt = opts.prompt ?? (await readLabPrompt());
	try {
		const result = await generateObject({
			model,
			schema: GeneratedLabSchema,
			system: prompt,
			messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
			abortSignal: opts.signal,
			maxRetries: 2
		});
		return result.object;
	} catch (err) {
		throw new LabGenerationError('Lab generation failed.', extractRaw(err));
	}
}
