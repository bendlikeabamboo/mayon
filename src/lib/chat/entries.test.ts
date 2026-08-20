import { describe, expect, it } from 'vitest';
import type { Message } from '$lib/db/schema';
import { assembleTimeline } from './entries';

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

describe('assembleTimeline', () => {
	it('pairs tool_call + tool_result by toolCallId', () => {
		const call = msg({
			id: 'tc-1',
			role: 'assistant',
			toolCallId: 'tc-1',
			toolName: 'bash',
			content: '',
			ord: 1
		});
		const result = msg({
			id: 'tr-1',
			role: 'tool',
			toolCallId: 'tc-1',
			toolName: 'bash',
			content: 'ran successfully',
			ord: 2
		});
		const items = assembleTimeline([call, result]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ source: 'durable', group: true });
		if (items[0].source === 'durable' && 'group' in items[0]) {
			expect(items[0].call.id).toBe('tc-1');
			expect(items[0].result?.id).toBe('tr-1');
		}
	});

	it('unpaired tool_call: "no result recorded"', () => {
		const call = msg({
			id: 'tc-2',
			role: 'assistant',
			toolCallId: 'tc-2',
			toolName: 'bash',
			content: '',
			ord: 1
		});
		const items = assembleTimeline([call]);
		expect(items).toHaveLength(1);
		if (items[0].source === 'durable' && 'group' in items[0]) {
			expect(items[0].result).toBeNull();
		}
	});

	it('orphan tool_result renders standalone', () => {
		const orphan = msg({
			id: 'tr-2',
			role: 'tool',
			toolCallId: 'ghost',
			toolName: 'bash',
			content: 'orphan summary',
			ord: 3
		});
		const items = assembleTimeline([orphan]);
		expect(items).toHaveLength(1);
		if (items[0].source === 'durable' && 'entry' in items[0]) {
			expect(items[0].kind).toBe('tool_result');
		}
	});

	it('choices-paired tool_result is folded (not rendered)', () => {
		const choicesCall = msg({
			id: 'pc-1',
			role: 'assistant',
			toolCallId: 'pc-1',
			toolName: 'present_choices',
			content: '',
			metadata: JSON.stringify({ options: ['a', 'b'], nextUnit: 'Unit 3' }),
			ord: 1
		});
		const choicesResult = msg({
			id: 'pc-r',
			role: 'tool',
			toolCallId: 'pc-1',
			toolName: 'present_choices',
			content: 'options presented',
			ord: 2
		});
		const items = assembleTimeline([choicesCall, choicesResult]);
		expect(items).toHaveLength(0);
	});

	it('hidden user_message is dropped', () => {
		const hidden = msg({
			id: 'u-1',
			role: 'user',
			content: 'hidden prompt',
			metadata: JSON.stringify({ hidden: true }),
			ord: 0
		});
		const items = assembleTimeline([hidden]);
		expect(items).toHaveLength(0);
	});

	it('preserves input ord ordering', () => {
		const msgs = [
			msg({ id: 'u-1', role: 'user', content: 'hello', ord: 0 }),
			msg({
				id: 'tc-1',
				role: 'assistant',
				toolCallId: 'tc-1',
				toolName: 'bash',
				content: '',
				ord: 1
			}),
			msg({
				id: 'tr-1',
				role: 'tool',
				toolCallId: 'tc-1',
				toolName: 'bash',
				content: 'ok',
				ord: 2
			}),
			msg({ id: 'a-1', role: 'assistant', content: 'done', ord: 3 })
		];
		const items = assembleTimeline(msgs);
		const ids = items.map((i) => {
			if (i.source === 'durable' && 'entry' in i) return i.entry.id;
			if (i.source === 'durable' && 'group' in i) return i.call.id;
			return 'live';
		});
		expect(ids).toEqual(['u-1', 'tc-1', 'a-1']);
	});

	it('empty-content tool_call inside its group does not render standalone', () => {
		const call = msg({
			id: 'tc-empty',
			role: 'assistant',
			toolCallId: 'tc-empty',
			toolName: 'bash',
			content: '',
			ord: 1
		});
		const items = assembleTimeline([call]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ source: 'durable', group: true });
	});
});
