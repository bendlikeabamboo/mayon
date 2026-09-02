import type { ModelMessage } from 'ai';
import {
	kindOf,
	type EntryKind,
	type ImagePart,
	type MessagePart,
	type TextPart
} from '$lib/chat/kinds';

const EXCLUDED_KINDS = new Set<EntryKind>([
	'reasoning',
	'approval',
	'sampling',
	'elicitation',
	'self_corrected'
]);

type ToolResultOutput =
	| { type: 'text'; value: string }
	| { type: 'json'; value: Record<string, unknown> };

function toolResultOutput(stored: string): ToolResultOutput {
	try {
		const v = JSON.parse(stored);
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			return { type: 'json', value: v as Record<string, unknown> };
		}
	} catch {
		/* not a JSON object — emit the raw summary as text below */
	}
	return { type: 'text', value: stored };
}

export interface ProjectableRow {
	role: string;
	content: string;
	toolCallId?: string | null;
	toolName?: string | null;
	metadata?: string | null;
	kind?: string | null;
	/** Raw `messages.parts` JSON (stored rows) or already-parsed parts (ChatMessage). */
	parts?: string | MessagePart[] | null;
}

/**
 * The row's parts when it actually carries parts: a non-empty array, either
 * already parsed (ChatMessage) or parsed from the stored JSON string. Null for
 * parts-less and malformed rows so image-less conversations stay byte-identical.
 */
function rowParts(row: ProjectableRow): MessagePart[] | null {
	const raw = row.parts;
	if (!raw) return null;
	if (Array.isArray(raw)) return raw.length > 0 ? raw : null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.length > 0 ? (parsed as MessagePart[]) : null;
	} catch {
		return null;
	}
}

function isTextPart(p: MessagePart): p is TextPart {
	return p.type === 'text';
}

function isImagePart(p: MessagePart): p is ImagePart {
	return p.type === 'image';
}

/**
 * Placeholder result synthesized for a tool call whose result row was never
 * persisted (turn interrupted between appending the call and its result).
 * Providers reject requests containing a dangling tool call, so every emitted
 * tool-call part must have a matching tool-result part.
 */
const INTERRUPTED_TOOL_RESULT = '(no result recorded — the turn was interrupted)';

/**
 * Compute, for each row, the set of tool-result ids in its TURN (the run of
 * rows since the last `user_message`). Pairing must be turn-scoped, not
 * conversation-global: many providers (OpenRouter DeepSeek, Z.AI GLM) restart
 * tool-call ids per response (`call_0`, `call_1`, …), so ids repeat across
 * turns. A global set lets a later turn's result falsely "satisfy" an earlier
 * turn's call, which is then sent as a dangling tool call — the provider
 * rejects the whole request with "Tool result is missing for tool call call_0".
 */
function turnResultScopes(rows: readonly ProjectableRow[]): Array<Set<string>> {
	const scopes: Array<Set<string>> = [];
	let current: Set<string> | null = null;
	for (let i = 0; i < rows.length; i++) {
		const k = kindOf(rows[i]!);
		if (k === 'user_message' || current === null) current = new Set<string>();
		if (k === 'tool_result') current.add(rows[i]!.toolCallId ?? '');
		scopes.push(current);
	}
	return scopes;
}

export function projectEntries(rows: readonly ProjectableRow[]): ModelMessage[] {
	const resultScopes = turnResultScopes(rows);

	const raw: ModelMessage[] = [];
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i]!;
		const k = kindOf(r);

		if (EXCLUDED_KINDS.has(k)) continue;
		if (r.role === 'system') continue;

		if (k === 'choices' && (!r.toolCallId || !resultScopes[i]!.has(r.toolCallId))) {
			const syntheticId = r.toolCallId ?? '';
			const parts: unknown[] = [];
			if (r.content) parts.push({ type: 'text', text: r.content });
			parts.push({
				type: 'tool-call',
				toolCallId: syntheticId,
				toolName: 'present_choices',
				input: {}
			});
			raw.push({ role: 'assistant' as const, content: parts } as unknown as ModelMessage);
			raw.push({
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result',
						toolCallId: syntheticId,
						toolName: 'present_choices',
						output: { type: 'text', value: 'options presented' }
					}
				]
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'tool_call' || k === 'choices') {
			const parts: unknown[] = [];
			if (r.content) parts.push({ type: 'text', text: r.content });
			const toolCallId = r.toolCallId ?? '';
			parts.push({
				type: 'tool-call',
				toolCallId,
				toolName: r.toolName ?? '',
				input: {}
			});
			raw.push({ role: 'assistant' as const, content: parts } as unknown as ModelMessage);
			// Orphaned tool call (no result row in this turn — e.g. the turn was
			// aborted between appending the call and its result): synthesize a
			// placeholder result so the provider never sees a dangling call.
			if (!resultScopes[i]!.has(toolCallId)) {
				raw.push({
					role: 'tool' as const,
					content: [
						{
							type: 'tool-result',
							toolCallId,
							toolName: r.toolName ?? '',
							output: { type: 'text', value: INTERRUPTED_TOOL_RESULT }
						}
					]
				} as unknown as ModelMessage);
			}
			continue;
		}

		if (k === 'tool_result') {
			raw.push({
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result',
						toolCallId: r.toolCallId ?? '',
						toolName: r.toolName ?? '',
						output: toolResultOutput(r.metadata ?? r.content)
					}
				]
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'user_message') {
			const parts = rowParts(r);
			if (!parts) {
				raw.push({
					role: 'user' as const,
					content: [{ type: 'text', text: r.content }]
				} as unknown as ModelMessage);
				continue;
			}
			// contracts/message-parts.md §5: ordered parts — text part(s) first
			// (omitted when empty, i.e. image-only), then one image part per
			// stored image in order. The AI SDK user image part takes the
			// stored data-URL string directly.
			const content: unknown[] = [];
			for (const p of parts) {
				if (isTextPart(p)) {
					if (p.text) content.push({ type: 'text', text: p.text });
				} else if (isImagePart(p)) {
					content.push({ type: 'image', image: p.data });
				}
			}
			if (content.length === 0) {
				content.push({ type: 'text', text: r.content });
			}
			raw.push({ role: 'user' as const, content } as unknown as ModelMessage);
			continue;
		}

		if (k === 'assistant_message') {
			raw.push({
				role: 'assistant' as const,
				content: [{ type: 'text', text: r.content }]
			} as unknown as ModelMessage);
			continue;
		}
	}

	const merged: ModelMessage[] = [];
	for (const msg of raw) {
		const last = merged[merged.length - 1];
		if (
			last &&
			last.role === msg.role &&
			Array.isArray(last.content) &&
			Array.isArray(msg.content)
		) {
			(last.content as unknown[]).push(...(msg.content as unknown[]));
		} else {
			merged.push(msg);
		}
	}
	return merged;
}
