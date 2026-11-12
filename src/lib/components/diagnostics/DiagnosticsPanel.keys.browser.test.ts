import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../../../tests/browser/render';
import { diagnosticsStore } from '#lib/stores/diagnostics.svelte.js';
import DiagnosticsPanel from './DiagnosticsPanel.svelte';

const hoisted = vi.hoisted(() => ({ traces: [] as Array<Record<string, unknown>> }));

vi.mock('#lib/db/index.js', () => ({
	repos: {
		agentTraces: {
			listByChat: async () => hoisted.traces,
			listByLab: async () => hoisted.traces,
			listByQuiz: async () => hoisted.traces,
			deleteByChat: async () => {},
			deleteByLab: async () => {},
			deleteByQuiz: async () => {}
		}
	}
}));

function chatTrace(id: string, body: Record<string, unknown>) {
	return {
		id,
		kind: 'chat',
		trace: JSON.stringify(body),
		createdAt: 1,
		durationMs: 12,
		model: 'gpt-4o'
	};
}

function resetStore() {
	diagnosticsStore.open = false;
	diagnosticsStore.liveEvents = [];
	diagnosticsStore.traces = [];
	diagnosticsStore.selectedTurnId = null;
	diagnosticsStore.kinds = null;
}

beforeEach(() => {
	resetStore();
	hoisted.traces = [];
});

afterEach(() => {
	resetStore();
});

describe('DiagnosticsPanel keyed loops survive repeated events', () => {
	it('renders repeated MCP events that share kind and server without a key collision', async () => {
		hoisted.traces = [
			chatTrace('trace-mcp', {
				mcpEvents: [
					{ kind: 'mcp-lifecycle', serverId: 'srv-1', serverName: 'Server One', action: 'started' },
					{ kind: 'mcp-lifecycle', serverId: 'srv-1', serverName: 'Server One', action: 'stopped' },
					{ kind: 'mcp-sampling', serverId: 'srv-1', serverName: 'Server One', approved: true }
				]
			})
		];
		diagnosticsStore.open = true;
		diagnosticsStore.selectedTurnId = 'trace-mcp';

		const { getByText, getByRole } = await render(DiagnosticsPanel, { chatId: 'chat-1' });

		await expect.element(getByRole('heading', { name: /MCP Events/ })).toBeVisible();
		await expect.element(getByText('started')).toBeVisible();
		await expect.element(getByText('stopped')).toBeVisible();
		await expect.element(getByText('approved')).toBeVisible();
		expect(getByText('Server One').all()).toHaveLength(3);
	});

	it('renders non-adjacent repeated live part types without deduplicating them', async () => {
		diagnosticsStore.open = true;
		diagnosticsStore.liveEvents = [
			{ kind: 'part', type: 'text-delta', payload: { text: 'a' } },
			{ kind: 'part', type: 'tool-call', payload: {} },
			{ kind: 'part', type: 'text-delta', payload: { text: 'b' } }
		];

		const { getByText, getByRole } = await render(DiagnosticsPanel, { chatId: 'chat-1' });

		await expect.element(getByRole('heading', { name: /In-flight turn/ })).toBeVisible();
		expect(getByText('tool-call').all()).toHaveLength(1);
		expect(getByText('text-delta').all()).toHaveLength(2);
	});

	it('renders repeated part types across a trace part sequence', async () => {
		hoisted.traces = [
			chatTrace('trace-seq', {
				iterations: [
					{
						request: { messages: [] },
						partSequence: [
							{ type: 'text-delta', count: 2 },
							{ type: 'tool-call', count: 1 },
							{ type: 'text-delta', count: 3 }
						]
					}
				]
			})
		];
		diagnosticsStore.open = true;
		diagnosticsStore.selectedTurnId = 'trace-seq';

		const { getByText } = await render(DiagnosticsPanel, { chatId: 'chat-1' });

		await expect.element(getByText('Part Sequence')).toBeVisible();
		expect(getByText('tool-call').all()).toHaveLength(1);
		expect(getByText('text-delta').all()).toHaveLength(2);
	});
});
