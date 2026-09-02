import { describe, expect, it } from 'vitest';
import { getPresentation, presentationKeyFor } from './presentation';
import type { DurableEntry, ToolGroup, OrphanToolResult, LiveEntry } from './entries';
import type { PresentationKey } from './presentation';

const DURABLE_KINDS: PresentationKey[] = [
	'user_message',
	'assistant_message',
	'reasoning',
	'approval',
	'sampling',
	'elicitation',
	'choices',
	'self_corrected'
];

const TOOL_KEYS: PresentationKey[] = ['tool_group', 'tool_group_unpaired', 'tool_result_orphan'];
const LIVE_KEYS: PresentationKey[] = ['live_text', 'live_reasoning', 'live_ask'];
const ALL_KEYS: PresentationKey[] = [...DURABLE_KINDS, ...TOOL_KEYS, ...LIVE_KEYS];

describe('registry completeness', () => {
	for (const key of ALL_KEYS) {
		it(`${key} has a presentation entry`, () => {
			const p = getPresentation(key);
			expect(p).toBeDefined();
			expect(typeof p.renderer).toBe('string');
			expect(p.renderer.length).toBeGreaterThan(0);
			expect(typeof p.collapsible).toBe('boolean');
			expect(typeof p.collapsedByDefault).toBe('boolean');
			expect(['user', 'internal', 'external']).toContain(p.lane);
		});
	}
});

describe('presentationKeyFor', () => {
	it('durable entry returns its kind', () => {
		const item: DurableEntry = {
			source: 'durable',
			entry: {
				id: '1',
				chatId: 'c',
				role: 'user',
				content: '',
				ord: 0,
				model: null,
				tokens: null,
				toolCallId: null,
				toolName: null,
				metadata: null,
				createdAt: 0,
				parts: null,
				kind: null
			},
			kind: 'user_message',
			lane: 'user'
		};
		expect(presentationKeyFor(item)).toBe('user_message');
	});

	it('tool group with result → tool_group', () => {
		const item: ToolGroup = {
			source: 'durable',
			group: true,
			call: {
				id: 'tc',
				chatId: 'c',
				role: 'assistant',
				content: '',
				ord: 0,
				model: null,
				tokens: null,
				toolCallId: 'tc',
				toolName: 'bash',
				metadata: null,
				createdAt: 0,
				parts: null,
				kind: null
			},
			result: {
				id: 'tr',
				chatId: 'c',
				role: 'tool',
				content: 'ok',
				ord: 1,
				model: null,
				tokens: null,
				toolCallId: 'tc',
				toolName: 'bash',
				metadata: null,
				createdAt: 0,
				parts: null,
				kind: null
			}
		};
		expect(presentationKeyFor(item)).toBe('tool_group');
	});

	it('tool group unpaired → tool_group_unpaired', () => {
		const item: ToolGroup = {
			source: 'durable',
			group: true,
			call: {
				id: 'tc',
				chatId: 'c',
				role: 'assistant',
				content: '',
				ord: 0,
				model: null,
				tokens: null,
				toolCallId: 'tc',
				toolName: 'bash',
				metadata: null,
				createdAt: 0,
				parts: null,
				kind: null
			},
			result: null
		};
		expect(presentationKeyFor(item)).toBe('tool_group_unpaired');
	});

	it('live entry returns its live variant', () => {
		const item: LiveEntry = {
			source: 'live',
			live: 'live_text',
			buffer: 'hi',
			pending: false
		};
		expect(presentationKeyFor(item)).toBe('live_text');
	});

	it('orphan tool result → tool_result_orphan', () => {
		const item: OrphanToolResult = {
			source: 'durable',
			orphan: true,
			result: {
				id: 'tr',
				chatId: 'c',
				role: 'tool',
				content: 'orphan',
				ord: 0,
				model: null,
				tokens: null,
				toolCallId: 'ghost',
				toolName: 'bash',
				metadata: null,
				createdAt: 0,
				parts: null,
				kind: null
			}
		};
		expect(presentationKeyFor(item)).toBe('tool_result_orphan');
	});
});

describe('presentation attributes are constants', () => {
	it('same key always returns the same object', () => {
		const a = getPresentation('user_message');
		const b = getPresentation('user_message');
		expect(a).toBe(b);
	});
});
