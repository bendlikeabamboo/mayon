import { describe, expect, it } from 'vitest';
import {
	DURATION_MS,
	MAX_DELAY_MS,
	SPAN_MS,
	STEP_MS,
	TOTAL_CAP_MS,
	entry,
	entryDelay,
	prefersReducedMotion
} from './stagger';

describe('entryDelay scheduling', () => {
	it('starts every sequence at zero delay', () => {
		expect(entryDelay(0, 1)).toBe(0);
		expect(entryDelay(0, 8)).toBe(0);
	});

	it('uses the contract step for small groups', () => {
		expect(entryDelay(1, 3)).toBe(STEP_MS);
		expect(entryDelay(2, 3)).toBe(STEP_MS * 2);
	});

	it('returns zero for single-child sequences regardless of index', () => {
		expect(entryDelay(5, 1)).toBe(0);
	});

	it('compresses large groups so the span never exceeds SPAN_MS', () => {
		const last = entryDelay(11, 12);
		expect(last).toBeLessThanOrEqual(SPAN_MS);
	});

	it('treats negative indexes as zero', () => {
		expect(entryDelay(-2, 4)).toBe(0);
	});

	it('clamps any computed delay under MAX_DELAY_MS', () => {
		expect(entryDelay(10_000, 10_000)).toBe(MAX_DELAY_MS);
	});
});

describe('FR-22 timing budget invariants', () => {
	it('keeps per-child step inside the 40–60 ms contract band before compression', () => {
		expect(STEP_MS).toBeGreaterThanOrEqual(40);
		expect(STEP_MS).toBeLessThanOrEqual(60);
	});

	it('guarantees worst-case total stays below 500 ms', () => {
		expect(MAX_DELAY_MS + DURATION_MS).toBe(TOTAL_CAP_MS);
		expect(TOTAL_CAP_MS).toBeLessThan(500);
	});
});

describe('reduced-motion gating', () => {
	it('reads false without a browser/DOM environment', () => {
		expect(prefersReducedMotion()).toBe(false);
	});

	it('honors an injected probe for both outcomes (SC-9)', () => {
		expect(prefersReducedMotion(() => true)).toBe(true);
		expect(prefersReducedMotion(() => false)).toBe(false);
	});

	it('returns a zero-length config outside the browser (no motion emitted)', () => {
		expect(entry({} as Element, { index: 2, count: 4 })).toEqual({ duration: 0 });
	});

	it('returns a zero-length config when the injected probe reports reduce', () => {
		expect(entry({} as Element, { index: 0, _probe: () => true })).toEqual({ duration: 0 });
	});
});
