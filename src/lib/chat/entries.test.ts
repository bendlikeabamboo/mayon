import { describe, expect, it, afterEach } from 'vitest';
import type { Message } from '$lib/db/schema';
import {
	assembleTimeline,
	isDurableEntry,
	isOrphanToolResult,
	isToolGroup,
	type TimelineItem
} from './entries';
import { registerTool, deregisterTool } from '$lib/agent/registry';

function msg(overrides: Partial<Message> & { id: string; role: Message['role'] }): Message {
	return {
		chatId: 'chat-1',
		content: '',
		ord: 0,
		model: null,
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: null,
		createdAt: Date.now(),
		kind: null,
		...overrides
	};
}

/** Discipline (research D7): row ids and toolCallIds are ALWAYS distinct strings. */
function rowIds(items: TimelineItem[]): string[] {
	return items.map((i) => {
		if (isToolGroup(i)) return `group:${i.call.id}`;
		if (isOrphanToolResult(i)) return `orphan:${i.result.id}`;
		if (isDurableEntry(i)) return `${i.kind}:${i.entry.id}`;
		return `live:${i.live}`;
	});
}

describe('assembleTimeline: pairing and placement (003 US4)', () => {
	it('production-shaped pairing (distinct row id vs toolCallId) groups into ONE unit', () => {
		const call = msg({
			id: 'row-call-1',
			role: 'assistant',
			toolCallId: 'call-1',
			toolName: 'bash',
			ord: 1
		});
		const result = msg({
			id: 'row-res-1',
			role: 'tool',
			toolCallId: 'call-1',
			toolName: 'bash',
			content: 'ran successfully',
			ord: 2
		});
		const items = assembleTimeline([call, result]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ source: 'durable', group: true });
		if (isToolGroup(items[0])) {
			expect(items[0].call.id).toBe('row-call-1');
			expect(items[0].result?.id).toBe('row-res-1');
		}
	});

	it("paired group sits at the result's position, not flushed at timeline end", () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			msg({
				id: 'row-call-2',
				role: 'assistant',
				toolCallId: 'call-2',
				toolName: 'bash',
				ord: 1
			}),
			msg({ id: 'row-a-mid', role: 'assistant', content: 'meanwhile', ord: 2 }),
			msg({
				id: 'row-res-2',
				role: 'tool',
				toolCallId: 'call-2',
				toolName: 'bash',
				content: 'ok',
				ord: 3
			})
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'assistant_message:row-a-mid',
			'group:row-call-2'
		]);
	});

	it('unpaired tool_call renders as a group at its own position', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			msg({
				id: 'row-call-3',
				role: 'assistant',
				toolCallId: 'call-3',
				toolName: 'bash',
				ord: 1
			}),
			msg({ id: 'row-a1', role: 'assistant', content: 'final', ord: 2 })
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'group:row-call-3',
			'assistant_message:row-a1'
		]);
		if (isToolGroup(items[1])) expect(items[1].result).toBeNull();
	});

	it('orphan tool_result renders visibly as a result-only item (never invisible)', () => {
		const orphan = msg({
			id: 'row-res-orphan',
			role: 'tool',
			toolCallId: 'call-ghost',
			toolName: 'bash',
			content: 'orphan summary',
			ord: 3
		});
		const items = assembleTimeline([orphan]);
		expect(items).toHaveLength(1);
		expect(isOrphanToolResult(items[0])).toBe(true);
		if (isOrphanToolResult(items[0])) {
			expect(items[0].result.id).toBe('row-res-orphan');
		}
	});

	it('choices row renders as an offer entry in place; legacy paired result folds under the offer', () => {
		const offer = msg({
			id: 'row-offer-1',
			role: 'assistant',
			toolCallId: 'offer-1',
			toolName: 'present_choices',
			content: '',
			metadata: JSON.stringify({ options: ['a', 'b'], nextUnit: 'Unit 3' }),
			ord: 1
		});
		const legacyResult = msg({
			id: 'row-offer-res-1',
			role: 'tool',
			toolCallId: 'offer-1',
			toolName: 'present_choices',
			content: 'options presented',
			ord: 2
		});
		const items = assembleTimeline([offer, legacyResult]);
		expect(items).toHaveLength(1);
		expect(isDurableEntry(items[0]) && items[0].kind === 'choices').toBe(true);
		if (isDurableEntry(items[0])) expect(items[0].entry.id).toBe('row-offer-1');
	});

	it('hidden user_message is dropped', () => {
		const hidden = msg({
			id: 'row-u-h',
			role: 'user',
			content: 'hidden prompt',
			metadata: JSON.stringify({ hidden: true }),
			ord: 0
		});
		const items = assembleTimeline([hidden]);
		expect(items).toHaveLength(0);
	});

	it('empty-content tool_call inside its group does not render standalone', () => {
		const call = msg({
			id: 'row-call-4',
			role: 'assistant',
			toolCallId: 'call-4',
			toolName: 'bash',
			content: '',
			ord: 1
		});
		const items = assembleTimeline([call]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ source: 'durable', group: true });
	});

	it('every visible input row appears exactly once (no row vanishes)', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			msg({ id: 'row-r1', role: 'assistant', kind: 'reasoning', content: 'hmm', ord: 1 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'interim', ord: 2 }),
			msg({
				id: 'row-call-5',
				role: 'assistant',
				toolCallId: 'call-5',
				toolName: 'bash',
				ord: 3
			}),
			msg({
				id: 'row-res-5',
				role: 'tool',
				toolCallId: 'call-5',
				toolName: 'bash',
				content: 'ok',
				ord: 4
			}),
			msg({ id: 'row-a2', role: 'assistant', content: 'done', ord: 5 })
		]);
		expect(items).toHaveLength(5); // 6 rows, call+result fold into one group
		const seen = new Set(rowIds(items));
		expect(seen.has('user_message:row-u1')).toBe(true);
		expect(seen.has('reasoning:row-r1')).toBe(true);
		expect(seen.has('assistant_message:row-a1')).toBe(true);
		expect(seen.has('group:row-call-5')).toBe(true);
		expect(seen.has('assistant_message:row-a2')).toBe(true);
	});
});

