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
