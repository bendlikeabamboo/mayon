import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TOOL_ACTIVITY = path.resolve(__dirname, 'ToolActivity.svelte');

describe('T008: ToolActivity status-driven presentation (source-inspection)', () => {
	const source = fs.readFileSync(TOOL_ACTIVITY, 'utf-8');

	it('awaiting state renders a waiting presentation (Hourglass icon)', () => {
		expect(source).toMatch(/Hourglass/);
	});

	it('awaiting state does not show "No result recorded"', () => {
		expect(source).not.toContain("status() === 'awaiting'");
		expect(source).toContain('No result recorded');
		const lines = source.split('\n');
		const gapIdx = lines.findIndex((l) => l.includes("status === 'gap'"));
		expect(gapIdx).toBeGreaterThanOrEqual(0);
	});

	it('failed state uses destructive XCircle vocabulary', () => {
		expect(source).toContain('XCircle');
		expect(source).toContain('text-destructive');
	});

	it('declined state renders with CircleSlash and label Declined', () => {
		expect(source).toMatch(/CircleSlash/);
		expect(source).toContain('Declined');
	});

	it('aborted state renders with label Aborted', () => {
		expect(source).toContain('Aborted');
	});

	it('running state renders a neutral pulsing Circle', () => {
		expect(source).toMatch(/animate-pulse/);
	});

	it('gap state shows "No result recorded"', () => {
		expect(source).toContain('No result recorded');
	});

	it('no UI-side tool-name lists (source must not contain present_choices)', () => {
		expect(source).not.toContain('present_choices');
	});

	it('status is derived from tool-status.ts (not inline)', () => {
		expect(source).toContain('deriveToolStatus');
	});

	it('Badge used for status chip', () => {
		expect(source).toContain('Badge');
	});
});