describe('canonical order pass (003 US3)', () => {
	it('buggy [text, reasoning] adjacency is repaired to [reasoning, text]', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'prompt', ord: 0 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'Reply first', ord: 1 }),
			msg({ id: 'row-r1', role: 'assistant', kind: 'reasoning', content: 'thoughts', ord: 2 })
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'reasoning:row-r1',
			'assistant_message:row-a1'
		]);
	});

	it('reported choices-turn shape renders reasoning → reply → offer (stored kind)', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'prompt', ord: 0 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'Reply', ord: 1 }),
			msg({
				id: 'row-offer-1',
				role: 'assistant',
				kind: 'choices',
				toolCallId: 'offer-1',
				toolName: 'present_choices',
				metadata: JSON.stringify({ options: ['continue'] }),
				ord: 2
			}),
			msg({ id: 'row-r1', role: 'assistant', kind: 'reasoning', content: 'pacing', ord: 3 })
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'reasoning:row-r1',
			'assistant_message:row-a1',
			'choices:row-offer-1'
		]);
	});

	it('canonical multi-iteration turn is a no-op (reasoning never crosses the tool boundary)', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			msg({ id: 'row-r0', role: 'assistant', kind: 'reasoning', content: 'think-0', ord: 1 }),
			msg({ id: 'row-a0', role: 'assistant', content: 'interim', ord: 2 }),
			msg({
				id: 'row-call-1',
				role: 'assistant',
				toolCallId: 'call-1',
				toolName: 'bash',
				ord: 3
			}),
			msg({
				id: 'row-res-1',
				role: 'tool',
				toolCallId: 'call-1',
				toolName: 'bash',
				content: 'ok',
				ord: 4
			}),
			msg({ id: 'row-r1', role: 'assistant', kind: 'reasoning', content: 'think-1', ord: 5 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'final', ord: 6 })
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'reasoning:row-r0',
			'assistant_message:row-a0',
			'group:row-call-1',
			'reasoning:row-r1',
			'assistant_message:row-a1'
		]);
	});

	it('reordering never moves an item across a user_message boundary', () => {
		const items = assembleTimeline([
			msg({ id: 'row-a0', role: 'assistant', content: 'lead reply', ord: 0 }),
			msg({ id: 'row-r0', role: 'assistant', kind: 'reasoning', content: 'lead think', ord: 1 }),
			msg({ id: 'row-u1', role: 'user', content: 'next turn', ord: 2 }),
			msg({ id: 'row-r1', role: 'assistant', kind: 'reasoning', content: 'think-1', ord: 3 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'final', ord: 4 })
		]);
		expect(rowIds(items)).toEqual([
			'reasoning:row-r0',
			'assistant_message:row-a0',
			'user_message:row-u1',
			'reasoning:row-r1',
			'assistant_message:row-a1'
		]);
	});

	it('multiple reasoning rows after one reply keep their relative order when moved', () => {
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			msg({ id: 'row-a1', role: 'assistant', content: 'Reply', ord: 1 }),
			msg({ id: 'row-ra', role: 'assistant', kind: 'reasoning', content: 'first', ord: 2 }),
			msg({ id: 'row-rb', role: 'assistant', kind: 'reasoning', content: 'second', ord: 3 })
		]);
		expect(rowIds(items)).toEqual([
			'user_message:row-u1',
			'reasoning:row-ra',
			'reasoning:row-rb',
			'assistant_message:row-a1'
		]);
	});
});

