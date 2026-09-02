/**
 * Provider/AI layer public types. Spec: `refinement/architecture.md` §6.
 *
 * The `Provider` interface is the single shape every adapter implements.
 * `chatStream` is the only transport method; `generateLab`/`generateQuiz`/
 * `gradeShortAnswer` are thin wrappers that delegate to the shared
 * orchestrators in `generate/` (prompt-driven: stream, parse fenced JSON,
 * retry on parse failure).
 */

import type { MessagePart } from '$lib/chat/kinds';

/** Provider kinds the registry can build adapters for. */
export type ProviderKind =
	| 'openai-compatible'
	| 'anthropic'
	| 'gemini'
	| 'ollama'
	| 'github-copilot';

/** A single chat message, provider-agnostic. Maps into each adapter's wire shape. */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	/** For assistant rows carrying a tool call. */
	toolCallId?: string;
	toolName?: string;
	toolArgs?: unknown;
	/** For tool-result rows. */
	toolResult?: string;
	/**
	 * Multimodal parts carried from the source row (text + images); set by
	 * `assembleContext` only for rows that actually have parts.
	 */
	parts?: MessagePart[];
}

/** A streamed token. `delta` and `text` are aliases (kept for readability at call sites). */
export interface Token {
	text?: string;
	delta?: string;
}

/** Reasoning/thinking control. `'auto'` (or omitted) = provider default. */
export type ReasoningMode = 'auto' | 'enabled' | 'disabled';

/** Three-tier reasoning effort selector for chat turns. Default: `'on'`. */
export type ReasoningEffort = 'off' | 'on' | 'deep';

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
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| JSONValue[]
	| { [key: string]: JSONValue };

export type SamplingRequestDefaults = {
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	stopSequences?: string[];
	seed?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
};

export type ResolvedRequestSettings = {
	callSettings: SamplingRequestDefaults;
	providerOptions: Record<string, unknown>;
	droppedExtraKeys: string[];
};

export type HazardId =
	| 'locks-sampling'
	| 'thinking-ignores-sampling'
	| 'thinking-rejects-sampling'
	| 'cannot-disable-thinking'
	| 'reasoning-eats-token-cap';

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
	/**
	 * Per-provider tool-capability flag. `'auto'`/undefined → resolved default per
	 * kind (anthropic/gemini→true, ollama→false, openai-compatible→true iff baseUrl
	 * is a known gateway). `'on'`/`'off'` override. Respected by the agent loop
	 * (AG3) to decide whether tool definitions are sent.
	 */
	toolCapability?: 'auto' | 'on' | 'off';
	/**
	 * Per-provider vision flag. `'auto'`/undefined → resolved from a static
	 * allowlist of vision-capable model-family prefixes (see
	 * `src/lib/ai/vision-capability.ts`). `'on'`/`'off'` override. Advisory
	 * only: gates the composer attachment affordance (FR-006) and
	 * image-unsupported error classification (FR-007); it must never strip,
	 * block, or rewrite message parts on the wire.
	 */
	vision?: 'auto' | 'on' | 'off';
	requestDefaults?: SamplingRequestDefaults;
	extraBody?: Record<string, JSONValue>;
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

/** GitHub authorization is missing, expired, or revoked — the device flow must
 *  be rerun (one-action "Reconnect GitHub"). */
export class CopilotAuthRequiredError extends Error {
	constructor(
		message = 'GitHub authorization required. Reconnect your GitHub account.',
		public readonly providerId?: string
	) {
		super(message);
		this.name = 'CopilotAuthRequiredError';
	}
}

/** The authorized GitHub account has no active Copilot subscription. */
export class CopilotSubscriptionError extends Error {
	constructor(message = 'This GitHub account does not have an active Copilot subscription.') {
		super(message);
		this.name = 'CopilotSubscriptionError';
	}
}

/** The active model does not accept image input — either resolved up front
 *  (advisory gate on a send that carried image parts) or classified as a
 *  fallback from a provider 4xx on an image-bearing request (see
 *  `asImageUnsupported`). */
export class ImageUnsupportedError extends Error {
	constructor(
		message = "This model doesn't accept images.",
		public readonly modelId?: string,
		public readonly providerId?: string
	) {
		super(message);
		this.name = 'ImageUnsupportedError';
	}
}
