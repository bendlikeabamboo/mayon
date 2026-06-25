/**
 * Google Gemini adapter (`streamGenerateContent` with `alt=sse`).
 *
 * Wire-shape differences this adapter absorbs:
 *   - `role` mapping: assistant → `model`, user → `user`. System messages have
 *     no direct equivalent, so they are merged into a leading instruction that
 *     prepends the first user turn (or, if there is none, an empty user turn).
 *   - Auth via `x-goog-api-key` header (the `?key=` query form also works; the
 *     header keeps the key out of logs/URLs).
 *   - The SSE stream yields `candidates[0].content.parts[].text` per chunk.
 */
import { streamSse } from '../transport';
import { MissingKeyError } from '../types';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import { p3, p4 } from './stubs';

interface GeminiStreamChunk {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
	}>;
}

export interface GeminiAdapterDeps {
	getKey: () => Promise<string | null>;
}

export function createGeminiAdapter(config: ProviderConfig, deps: GeminiAdapterDeps): Provider {
	return {
		kind: 'gemini',
		config,

		async *chatStream(messages: ChatMessage[], opts: ChatStreamOptions = {}): AsyncIterable<Token> {
			const key = await deps.getKey();
			if (!key) throw new MissingKeyError(undefined, config.id);

			const model = opts.model ?? config.defaultModel;
			const endpoint = joinUrl(
				config.baseUrl,
				`/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
			);

			// Fold system messages into a leading instruction on the first user turn.
			const systemParts: string[] = [];
			const contents: Array<{ role: 'user' | 'model'; parts: { text: string }[] }> = [];
			for (const m of messages) {
				if (m.role === 'system') {
					if (m.content) systemParts.push(m.content);
				} else {
					contents.push({
						role: m.role === 'assistant' ? 'model' : 'user',
						parts: [{ text: m.content }]
					});
				}
			}
			if (systemParts.length > 0) {
				const systemText = systemParts.join('\n\n');
				const firstUserIdx = contents.findIndex((c) => c.role === 'user');
				if (firstUserIdx === -1) {
					// No user turn at all — synthesize one carrying the system text.
					contents.unshift({ role: 'user', parts: [{ text: systemText }] });
				} else {
					const first = contents[firstUserIdx];
					contents[firstUserIdx] = {
						role: 'user',
						parts: [{ text: `${systemText}\n\n${first.parts.map((p) => p.text).join('')}` }]
					};
				}
			}

			const body = JSON.stringify({ contents });

			for await (const data of streamSse(
				endpoint,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': key
					},
					body
				},
				opts.signal
			)) {
				const parsed = safeParse(data);
				if (!parsed) continue;
				const parts = parsed.candidates?.[0]?.content?.parts;
				if (!parts) continue;
				for (const part of parts) {
					if (typeof part.text === 'string' && part.text.length > 0) yield { text: part.text };
				}
			}
		},

		generateLab: p3,
		generateQuiz: p3,
		gradeAnswer: p4
	};
}

function safeParse(data: string): GeminiStreamChunk | null {
	try {
		return JSON.parse(data) as GeminiStreamChunk;
	} catch {
		return null;
	}
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path}`;
}
