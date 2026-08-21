import type { Message } from '$lib/db/schema';
import type {
	ApprovalMeta,
	EntryKind,
	SharedMetadata,
	ToolResultMeta,
	UserMessageMeta
} from './kinds';
import { kindOf, laneOf, parseMetadata, type Lane } from './kinds';
import { getToolDefinition } from '$lib/agent/registry';

export interface ToolGroup {
	source: 'durable';
	group: true;
	call: Message;
	result: Message | null;
	awaitingDecision?: boolean;
	declined?: boolean;
	aborted?: boolean;
	running?: boolean;
	failed?: boolean;
}

export interface OrphanToolResult {
	source: 'durable';
	orphan: true;
	result: Message;
	failed?: boolean;
}

export interface DurableEntry {
	source: 'durable';
	entry: Message;
	kind: EntryKind;
	lane: Lane;
}

export type LiveVariant = 'live_text' | 'live_reasoning' | 'live_ask';

export interface LiveAskPayload {
	askKind: 'approval' | 'sampling' | 'elicitation';
	rowId: string;
	approval?: {
		toolCallId: string;
		toolName: string;
		description: string;
		args: unknown;
	};
	sampling?: {
		id: string;
		serverName: string;
		prompt: string;
		maxTokens: number;
		remainingBudget: number;
	};
	elicitation?: {
		id: string;
		serverName: string;
		schema: Record<string, unknown>;
		message: string;
	};
}

export interface LiveTextEntry {
	source: 'live';
	live: 'live_text';
	buffer: string;
	pending: boolean;
}

export interface LiveReasoningEntry {
	source: 'live';
	live: 'live_reasoning';
	buffer: string;
}

export interface LiveAskEntry {
	source: 'live';
	live: 'live_ask';
	payload: LiveAskPayload;
}

export type LiveEntry = LiveTextEntry | LiveReasoningEntry | LiveAskEntry;

export type TimelineItem = DurableEntry | ToolGroup | OrphanToolResult | LiveEntry;

function metaOf<T = SharedMetadata>(m: Message): T | null {
	return parseMetadata<T>(m.metadata);
}

function isUndecidedApproval(meta: ApprovalMeta | null): boolean {
	if (!meta) return false;
	if (meta.outcome === null) return true;
	if (meta.outcome && 'decision' in meta.outcome && meta.outcome.decision === 'undecided')
		return true;
	return false;
}

function isDeclinedApproval(meta: ApprovalMeta | null): { declined: boolean; aborted: boolean } {
	if (!meta) return { declined: false, aborted: false };
	if (meta.outcome && 'decision' in meta.outcome && meta.outcome.decision === 'declined') {
		return { declined: true, aborted: meta.outcome.aborted === true };
	}
	return { declined: false, aborted: false };
}

export function assembleTimeline(
	messages: Message[],
	liveItems?: LiveEntry[],
	streaming = false
): TimelineItem[] {
	const durable: TimelineItem[] = [];
	const pendingCalls = new Map<string, Message>();
	const resultExists = new Set<string>();
	const consumedResults = new Set<string>();
	const choicesCallIds = new Set<string>();

	const undecidedTcids = new Set<string>();
	const declinedMap = new Map<string, { declined: boolean; aborted: boolean }>();

	const liveAskByRowId = new Map<string, LiveAskEntry>();
	if (liveItems) {
		for (const li of liveItems) {
			if (li.live === 'live_ask') {
				liveAskByRowId.set(li.payload.rowId, li);
			}
		}
	}
	const consumedLiveAsks = new Set<string>();

	for (const m of messages) {
		if (kindOf(m) === 'tool_result' && m.toolCallId) resultExists.add(m.toolCallId);
	}

	for (const m of messages) {
		if (kindOf(m) === 'approval' && m.toolCallId) {
			const meta = metaOf<ApprovalMeta>(m);
			if (isUndecidedApproval(meta)) {
				undecidedTcids.add(m.toolCallId);
			}
			const d = isDeclinedApproval(meta);
			if (d.declined) {
				declinedMap.set(m.toolCallId, d);
			}
		}
	}

	if (liveItems) {
		for (const li of liveItems) {
			if (li.live === 'live_ask' && li.payload.askKind === 'approval' && li.payload.approval) {
				undecidedTcids.add(li.payload.approval.toolCallId);
			}
		}
	}

	for (const m of messages) {
		const kind = kindOf(m);

		if (kind === 'user_message') {
			const meta = metaOf<UserMessageMeta>(m);
			if (meta?.hidden) continue;
		}

		if (kind === 'tool_result') {
			if (m.toolCallId) {
				const pairedCall = pendingCalls.get(m.toolCallId);
				if (pairedCall) {
					const group: ToolGroup = {
						source: 'durable',
						group: true,
						call: pairedCall,
						result: m
					};
					applyGroupStatus(group, m.toolCallId, undecidedTcids, declinedMap, streaming);
					durable.push(group);
					pendingCalls.delete(m.toolCallId);
					consumedResults.add(m.toolCallId);
					continue;
				}
				if (choicesCallIds.has(m.toolCallId)) {
					continue;
				}
				consumedResults.add(m.toolCallId);
			}
			const orphan: OrphanToolResult = { source: 'durable', orphan: true, result: m };
			const resMeta = metaOf<ToolResultMeta>(m);
			if (resMeta?.ok === false) orphan.failed = true;
			durable.push(orphan);
			continue;
		}

		if (kind === 'choices') {
			if (m.toolCallId) choicesCallIds.add(m.toolCallId);
			durable.push({ source: 'durable', entry: m, kind, lane: laneOf(kind) });
			continue;
		}

		if (kind === 'tool_call') {
			const tcid = m.toolCallId;
			if (tcid && resultExists.has(tcid) && !consumedResults.has(tcid)) {
				pendingCalls.set(tcid, m);
			} else {
				const group: ToolGroup = {
					source: 'durable',
					group: true,
					call: m,
					result: null
				};
				applyGroupStatus(group, tcid ?? '', undecidedTcids, declinedMap, streaming);
				durable.push(group);
			}
			continue;
		}

		if (
			(kind === 'approval' || kind === 'sampling' || kind === 'elicitation') &&
			liveAskByRowId.has(m.id)
		) {
			const liveAsk = liveAskByRowId.get(m.id)!;
			consumedLiveAsks.add(m.id);
			durable.push(liveAsk);
			continue;
		}

		durable.push({ source: 'durable', entry: m, kind, lane: laneOf(kind) });
	}

	const ordered = canonicalizeOrder(durable);
	if (liveItems?.length) {
		ordered.push(
			...liveItems.filter(
				(li) => !(li.live === 'live_ask' && consumedLiveAsks.has(li.payload.rowId))
			)
		);
	}
	return ordered;
}

