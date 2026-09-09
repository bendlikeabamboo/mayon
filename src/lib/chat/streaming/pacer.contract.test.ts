import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STORE = path.resolve(__dirname, '../../stores/chat.svelte.ts');

describe('US1: pacer perf instrumentation source contract', () => {
	const source = fs.readFileSync(STORE, 'utf-8');

	it('wraps the paced flush step in the pacing:flush perf mark', () => {
		expect(source).toContain("mark('pacing:flush'");
	});

	it('reports pacer render counts for the perf probe', () => {
		expect(source).toContain("incRender('Pacer')");
	});
});
