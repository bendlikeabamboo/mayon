import type { Message } from '$lib/db/schema';

export type EntryKind =
	| 'user_message'
	| 'assistant_message'
	| 'reasoning'
	| 'tool_call'
	| 'tool_result'
	| 'approval'
	| 'sampling'
	| 'elicitation'
	| 'choices'
	| 'self_corrected'
	| 'branch_artifact';

export type Lane = 'user' | 'internal' | 'external';

export function laneOf(kind: EntryKind): Lane {
	if (kind === 'user_message') return 'user';
	if (kind === 'assistant_message') return 'external';
	if (kind === 'branch_artifact') return 'internal';
	return 'internal';
}

const ALL_KINDS: EntryKind[] = [
	'user_message',
	'assistant_message',
	'reasoning',
	'tool_call',
	'tool_result',
	'approval',
	'sampling',
	'elicitation',
	'choices',
	'self_corrected',
	'branch_artifact'
];

export { ALL_KINDS };

interface LegacyRow {
	role: string;
	toolCallId?: string | null | undefined;
	toolName?: string | null | undefined;
}

export function deriveKindFromColumns(row: LegacyRow): EntryKind {
	if (row.role === 'user') return 'user_message';
	if (row.role === 'assistant' && row.toolCallId != null && row.toolName === 'present_choices')
		return 'choices';
	if (row.role === 'assistant' && row.toolCallId != null) return 'tool_call';
	if (row.role === 'tool' && row.toolName === 'present_choices') return 'tool_result';
	if (row.role === 'tool') return 'tool_result';
	if (row.role === 'assistant' && row.toolCallId == null) return 'assistant_message';
	if (row.role === 'system') return 'assistant_message';
	return 'assistant_message';
}

export function kindOf(row: { kind?: string | null } & LegacyRow): EntryKind {
	if (row.kind != null) return row.kind as EntryKind;
	return deriveKindFromColumns(row);
}

export interface SharedMetadata {
	hidden?: true;
	interrupted?: true;
	artifact?: { kind: string; id: string };
	sources?: { title: string; url: string }[];
	reasoning?: string;
	model?: string;
	tokens?: number;
}

export interface UserMessageMeta extends SharedMetadata {
	choicesEntryId?: string;
}

export type AssistantMessageMeta = SharedMetadata;

export interface ReasoningMeta extends SharedMetadata {
	iteration: number;
	model?: string;
}

export interface ToolCallMeta extends SharedMetadata {
	args?: Record<string, unknown>;
}

export interface ToolResultMeta extends SharedMetadata {
	detail?: Record<string, unknown>;
	ok?: boolean;
}

export interface ApprovalMeta extends SharedMetadata {
	toolName?: string;
	description?: string;
	args?: Record<string, unknown>;
	outcome?:
		| null
		| { decision: 'approved' | 'declined'; aborted?: boolean }
		| { decision: 'undecided' };
}

export interface SamplingMeta extends SharedMetadata {
	serverName?: string;
	prompt?: string;
	maxTokens?: number;
	remainingBudget?: number;
	outcome?: null | { decision: 'allowed' | 'denied' } | { decision: 'undecided' };
}

export interface ElicitationMeta extends SharedMetadata {
	serverName?: string;
	message?: string;
	schema?: Record<string, unknown>;
	outcome?:
		| null
		| { decision: 'accepted'; data: Record<string, unknown> }
		| { decision: 'declined' }
		| { decision: 'undecided' };
}

export const TOOL_SUMMARY_THRESHOLD = 160;

export interface ChoicesMeta extends SharedMetadata {
	nextUnit?: string;
	options?: string[];
	progress?: string;
}

export interface SelfCorrectedMeta extends SharedMetadata {
	issues?: { type: string; message: string }[];
	attempts?: number;
	succeeded?: boolean;
}

/**
 * Metadata of a `branch_artifact` row (020): the back-propagated outcome of a
 * branch chat, anchored into its parent at the branch point. Stored as a JSON
 * string in `messages.metadata`. `sourceChatId` is informational (not a FK) so
 * deleting the source branch never cascades into the parent's history.
 */
export interface BranchArtifactMetadata {
	mode: 'raw' | 'summary';
	sourceChatId: string;
	sourceChatTitle: string;
	branchPointMessageId: string | null;
	anchor: 'recorded' | 'derived';
	summaryTraceId: string | null;
	regeneratedAt: string | null;
}

export function parseMetadata<T = SharedMetadata>(raw: string | null): T | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export interface TextPart {
	type: 'text';
	text: string;
}

export interface ImagePart {
	type: 'image';
	data: string;
	mimeType: string;
	width: number;
	height: number;
	bytes: number;
	name?: string;
}

export type MessagePart = TextPart | ImagePart | { type: string };

export interface ComposerAttachment {
	part: ImagePart;
	thumbnailDataUrl: string;
}

export function partsOf(message: Message): MessagePart[] {
	let parsed: unknown;
	try {
		parsed = message.parts ? JSON.parse(message.parts) : null;
	} catch {
		parsed = null;
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return [{ type: 'text', text: message.content }];
	}
	return parsed as MessagePart[];
}

export function textOf(message: Message): string {
	return partsOf(message)
		.filter((p): p is TextPart => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

/**
 * Rebuild composer attachments from a stored row's image parts (018 US1: the
 * regenerate path re-sends the preceding user turn's images). The thumbnail
 * falls back to the full data URL — the composer only uses it for preview.
 */
export function attachmentsOf(message: Message): ComposerAttachment[] {
	return partsOf(message)
		.filter((p): p is ImagePart => p.type === 'image')
		.map((part) => ({ part, thumbnailDataUrl: part.data }));
}
