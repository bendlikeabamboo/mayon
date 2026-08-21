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

	it('verbose rule is unchanged: needsExpander || payloadLike', () => {
		expect(source).toContain('needsExpander || payloadLike');
		expect(source).toContain('TOOL_SUMMARY_THRESHOLD');
		expect(source).toContain('payloadLike');
	});

	it('the header row itself is the toggle for verbose rows (button semantics + aria-expanded)', () => {
		expect(source).toMatch(/aria-expanded=\{expanded\}/);
		expect(source).toContain('onclick={() => (expanded = !expanded)}');
	});

	it('no floating Show/Hide result control exists', () => {
		expect(source).not.toContain('Show result');
		expect(source).not.toContain('Hide result');
	});

	it('header carries the chevron state affordance', () => {
		expect(source).toContain('ChevronRight');
		expect(source).toContain('ChevronDown');
	});

	it('expanded body is delegated to ToolResultBody (shape-driven)', () => {
		expect(source).toContain('classifyResult');
		expect(source).toMatch(/<ToolResultBody \{shape\} \/>/);
	});

	it('ToolSources renders last and is suppressed for records shapes', () => {
		expect(source).toMatch(
			/\{#if \(!verbose \|\| expanded\) && shape\?\.kind !== 'records'\}\s*<ToolSources/
		);
	});

	it('short summaries render inline with truncate class (unchanged)', () => {
		expect(source).toMatch(/truncate/);
	});

	it('verbose rows render NO inline summary line when collapsed', () => {
		// summary renders only when (!verbose || expanded) — payload text never leaks inline
		expect(source).toMatch(/\{#if summary && \(!verbose \|\| expanded\)\}/);
	});

	it('expanded body uses bounded pattern (max-h-60 overflow-y-auto fallback)', () => {
		expect(source).toMatch(/max-h-60/);
		expect(source).toMatch(/overflow-y-auto/);
	});
});
