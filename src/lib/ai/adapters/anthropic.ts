/**
 * Anthropic Messages API adapter.
 *
 * Wire-shape differences from OpenAI that this adapter absorbs:
 *   - The `system` prompt is a top-level `system` field, NOT a message in the
 *     `messages` array. Multiple system messages are concatenated.
 *   - Auth uses `x-api-key` + `anthropic-version`, and browser calls must send
 *     `anthropic-dangerous-direct-browser-access: true` (Anthropic otherwise
 *     rejects browser-origin requests). Even with it, CORS may still block —
 *     that surfaces as `CorsBlockedError` (see `errors.ts`) with the desktop hint.
 *   - The stream is SSE where each event has an `event:` type plus a `data:`
 *     JSON payload; assistant text arrives in `content_block_delta` events as
 *     `delta.text`.
 */
import { streamSse } from '../transport';
import { MissingKeyError } from '../types';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import { generateLab as generateLabOrchestrator } from '../generate/generate';
import {
	generateQuiz as generateQuizOrchestrator,
	gradeShortAnswer as gradeShortAnswerOrchestrator
} from '../generate/generate-quiz';

const ANTHROPIC_VERSION = '2023-06-01';

/** `content_block_delta` event payload (only the fields we read). */
interface AnthropicDelta {
	type?: string;
	delta?: { type?: string; text?: string };
}

export interface AnthropicAdapterDeps {
	getKey: () => Promise<string | null>;
}

export function createAnthropicAdapter(
	config: ProviderConfig,
	deps: AnthropicAdapterDeps
): Provider {
	const endpoint = joinUrl(config.baseUrl, '/v1/messages');

	const adapter: Provider = {
		kind: 'anthropic',
		config,

		async *chatStream(messages: ChatMessage[], opts: ChatStreamOptions = {}): AsyncIterable<Token> {
			const key = await deps.getKey();
			if (!key) throw new MissingKeyError(undefined, config.id);

			// Split system messages out: Anthropic puts them in a top-level field.
			const systemParts: string[] = [];
			const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
			for (const m of messages) {
				if (m.role === 'system') {
					if (m.content) systemParts.push(m.content);
				} else {
					turns.push({ role: m.role, content: m.content });
				}
			}
			// Anthropic requires the first turn to be `user`; if callers lead with
			// an assistant turn, prepend an empty user turn so the request is valid.
			if (turns.length > 0 && turns[0].role !== 'user') {
				turns.unshift({ role: 'user', content: '' });
			}

			const body = JSON.stringify({
				model: opts.model ?? config.defaultModel,
				messages: turns,
				system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
				max_tokens: 4096,
				stream: true
			});

			for await (const data of streamSse(
				endpoint,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': key,
						'anthropic-version': ANTHROPIC_VERSION,
						// Required for browser-origin calls; a no-op in the desktop shell.
						'anthropic-dangerous-direct-browser-access': 'true'
					},
					body
				},
				opts.signal
			)) {
				const parsed = safeParse(data);
				if (!parsed) continue;
				// Only content deltas carry assistant text; other event types
				// (message_start, message_delta, message_stop) are ignored.
				if (parsed.type !== 'content_block_delta') continue;
				const text = parsed.delta?.text;
				if (typeof text === 'string' && text.length > 0) yield { text };
			}
		},

		// `adapter` is assigned below; the closure captures the built provider.
		generateLab: (messages, opts) => generateLabOrchestrator(adapter, messages, opts),
		generateQuiz: (messages, opts) => generateQuizOrchestrator(adapter, messages, opts),
		gradeShortAnswer: (input) => gradeShortAnswerOrchestrator(adapter, input)
	};
	return adapter;
}

function safeParse(data: string): AnthropicDelta | null {
	try {
		return JSON.parse(data) as AnthropicDelta;
	} catch {
		return null;
	}
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
