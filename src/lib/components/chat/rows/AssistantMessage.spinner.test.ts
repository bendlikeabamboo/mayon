import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ASSISTANT = path.resolve(__dirname, 'AssistantMessage.svelte');

describe('US2: AssistantMessage spinner is live-only', () => {
	const source = fs.readFileSync(ASSISTANT, 'utf-8');

	it('orbit spinner (label row) renders only for live items', () => {
		// The orbit spinner block must be guarded by the live state, not merely
		// `!pending && visible` — durable rows are complete and must never spin.
		const orbit = source.match(/\{#if ([^}]*?)\}\s*<Spinner variant="orbit"/);
		expect(orbit, 'orbit Spinner block not found').not.toBeNull();
		expect(orbit![1]).toMatch(/(\blive\b|!isDurable)/);
	});

	it('Thinking… state renders only for live items', () => {
		const thinking = source.match(/\{#if ([^}]*?)\}[^{]*?<Spinner variant="pulse"/);
		expect(thinking, 'pulse Spinner (Thinking…) block not found').not.toBeNull();
		expect(thinking![1]).toMatch(/(\blive\b|!isDurable)/);
	});
});
