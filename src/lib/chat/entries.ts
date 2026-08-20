import type { Message } from '$lib/db/schema';
import type { EntryKind, SharedMetadata, UserMessageMeta } from './kinds';
import { kindOf, laneOf, parseMetadata, type Lane } from './kinds';

export interface ToolGroup {
	source: 'durable';
	group: true;
	call: Message;
	result: Message | null;
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

export type TimelineItem = DurableEntry | ToolGroup | LiveEntry;

function metaOf<T = SharedMetadata>(m: Message): T | null {
	return parseMetadata<T>(m.metadata);
}

export function assembleTimeline(messages: Message[], liveItems?: LiveEntry[]): TimelineItem[] {
	const result: TimelineItem[] = [];
	const byToolCallId = new Map<string, Message>();

	for (const msg of messages) {
		const kind = kindOf(msg);

		if (kind === 'user_message') {
			const meta = metaOf<UserMessageMeta>(msg);
			if (meta?.hidden) continue;
		}

		if (kind === 'tool_result') {
			if (msg.toolCallId) {
				const pairedCall = byToolCallId.get(msg.toolCallId);
				if (pairedCall) {
					const callKind = kindOf(pairedCall);
					if (callKind === 'choices') {
						byToolCallId.delete(msg.toolCallId);
						continue;
					}
					const group: ToolGroup = {
						source: 'durable',
						group: true,
						call: pairedCall,
						result: msg
					};
					result.push(group);
					byToolCallId.delete(msg.toolCallId);
					continue;
				}
			}
			const orphan: DurableEntry = {
				source: 'durable',
				entry: msg,
				kind: 'tool_result',
				lane: laneOf('tool_result')
			};
			result.push(orphan);
			continue;
		}

		if (kind === 'tool_call' || kind === 'choices') {
			byToolCallId.set(msg.id, msg);
			continue;
		}

		result.push({
			source: 'durable',
			entry: msg,
			kind,
			lane: laneOf(kind)
		});
	}

	for (const [, call] of byToolCallId) {
		result.push({
			source: 'durable',
			group: true,
			call,
			result: null
		});
	}

	if (liveItems?.length) {
		result.push(...liveItems);
	}

	return result;
}

export function hasResult(group: ToolGroup): boolean {
	return group.result !== null;
}

export function isToolGroup(item: TimelineItem): item is ToolGroup {
	return item.source === 'durable' && 'group' in item && item.group === true;
}

export function isDurableEntry(item: TimelineItem): item is DurableEntry {
	return item.source === 'durable' && !('group' in item && item.group === true);
}

export function isLiveEntry(item: TimelineItem): item is LiveEntry {
	return item.source === 'live';
}
