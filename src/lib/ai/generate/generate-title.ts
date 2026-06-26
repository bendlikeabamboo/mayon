/**
 * Title generation (auto-title root chats).
 *
 * Provider-agnostic orchestrator mirroring `generate/generate.ts`: prepends a
 * system instruction, streams a reply via `provider.chatStream`, then normalizes
 * the raw output into a clean title. No JSON to parse, so there are no retries —
 * a malformed/empty result just falls back to the placeholder.
 *
 * Called best-effort by `chatStore.autoTitleRoot` after a root's first exchange;
 * title failures must never break the chat.
 */
import type { ChatMessage, ChatStreamOptions, Provider } from '../types';

const TITLE_PROMPT = [
	'You generate a short title for a conversation.',
	'Reply with ONLY the title. Rules:',
	'- At most 6 words.',
	'- No quotation marks, no markdown, no trailing punctuation, no emoji.',
	'- Plain text; nothing else.'
].join('\n');

/** The placeholder a fresh root chat starts with (matched to reset it on failure). */
export const DEFAULT_TITLE = 'New chat';

/**
 * Generate a concise title for `messages` (the chat context). Streams tokens via
 * `provider.chatStream`, accumulates, and normalizes via {@link cleanTitle}.
 * `AbortError` and transport errors propagate to the caller.
 */
export async function generateTitle(
	provider: Provider,
	messages: ChatMessage[],
	opts?: ChatStreamOptions
): Promise<string> {
	const turns: ChatMessage[] = [{ role: 'system', content: TITLE_PROMPT }, ...messages];
	let buffer = '';
	for await (const token of provider.chatStream(turns, opts)) {
		buffer += token.text ?? token.delta ?? '';
	}
	return cleanTitle(buffer);
}

/**
 * Normalize a raw model title into a clean single line: strip code fences,
 * surrounding quotes, trailing punctuation, collapse whitespace, and clamp to a
 * sane length. Falls back to {@link DEFAULT_TITLE} when nothing usable remains.
 */
export function cleanTitle(raw: string): string {
	let t = raw.trim();
	t = t.replace(/^```[a-zA-Z]*\s*/i, '').replace(/```\s*$/, '');
	t = t.replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '');
	t = t.replace(/\s+/g, ' ').trim();
	t = t.replace(/[.!?,;:]+$/g, '');
	if (t.length === 0) return DEFAULT_TITLE;
	if (t.length > 80) return t.slice(0, 77) + '\u2026';
	return t;
}
