/**
 * Golden fixture corpus for the context-projection rewrite (T002).
 *
 * Each fixture pairs legacy Message-shaped rows (no `kind` column) with the
 * exact `ModelMessage[]` the CURRENT `toCoreMessages` pipeline produces.
 * These become the permanent acceptance baseline when US3 retargets the
 * test to `projectEntries`.
 *
 * Captured behavioral quirks (intentional — faithful to production):
 * - `toolArgs` is NEVER populated by the production gather step, so
 *   `toCoreMessages` always emits `input: {}` for tool-call parts.
 *   `metadata.args` exists on stored rows but is NOT replayed.
 * - `toCoreMessages` strips all `system`-role entries.
 * - Adjacent same-role messages merge their parts arrays.
 * - Tool-result output typing: JSON-parseable object → `{type:'json',value}`;
 *   everything else (including non-object JSON) → `{type:'text',value}`.
 * - Tool row with NULL metadata falls back to `content` for toolResult.
 */
import type { ChatMessage } from '$lib/ai/types';
import type { ModelMessage } from 'ai';

export interface LegacyRow {
	id: string;
	chatId: string;
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	ord: number;
	model?: string | null;
	tokens?: number | null;
	toolCallId?: string | null;
	toolName?: string | null;
	metadata?: string | null;
	kind?: string | null;
	createdAt?: number;
}

export interface GoldenFixture {
	name: string;
	rows: LegacyRow[];
	systemNotes?: string[];
	expected: ModelMessage[];
}

let _ord = 0;
function ord() {
	return ++_ord;
}

export function makeRow(
	partial: Omit<LegacyRow, 'id' | 'chatId' | 'ord' | 'createdAt' | 'model' | 'tokens'> & {
		ord?: number;
	}
): LegacyRow {
	return {
		id: `msg-${_ord}`,
		chatId: 'chat-0',
		model: null,
		tokens: null,
		createdAt: 1000 + _ord,
		...partial,
		ord: partial.ord ?? ord()
	};
}

export function resetOrd() {
	_ord = 0;
}

