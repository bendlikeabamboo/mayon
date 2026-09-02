import { describe, expect, it } from 'vitest';
import { projectEntries, type ProjectableRow } from './projection';
import { fixtures, resetOrd, makeRow, type GoldenFixture, type LegacyRow } from './golden/fixtures';
import type { ModelMessage } from 'ai';

function pipeline(fixture: GoldenFixture): ModelMessage[] {
	resetOrd();
	return projectEntries(fixture.rows as readonly ProjectableRow[]);
}

describe('golden projection fixtures (T002 → T027)', () => {
	for (const fixture of fixtures) {
		it(`${fixture.name}: projectEntries matches golden expected`, () => {
			const actual = pipeline(fixture);
			expect(actual).toEqual(fixture.expected);
		});
	}
});

describe('new-shape projection tests (T027)', () => {
	it('single choices row (no stored pair) synthesizes tool-call + tool-result', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({
				role: 'assistant',
				content: '',
				toolCallId: 'pc_new',
				toolName: 'present_choices',
				kind: 'choices'
			}),
			makeRow({ role: 'user', content: 'I choose B' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'tool-call', toolCallId: 'pc_new', toolName: 'present_choices', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'pc_new',
						toolName: 'present_choices',
						output: { type: 'text', value: 'options presented' }
					}
				]
			},
			{ role: 'user', content: [{ type: 'text', text: 'I choose B' }] }
		] as ModelMessage[]);
	});

	it('excluded kinds (reasoning/approval/sampling/elicitation/self_corrected) produce nothing', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({ role: 'user', content: 'visible' }),
			makeRow({ role: 'assistant', content: 'thinking', kind: 'reasoning' }),
			makeRow({ role: 'assistant', content: 'need approval', kind: 'approval' }),
			makeRow({ role: 'assistant', content: 'sampling...', kind: 'sampling' }),
			makeRow({ role: 'assistant', content: 'elicit...', kind: 'elicitation' }),
			makeRow({ role: 'assistant', content: 'self-corrected', kind: 'self_corrected' }),
			makeRow({ role: 'assistant', content: 'still visible' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'visible' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'still visible' }] }
		] as ModelMessage[]);
	});

	it('kindOf wins over role: explicit kind=tool_call on a user-role row projects as tool_call', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({
				role: 'user',
				content: '',
				toolCallId: 'tc_k',
				toolName: 'some_tool',
				kind: 'tool_call'
			})
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: 'tc_k', toolName: 'some_tool', input: {} }]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'tc_k',
						toolName: 'some_tool',
						output: { type: 'text', value: '(no result recorded — the turn was interrupted)' }
					}
				]
			}
		] as ModelMessage[]);
	});

	it('excluded kind wins over role guessing', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({ role: 'assistant', content: 'hidden reasoning text', kind: 'reasoning' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([] as ModelMessage[]);
	});
});

describe('user parts projection (T013 — contracts/message-parts.md §5)', () => {
	it('a user row with [text, image, image] parts projects to an ordered user parts array', () => {
		resetOrd();
		const imageA = 'data:image/png;base64,AAAA';
		const imageB = 'data:image/jpeg;base64,BBBB';
		const row = {
			...makeRow({ role: 'user', content: 'look at these' }),
			parts: JSON.stringify([
				{ type: 'text', text: 'look at these' },
				{ type: 'image', data: imageA },
				{ type: 'image', data: imageB }
			])
		};
		const result = projectEntries([row] as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'look at these' },
					{ type: 'image', image: imageA },
					{ type: 'image', image: imageB }
				]
			}
		] as ModelMessage[]);
	});

	it('a user row with parts=null projects exactly as today (text-only content)', () => {
		resetOrd();
		const row = { ...makeRow({ role: 'user', content: 'hello' }), parts: null };
		const result = projectEntries([row] as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'hello' }] }
		] as ModelMessage[]);
	});
});

