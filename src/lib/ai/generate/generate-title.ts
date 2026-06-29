/**
 * Title generation (auto-title root chats).
 *
 * Uses the Vercel AI SDK's `generateText` to produce a concise title.
 * Failures are not caught here — the caller wraps in best-effort semantics.
 */
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../types';

const TITLE_PROMPT = [
	'You generate a short title for a conversation.',
	'Reply with ONLY the title. Rules:',
	'- Between 3 and 10 words.',
	'- No quotation marks, no markdown, no trailing punctuation, no emoji.',
	'- Plain text; nothing else.'
].join('\n');

export const DEFAULT_TITLE = 'New chat';

export interface GenerateTitleOptions {
	signal?: AbortSignal;
}

export async function generateTitle(
	model: LanguageModel,
	messages: ChatMessage[],
	opts?: GenerateTitleOptions
): Promise<string> {
	const result = await generateText({
		model,
		system: TITLE_PROMPT,
		messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
		abortSignal: opts?.signal,
		maxRetries: 0
	});
	return cleanTitle(result.text);
}

export function cleanTitle(raw: string): string {
	let t = raw.trim();
	t = t.replace(/^```[a-zA-Z]*\s*/i, '').replace(/```\s*$/, '');
	t = t.replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '');
	t = t.replace(/\s+/g, ' ').trim();
	t = t.replace(/[.!?,;:]+$/g, '');
	if (t.length === 0) return DEFAULT_TITLE;
	if (t.length > 80) return t.slice(0, 79) + '\u2026';
	return t;
}
