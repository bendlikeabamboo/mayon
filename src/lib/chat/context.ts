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
import { kindOf } from '$lib/chat/kinds';
import { projectEntries } from '$lib/chat/projection';

const PROVIDER_EXCLUDED_KINDS = new Set([
	'reasoning',
	'approval',
	'sampling',
	'elicitation',
	'self_corrected'
]);

interface AnchoredMessage {
	depth: number;
	ord: number;
	role: Message['role'];
	content: string;
	toolCallId?: string | null;
	toolName?: string | null;
	metadata?: string | null;
	kind?: string | null;
}

/**
 * Assemble the message set to send to the LLM for `targetChatId`. Returns an
 * ordered `ChatMessage[]` with the branch excerpt (if any) as a leading system
 * note. Throws if the target chat does not exist.
 */
export async function assembleContext(targetChatId: string): Promise<ChatMessage[]> {
	const target = await repos.chats.getById(targetChatId);
	if (!target) throw new Error(`assembleContext: chat ${targetChatId} not found`);

	const collected: AnchoredMessage[] = [];

	const own = await repos.messages.listUpToOrd(target.id, null);
	pushAll(collected, own, target.depth);

	let child: Chat = target;
	let node = await parentOf(target);
	while (node) {
		const cutoff = await cutoffForChild(child);
		const msgs = await repos.messages.listUpToOrd(node.id, cutoff);
		pushAll(collected, msgs, node.depth);
		child = node;
		node = await parentOf(node);
	}

	collected.sort((a, b) => a.depth - b.depth || a.ord - b.ord);

	const briefNote = await briefSystemNoteFor(target);
	const excerptNote = await excerptSystemNoteFor(target.id);
	const attachmentNotes = await attachmentSystemNotesFor(target.id);

	const out: ChatMessage[] = [];
	if (briefNote) out.push(briefNote);
	if (excerptNote) out.push(excerptNote);
	out.push(...attachmentNotes);
	for (const m of collected) {
		if (PROVIDER_EXCLUDED_KINDS.has(kindOf(m))) continue;
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

export { projectEntries };

async function parentOf(node: Chat): Promise<Chat | null> {
	if (!node.parentId) return null;
	return (await repos.chats.getById(node.parentId)) ?? null;
}

async function cutoffForChild(child: Chat): Promise<number | null> {
	if (!child.branchPointMessageId) return null;
	const msg = await repos.messages.getById(child.branchPointMessageId);
	return msg ? msg.ord : null;
}

function pushAll(out: AnchoredMessage[], msgs: Message[], depth: number): void {
	for (const m of msgs) {
		out.push({
			depth,
			ord: m.ord,
			role: m.role,
			content: m.content,
			toolCallId: m.toolCallId,
			toolName: m.toolName,
			metadata: m.metadata,
			kind: m.kind
		});
	}
}

async function briefSystemNoteFor(target: Chat): Promise<ChatMessage | null> {
	const root = target.rootId === target.id ? target : await repos.chats.getById(target.rootId);
	if (!root) return null;
	const brief = parseBrief(root.brief);
	if (!brief) return null;
	return buildBriefSystemNote(brief);
}

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
