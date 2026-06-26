/**
 * Lab generation orchestrator (architecture.md §7, P3).
 *
 * Provider-agnostic: lives outside the adapters because lab generation is
 * prompt-driven (no per-adapter wire support for JSON mode). Every adapter's
 * `generateLab` method is a thin wrapper that calls {@link generateLab} here.
 *
 * Flow:
 *   1. Prepend the lab prompt as a leading `system` message.
 *   2. Stream the reply via `provider.chatStream`, accumulating tokens into a
 *      string (same loop as `chatStore.send`).
 *   3. `parseGeneratedLab` the result.
 *   4. On `LabParseError`, retry up to 2× total: feed the model its own bad
 *      output back as an assistant turn plus a corrective user instruction,
 *      then re-stream. After max attempts, throw {@link LabGenerationError}
 *      carrying the last raw text so the caller can offer "save raw anyway".
 *
 * Abort handling mirrors `chatStore.send`: an `AbortError` from the stream is
 * propagated unchanged for the store to swallow.
 */
import type { ChatMessage, ChatStreamOptions, Provider } from '../types';
import { parseGeneratedLab, type GeneratedLab } from './lab';

/** Max total attempts (initial + retries). Capped at 3 so retry cost is bounded. */
const MAX_ATTEMPTS = 3;

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

/** The corrective instruction appended on a retry. */
const CORRECTION_INSTRUCTION =
	'That was not valid JSON matching the schema. Common causes: (a) a code fence opened inside a JSON string — escape backticks as backslash-backtick instead; (b) a bare-string checklist item — wrap each in {"text": "..."}; (c) unescaped newlines/backticks. Output ONLY one ```json block with {title, intro, steps[], checklist[]} (checklist items are {"text":"..."}) and nothing else.';

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

export interface GenerateLabOptions extends ChatStreamOptions {
	/** The prompt prepended as a leading system message (defaults via readLabPrompt). */
	prompt?: string;
}

/**
 * Generate a lab from `messages` (the chat context). Streams tokens from
 * `provider.chatStream`, parses the fenced JSON, and retries on parse failure.
 *
 * `AbortError` from the underlying stream propagates unchanged.
 */
export async function generateLab(
	provider: Provider,
	messages: ChatMessage[],
	opts: GenerateLabOptions = {}
): Promise<GeneratedLab> {
	const prompt = opts.prompt ?? (await readLabPrompt());
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
			return parseGeneratedLab(lastRaw);
		} catch (err) {
			// Only retry on a parse failure; anything else (transport error,
			// AbortError) propagates immediately.
			if (!(err instanceof Error && err.name === 'LabParseError')) throw err;
			if (attempt >= MAX_ATTEMPTS) break;
			// Feed the model its previous output + the correction, then loop.
			turns.push({ role: 'assistant', content: lastRaw });
			turns.push({ role: 'user', content: CORRECTION_INSTRUCTION });
		}
	}

	throw new LabGenerationError(
		`Lab generation failed after ${MAX_ATTEMPTS} attempts; the model output never matched the schema.`,
		lastRaw
	);
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
