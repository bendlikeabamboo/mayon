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
 * verbatim in `ord` order — `[user] `, `[assistant] `, `[tool: <name>] `
 * (propagation chrome excluded, see `isPropagationChrome`).
 * Image parts render as positioned `[image]` markers (030 T021).
 * No truncation, ever.
 */
import { repos } from '#lib/db/index.js';
import type { Chat, Message } from '#lib/db/index.js';
import {
	partsOf,
	type BranchArtifactMetadata,
	type ImagePart,
	type MessagePart,
	type TextPart
} from '#lib/chat/kinds.js';

const asImage = (p: MessagePart): p is ImagePart => p.type === 'image';
const asText = (p: MessagePart): p is TextPart => p.type === 'text';

/**
 * Propagation chrome (037 US1): the `propagate_to_parent` tool's own branch
 * timeline rows — its tool_call row, approval ask, and tool_result (declined
 * included) — all of which carry its `toolName`. Excluded from every payload
 * projection so the tool path and the manual path stay byte-identical for the
 * same content (specs/037-backprop-tool-integrity/contracts/payload-parity.md).
 */
function isPropagationChrome(row: Message): boolean {
	return row.toolName === 'propagate_to_parent';
}

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

/**
 * The row's verbatim payload: tool results prefer their structured metadata;
 * image-bearing rows (030 T021) flow text parts through unchanged and render
 * each image part as a positioned `[image]` marker — the marker sits exactly
 * where the image sat in the row's `parts` sequence.
 */
function turnBody(row: Message): string {
	if (row.role === 'tool') return row.metadata ?? row.content;
	const parts = partsOf(row);
	if (!parts.some(asImage)) return row.content;
	return parts.map((p) => (asText(p) ? p.text : asImage(p) ? '[image]' : '')).join('');
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

/**
 * The complete raw-delta payload plus the branch's own image parts (030 T021):
 * images are collected in turn order from the branch rows, first 8 kept (the
 * repo-wide image cap, applied at collection so the artifact insert cannot
 * fail validation).
 */
export interface RawPayload {
	content: string;
	imageParts: ImagePart[];
}

/** Build the complete raw-delta payload for a branch chat plus its collected image parts. */
export async function buildRawPayload(branchChatId: string): Promise<RawPayload> {
	const [branch, rows] = await Promise.all([
		repos.chats.getById(branchChatId),
		repos.messages.listByChat(branchChatId)
	]);
	if (!branch) throw new Error(`Branch chat ${branchChatId} not found`);
	const payloadRows = rows.filter((r) => !isPropagationChrome(r));
	const content = renderRawDelta(payloadRows, await resolveExcerpt(branch));
	const imageParts = payloadRows.flatMap((r) => partsOf(r).filter(asImage)).slice(0, 8);
	return { content, imageParts };
}

/** Build the complete raw-delta payload for a branch chat. */
export async function buildRawDelta(branchChatId: string): Promise<string> {
	return (await buildRawPayload(branchChatId)).content;
}

/**
 * Image parts of a branch's own turns (030): turn order, first 8 kept.
 * Standalone read for summary mode, whose payload comes from the LLM instead
 * of the raw renderer. Chrome rows are excluded (037 US1), matching
 * `buildRawPayload`'s collection.
 */
export async function collectPropagatedImages(branchChatId: string): Promise<ImagePart[]> {
	const rows = await repos.messages.listByChat(branchChatId);
	return rows
		.filter((r) => !isPropagationChrome(r))
		.flatMap((r) => partsOf(r).filter(asImage))
		.slice(0, 8);
}

/**
 * Artifact-row `parts` (030 T021): a leading text part carrying the payload
 * (repo invariant: text parts concatenate exactly to `content`) followed by
 * the collected image parts. Undefined for image-less branches — those rows
 * stay byte-identical to the pre-030 shape (`parts` NULL).
 */
export function artifactParts(
	content: string,
	imageParts: readonly ImagePart[]
): MessagePart[] | undefined {
	return imageParts.length ? [{ type: 'text', text: content }, ...imageParts] : undefined;
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

/**
 * Shared in-flight latch (027): a module-level single slot serializing
 * propagation attempts across the store's manual path and the
 * `propagate_to_parent` tool. Synchronous try-acquire; the holder must
 * release in `finally` on every exit path (abort/throw included).
 */
let latchHeld = false;

/** Try to acquire the propagation latch; false when a propagation is already in flight. */
export function acquirePropagationLatch(): boolean {
	if (latchHeld) return false;
	latchHeld = true;
	return true;
}

/** Release the propagation latch. Always safe to call. */
export function releasePropagationLatch(): void {
	latchHeld = false;
}
