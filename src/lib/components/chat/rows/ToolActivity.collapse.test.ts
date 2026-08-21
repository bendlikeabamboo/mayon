import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_SUMMARY_THRESHOLD } from '$lib/chat/kinds';

const TOOL_ACTIVITY = path.resolve(__dirname, 'ToolActivity.svelte');

describe('T011: ToolActivity collapse regression (source-inspection)', () => {
	const source = fs.readFileSync(TOOL_ACTIVITY, 'utf-8');

	it(`TOOL_SUMMARY_THRESHOLD is exported as ${TOOL_SUMMARY_THRESHOLD}`, () => {
		expect(typeof TOOL_SUMMARY_THRESHOLD).toBe('number');
		expect(TOOL_SUMMARY_THRESHOLD).toBe(160);
	});

	it('short summaries render inline with truncate class', () => {
		expect(source).toMatch(/truncate/);
	});

	it('renders a "Show result" expander for verbose results (threshold, detail, or payload-like)', () => {
		expect(source).toContain('Show result');
		expect(source).toContain('TOOL_SUMMARY_THRESHOLD');
		expect(source).toContain('payloadLike');
	});

	it('verbose rows render NO inline summary line when collapsed', () => {
		// summary renders only when (!verbose || expanded) — payload JSON never leaks inline
		expect(source).toMatch(/\{#if summary && \(!verbose \|\| expanded\)\}/);
	});

	it('sources render only when expanded for verbose rows (quiet rows keep them)', () => {
		expect(source).toMatch(/\{#if !verbose \|\| expanded\}\s*<ToolSources/);
	});

	it('expanded body uses bounded pattern (max-h-60 overflow-y-auto)', () => {
		expect(source).toMatch(/max-h-60/);
		expect(source).toMatch(/overflow-y-auto/);
	});
});
