import { describe, it, expect } from 'vitest';
import { deriveToolStatus, type ToolStatus } from './tool-status';
import type { ToolGroup, OrphanToolResult } from '$lib/chat/entries';

describe('deriveToolStatus', () => {
	const baseCall = {
		id: 'tc-1',
		role: 'assistant' as const,
		content: '',
		toolCallId: 'tc-1',
		toolName: 'test_tool',
		metadata: null,
		createdAt: 0,
		tokens: null,
		model: null,
		parts: null,
		kind: 'tool_call' as const,
		ord: 0,
		chatId: 'c-1'
	};
	const baseResult = {
		id: 'r-1',
		role: 'tool' as const,
		content: 'ok',
		toolCallId: 'tc-1',
		toolName: 'test_tool',
		metadata: null,
		createdAt: 0,
		tokens: null,
		model: null,
		parts: null,
		kind: 'tool_result' as const,
		ord: 0,
		chatId: 'c-1'
	};

	function makeGroup(overrides: Partial<ToolGroup> = {}): ToolGroup {
		return {
			source: 'durable',
			group: true,
			call: baseCall,
			result: null,
			...overrides
		};
	}

	function makeOrphan(overrides: Partial<OrphanToolResult> = {}): OrphanToolResult {
		return {
			source: 'durable',
			orphan: true,
			result: baseResult,
			...overrides
		};
	}

	describe('group: aborted', () => {
		it('returns aborted when group.aborted is true', () => {
			const item = makeGroup({ aborted: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>(
				'aborted'
			);
		});
	});

	describe('group: declined', () => {
		it('returns declined when group.declined is true', () => {
			const item = makeGroup({ declined: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>(
				'declined'
			);
		});
	});

	describe('group: awaiting', () => {
		it('returns awaiting when group.awaitingDecision is true', () => {
			const item = makeGroup({ awaitingDecision: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>(
				'awaiting'
			);
		});
	});

	describe('group: failed (has result)', () => {
		it('returns failed when hasResult and group.failed is true', () => {
			const item = makeGroup({ failed: true, result: baseResult });
			expect(deriveToolStatus(item, { hasResult: true, terminal: false })).toBe<ToolStatus>(
				'failed'
			);
		});
	});

	describe('group: succeeded (has result)', () => {
		it('returns succeeded when hasResult and group.failed is false', () => {
			const item = makeGroup({ failed: false, result: baseResult });
			expect(deriveToolStatus(item, { hasResult: true, terminal: false })).toBe<ToolStatus>(
				'succeeded'
			);
		});
	});

	describe('group: terminal (no result)', () => {
		it('returns terminal when terminal=true and no result, not running/awaiting', () => {
			const item = makeGroup({});
			expect(deriveToolStatus(item, { hasResult: false, terminal: true })).toBe<ToolStatus>(
				'terminal'
			);
		});
	});

	describe('group: running', () => {
		it('returns running when group.running is true and no result', () => {
			const item = makeGroup({ running: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>(
				'running'
			);
		});
	});

	describe('group: gap', () => {
		it('returns gap as fallback for group with no result, not running, not terminal', () => {
			const item = makeGroup({});
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>('gap');
		});
	});

	describe('orphan: failed', () => {
		it('returns failed when orphan.failed is true', () => {
			const item = makeOrphan({ failed: true });
			expect(deriveToolStatus(item, { hasResult: true, terminal: false })).toBe<ToolStatus>(
				'failed'
			);
		});
	});

	describe('orphan: succeeded', () => {
		it('returns succeeded when orphan.failed is false', () => {
			const item = makeOrphan({ failed: false });
			expect(deriveToolStatus(item, { hasResult: true, terminal: false })).toBe<ToolStatus>(
				'succeeded'
			);
		});
	});

	describe('orphan: fallback gap', () => {
		it('returns gap for orphan with failed=false', () => {
			const item = makeOrphan({ failed: false });
			expect(deriveToolStatus(item, { hasResult: true, terminal: false })).toBe<ToolStatus>(
				'succeeded'
			);
		});
	});

	describe('group: aborted precedence over declined', () => {
		it('returns aborted when both aborted and declined are true', () => {
			const item = makeGroup({ aborted: true, declined: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: false })).toBe<ToolStatus>(
				'aborted'
			);
		});
	});

	describe('terminal-tool precedence', () => {
		it('terminal takes precedence over running for unpaired terminal tool', () => {
			const item = makeGroup({ running: true });
			expect(deriveToolStatus(item, { hasResult: false, terminal: true })).toBe<ToolStatus>(
				'terminal'
			);
		});
	});
});
