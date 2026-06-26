/**
 * Shared adapter for OpenAI-compatible providers. Covers OpenAI itself and
 * Z.AI/GLM (Z.AI's coding endpoint speaks the standard OpenAI shape:
 * `POST <baseUrl>/chat/completions`, SSE with `choices[0].delta.content`, and a
 * `[DONE]` terminator). Parameterized entirely by `baseUrl` + `models[]` + key.
 *
 * No special-casing per provider: the factory in `registry.ts` instantiates this
 * twice (OpenAI and Z.AI) with different base URLs and model lists.
 */
import { streamSse } from '../transport';
import { MissingKeyError } from '../types';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import { generateLab as generateLabOrchestrator } from '../generate/generate';
import {
	generateQuiz as generateQuizOrchestrator,
	gradeShortAnswer as gradeShortAnswerOrchestrator
} from '../generate/generate-quiz';

/** Shape of a streamed OpenAI completion chunk (only the fields we read). */
interface OpenAiStreamChunk {
	choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

export interface OpenAICompatibleAdapterDeps {
	/** True if an API key is configured (probed lazily so a late save is noticed). */
	hasKey: () => Promise<boolean>;
}

export function createOpenAICompatibleAdapter(
	config: ProviderConfig,
	deps: OpenAICompatibleAdapterDeps
): Provider {
	const endpoint = joinUrl(config.baseUrl, '/chat/completions');

	const adapter: Provider = {
		kind: 'openai-compatible',
		config,

		async *chatStream(messages: ChatMessage[], opts: ChatStreamOptions = {}): AsyncIterable<Token> {
			const hasKey = await deps.hasKey();
			// OpenAI-compatible endpoints require a bearer key. Missing key is a
			// typed, user-actionable error (the UI prompts to add one). The secret
			// itself is resolved into the header by the transport, not here.
			if (!hasKey) throw new MissingKeyError(undefined, config.id);

			const model = opts.model ?? config.defaultModel;
			const body = JSON.stringify({
				model,
				messages: messages.map((m) => ({ role: m.role, content: m.content })),
				stream: true
			});

			for await (const data of streamSse(
				endpoint,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					auth: { header: 'Authorization', scheme: 'Bearer', keyId: config.id },
					body
				},
				opts.signal
			)) {
				const parsed = safeParse(data);
				if (!parsed) continue;
				const delta = parsed.choices?.[0]?.delta?.content;
				if (typeof delta === 'string' && delta.length > 0) yield { text: delta };
			}
		},

		// `adapter` is assigned to `const adapter` below, so this closure captures
		// the fully-built provider (chatStream + generateLab) for the orchestrator.
		generateLab: (messages, opts) => generateLabOrchestrator(adapter, messages, opts),
		generateQuiz: (messages, opts) => generateQuizOrchestrator(adapter, messages, opts),
		gradeShortAnswer: (input) => gradeShortAnswerOrchestrator(adapter, input)
	};
	return adapter;
}

/** Parse a JSON data payload defensively (some providers emit keep-alive blanks). */
function safeParse(data: string): OpenAiStreamChunk | null {
	try {
		return JSON.parse(data) as OpenAiStreamChunk;
	} catch {
		return null;
	}
}

/** Join a base URL and a path, tolerating a trailing slash / leading slash. */
function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