describe('FR-001 boundary persist: no duplicate text after D1 (T005)', () => {
	it('durable assistant_message + empty live_text renders exactly one text-bearing entry', () => {
		const durable = msg({
			id: 'row-a-boundary-1',
			role: 'assistant',
			content: 'pre-tool text',
			ord: 1
		});
		const items = assembleTimeline(
			[msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }), durable],
			[{ source: 'live', live: 'live_text', buffer: '', pending: true }]
		);
		const textEntries = items.filter(
			(i) => isDurableEntry(i) && i.kind === 'assistant_message' && i.entry.content.length > 0
		);
		expect(textEntries).toHaveLength(1);
		if (isDurableEntry(textEntries[0])) {
			expect(textEntries[0].entry.id).toBe('row-a-boundary-1');
		}
		const liveTexts = items.filter((i) => i.source === 'live' && i.live === 'live_text');
		expect(liveTexts).toHaveLength(1);
		if (liveTexts[0] && liveTexts[0].live === 'live_text') {
			expect(liveTexts[0].buffer).toBe('');
			expect(liveTexts[0].pending).toBe(true);
		}
	});
});

describe('live items (003 regression)', () => {
	it('live items are appended after durable items, reasoning before text', () => {
		const items = assembleTimeline(
			[msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 })],
			[
				{ source: 'live', live: 'live_reasoning', buffer: 'thinking' },
				{ source: 'live', live: 'live_text', buffer: 'reply', pending: false }
			]
		);
		expect(rowIds(items)).toEqual(['user_message:row-u1', 'live:live_reasoning', 'live:live_text']);
	});
});

