import type { ModelMessage } from 'ai';
import { kindOf, type EntryKind } from '$lib/chat/kinds';

const EXCLUDED_KINDS = new Set<EntryKind>([
	'reasoning',
	'approval',
	'sampling',
	'elicitation',
	'self_corrected'
]);

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

export interface ProjectableRow {
	role: string;
	content: string;
	toolCallId?: string | null;
	toolName?: string | null;
	metadata?: string | null;
	kind?: string | null;
}

export function projectEntries(rows: readonly ProjectableRow[]): ModelMessage[] {
	const toolResultIds = new Set<string>();
	for (const r of rows) {
		if (kindOf(r) === 'tool_result') toolResultIds.add(r.toolCallId ?? '');
	}

	const raw: ModelMessage[] = [];
	for (const r of rows) {
		const k = kindOf(r);

		if (EXCLUDED_KINDS.has(k)) continue;
		if (r.role === 'system') continue;

		if (k === 'choices' && (!r.toolCallId || !toolResultIds.has(r.toolCallId))) {
			const syntheticId = r.toolCallId ?? '';
			raw.push({
				role: 'assistant' as const,
				content: [
					{
						type: 'tool-call',
						toolCallId: syntheticId,
						toolName: 'present_choices',
						input: {}
					}
				]
			} as unknown as ModelMessage);
			raw.push({
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result',
						toolCallId: syntheticId,
						toolName: 'present_choices',
						output: { type: 'text', value: 'options presented' }
					}
				]
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'tool_call' || k === 'choices') {
			const parts: unknown[] = [];
			if (r.content) parts.push({ type: 'text', text: r.content });
			parts.push({
				type: 'tool-call',
				toolCallId: r.toolCallId ?? '',
				toolName: r.toolName ?? '',
				input: {}
			});
			raw.push({ role: 'assistant' as const, content: parts } as unknown as ModelMessage);
			continue;
		}

		if (k === 'tool_result') {
			raw.push({
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result',
						toolCallId: r.toolCallId ?? '',
						toolName: r.toolName ?? '',
						output: toolResultOutput(r.metadata ?? r.content)
					}
				]
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'user_message') {
			raw.push({
				role: 'user' as const,
				content: [{ type: 'text', text: r.content }]
			} as unknown as ModelMessage);
			continue;
		}

		if (k === 'assistant_message') {
			raw.push({
				role: 'assistant' as const,
				content: [{ type: 'text', text: r.content }]
			} as unknown as ModelMessage);
			continue;
		}
	}

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
