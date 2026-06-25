/**
 * Branch/tree helpers (architecture.md §5, P2).
 *
 * Pure functions over plain `Chat` data so they are unit-tested without a DOM
 * or driver. Two shapes:
 *
 *   - `breadcrumbToRoot` — the ordered ancestor chain root…current.
 *   - `buildSubtreeModel` — nested `{ chat, children[] }` from a flat
 *     `listSubtree` result.
 */
import type { Chat } from '$lib/db/schema';

export interface SubtreeNode {
	chat: Chat;
	children: SubtreeNode[];
}

/**
 * Walk `parentId` from `current` up to the root, returning the chain
 * root…current (inclusive of `current`).
 *
 * `byId` is a lookup the caller builds (e.g. from a `listSubtree` result) —
 * this keeps the function pure and avoids any driver calls. Cycles are
 * guarded: a visited set caps the walk so a malformed parent pointer cannot
 * loop forever.
 */
export function breadcrumbToRoot(current: Chat, byId: Map<string, Chat>): Chat[] {
	const chain: Chat[] = [];
	const seen = new Set<string>();
	let node: Chat | undefined = current;
	while (node && !seen.has(node.id)) {
		seen.add(node.id);
		chain.unshift(node);
		node = node.parentId ? byId.get(node.parentId) : undefined;
	}
	return chain;
}

/**
 * Build a nested forest from a flat list of chats that share a root (the
 * output of `chatsRepo.listSubtree`). Returns one entry per root found in the
 * flat list; the plan renders a single root's tree, but supporting a forest
 * costs nothing and is robust to an unfiltered input.
 */
export function buildSubtreeModel(chats: Chat[]): SubtreeNode[] {
	const nodes = new Map<string, SubtreeNode>();
	for (const chat of chats) nodes.set(chat.id, { chat, children: [] });

	const roots: SubtreeNode[] = [];
	for (const chat of chats) {
		const node = nodes.get(chat.id)!;
		if (chat.parentId && nodes.has(chat.parentId)) {
			nodes.get(chat.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}
	// Sort children by createdAt for stable display.
	const sortRecursive = (n: SubtreeNode) => {
		n.children.sort((a, b) => a.chat.createdAt - b.chat.createdAt);
		for (const c of n.children) sortRecursive(c);
	};
	for (const r of roots) sortRecursive(r);
	return roots;
}
