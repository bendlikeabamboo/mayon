import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'DiagnosticsPanel.svelte'), 'utf-8');

describe('DiagnosticsPanel mobile sheet source contract', () => {
	it('fills narrow screens and caps at 540px on sm+', () => {
		expect(source).toContain(
			'w-full max-w-[540px] sm:w-[540px] data-[side=right]:w-full data-[side=right]:sm:max-w-[540px]'
		);
	});

	it('overrides the sheet base width classes, which out-specify plain width utilities', () => {
		expect(source).toContain('data-[side=right]:w-full');
		expect(source).toContain('data-[side=right]:sm:max-w-[540px]');
	});

	it('wraps the header filter/clear row', () => {
		expect(source).toMatch(/class="flex flex-wrap items-center justify-between gap-2"/);
	});
});
