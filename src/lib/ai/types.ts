/**
 * Provider/AI layer public types. Spec: `refinement/architecture.md` §6.
 *
 * The `Provider` interface is the single shape every adapter implements. Only
 * `chatStream` is functional in P1; `generateLab`/`generateQuiz`/`gradeAnswer`
 * are declared here to lock the shape so later phases don't reopen adapters
 * (they throw `Error('P3')` / `Error('P4')`).
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

/** Options accepted by `Provider.chatStream`. */
export interface ChatStreamOptions {
	signal?: AbortSignal;
	/** Override the provider's `defaultModel` for this call only. */
	model?: string;
}

// Re-exported so `Provider.generateLab` can reference the generated-lab shape
// without every adapter re-importing from `generate/lab.ts`. The orchestrator
// is still the single implementer; this is a type-only re-export.
import type { GeneratedLab } from './generate/lab';
export type { GeneratedLab };

/**
 * Static, non-secret configuration for a configured provider. Stored under the
 * `providers` settings key as `{[id]: ProviderConfig}`. API keys live separately
 * under `providerKey:<id>` (see `client.ts`).
 */
export interface ProviderConfig {
	id: string;
	kind: ProviderKind;
	name: string;
	baseUrl: string;
	defaultModel: string;
	models: string[];
}

/**
 * The provider abstraction. Adapters implement `chatStream`; lab generation
 * delegates to the shared orchestrator in `generate/generate.ts` (every
 * adapter's `generateLab` is a thin wrapper). Quiz/grading stay stubbed until P4.
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

	// ── P4 generation helpers — declared now, implemented in P4. ─────────────
	generateQuiz(_messages: ChatMessage[], _opts?: ChatStreamOptions): Promise<never>;
	gradeAnswer(_questionId: string, _answer: string): Promise<never>;
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
