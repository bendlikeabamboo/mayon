/**
 * Branch back-propagation core (020 US1).
 *
 * Pure-ish helpers behind `chatStore.propagateToParent`: build the raw-delta
 * payload for a branch and resolve where its `branch_artifact` row anchors in
 * the parent. Reads go through repositories only (layering rule); the single
 * write is `messagesRepo.insertAnchored`, driven by the store.
 *
 * Raw-delta format (docs/history/appendices/020-branch-backprop-data-model.md): the anchored
 * excerpt (omitted when unresolvable) followed by every branch row rendered
 * verbatim in `ord` order — `[user] `, `[assistant] `, `[tool: <name>] `.
 * No truncation, ever.
 */
import { repos } from '$lib/db';
import type { Chat, Message } from '$lib/db/schema';
import type { BranchArtifactMetadata } from '$lib/chat/kinds';

/** Placement accepted by `messagesRepo.insertAnchored`. */
export type ArtifactPlacement = { afterOrd: number; beforeOrd: number | null } | 'start';

export interface ResolvedAnchor {
	placement: ArtifactPlacement;
	anchor: 'recorded' | 'derived';
}

/** Role prefix for one rendered turn (`[tool: <name>] ` for tool results). */
function turnPrefix(row: Message): string {
	if (row.role === 'tool') return `[tool: ${row.toolName ?? 'tool'}] `;
	return `[${row.role}] `;
}

/** The row's verbatim payload: tool results prefer their structured metadata. */
function turnBody(row: Message): string {
	if (row.role === 'tool') return row.metadata ?? row.content;
	return row.content;
}

/** Render rows verbatim in the given (ord) order, one prefixed turn per row. */
export function renderRawTurns(rows: readonly Message[]): string {
	return rows.map((row) => `${turnPrefix(row)}${turnBody(row)}`).join('\n');
}

/**
 * Assemble the full delta: the `[excerpt]…[/excerpt]` section (with a blank
 * line after it, per the data-model spec) when an excerpt resolves, then the
 * turns. Pure — `buildRawDelta` is the repo-reading orchestrator.
 */
export function renderRawDelta(rows: readonly Message[], excerpt: string | null): string {
	const turns = renderRawTurns(rows);
	if (excerpt == null) return turns;
	return `[excerpt]\n${excerpt}\n[/excerpt]\n\n${turns}`;
}

/**
 * Excerpt resolution (R2): the branch's `branch_sources.excerpt` when a row
 * exists; else the content of the parent message at the recorded branch
 * point; else null (section omitted — never invented).
 */
export async function resolveExcerpt(branch: Chat): Promise<string | null> {
	const source = await repos.branchSources.getByBranchChat(branch.id);
	if (source) return source.excerpt;
	if (branch.branchPointMessageId != null) {
		const anchor = await repos.messages.getById(branch.branchPointMessageId);
		if (anchor) return anchor.content;
	}
	return null;
}

/** Build the complete raw-delta payload for a branch chat. */
export async function buildRawDelta(branchChatId: string): Promise<string> {
	const [branch, rows] = await Promise.all([
		repos.chats.getById(branchChatId),
		repos.messages.listByChat(branchChatId)
	]);
	if (!branch) throw new Error(`Branch chat ${branchChatId} not found`);
	return renderRawDelta(rows, await resolveExcerpt(branch));
}

/** Next parent row's `ord` strictly above `afterOrd` (rows sorted by ord), or null. */
function nextOrd(rows: readonly Message[], afterOrd: number): number | null {
	const next = rows.find((r) => r.ord > afterOrd);
	return next ? next.ord : null;
}

/**
 * Anchor resolution (data-model.md): a recorded branch point pins the anchor
 * to that parent row's `ord` (midpoint before the next row; `afterOrd + 1`
 * when it is last). A null pointer (composer branch) derives the anchor: the
 * latest parent row created no later than the branch itself, else
 * start-of-thread. A recorded row that has vanished degrades to derived —
 * the delete cascade normally nulls the pointer first.
 */
export async function resolveAnchor(branch: Chat): Promise<ResolvedAnchor> {
	if (branch.parentId == null) {
		throw new Error('resolveAnchor requires a branch chat (parentId != null)');
	}
	const parentRows = await repos.messages.listByChat(branch.parentId);

	if (branch.branchPointMessageId != null) {
		const anchorRow = await repos.messages.getById(branch.branchPointMessageId);
		if (anchorRow) {
			return {
				placement: { afterOrd: anchorRow.ord, beforeOrd: nextOrd(parentRows, anchorRow.ord) },
				anchor: 'recorded'
			};
		}
	}

	const eligible = parentRows.filter((r) => r.createdAt <= branch.createdAt);
	const last = eligible.reduce<Message | null>(
		(acc, r) => (acc === null || r.createdAt >= acc.createdAt ? r : acc),
		null
	);
	if (!last) return { placement: 'start', anchor: 'derived' };
	return {
		placement: { afterOrd: last.ord, beforeOrd: nextOrd(parentRows, last.ord) },
		anchor: 'derived'
	};
}

/**
 * `BranchArtifactMetadata` for a fresh artifact: raw mode by default; summary
 * mode passes `mode`/`summaryTraceId` explicitly.
 */
export function branchArtifactMetadata(
	branch: Chat,
	anchor: 'recorded' | 'derived',
	opts?: { mode?: 'raw' | 'summary'; summaryTraceId?: string | null }
): BranchArtifactMetadata {
	return {
		mode: opts?.mode ?? 'raw',
		sourceChatId: branch.id,
		sourceChatTitle: branch.title,
		branchPointMessageId: branch.branchPointMessageId,
		anchor,
		summaryTraceId: opts?.summaryTraceId ?? null,
		regeneratedAt: null
	};
}