describe('T007: status derivation on ToolGroup and OrphanToolResult', () => {
	afterEach(() => {
		deregisterTool('test_terminal_tool');
	});

	it('(a) approval row outcome:null linked to unpaired call → awaitingDecision', () => {
		const call = msg({
			id: 'row-tc-a1',
			role: 'assistant',
			toolCallId: 'tcid-a1',
			toolName: 'bash',
			ord: 1
		});
		const approval = msg({
			id: 'row-appr-a1',
			role: 'assistant',
			toolCallId: 'tcid-a1',
			kind: 'approval',
			metadata: JSON.stringify({
				toolName: 'bash',
				description: 'run bash',
				args: {},
				outcome: null
			}),
			ord: 2
		});
		const items = assembleTimeline([call, approval]);
		const groups = items.filter(isToolGroup);
		expect(groups).toHaveLength(1);
		if (isToolGroup(groups[0])) {
			expect(groups[0].awaitingDecision).toBe(true);
			expect(groups[0].declined).toBeFalsy();
			expect(groups[0].aborted).toBeFalsy();
			expect(groups[0].running).toBeFalsy();
			expect(groups[0].failed).toBeFalsy();
		}
	});

	it('(b) live_ask approval → awaitingDecision on linked unpaired call', () => {
		const call = msg({
			id: 'row-tc-b1',
			role: 'assistant',
			toolCallId: 'tcid-b1',
			toolName: 'bash',
			ord: 1
		});
		const items = assembleTimeline(
			[call],
			[
				{
					source: 'live' as const,
					live: 'live_ask' as const,
					payload: {
						askKind: 'approval' as const,
						rowId: 'live-ask-b1',
						approval: {
							toolCallId: 'tcid-b1',
							toolName: 'bash',
							description: 'run bash',
							args: {}
						}
					}
				}
			]
		);
		const groups = items.filter(isToolGroup);
		expect(groups).toHaveLength(1);
		if (isToolGroup(groups[0])) {
			expect(groups[0].awaitingDecision).toBe(true);
			expect(groups[0].declined).toBeFalsy();
		}
	});

	it('(c) outcome:{decision:declined} → declined; with aborted:true → aborted too', () => {
		const call = msg({
			id: 'row-tc-c1',
			role: 'assistant',
			toolCallId: 'tcid-c1',
			toolName: 'bash',
			ord: 1
		});
		const approval = msg({
			id: 'row-appr-c1',
			role: 'assistant',
			toolCallId: 'tcid-c1',
			kind: 'approval',
			metadata: JSON.stringify({ toolName: 'bash', outcome: { decision: 'declined' } }),
			ord: 2
		});
		const items = assembleTimeline([call, approval]);
		if (isToolGroup(items[0])) {
			expect(items[0].declined).toBe(true);
			expect(items[0].aborted).toBeFalsy();
		}

		const call2 = msg({
			id: 'row-tc-c2',
			role: 'assistant',
			toolCallId: 'tcid-c2',
			toolName: 'bash',
			ord: 3
		});
		const approval2 = msg({
			id: 'row-appr-c2',
			role: 'assistant',
			toolCallId: 'tcid-c2',
			kind: 'approval',
			metadata: JSON.stringify({
				toolName: 'bash',
				outcome: { decision: 'declined', aborted: true }
			}),
			ord: 4
		});
		const items2 = assembleTimeline([call2, approval2]);
		if (isToolGroup(items2[0])) {
			expect(items2[0].declined).toBe(true);
			expect(items2[0].aborted).toBe(true);
		}
	});

	it('(d) unpaired non-terminal + streaming:true → running; streaming:false → no status fields', () => {
		const call = msg({
			id: 'row-tc-d1',
			role: 'assistant',
			toolCallId: 'tcid-d1',
			toolName: 'bash',
			ord: 1
		});
		const itemsStreaming = assembleTimeline([call], [], true);
		if (isToolGroup(itemsStreaming[0])) {
			expect(itemsStreaming[0].running).toBe(true);
			expect(itemsStreaming[0].awaitingDecision).toBeFalsy();
			expect(itemsStreaming[0].declined).toBeFalsy();
		}

		const itemsStatic = assembleTimeline([call], [], false);
		if (isToolGroup(itemsStatic[0])) {
			expect(itemsStatic[0].running).toBeFalsy();
			expect(itemsStatic[0].awaitingDecision).toBeFalsy();
			expect(itemsStatic[0].declined).toBeFalsy();
			expect(itemsStatic[0].failed).toBeFalsy();
		}
	});

	it('(e) paired result metadata ok:false → failed; legacy without ok → no failed', () => {
		const call = msg({
			id: 'row-tc-e1',
			role: 'assistant',
			toolCallId: 'tcid-e1',
			toolName: 'bash',
			ord: 1
		});
		const resultOk = msg({
			id: 'row-res-e1',
			role: 'tool',
			toolCallId: 'tcid-e1',
			toolName: 'bash',
			content: 'success',
			metadata: JSON.stringify({ ok: true }),
			ord: 2
		});
		const itemsOk = assembleTimeline([call, resultOk]);
		if (isToolGroup(itemsOk[0])) {
			expect(itemsOk[0].failed).toBeFalsy();
		}

		const resultFail = msg({
			id: 'row-res-e2',
			role: 'tool',
			toolCallId: 'tcid-e2',
			toolName: 'bash',
			content: 'error',
			metadata: JSON.stringify({ ok: false }),
			ord: 2
		});
		const call2 = msg({
			id: 'row-tc-e2',
			role: 'assistant',
			toolCallId: 'tcid-e2',
			toolName: 'bash',
			ord: 1
		});
		const itemsFail = assembleTimeline([call2, resultFail]);
		if (isToolGroup(itemsFail[0])) {
			expect(itemsFail[0].failed).toBe(true);
		}

		const call3 = msg({
			id: 'row-tc-e3',
			role: 'assistant',
			toolCallId: 'tcid-e3',
			toolName: 'bash',
			ord: 1
		});
		const resultLegacy = msg({
			id: 'row-res-e3',
			role: 'tool',
			toolCallId: 'tcid-e3',
			toolName: 'bash',
			content: 'legacy ok',
			metadata: null,
			ord: 2
		});
		const itemsLegacy = assembleTimeline([call3, resultLegacy]);
		if (isToolGroup(itemsLegacy[0])) {
			expect(itemsLegacy[0].failed).toBeFalsy();
		}
	});

	it('(f) unpaired terminal tool → no status fields', () => {
		registerTool({
			def: {
				id: 'test_terminal_tool',
				description: '',
				parameters: {},
				risk: 'readonly',
				generative: false,
				terminal: true
			},
			async run() {
				return { ok: true, summary: '' };
			}
		});
		const call = msg({
			id: 'row-tc-f1',
			role: 'assistant',
			toolCallId: 'tcid-f1',
			toolName: 'test_terminal_tool',
			ord: 1
		});
		const items = assembleTimeline([call]);
		if (isToolGroup(items[0])) {
			expect(items[0].awaitingDecision).toBeFalsy();
			expect(items[0].declined).toBeFalsy();
			expect(items[0].aborted).toBeFalsy();
			expect(items[0].running).toBeFalsy();
			expect(items[0].failed).toBeFalsy();
		}
	});

	it('orphan tool_result with ok:false metadata → failed', () => {
		const orphan = msg({
			id: 'row-res-orphan-fail',
			role: 'tool',
			toolCallId: 'call-ghost-fail',
			toolName: 'bash',
			content: 'orphan error',
			metadata: JSON.stringify({ ok: false }),
			ord: 1
		});
		const items = assembleTimeline([orphan]);
		expect(items).toHaveLength(1);
		if (isOrphanToolResult(items[0])) {
			expect(items[0].failed).toBe(true);
		}

		const orphanOk = msg({
			id: 'row-res-orphan-ok',
			role: 'tool',
			toolCallId: 'call-ghost-ok',
			toolName: 'bash',
			content: 'orphan ok',
			metadata: JSON.stringify({ ok: true }),
			ord: 1
		});
		const itemsOk = assembleTimeline([orphanOk]);
		if (isOrphanToolResult(itemsOk[0])) {
			expect(itemsOk[0].failed).toBeFalsy();
		}
	});
});

