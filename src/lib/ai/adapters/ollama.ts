/**
 * Ollama adapter (`POST /api/chat`, NDJSON stream, no auth).
 *
 * Each line is a JSON object `{ message: { content }, done }`; assistant text
 * arrives incrementally in `message.content`. The final object has `done: true`
 * (and may carry stats we ignore). Same-origin localhost → no CORS concerns.
 */
import { streamNdjson } from '../transport';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import { generateLab as generateLabOrchestrator } from '../generate/generate';
import {
	generateQuiz as generateQuizOrchestrator,
	gradeShortAnswer as gradeShortAnswerOrchestrator
} from '../generate/generate-quiz';

interface OllamaChatLine {
	message?: { content?: string };
	done?: boolean;
}

export function createOllamaAdapter(config: ProviderConfig): Provider {
	const endpoint = joinUrl(config.baseUrl, '/api/chat');

	const adapter: Provider = {
		kind: 'ollama',
		config,

		async *chatStream(messages: ChatMessage[], opts: ChatStreamOptions = {}): AsyncIterable<Token> {
			// Ollama needs no key; it's a local server. We still map messages into
			// Ollama's `{role, content}` shape (identical to OpenAI's).
			const body = JSON.stringify({
				model: opts.model ?? config.defaultModel,
				messages: messages.map((m) => ({ role: m.role, content: m.content })),
				stream: true
			});

			for await (const line of streamNdjson(
				endpoint,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body
				},
				opts.signal
			)) {
				const parsed = safeParse(line);
				if (!parsed) continue;
				const content = parsed.message?.content;
				if (typeof content === 'string' && content.length > 0) yield { text: content };
				if (parsed.done) return;
			}
		},

		// `adapter` is assigned below; the closure captures the built provider.
		generateLab: (messages, opts) => generateLabOrchestrator(adapter, messages, opts),
		generateQuiz: (messages, opts) => generateQuizOrchestrator(adapter, messages, opts),
		gradeShortAnswer: (input) => gradeShortAnswerOrchestrator(adapter, input)
	};
	return adapter;
}

function safeParse(line: string): OllamaChatLine | null {
	try {
		return JSON.parse(line) as OllamaChatLine;
	} catch {
		return null;
	}
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
