import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('H1 guard: TimelineRow mount-counting + LazyMount rootMargin', () => {
	it('incRender(TimelineRow) is in onMount of a row renderer', () => {
		const rowsDir = path.resolve(__dirname, 'rows');
		const files = fs.readdirSync(rowsDir).filter((f) => f.endsWith('.svelte'));
		let found = false;
		for (const file of files) {
			const source = fs.readFileSync(path.join(rowsDir, file), 'utf-8');
			if (source.includes("onMount(() => incRender('TimelineRow'))")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it('MessageList passes rootMargin="1200px" to LazyMount', () => {
		const source = fs.readFileSync(path.resolve(__dirname, 'MessageList.svelte'), 'utf-8');
		expect(source).toContain('rootMargin="1200px"');
	});
});
