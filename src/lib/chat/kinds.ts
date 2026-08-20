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
	| 'self_corrected';

export type Lane = 'user' | 'internal' | 'external';

export function laneOf(kind: EntryKind): Lane {
	if (kind === 'user_message') return 'user';
	if (kind === 'assistant_message') return 'external';
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
	'self_corrected'
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

export function parseMetadata<T = SharedMetadata>(raw: string | null): T | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}