describe('FR-006 live-ask merge (004 T013)', () => {
	it('(a) durable approval row + matching live_ask → live item at chronological position, durable suppressed, no tail duplicate', () => {
		const durable = msg({
			id: 'row-appr-merge-1',
			role: 'assistant',
			toolCallId: 'tcid-merge-1',
			kind: 'approval',
			metadata: JSON.stringify({ toolName: 'bash', outcome: null }),
			ord: 1
		});
		const liveAsk: import('./entries').LiveAskEntry = {
			source: 'live',
			live: 'live_ask',
			payload: {
				askKind: 'approval',
				rowId: 'row-appr-merge-1',
				approval: {
					toolCallId: 'tcid-merge-1',
					toolName: 'bash',
					description: 'run bash',
					args: {}
				}
			}
		};
		const items = assembleTimeline(
			[msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }), durable],
			[liveAsk]
		);
		const liveAskItems = items.filter((i) => i.source === 'live' && i.live === 'live_ask');
		expect(liveAskItems).toHaveLength(1);
		const approvalDurable = items.filter((i) => isDurableEntry(i) && i.kind === 'approval');
		expect(approvalDurable).toHaveLength(0);
		const approvalIdx = items.findIndex((i) => i.source === 'live' && i.live === 'live_ask');
		const userIdx = items.findIndex((i) => isDurableEntry(i) && i.kind === 'user_message');
		expect(approvalIdx).toBeGreaterThan(userIdx);
	});

	it('(b) durable approval row with NO live item → durable entry renders', () => {
		const durable = msg({
			id: 'row-appr-nolive-1',
			role: 'assistant',
			toolCallId: 'tcid-nolive-1',
			kind: 'approval',
			metadata: JSON.stringify({ toolName: 'bash', outcome: null }),
			ord: 1
		});
		const items = assembleTimeline([
			msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 }),
			durable
		]);
		const approvalDurable = items.filter((i) => isDurableEntry(i) && i.kind === 'approval');
		expect(approvalDurable).toHaveLength(1);
		if (isDurableEntry(approvalDurable[0])) {
			expect(approvalDurable[0].entry.id).toBe('row-appr-nolive-1');
		}
		const liveAskItems = items.filter((i) => i.source === 'live' && i.live === 'live_ask');
		expect(liveAskItems).toHaveLength(0);
	});

	it('(c) live_text + unmatched live_ask still append at tail in order', () => {
		const liveText = {
			source: 'live' as const,
			live: 'live_text' as const,
			buffer: 'hello',
			pending: false
		};
		const unmatchedAsk = {
			source: 'live' as const,
			live: 'live_ask' as const,
			payload: {
				askKind: 'approval' as const,
				rowId: 'nonexistent-row',
				approval: {
					toolCallId: 'tcid-unmatched',
					toolName: 'bash',
					description: 'run bash',
					args: {}
				}
			}
		};
		const items = assembleTimeline(
			[msg({ id: 'row-u1', role: 'user', content: 'go', ord: 0 })],
			[liveText, unmatchedAsk]
		);
		const tailLive = items.filter((i) => i.source === 'live');
		expect(tailLive).toHaveLength(2);
		expect(tailLive[0].live).toBe('live_text');
		expect(tailLive[1].live).toBe('live_ask');
	});
});
