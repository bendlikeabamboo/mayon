import type { ToolGroup, OrphanToolResult } from '$lib/chat/entries';

export type ToolStatus =
	| 'awaiting'
	| 'declined'
	| 'aborted'
	| 'running'
	| 'failed'
	| 'succeeded'
	| 'terminal'
	| 'gap';

export function deriveToolStatus(
	item: ToolGroup | OrphanToolResult,
	opts: { hasResult: boolean; terminal: boolean }
): ToolStatus {
	if ('group' in item && item.group) {
		if (item.aborted) return 'aborted';
		if (item.declined) return 'declined';
		if (item.awaitingDecision) return 'awaiting';
		if (opts.hasResult) {
			return item.failed === true ? 'failed' : 'succeeded';
		}
		if (opts.terminal) return 'terminal';
		if (item.running) return 'running';
		return 'gap';
	}
	if ('orphan' in item && item.orphan) {
		return item.failed === true ? 'failed' : 'succeeded';
	}
	return 'gap';
}
