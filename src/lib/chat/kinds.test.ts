import { describe, expect, it } from 'vitest';
import { deriveKindFromColumns, kindOf, laneOf, ALL_KINDS, type EntryKind } from './kinds';

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