describe('turn-scoped tool pairing (dangling tool call prevention)', () => {
	interface ToolPart {
		toolCallId: string;
		toolName: string;
	}

	function partsOf(messages: ModelMessage[], type: 'tool-call' | 'tool-result'): ToolPart[] {
		const out: ToolPart[] = [];
		for (const m of messages) {
			for (const p of (m.content as unknown[]) ?? []) {
				const part = p as Record<string, unknown>;
				if (part.type === type) {
					out.push({
						toolCallId: String(part.toolCallId),
						toolName: String(part.toolName)
					});
				}
			}
		}
		return out;
	}

	it('a later turn reusing the same toolCallId does not suppress the choices synthesis', () => {
		// Exact production incident: providers that restart tool-call ids per
		// response (OpenRouter DeepSeek, Z.AI GLM) emit `call_0` in both the
		// orientation turn (present_choices) and a later MCP turn. The old
		// conversation-global result set let the MCP result "satisfy" the
		// present_choices call, sending it as a dangling tool call.
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({ role: 'user', content: 'teach me Azure Durable Functions' }),
			makeRow({
				role: 'assistant',
				content: 'Unit 1…',
				toolCallId: 'call_0',
				toolName: 'present_choices',
				kind: 'choices'
			}),
			makeRow({ role: 'user', content: 'continue' }),
			makeRow({
				role: 'assistant',
				content: '',
				toolCallId: 'call_0',
				toolName: 'mcp.brave_web_search',
				kind: 'tool_call'
			}),
			makeRow({
				role: 'tool',
				content: '{"results":[]}',
				toolCallId: 'call_0',
				toolName: 'mcp.brave_web_search',
				kind: 'tool_result'
			}),
			makeRow({ role: 'user', content: 'continue' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);

		const calls = partsOf(result, 'tool-call');
		const callIds = calls.map((c) => c.toolCallId);
		const resultIds = partsOf(result, 'tool-result').map((c) => c.toolCallId);

		// Every emitted tool call has a matching tool result — no dangling call.
		for (const id of callIds) {
			expect(resultIds).toContain(id);
		}
		// The present_choices call_0 got its synthetic 'options presented' result…
		expect(resultIds.filter((id) => id === 'call_0')).toHaveLength(2);
		// …and no synthetic result was fabricated for the satisfied MCP call.
		expect(result).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'teach me Azure Durable Functions' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Unit 1…' },
					{ type: 'tool-call', toolCallId: 'call_0', toolName: 'present_choices', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call_0',
						toolName: 'present_choices',
						output: { type: 'text', value: 'options presented' }
					}
				]
			},
			{ role: 'user', content: [{ type: 'text', text: 'continue' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'tool-call', toolCallId: 'call_0', toolName: 'mcp.brave_web_search', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call_0',
						toolName: 'mcp.brave_web_search',
						output: { type: 'json', value: { results: [] } }
					}
				]
			},
			{ role: 'user', content: [{ type: 'text', text: 'continue' }] }
		] as ModelMessage[]);
	});

	it('an orphaned tool_call (interrupted turn) gets a placeholder result', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({ role: 'user', content: 'check my progress' }),
			makeRow({
				role: 'assistant',
				content: 'Let me check.',
				toolCallId: 'call_7',
				toolName: 'summarize_progress',
				kind: 'tool_call'
			}),
			makeRow({ role: 'user', content: 'hello again' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		expect(result).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'check my progress' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me check.' },
					{ type: 'tool-call', toolCallId: 'call_7', toolName: 'summarize_progress', input: {} }
				]
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call_7',
						toolName: 'summarize_progress',
						output: {
							type: 'text',
							value: '(no result recorded — the turn was interrupted)'
						}
					}
				]
			},
			{ role: 'user', content: [{ type: 'text', text: 'hello again' }] }
		] as ModelMessage[]);
	});

	it('a result in the same turn satisfies the call; no placeholder is synthesized', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({ role: 'user', content: 'go' }),
			makeRow({
				role: 'assistant',
				content: '',
				toolCallId: 'call_3',
				toolName: 'list_artifacts',
				kind: 'tool_call'
			}),
			makeRow({
				role: 'tool',
				content: '[]',
				toolCallId: 'call_3',
				toolName: 'list_artifacts',
				kind: 'tool_result'
			})
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		const resultIds = partsOf(result, 'tool-result').map((c) => c.toolCallId);
		expect(resultIds).toEqual(['call_3']);
	});

	it('a legacy persisted present_choices result in the same turn is not duplicated', () => {
		resetOrd();
		const rows: LegacyRow[] = [
			makeRow({
				role: 'assistant',
				content: '',
				toolCallId: 'pc_1',
				toolName: 'present_choices',
				kind: 'choices'
			}),
			makeRow({
				role: 'tool',
				content: 'options presented',
				toolCallId: 'pc_1',
				toolName: 'present_choices',
				kind: 'tool_result'
			}),
			makeRow({ role: 'user', content: 'I choose B' })
		];
		const result = projectEntries(rows as unknown as readonly ProjectableRow[]);
		const results = partsOf(result, 'tool-result');
		expect(results).toEqual([{ toolCallId: 'pc_1', toolName: 'present_choices' }]);
	});
});
