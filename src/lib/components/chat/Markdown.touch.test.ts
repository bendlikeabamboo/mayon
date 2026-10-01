import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'Markdown.svelte'), 'utf-8');

describe('Markdown touch affordances', () => {
	it('keeps the code copy button visible on coarse pointers', () => {
		const block = source.match(
			/@media \(any-pointer: coarse\)\s*\{\s*:global\(\.md-copy-btn\)\s*\{([^}]*)\}/
		);
		expect(block, 'coarse override for .md-copy-btn not found').not.toBeNull();
		expect(block![1]).toContain('opacity: 1');
	});

	it('raises the table-focus trigger opacity and size on coarse pointers', () => {
		const block = source.match(
			/@media \(any-pointer: coarse\)[\s\S]*?:global\(\.md-focusable-btn\)\s*\{([^}]*)\}/
		);
		expect(block, 'coarse override for .md-focusable-btn not found').not.toBeNull();
		expect(block![1]).toContain('opacity: 1');
		expect(block![1]).toContain('width: 2rem');
		expect(block![1]).toContain('height: 2rem');
	});

	it('scrolls wide tables instead of clipping them', () => {
		const block = source.match(/:global\(\.markdown-body table\)\s*\{([^}]*)\}/);
		expect(block, 'table rule not found').not.toBeNull();
		expect(block![1]).toContain('overflow-x: auto');
		expect(block![1]).toContain('max-width: 100%');
	});
});
