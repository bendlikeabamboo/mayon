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

describe('Composer launchers aria-disabled no-op (B3a)', () => {
	it('converts the three launchers to aria-disabled instead of the disabled attribute', () => {
		// \s prefix so aria-disabled={…} doesn't count as a native disabled.
		expect(source).not.toMatch(/\sdisabled=\{branchBlocked\}/);
		expect(source).not.toMatch(/\sdisabled=\{generationBlocked\}/);
		expect(source).toContain('aria-disabled={branchBlocked}');
		expect(source.match(/aria-disabled=\{generationBlocked\}/g)?.length).toBe(2);
	});

	it('clicks no-op while aria-disabled: each guard returns before invoking its action', () => {
		expect(source).toMatch(/if \(branchBlocked\) return;\s*void onBranch\(\);/);
		expect(source).toMatch(/if \(generationBlocker\) return;\s*void onQuiz\(\);/);
		expect(source).toMatch(/if \(generationBlocker\) return;\s*void onLab\(\);/);
	});

	it('keeps the functional reason readable via tip while blocked', () => {
		expect(source).toContain('class:tip={branchBlocked}');
		expect(source.match(/class:tip=\{generationBlocked\}/g)?.length).toBe(2);
	});
});

describe('Composer footer compaction below sm (C3)', () => {
	it('collapses launcher labels to icon-only', () => {
		expect(source.match(/<span class="hidden sm:inline">/g)?.length).toBe(3);
	});

	it('keeps send/stop at ≥40px touch targets below lg', () => {
		expect(source.match(/max-lg:size-10/g)?.length).toBe(2);
	});

	it('lets right-side dropdown triggers wrap', () => {
		expect(source).toContain('flex flex-wrap items-center justify-end gap-2');
	});
});
