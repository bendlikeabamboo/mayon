import { describe, expect, it } from 'vitest';
import { resolveActive, type SpyEntry } from './scroll-spy';

const bandTop = 160;

const entry = (id: string, top: number, isIntersecting = true): SpyEntry => ({
	id,
	isIntersecting,
	top,
	bandTop
});

describe('resolveActive', () => {
	it('returns null for an empty state', () => {
		expect(resolveActive([])).toBeNull();
	});

	it('returns a single section intersecting the band', () => {
		expect(resolveActive([entry('providers', 40)])).toBe('providers');
	});

	it('picks the topmost section at or above the band', () => {
		expect(resolveActive([entry('providers', 40), entry('mcp', 120), entry('data', 500)])).toBe(
			'mcp'
		);
	});

	it('returns null when the viewport is above the first section', () => {
		expect(resolveActive([entry('providers', 400)])).toBeNull();
	});

	it('ignores sections below the band even when listed last', () => {
		expect(resolveActive([entry('providers', 40), entry('mcp', 480)])).toBe('providers');
	});

	it('keeps a fully above-band section active when nothing intersects', () => {
		expect(resolveActive([entry('providers', 20, false), entry('mcp', 480)])).toBe('providers');
	});

	it('follows moved boxes after content-height drift', () => {
		const before = resolveActive([entry('providers', 40), entry('mcp', 150), entry('data', 900)]);
		expect(before).toBe('mcp');

		const after = resolveActive([entry('providers', 40), entry('mcp', 480), entry('data', 900)]);
		expect(after).toBe('providers');

		const settled = resolveActive([entry('providers', 40), entry('mcp', 90), entry('data', 700)]);
		expect(settled).toBe('mcp');
	});

	it('gives last-crossed precedence when two sections meet the band at the same top', () => {
		expect(resolveActive([entry('providers', 120), entry('mcp', 120)])).toBe('mcp');
		expect(resolveActive([entry('mcp', 120), entry('providers', 120)])).toBe('providers');
	});

	it('activates the last section when the scroll container is clamped at the bottom', () => {
		expect(
			resolveActive([entry('providers', -2600), entry('data', 240), entry('sandbox-db', 480)], true)
		).toBe('sandbox-db');
	});

	it('at-bottom rule overrides a stale band candidate from earlier in the page', () => {
		expect(resolveActive([entry('providers', 40), entry('mcp', 200)], true)).toBe('mcp');
	});

	it('at-bottom with no recorded entries stays null', () => {
		expect(resolveActive([], true)).toBeNull();
	});

	it('at-bottom=false keeps the band decision (default argument)', () => {
		expect(resolveActive([entry('providers', 40), entry('mcp', 480)])).toBe('providers');
		expect(resolveActive([entry('providers', 40), entry('mcp', 480)], false)).toBe('providers');
	});
});
