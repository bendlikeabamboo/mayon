import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'MobileSectionJump.svelte'), 'utf-8');

describe('MobileSectionJump source contract', () => {
	it('self-gates below the xl breakpoint where the rail takes over', () => {
		expect(source).toContain('(min-width: 1280px)');
		expect(source).not.toContain('1024');
	});

	it('opens a bottom sheet', () => {
		expect(source).toContain('side="bottom"');
	});

	it('labels the trigger and the nav "Jump to section"', () => {
		expect(source.match(/aria-label="Jump to section"/g)?.length).toBe(2);
	});

	it('delegates jumping via onJump exactly once per pick, after closing the sheet', () => {
		expect(source).toMatch(
			/function pick\(entry: SectionEntry\) \{\s*open = false;\s*onJump\(entry\.id\);\s*\}/
		);
		expect(source.match(/onJump\(/g)?.length).toBe(1);
	});

	it('dismiss has no scroll or history side effects', () => {
		expect(source).toMatch(/onOpenChange=\{\(v\) => \(open = v\)\}/);
		expect(source).not.toContain('scrollIntoView');
		expect(source).not.toContain('window.history');
		expect(source).not.toContain('pushState');
		expect(source).not.toContain('replaceState');
	});

	it('renders sections in prop order', () => {
		expect(source).toMatch(/\{#each sections as entry/);
	});

	it('floats fixed bottom-right with safe-area padding', () => {
		expect(source).toMatch(/class="fixed right-4 bottom-/);
		expect(source).toContain('safe-area-inset-bottom');
	});
});