export function rowsToChatMessages(rows: LegacyRow[], systemNotes?: string[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	if (systemNotes) {
		for (const s of systemNotes) out.push({ role: 'system', content: s });
	}
	for (const r of rows) {
		const msg: ChatMessage = { role: r.role, content: r.content };
		if (r.toolCallId) msg.toolCallId = r.toolCallId;
		if (r.toolName) msg.toolName = r.toolName;
		if (r.role === 'tool') {
			msg.toolResult = r.metadata ?? r.content;
		}
		out.push(msg);
	}
	return out;
}

export const fixtures: GoldenFixture[] = [
	{
		name: 'plain-user-assistant-turns',
		rows: [
			makeRow({ role: 'user', content: 'hello' }),
			makeRow({ role: 'assistant', content: 'hi there' }),
			makeRow({ role: 'user', content: 'how are you' }),
			makeRow({ role: 'assistant', content: 'doing well' })
		],
		expected: [
			{ role: 'user', content: [{ type: 'text', text: 'hello' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
			{ role: 'user', content: [{ type: 'text', text: 'how are you' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'doing well' }] }
		] as ModelMessage[]
	},
	{
		name: 'tool-call-json-result',
		rows: [
			makeRow({
				role: 'assistant',
				content: 'Let me check.',
				toolCallId: 'tc_1',
				toolName: 'summarize_progress'
			}),
			makeRow({
				role: 'tool',
				content: '0 labs',
				toolCallId: 'tc_1',
				toolName: 'summarize_progress',
				metadata: '{"labs":[],"quizCount":0}'
			})
		],
		expected: [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me check.' },
					{ type: 'tool-call', toolCallId: 'tc_1', toolName: 'summarize_progress', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_1',
						toolName: 'summarize_progress',
						output: { type: 'json', value: { labs: [], quizCount: 0 } }
					}
				]
			}
		] as ModelMessage[]
	},
	{
		name: 'tool-call-text-result',
		rows: [
			makeRow({ role: 'assistant', content: '', toolCallId: 'tc_2', toolName: 'read_checklist' }),
			makeRow({
				role: 'tool',
				content: '3/5 steps done',
				toolCallId: 'tc_2',
				toolName: 'read_checklist',
				metadata: '3/5 steps done'
			})
		],
		expected: [
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: 'tc_2', toolName: 'read_checklist', input: {} }]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_2',
						toolName: 'read_checklist',
						output: { type: 'text', value: '3/5 steps done' }
					}
				]
			}
		] as ModelMessage[]
	},
	{
		name: 'present-choices-legacy-pair',
		rows: [
			makeRow({
				role: 'assistant',
				content: '',
				toolCallId: 'pc_1',
				toolName: 'present_choices',
				metadata:
					'{"nextUnit":2,"options":[{"label":"A","value":"a"},{"label":"B","value":"b"}],"progress":1}'
			}),
			makeRow({
				role: 'tool',
				content: 'options presented',
				toolCallId: 'pc_1',
				toolName: 'present_choices'
			}),
			makeRow({ role: 'user', content: 'I choose B' })
		],
		expected: [
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: 'pc_1', toolName: 'present_choices', input: {} }]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'pc_1',
						toolName: 'present_choices',
						output: { type: 'text', value: 'options presented' }
					}
				]
			},
			{ role: 'user', content: [{ type: 'text', text: 'I choose B' }] }
		] as ModelMessage[]
	},
	{
		name: 'hidden-user-prompt',
		rows: [
			makeRow({ role: 'user', content: 'You are a helpful tutor.', metadata: '{"hidden":true}' }),
			makeRow({ role: 'assistant', content: 'Understood. What would you like to learn?' })
		],
		expected: [
			{ role: 'user', content: [{ type: 'text', text: 'You are a helpful tutor.' }] },
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'Understood. What would you like to learn?' }]
			}
		] as ModelMessage[]
	},
	{
		name: 'branch-walk-ordering',
		rows: [
			makeRow({ role: 'user', content: 'root-u0', ord: 0 }),
			makeRow({ role: 'assistant', content: 'root-a1', ord: 1 }),
			makeRow({ role: 'user', content: 'child-c0', ord: 0 }),
			makeRow({ role: 'assistant', content: 'child-c1', ord: 1 }),
			makeRow({ role: 'user', content: 'grand-g0', ord: 0 })
		],
		expected: [
			{ role: 'user', content: [{ type: 'text', text: 'root-u0' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'root-a1' }] },
			{ role: 'user', content: [{ type: 'text', text: 'child-c0' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'child-c1' }] },
			{ role: 'user', content: [{ type: 'text', text: 'grand-g0' }] }
		] as ModelMessage[]
	},
	{
		name: 'merge-assistant-text-plus-tool-call',
		rows: [
			makeRow({ role: 'assistant', content: 'Let me check that.' }),
			makeRow({ role: 'assistant', content: '', toolCallId: 'tc_m1', toolName: 'list_artifacts' }),
			makeRow({
				role: 'tool',
				content: 'result',
				toolCallId: 'tc_m1',
				toolName: 'list_artifacts',
				metadata: '{"items":[]}'
			}),
			makeRow({ role: 'assistant', content: 'Here is the result.' })
		],
		expected: [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me check that.' },
					{ type: 'tool-call', toolCallId: 'tc_m1', toolName: 'list_artifacts', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_m1',
						toolName: 'list_artifacts',
						output: { type: 'json', value: { items: [] } }
					}
				]
			},
			{ role: 'assistant', content: [{ type: 'text', text: 'Here is the result.' }] }
		] as ModelMessage[]
	},
	{
		name: 'merge-consecutive-tool-results',
		rows: [
			makeRow({ role: 'assistant', content: '', toolCallId: 'tc_c1', toolName: 'tool_a' }),
			makeRow({ role: 'assistant', content: '', toolCallId: 'tc_c2', toolName: 'tool_b' }),
			makeRow({
				role: 'tool',
				content: 'r1',
				toolCallId: 'tc_c1',
				toolName: 'tool_a',
				metadata: '{"ok":true}'
			}),
			makeRow({
				role: 'tool',
				content: 'r2',
				toolCallId: 'tc_c2',
				toolName: 'tool_b',
				metadata: 'plain text'
			})
		],
		expected: [
			{
				role: 'assistant',
				content: [
					{ type: 'tool-call', toolCallId: 'tc_c1', toolName: 'tool_a', input: {} },
					{ type: 'tool-call', toolCallId: 'tc_c2', toolName: 'tool_b', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_c1',
						toolName: 'tool_a',
						output: { type: 'json', value: { ok: true } }
					},
					{
						type: 'tool-result',
						toolCallId: 'tc_c2',
						toolName: 'tool_b',
						output: { type: 'text', value: 'plain text' }
					}
				]
			}
		] as ModelMessage[]
	},
	{
		name: 'merge-consecutive-user-rows',
		rows: [
			makeRow({ role: 'user', content: 'First part.' }),
			makeRow({ role: 'user', content: 'Second part.' }),
			makeRow({ role: 'assistant', content: 'Got it.' })
		],
		expected: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'First part.' },
					{ type: 'text', text: 'Second part.' }
				]
			},
			{ role: 'assistant', content: [{ type: 'text', text: 'Got it.' }] }
		] as ModelMessage[]
	},
	{
		name: 'tool-row-null-metadata-fallback',
		rows: [
			makeRow({ role: 'assistant', content: '', toolCallId: 'tc_n1', toolName: 'do_thing' }),
			makeRow({
				role: 'tool',
				content: 'fallback content',
				toolCallId: 'tc_n1',
				toolName: 'do_thing',
				metadata: null
			})
		],
		expected: [
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: 'tc_n1', toolName: 'do_thing', input: {} }]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_n1',
						toolName: 'do_thing',
						output: { type: 'text', value: 'fallback content' }
					}
				]
			}
		] as ModelMessage[]
	},
	{
		name: 'system-note-filtered',
		rows: [
			makeRow({ role: 'user', content: 'hello' }),
			makeRow({ role: 'assistant', content: 'world' })
		],
		systemNotes: ['You are a helpful tutor.'],
		expected: [
			{ role: 'user', content: [{ type: 'text', text: 'hello' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'world' }] }
		] as ModelMessage[]
	}
];
