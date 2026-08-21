import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TOOL_ACTIVITY = path.resolve(__dirname, 'ToolActivity.svelte');

describe('T008: ToolActivity status-driven presentation (source-inspection)', () => {
	const source = fs.readFileSync(TOOL_ACTIVITY, 'utf-8');

	it('awaiting state renders a waiting presentation (Hourglass icon)', () => {
		expect(source).toMatch(/Hourglass/);
	});

	it('awaiting state MUST NOT contain "No result recorded" text', () => {
		const awaitingBlock = source.match(/status\(\) === 'awaiting'[\s\S]*?(?=:else)/);
		expect(awaitingBlock).not.toBeNull();
		expect(awaitingBlock![0]).not.toContain('No result recorded');
	});

	it('awaiting state MUST NOT contain a failure icon (XCircle) for that branch', () => {
		const awaitingBlock = source.match(/status\(\) === 'awaiting'[\s\S]*?(?=:else)/);
		expect(awaitingBlock).not.toBeNull();
		expect(awaitingBlock![0]).not.toContain('XCircle');
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

	it('failed state uses red XCircle vocabulary', () => {
		const failedBlock = source.match(/status\(\) === 'failed'[\s\S]*?(?=:else)/);
		expect(failedBlock).not.toBeNull();
		expect(failedBlock![0]).toContain('XCircle');
	});

	it('gap state retains XCircle + "No result recorded" (guard)', () => {
		expect(source).toContain('No result recorded');
		expect(source).toMatch(/status\(\) === 'gap'/);
	});

	it('no UI-side tool-name lists (source must not contain present_choices)', () => {
		expect(source).not.toContain('present_choices');
	});
});
