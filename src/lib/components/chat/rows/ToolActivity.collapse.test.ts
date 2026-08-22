import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_SUMMARY_THRESHOLD } from '$lib/chat/kinds';

const TOOL_ACTIVITY = path.resolve(__dirname, 'ToolActivity.svelte');

describe('T012: ToolActivity collapse contract (source-inspection)', () => {
	const source = fs.readFileSync(TOOL_ACTIVITY, 'utf-8');

	it(`TOOL_SUMMARY_THRESHOLD is exported as ${TOOL_SUMMARY_THRESHOLD}`, () => {
		expect(typeof TOOL_SUMMARY_THRESHOLD).toBe('number');
		expect(TOOL_SUMMARY_THRESHOLD).toBe(160);
	});

	it('collapsible-by-default: every entry with content uses Collapsible', () => {
		expect(source).toContain('Collapsible');
		expect(source).toContain('CollapsibleTrigger');
		expect(source).toContain('CollapsibleContent');
		expect(source).toContain('hasContent');
	});

	it('the header uses CollapsibleTrigger (button semantics + aria-expanded from primitive)', () => {
		expect(source).toContain('CollapsibleTrigger');
		expect(source).not.toContain('role="button"');
		expect(source).not.toContain('onkeydown');
	});

	it('no floating Show/Hide result control exists', () => {
		expect(source).not.toContain('Show result');
		expect(source).not.toContain('Hide result');
	});

	it('header carries the chevron state affordance', () => {
		expect(source).toContain('ChevronRight');
	});

	it('expanded body is delegated to ToolResultBody (shape-driven)', () => {
		expect(source).toContain('classifyResult');
		expect(source).toMatch(/<ToolResultBody \{shape\} \/>/);
	});

	it('ToolSources renders inside CollapsibleContent and is suppressed for records shapes', () => {
		expect(source).toMatch(/shape\?\.kind !== 'records'/);
		expect(source).toContain('ToolSources');
	});

	it('expanded body uses bounded pattern (max-h-60 overflow-y-auto fallback)', () => {
		expect(source).toMatch(/max-h-60/);
		expect(source).toMatch(/overflow-y-auto/);
	});
});
