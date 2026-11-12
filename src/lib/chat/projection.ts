import type { ModelMessage } from 'ai';
import {
	kindOf,
	parseMetadata,
	type BranchArtifactMetadata,
	type EntryKind,
	type ImagePart,
	type MessagePart,
	type TextPart
} from '#lib/chat/kinds.js';

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
	/**
	 * Row insertion time (epoch-ms), carried so the `branch_artifact` framing
	 * header can timestamp the artifact. Optional: `ChatMessage`s only carry it
	 * when the caller passes it through (assembleContext does).
	 */
	createdAt?: number | null;
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
 * Wire content for a row carrying parts (specs/030-image-generation/contracts/message-parts.md §5,
 * amended by specs/033-image-output-finalize-paths/contracts/assistant-projection.md): ordered
 * parts — text part(s) first (omitted when empty, i.e. image-only), then one image-bearing part
 * per stored image in order. The image-bearing shape depends on the target: user rows keep the
 * 018 AI SDK image part (`{ type: 'image', image }` — byte-identical history, legal for user
 * content); assistant rows emit provider file parts (`{ type: 'file', mediaType, data:
 * <base64-only> }` — the SDK AssistantContent union has no image part). Falls back to the row's
 * canonical content when nothing survives, so the payload never goes out empty.
 */
function wireContent(
	parts: MessagePart[],
	fallbackText: string,
	target: 'user' | 'assistant'
): unknown[] {
	const content: unknown[] = [];
	for (const p of parts) {
		if (isTextPart(p)) {
			if (p.text) content.push({ type: 'text', text: p.text });
		} else if (isImagePart(p)) {
			if (target === 'assistant') {
				// Assistant images ride the wire as provider file parts (033 §1):
				// base64-only body (data-URL prefix stripped at the first comma)
				// plus explicit mediaType from the stored part. A part lacking
				// either cannot produce an SDK-valid file part and is skipped
				// silently (defensive; composition upstream guarantees both).
				const comma = p.data.indexOf(',');
				const base64 = comma === -1 ? '' : p.data.slice(comma + 1);
				if (base64 && p.mimeType) {
					content.push({ type: 'file', mediaType: p.mimeType, data: base64 });
				}
			} else {
				content.push({ type: 'image', image: p.data });
			}
		}
	}
	if (content.length === 0) {
		content.push({ type: 'text', text: fallbackText });
	}
	return content;
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

/**
 * Framed payload of a `branch_artifact` row (020 US2): a deterministic
 * header — source branch title, propagation mode, insertion time — followed by
 * a blank line and the stored content verbatim. Missing or corrupt metadata
 * degrades to 'unknown' placeholders; the payload always reaches the model.
 */
function artifactText(row: ProjectableRow): string {
	const meta = parseMetadata<Partial<BranchArtifactMetadata>>(row.metadata ?? null);
	const title =
		meta && typeof meta.sourceChatTitle === 'string' && meta.sourceChatTitle.length > 0
			? meta.sourceChatTitle
			: 'unknown';
	const mode = meta && (meta.mode === 'raw' || meta.mode === 'summary') ? meta.mode : 'unknown';
	const createdAt =
		typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
			? new Date(row.createdAt).toISOString()
			: 'unknown';
	return `[Back-propagated from "${title}" · ${mode} · ${createdAt}]\n\n${row.content}`;
}

export interface ProjectEntriesOptions {
	/**
	 * Whether the active target model accepts images (resolve with
	 * `supportsVision`). Gates `assistant_message` image parts
	 * (specs/030-image-generation/contracts/message-parts.md §5): emitted only when true; otherwise the
	 * row projects text-only, silently. Absent = not vision-capable.
	 */
	visionCapable?: boolean;
}

export function projectEntries(
	rows: readonly ProjectableRow[],
	opts?: ProjectEntriesOptions
): ModelMessage[] {
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

		if (k === 'branch_artifact') {
			// 020 US2: one user-role message — framing header + blank line + the
			// stored payload. Deliberately NOT in EXCLUDED_KINDS: the artifact must
			// steer future answers (FR-008), and the generic fall-through would
			// silently drop it. Emitted like a plain user turn so the consecutive-
			// user merge below still applies.
			raw.push({
				role: 'user' as const,
				content: [{ type: 'text', text: artifactText(r) }]
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
			// 018 behavior: user image parts ride the wire unconditionally here —
			// the vision gate lives upstream (Composer only offers attach for
			// vision-capable models).
			raw.push({
				role: 'user' as const,
				content: wireContent(parts, r.content, 'user')
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'assistant_message') {
			// 030 §5 (amended by 033, contracts/assistant-projection.md): assistant
			// image parts ride the wire as provider file parts, only for
			// vision-capable targets; otherwise text-only, silently.
			const parts = opts?.visionCapable ? rowParts(r) : null;
			if (!parts) {
				raw.push({
					role: 'assistant' as const,
					content: [{ type: 'text', text: r.content }]
				} as unknown as ModelMessage);
				continue;
			}
			raw.push({
				role: 'assistant' as const,
				content: wireContent(parts, r.content, 'assistant')
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
