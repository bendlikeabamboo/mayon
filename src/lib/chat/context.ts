/**
 * Reference-based context assembly (architecture.md §5.2).
 *
 * A child inherits "excerpt + full history up to the fork point" by **reading**
 * ancestor messages — never copying. `branchPointMessageId` on a node points to
 * a message in its **parent** and defines how many of the parent's own messages
 * the child sees (`ord <= ord(branchPointMessageId)`).
 *
 * The algorithm:
 *   1) target's own messages: all of them.
 *   2) walk up `parentId`; for each ancestor, include its own messages up to the
 *      cutoff recorded on the child that links into it (root → all).
 *   3) sort parts by depth asc, then ord asc.
 *   4) if a `branch_sources` row exists for the target, inject its excerpt as a
 *      leading system note so the first turn is anchored to the highlighted text.
 *
 * Pure: takes only a chatId and resolves everything through `repos`.
 */
import { repos } from '$lib/db';
import type { Chat, Message } from '$lib/db/schema';
import type { ChatMessage } from '$lib/ai/types';
import { buildBriefSystemNote, parseBrief } from '$lib/chat/brief';
import type { ModelMessage } from 'ai';

/** A message plus the depth of the chat it belongs to (for ordering). */
interface AnchoredMessage {
	depth: number;
	ord: number;
	role: Message['role'];
	content: string;
	toolCallId?: string | null;
	toolName?: string | null;
	metadata?: string | null;
}

/**
 * Assemble the message set to send to the LLM for `targetChatId`. Returns an
 * ordered `ChatMessage[]` with the branch excerpt (if any) as a leading system
 * note. Throws if the target chat does not exist.
 */
export async function assembleContext(targetChatId: string): Promise<ChatMessage[]> {
	const target = await repos.chats.getById(targetChatId);
	if (!target) throw new Error(`assembleContext: chat ${targetChatId} not found`);

	// Gather (ancestor, cutoffOrd) pairs from root → target so we can sort by depth.
	const collected: AnchoredMessage[] = [];

	// 1) Target's own messages: all.
	const own = await repos.messages.listUpToOrd(target.id, null);
	pushAll(collected, own, target.depth);

	// 2) Walk up. The child we came from defines the cutoff for its parent.
	let child: Chat = target;
	let node = await parentOf(target);
	while (node) {
		const cutoff = await cutoffForChild(child); // null for root → all
		const msgs = await repos.messages.listUpToOrd(node.id, cutoff);
		pushAll(collected, msgs, node.depth);
		child = node;
		node = await parentOf(node);
	}

	// 3) Sort by depth asc, then ord asc.
	collected.sort((a, b) => a.depth - b.depth || a.ord - b.ord);

	// 4) Optional leading notes. The brief (overarching framing, read from the
	//    root) leads, then the branch excerpt (branch-specific seed). Branches
	//    inherit the root's brief via `rootId`; their own `brief` column is null.
	const briefNote = await briefSystemNoteFor(target);
	const excerptNote = await excerptSystemNoteFor(target.id);
	const attachmentNotes = await attachmentSystemNotesFor(target.id);

	const out: ChatMessage[] = [];
	if (briefNote) out.push(briefNote);
	if (excerptNote) out.push(excerptNote);
	out.push(...attachmentNotes);
	for (const m of collected) {
		const msg: ChatMessage = { role: m.role, content: m.content };
		if (m.toolCallId) msg.toolCallId = m.toolCallId;
		if (m.toolName) msg.toolName = m.toolName;
		if (m.role === 'tool') {
			msg.toolResult = m.metadata ?? m.content;
		}
		out.push(msg);
	}
	return out;
}

/** Fetch the parent chat of `node`, or null if `node` is the root. */
async function parentOf(node: Chat): Promise<Chat | null> {
	if (!node.parentId) return null;
	return (await repos.chats.getById(node.parentId)) ?? null;
}

/**
 * The cutoff `ord` the parent should be read up to, as defined by the child's
 * `branchPointMessageId`. That id points to a message in the **parent**; its
 * `.ord` is the inclusive cutoff. Returns null (→ all) if the child has no
 * branch point, or if the referenced message is gone.
 */
async function cutoffForChild(child: Chat): Promise<number | null> {
	if (!child.branchPointMessageId) return null;
	const msg = await repos.messages.getById(child.branchPointMessageId);
	return msg ? msg.ord : null;
}

