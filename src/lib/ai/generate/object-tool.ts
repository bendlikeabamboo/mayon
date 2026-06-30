/**
 * Tool-calling structured-output helper (architecture.md §7).
 *
 * This replaces the Vercel AI SDK's `generateObject` JSON-text path for our
 * `generateObject`-style surfaces (lab / quiz / brief generation, short-answer
 * grading). `generateObject` (ai v7) tells the provider to emit a JSON object
 * via `responseFormat: { type: 'json' }`. For OpenAI-compatible providers that
 * maps to `response_format: { type: 'json_schema', strict: true }` (OpenAI
 * "Structured Outputs"). Many OpenAI-compatible gateways — notably Z.AI/GLM,
 * the default — do NOT implement strict `json_schema`, so they ignore
 * `response_format` and emit prose / fenced JSON / nothing. The SDK then can't
 * parse the text and throws `NoObjectGeneratedError`:
 * "No object generated: could not parse the response."
 *
 * Tool/function calling is far more universally supported across the provider
 * set (GLM, OpenRouter, OpenAI, Anthropic, Gemini) — it's the same mechanism
 * the chat agent loop already relies on. So we declare a single `json` tool
 * whose arguments ARE the result object; the provider serializes them as JSON.
 * We do NOT force a `toolChoice`, because some providers only support the
 * `auto` strategy — notably Z.AI/GLM, whose docs state tool_choice "only
 * supports `auto`", and which returns HTTP 400 (code 1210 "Invalid API
 * parameter") for any forced/named choice. With `auto` the model usually calls
 * the tool; when it instead emits the object as prose/fenced JSON, we fall back
 * to parsing that text. We always re-validate with the Zod schema so
 * `superRefine` / `preprocess` / `.strict()` still apply (the wire JSON Schema
 * the model saw can't express those).
 *
 * Some providers also return tool-call `arguments` (or emitted JSON text)
 * already serialized — occasionally double-serialized — so the parsed value is a
 * JSON string rather than an object; we peel those layers off before validating
 * (see `unwrapJsonString`), which otherwise surfaces as
 * "expected object, received string" at the schema root.
 *
 * Provider-agnostic: every generate fn delegates to this. Returns the parsed
 * object on success; throws {@link ObjectToolError} (carrying the model's raw
 * text) on any failure.
 */
import { generateText, tool, APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';
import { extractFencedJson } from './generate-gate';

export interface GenerateObjectToolOptions<T> {
	/** Strict Zod schema. Validated again after the call (wire JSON Schema can't express refinements). */
	schema: z.ZodType<T>;
	system: string;
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	signal?: AbortSignal;
	maxRetries?: number;
}

export interface GenerateObjectToolResult<T> {
	object: T;
	/** The model's raw text (for diagnostics; empty when the model emitted only the tool call). */
	text: string;
}

/**
 * Raised when tool-calling structured generation fails (request error, no tool
 * call, or a schema mismatch). Carries the model's raw text in `raw` so the
 * diagnostics panel can show what actually came back. Not a transport error —
 * callers re-wrap into their own typed `*Error` (e.g. `LabGenerationError`).
 */
export class ObjectToolError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'ObjectToolError';
	}
}

/**
 * Best-effort extraction of a diagnostics `raw` payload from a generation
 * error. Prefers the provider response body, then the model text carried by
 * {@link ObjectToolError}, then the error message. Shared so every generate
 * fn surfaces the same thing on failure.
 */
export function extractObjectErrorRaw(err: unknown): string {
	if (err instanceof APICallError) {
		return err.responseBody ?? err.message ?? '';
	}
	if (err instanceof ObjectToolError) {
		return err.raw || err.message;
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

const RESULT_TOOL = 'json';

function describeValidation<T>(schema: z.ZodType<T>, value: unknown): string {
	const result = schema.safeParse(value);
	if (result.success) return '';
	const first = result.error.issues[0];
	const path = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
	return first ? `${first.message}${path}` : 'schema validation failed';
}

/**
 * Peel off stringified-JSON layers so the schema sees the underlying object.
 *
 * Some OpenAI-compatible providers — notably Z.AI/GLM — return tool-call
 * `function.arguments` already serialized, and occasionally *double*-
 * serialized, so the parsed tool `input` (or the JSON parsed from emitted text)
 * is itself a JSON string like `'{"title":...}'` instead of an object. Validating
 * that string against an object schema fails at the root with
 * "expected object, received string". This unwraps up to a few layers of
 * `{`/`[`-prefixed JSON strings; non-string values pass through unchanged.
 */
function unwrapJsonString(value: unknown): unknown {
	let current = value;
	for (let i = 0; i < 4; i++) {
		if (typeof current !== 'string') break;
		try {
			current = JSON.parse(current);
		} catch {
			break;
		}
	}
	return current;
}

export async function generateObjectViaTool<T>(
	model: LanguageModel,
	opts: GenerateObjectToolOptions<T>
): Promise<GenerateObjectToolResult<T>> {
	let result;
	try {
		result = await generateText({
			model,
			system: opts.system,
			messages: opts.messages,
			tools: {
				[RESULT_TOOL]: tool({
					description:
						'Emit the structured result. You MUST call this single tool with the complete object; do not return prose or call any other tool.',
					inputSchema: opts.schema
				})
			},
			abortSignal: opts.signal,
			maxRetries: opts.maxRetries ?? 2
		});
	} catch (err) {
		throw new ObjectToolError('Structured generation request failed.', extractObjectErrorRaw(err));
	}

	const text = result.text ?? '';

	// Primary path: the model called the `json` tool — its arguments are the
	// object (provider-serialized JSON). We do not force toolChoice (some
	// providers, e.g. Z.AI/GLM, only support `auto` and 400 on anything else).
	const call = result.toolCalls[0];
	if (call) {
		const input = unwrapJsonString(call.input);
		const detail = describeValidation(opts.schema, input);
		if (!detail) {
			return { object: opts.schema.parse(input), text };
		}
		throw new ObjectToolError(`Structured result did not match the schema: ${detail}`, text);
	}

	// Fallback: the model ignored the tool and emitted the object as prose /
	// fenced JSON (common with strict-schema-ignorant providers). Parse it.
	if (text.trim().length > 0) {
		try {
			const fromText = unwrapJsonString(extractFencedJson(text));
			const detail = describeValidation(opts.schema, fromText);
			if (!detail) {
				return { object: opts.schema.parse(fromText), text };
			}
			throw new ObjectToolError(`Structured result did not match the schema: ${detail}`, text);
		} catch (err) {
			if (err instanceof ObjectToolError) throw err;
			throw new ObjectToolError(
				`Model returned no tool call and the text was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
				text
			);
		}
	}

	throw new ObjectToolError(
		'Model did not emit a structured result (no tool call and no text).',
		text
	);
}
