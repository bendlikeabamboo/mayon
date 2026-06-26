/**
 * Provider/AI layer public types. Spec: `refinement/architecture.md` §6.
 *
 * The `Provider` interface is the single shape every adapter implements.
 * `chatStream` is the only transport method; `generateLab`/`generateQuiz`/
 * `gradeShortAnswer` are thin wrappers that delegate to the shared
 * orchestrators in `generate/` (prompt-driven: stream, parse fenced JSON,
 * retry on parse failure).
 */

/** Provider kinds the registry can build adapters for. */
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama';

/** A single chat message, provider-agnostic. Maps into each adapter's wire shape. */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** A streamed token. `delta` and `text` are aliases (kept for readability at call sites). */
export interface Token {
	text?: string;
	delta?: string;
}

/** Reasoning/thinking control. `'auto'` (or omitted) = provider default. */
export type ReasoningMode = 'auto' | 'enabled' | 'disabled';

/** Options accepted by `Provider.chatStream`. */
export interface ChatStreamOptions {
	signal?: AbortSignal;
	/** Override the provider's `defaultModel` for this call only. */
	model?: string;
	/** Reasoning/thinking control. `'auto'` (or omitted) = provider default. */
	reasoning?: ReasoningMode;
}

// Re-exported so `Provider.generateLab` can reference the generated-lab shape
// without every adapter re-importing from `generate/lab.ts`. The orchestrator
// is still the single implementer; this is a type-only re-export.
import type { GeneratedLab } from './generate/lab';
export type { GeneratedLab };

// Same rationale for the P4 quiz/grading shapes: every adapter's
// `generateQuiz` / `gradeShortAnswer` wrapper can reference them via the
// `Provider` interface without re-importing from `generate/quiz.ts`.
import type { GeneratedQuiz, GradedAnswer } from './generate/quiz';
export type { GeneratedQuiz, GradedAnswer };

/**
 * Static, non-secret configuration for a configured provider. Stored under the
 * `providers` settings key as `{[id]: ProviderConfig}`. API keys live separately
 * in the runtime `KeyStore` (see `client.ts`); nothing secret is stored here.
 */
export interface ProviderConfig {
	id: string;
	kind: ProviderKind;
	name: string;
	baseUrl: string;
	defaultModel: string;
	models: string[];
	/**
	 * Whether the model list can be discovered live from a `/models` endpoint.
	 * Set from the provider template on add. When true the Settings UI fetches
	 * the catalog (OpenRouter / Kilo Gateway / Z.AI) instead of relying on the
	 * shipped fallback list. Optional: older configs predate this field.
	 */
	discoverable?: boolean;
}

/**
 * The provider abstraction. Adapters implement `chatStream`; lab/quiz
 * generation and short-answer grading delegate to the shared orchestrators in
 * `generate/` (every adapter's `generateLab`/`generateQuiz`/`gradeShortAnswer`
 * is a thin wrapper).
 */
export interface Provider {
	readonly kind: ProviderKind;
	readonly config: ProviderConfig;

	/** Stream assistant tokens for `messages`. Never resolves to a full string —
	 *  callers accumulate. Throws typed errors (see `errors.ts`). */
	chatStream(messages: ChatMessage[], opts?: ChatStreamOptions): AsyncIterable<Token>;

	/**
	 * Generate a hands-on lab from `messages` (the chat context). Prompt-driven
	 * (no wire JSON mode): streams tokens via `chatStream`, parses fenced JSON,
	 * retries on parse failure (≤2). Implemented in P3 by delegating to the
	 * shared orchestrator in `generate/generate.ts`. `AbortError` propagates.
	 */
	generateLab(messages: ChatMessage[], opts?: ChatStreamOptions): Promise<GeneratedLab>;

	/**
	 * Generate a mixed quiz from `messages` (the chat context). Prompt-driven
	 * (no wire JSON mode): streams tokens via `chatStream`, parses fenced JSON,
	 * retries on parse failure (≤2). Delegates to the shared orchestrator in
	 * `generate/generate-quiz.ts`. `AbortError` propagates.
	 */
	generateQuiz(messages: ChatMessage[], opts?: ChatStreamOptions): Promise<GeneratedQuiz>;

	/**
	 * Grade a learner's short answer against `rubric`, grounded in `context`.
	 * Prompt-driven: streams tokens via `chatStream`, parses fenced JSON, retries
	 * on parse failure (≤2). Delegates to the shared orchestrator in
	 * `generate/generate-quiz.ts`. `AbortError` propagates.
	 */
	gradeShortAnswer(opts: {
		prompt: string;
		rubric: string;
		answer: string;
		context: ChatMessage[];
	}): Promise<GradedAnswer>;
}

// ── Typed error declarations (implemented in errors.ts) ─────────────────────
// Declared here so adapters can `throw new MissingKeyError(...)` without an
// import cycle: `errors.ts` imports the classes from here.

/** No API key configured for a provider kind that requires one. */
export class MissingKeyError extends Error {
	constructor(
		message = 'No API key configured for this provider.',
		public readonly providerId?: string
	) {
		super(message);
		this.name = 'MissingKeyError';
	}
}

/** Provider returned 429 / signaled rate limiting. */
export class RateLimitError extends Error {
	constructor(
		message = 'Rate limit exceeded. Wait and retry.',
		public readonly retryAfter?: number
	) {
		super(message);
		this.name = 'RateLimitError';
	}
}

/** Browser fetch was blocked by CORS. Hint: use the desktop app. */
export class CorsBlockedError extends Error {
	constructor(
		message = 'The provider blocked this browser request (CORS).',
		public readonly providerId?: string
	) {
		super(message);
		this.name = 'CorsBlockedError';
	}
}

/** Provider returned a non-2xx HTTP status (other than 429). */
export class ProviderHttpError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body?: string
	) {
		super(message);
		this.name = 'ProviderHttpError';
	}
}

/** Network-level failure (DNS, offline, aborted). Aborted-by-user is NOT thrown
 *  as NetworkError — adapters let AbortError propagate (or swallow it) instead. */
export class NetworkError extends Error {
	constructor(
		message = 'Network request failed.',
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'NetworkError';
	}
}
