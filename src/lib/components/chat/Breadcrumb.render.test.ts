import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'Breadcrumb.svelte'), 'utf-8');

describe('Breadcrumb truncation + narrow collapse (C1)', () => {
	it('renders a single line: nav never wraps and entries truncate', () => {
		expect(source).not.toContain('flex-wrap');
		expect(source).toContain('min-w-0');
		expect(source.match(/truncate/g)?.length).toBeGreaterThanOrEqual(2);
	});

	it('collapses middle ancestors to … below sm, keeping root + current', () => {
		expect(source).toContain("mediaQuery('(min-width: 640px)')");
		expect(source).toMatch(/\{#if chain\.length > 2 && !sm\.matches\}/);
		expect(source).toMatch(/aria-hidden="true">…</);
	});

	it('root stays a clickable link and current stays rendered in both variants', () => {
		expect(source.match(/<a\s+href="\/chat\/\{chat\.id\}"/g)?.length).toBe(1);
		expect(source.match(/\{@render link\(/g)?.length).toBe(2);
		expect(source.match(/\{@render currentEntry\(/g)?.length).toBe(2);
	});
});
