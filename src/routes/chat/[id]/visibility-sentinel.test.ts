import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('H4 guard: IntersectionObserver sentinels (no per-frame layout reads)', () => {
	it('page module uses IntersectionObserver and has no updateVisibility', () => {
		const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');
		expect(source).toContain('IntersectionObserver');
		expect(source).not.toContain('updateVisibility');
	});

	it('scrollTop/clientHeight/scrollHeight reads are not in any scroll-tied effect', () => {
		const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');
		expect(source).not.toContain('onScroll');
	});
});
