import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('H1 guard: MessageRow mount-counting + LazyMount rootMargin', () => {
	it('incRender(MessageRow) is in onMount (mount-counting, not re-render-counting)', () => {
		const source = fs.readFileSync(path.resolve(__dirname, 'MessageRow.svelte'), 'utf-8');
		expect(source).toContain("onMount(() => incRender('MessageRow')");
	});

	it('MessageList passes rootMargin="1200px" to LazyMount', () => {
		const source = fs.readFileSync(path.resolve(__dirname, 'MessageList.svelte'), 'utf-8');
		expect(source).toContain('rootMargin="1200px"');
	});
});
