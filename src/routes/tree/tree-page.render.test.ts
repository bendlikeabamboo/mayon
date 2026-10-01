import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '+page.svelte'), 'utf-8');

describe('Tree page mobile source contract', () => {
	it('reserves top space for the floating toggle zone below lg (≥56px)', () => {
		expect(source).toContain('p-4 pt-14 sm:px-8 sm:pb-8 lg:pt-8');
	});

	it('gives caret buttons a 40px hit area around the size-4 icon', () => {
		expect(source).toMatch(/rounded-sm p-3 text-muted-foreground/);
	});

	it('delete button renders in DOM, is coarse-visible, and is inert while invisible on fine pointers', () => {
		expect(source).toContain('aria-label="Delete branch"');
		const cls = source.match(/aria-label="Delete branch"\s*class="([^"]+)"/);
		expect(cls, 'delete button class not found').not.toBeNull();
		expect(cls![1]).toContain('pointer-events-none');
		expect(cls![1]).toContain('group-hover:pointer-events-auto');
		expect(cls![1]).toContain('[@media(any-pointer:coarse)]:opacity-100');
		expect(cls![1]).toContain('[@media(any-pointer:coarse)]:pointer-events-auto');
		expect(cls![1]).not.toContain('hidden');
	});
});
