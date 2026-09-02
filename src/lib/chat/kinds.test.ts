import { describe, expect, it } from 'vitest';
import type { Message } from '$lib/db/schema';
import {
	deriveKindFromColumns,
	kindOf,
	laneOf,
	ALL_KINDS,
	partsOf,
	textOf,
	type EntryKind
} from './kinds';

function makeMessage(overrides: Partial<Message>): Message {
	return {
		id: 'm1',
		chatId: 'c1',
		kind: 'user_message',
		role: 'user',
		content: 'hello',
		parts: null,
		ord: 0,
		model: null,
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: null,
		createdAt: 0,
		...overrides
	};
}

describe('deriveKindFromColumns — D10 case table', () => {
	it('rule 1: role=user → user_message', () => {
		expect(deriveKindFromColumns({ role: 'user', toolCallId: null, toolName: null })).toBe(
			'user_message'
		);
	});

	it('rule 2: assistant + toolCallId + toolName=present_choices → choices', () => {
		expect(
			deriveKindFromColumns({
				role: 'assistant',
				toolCallId: 'tc-1',
				toolName: 'present_choices'
			})
		).toBe('choices');
	});

	it('rule 3: assistant + toolCallId (non-choices) → tool_call', () => {
		expect(
			deriveKindFromColumns({ role: 'assistant', toolCallId: 'tc-2', toolName: 'read_file' })
		).toBe('tool_call');
	});

	it('rule 4: tool + toolName=present_choices → tool_result', () => {
		expect(
			deriveKindFromColumns({ role: 'tool', toolCallId: 'tc-1', toolName: 'present_choices' })
		).toBe('tool_result');
	});

	it('rule 5: tool → tool_result', () => {
		expect(deriveKindFromColumns({ role: 'tool', toolCallId: 'tc-2', toolName: 'read_file' })).toBe(
			'tool_result'
		);
	});

	it('rule 6: assistant no toolCallId → assistant_message', () => {
		expect(deriveKindFromColumns({ role: 'assistant', toolCallId: null, toolName: null })).toBe(
			'assistant_message'
		);
	});

	it('rule 7: system → assistant_message', () => {
		expect(deriveKindFromColumns({ role: 'system', toolCallId: null, toolName: null })).toBe(
			'assistant_message'
		);
	});
});

describe('edge rows', () => {
	it('empty tool-call bookkeeping row (assistant+toolCallId, empty content)', () => {
		expect(
			deriveKindFromColumns({ role: 'assistant', toolCallId: 'tc-3', toolName: 'some_tool' })
		).toBe('tool_call');
	});

	it('present_choices pair: call → choices, result → tool_result', () => {
		const call = deriveKindFromColumns({
			role: 'assistant',
			toolCallId: 'pc-1',
			toolName: 'present_choices'
		});
		const result = deriveKindFromColumns({
			role: 'tool',
			toolCallId: 'pc-1',
			toolName: 'present_choices'
		});
		expect(call).toBe('choices');
		expect(result).toBe('tool_result');
	});

	it('user row with hidden metadata still derives user_message', () => {
		expect(deriveKindFromColumns({ role: 'user', toolCallId: null, toolName: null })).toBe(
			'user_message'
		);
	});
});

describe('kindOf', () => {
	it('delegates to deriveKindFromColumns', () => {
		expect(kindOf({ role: 'user', toolCallId: null, toolName: null })).toBe('user_message');
		expect(kindOf({ role: 'assistant', toolCallId: 'tc-1', toolName: 'bash' })).toBe('tool_call');
	});
});

describe('laneOf', () => {
	const expected: Record<EntryKind, string> = {
		user_message: 'user',
		assistant_message: 'external',
		reasoning: 'internal',
		tool_call: 'internal',
		tool_result: 'internal',
		approval: 'internal',
		sampling: 'internal',
		elicitation: 'internal',
		choices: 'internal',
		self_corrected: 'internal'
	};

	for (const kind of ALL_KINDS) {
		it(`${kind} → ${expected[kind]}`, () => {
			expect(laneOf(kind)).toBe(expected[kind]);
		});
	}
});

describe('partsOf', () => {
	it('derives a single text part when parts is null (legacy row)', () => {
		expect(partsOf(makeMessage({ content: 'hello', parts: null }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
	});

	it('derives a single text part when parts is blank', () => {
		expect(partsOf(makeMessage({ content: 'hello', parts: '' }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
		expect(partsOf(makeMessage({ content: 'hello', parts: '   ' }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
	});

	it('derives a single text part when parts is malformed JSON', () => {
		expect(partsOf(makeMessage({ content: 'hello', parts: 'not-json' }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
	});

	it('derives a single text part when parts is not an array or is empty', () => {
		expect(partsOf(makeMessage({ content: 'hello', parts: '{"type":"text"}' }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
		expect(partsOf(makeMessage({ content: 'hello', parts: '[]' }))).toEqual([
			{ type: 'text', text: 'hello' }
		]);
	});

	it('parses a stored text+image parts array', () => {
		const parts = [
			{ type: 'text', text: 'why does this crash?' },
			{
				type: 'image',
				data: 'data:image/jpeg;base64,/9j/4AA',
				mimeType: 'image/jpeg',
				width: 1568,
				height: 940,
				bytes: 412345,
				name: 'Screenshot 2026-09-02 at 15.41.03'
			}
		];
		const msg = makeMessage({
			content: 'why does this crash?',
			parts: JSON.stringify(parts)
		});
		expect(partsOf(msg)).toEqual(parts);
	});

	it('preserves unknown part kinds (FR-014)', () => {
		const msg = makeMessage({
			content: 'hi',
			parts: JSON.stringify([
				{ type: 'text', text: 'hi' },
				{ type: 'voice', url: 'audio.mp3' }
			])
		});
		const parts = partsOf(msg);
		expect(parts).toHaveLength(2);
		expect(parts[1]!.type).toBe('voice');
	});
});

describe('textOf', () => {
	it('concatenates text-part texts in order', () => {
		const msg = makeMessage({
			content: 'look at this: and this:',
			parts: JSON.stringify([
				{ type: 'text', text: 'look at this: ' },
				{
					type: 'image',
					data: 'data:image/png;base64,AA',
					mimeType: 'image/png',
					width: 1,
					height: 1,
					bytes: 2
				},
				{ type: 'text', text: 'and this:' }
			])
		});
		expect(textOf(msg)).toBe('look at this: and this:');
	});

	it('ignores image and unknown parts', () => {
		const msg = makeMessage({
			content: 'hi',
			parts: JSON.stringify([
				{
					type: 'image',
					data: 'data:image/png;base64,AA',
					mimeType: 'image/png',
					width: 1,
					height: 1,
					bytes: 2
				},
				{ type: 'text', text: 'hi' },
				{ type: 'voice', url: 'audio.mp3' }
			])
		});
		expect(textOf(msg)).toBe('hi');
	});

	it('equals content for legacy rows', () => {
		expect(textOf(makeMessage({ content: 'hello', parts: null }))).toBe('hello');
	});
});
