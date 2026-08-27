import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'Composer.svelte'), 'utf-8');

describe('Composer instrument card + artifact launchers (US3)', () => {
	it('renders the three launcher labels', () => {
		const lower = source.toLowerCase();
		expect(lower).toContain('branch here');
		expect(lower).toContain('quiz me');
		expect(lower).toContain('open lab');
	});

	it('de-boxes the textarea (card owns border/bg, not the textarea)', () => {
		expect(source).toContain('bg-transparent');
		expect(source).toContain('border-0');
	});

	it('wraps the input area in the surface-card elevation recipe with docked controls inside it', () => {
		expect(source).toContain('surface-card');
		const cardAt = source.indexOf('surface-card');
		expect(cardAt).toBeGreaterThan(-1);
		// Textarea AND the Send control sit after the card wrapper opens: they
		// are inside the card's footprint, not siblings beside it.
		expect(source.indexOf('<textarea')).toBeGreaterThan(cardAt);
		expect(source.indexOf('aria-label="Send"')).toBeGreaterThan(cardAt);
	});
});
