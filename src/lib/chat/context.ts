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

/** A message plus the depth of the chat it belongs to (for ordering). */
interface AnchoredMessage {
	depth: number;
	ord: number;
	role: Message['role'];
	content: string;
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

	// 4) Optional leading excerpt note.
	const excerptNote = await excerptSystemNoteFor(target.id);

	const out: ChatMessage[] = [];
	if (excerptNote) out.push(excerptNote);
	for (const m of collected) out.push({ role: m.role, content: m.content });
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
		out.push({ depth, ord: m.ord, role: m.role, content: m.content });
	}
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
