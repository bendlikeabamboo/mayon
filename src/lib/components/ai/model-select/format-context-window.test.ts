import { describe, expect, it } from 'vitest';

import { formatContextWindow } from './format-context-window.svelte';

describe('formatContextWindow', () => {
	it('128000 → 128K', () => {
		expect(formatContextWindow(128_000)).toBe('128K');
	});

	it('1000000 → 1M', () => {
		expect(formatContextWindow(1_000_000)).toBe('1M');
	});

	it('1500000 → 1.5M', () => {
		expect(formatContextWindow(1_500_000)).toBe('1.5M');
	});

	it('999 → 999 (raw below 1K)', () => {
		expect(formatContextWindow(999)).toBe('999');
	});
});