/** Append a chat's messages to the collector, tagged with that chat's depth. */
function pushAll(out: AnchoredMessage[], msgs: Message[], depth: number): void {
	for (const m of msgs) {
		out.push({
			depth,
			ord: m.ord,
			role: m.role,
			content: m.content,
			toolCallId: m.toolCallId,
			toolName: m.toolName,
			metadata: m.metadata
		});
	}
}

/**
 * If the target's ROOT carries a Learning Brief, render it as a leading system
 * note. The brief is authored on the root only; a branch inherits it because we
 * read from `target.rootId` (self for a root), never the target's own (null)
 * `brief` column. Returns `null` when the root has no parseable brief.
 *
 * Reuses the already-fetched `target` when the target IS the root (avoids a
 * redundant fetch); otherwise does a single `getById` for the root.
 */
async function briefSystemNoteFor(target: Chat): Promise<ChatMessage | null> {
	const root = target.rootId === target.id ? target : await repos.chats.getById(target.rootId);
	if (!root) return null;
	const brief = parseBrief(root.brief);
	if (!brief) return null;
	return buildBriefSystemNote(brief);
}

/**
 * If the target was branched from a highlight, build a leading system note that
 * anchors the conversation to that excerpt. Returns null when there is no
 * `branch_sources` row for the target.
 */
async function excerptSystemNoteFor(targetChatId: string): Promise<ChatMessage | null> {
	const src = await repos.branchSources.getByBranchChat(targetChatId);
	if (!src) return null;
	return {
		role: 'system',
		content: `This conversation was branched from the following excerpt of an earlier chat:\n\n"""\n${src.excerpt}\n"""`
	};
}

async function attachmentSystemNotesFor(targetChatId: string): Promise<ChatMessage[]> {
	const attachments = await repos.mcp.listAttachments(targetChatId);
	if (attachments.length === 0) return [];
	return attachments.map((att) => ({
		role: 'system' as const,
		content: `[Attached MCP resource — ${att.serverName}: ${att.name} (${att.uri})]\n${att.content}`
	}));
}

/**
 * Convert an assembled `ChatMessage[]` into ai@7 `ModelMessage[]`.
 *
 * - `system` → system message
 * - plain `user`/`assistant` text → text messages
 * - assistant row with `toolArgs` → `AssistantModelMessage` with parts
 *   (`TextPart?` + `ToolCallPart`)
 * - tool row → `ToolModelMessage` with `ToolResultPart`
 *
 * Constructed directly — no `convertToCoreMessages` (removed in ai@5+).
 */
/**
 * ai v7's `ModelMessage` schema requires a tool-result part's `output` to be a
 * discriminated object (`{ type: 'text', value }` / `{ type: 'json', value }`).
 * A bare string is rejected by `standardizePrompt` before any provider call.
 *
 * Tools persist their structured result in `messages.metadata` (a JSON string);
 * when present it is parsed back into a `json`-typed output. A plain summary
 * string (no structured detail) becomes a `text`-typed output.
 */
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

export function toCoreMessages(ctx: ChatMessage[]): ModelMessage[] {
	const raw = ctx
		.filter((m) => m.role !== 'system')
		.map((m): ModelMessage => {
			if (m.role === 'tool') {
				return {
					role: 'tool' as const,
					content: [
						{
							type: 'tool-result' as const,
							toolCallId: m.toolCallId ?? '',
							toolName: m.toolName ?? '',
							output: toolResultOutput(m.toolResult ?? m.content)
						}
					]
				} as unknown as ModelMessage;
			}

			if (m.role === 'assistant' && m.toolCallId && m.toolName) {
				const parts: unknown[] = [];
				if (m.content) parts.push({ type: 'text', text: m.content });
				parts.push({
					type: 'tool-call',
					toolCallId: m.toolCallId,
					toolName: m.toolName,
					input: (m.toolArgs as Record<string, unknown>) ?? {}
				});
				return { role: 'assistant' as const, content: parts } as unknown as ModelMessage;
			}

			if (m.role === 'assistant') {
				return {
					role: 'assistant' as const,
					content: [{ type: 'text', text: m.content }]
				} as unknown as ModelMessage;
			}

			return {
				role: 'user' as const,
				content: [{ type: 'text', text: m.content }]
			} as unknown as ModelMessage;
		});

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