function applyGroupStatus(
	group: ToolGroup,
	tcid: string,
	undecidedTcids: Set<string>,
	declinedMap: Map<string, { declined: boolean; aborted: boolean }>,
	streaming: boolean
): void {
	const isTerminal = getToolDefinition(group.call.toolName ?? '')?.terminal === true;

	if (undecidedTcids.has(tcid)) {
		group.awaitingDecision = true;
		return;
	}

	const d = declinedMap.get(tcid);
	if (d) {
		group.declined = true;
		if (d.aborted) group.aborted = true;
		return;
	}

	if (group.result) {
		const resMeta = parseMetadata<ToolResultMeta>(group.result.metadata);
		if (resMeta?.ok === false) {
			group.failed = true;
		}
		return;
	}

	if (isTerminal) return;

	if (!group.result && !isTerminal && streaming && !undecidedTcids.has(tcid)) {
		group.running = true;
	}
}

function isToolActivity(item: TimelineItem): boolean {
	return isToolGroup(item) || isOrphanToolResult(item);
}

function reorderTurn(items: TimelineItem[]): TimelineItem[] {
	const out: TimelineItem[] = [];
	for (const item of items) {
		if (isDurableEntry(item) && item.kind === 'reasoning') {
			let insertAt = -1;
			for (let j = out.length - 1; j >= 0; j--) {
				const prev = out[j];
				if (isToolActivity(prev)) break;
				if (isDurableEntry(prev) && prev.kind === 'assistant_message') {
					insertAt = j;
					break;
				}
			}
			if (insertAt !== -1) {
				out.splice(insertAt, 0, item);
				continue;
			}
		}
		out.push(item);
	}
	return out;
}

function canonicalizeOrder(items: TimelineItem[]): TimelineItem[] {
	const out: TimelineItem[] = [];
	let turn: TimelineItem[] = [];
	const flush = () => {
		out.push(...reorderTurn(turn));
		turn = [];
	};
	for (const item of items) {
		if (isDurableEntry(item) && item.kind === 'user_message') {
			flush();
			out.push(item);
		} else {
			turn.push(item);
		}
	}
	flush();
	return out;
}

export function hasResult(group: ToolGroup): boolean {
	return group.result !== null;
}

export function isToolGroup(item: TimelineItem): item is ToolGroup {
	return item.source === 'durable' && 'group' in item && item.group === true;
}

export function isOrphanToolResult(item: TimelineItem): item is OrphanToolResult {
	return item.source === 'durable' && 'orphan' in item && item.orphan === true;
}

export function isDurableEntry(item: TimelineItem): item is DurableEntry {
	return (
		item.source === 'durable' &&
		!('group' in item && item.group === true) &&
		!('orphan' in item && item.orphan === true)
	);
}

export function isLiveEntry(item: TimelineItem): item is LiveEntry {
	return item.source === 'live';
}
