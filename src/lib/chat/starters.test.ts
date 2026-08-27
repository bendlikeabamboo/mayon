import { describe, expect, it } from 'vitest';
import { deriveStarters, EXPLORE_STARTER } from './starters';

// Owner ruling 2026-08-27: Home keeps ONLY the "Explore a new topic" chip.
describe('deriveStarters — single explore seed', () => {
	it('returns exactly the explore starter', () => {
		expect(deriveStarters()).toEqual([EXPLORE_STARTER]);
	});

	it('is stable across repeated calls', () => {
		const a = deriveStarters();
		const b = deriveStarters();
		expect(a).toEqual(b);
	});

	it('has well-formed chip content', () => {
		const [starter] = deriveStarters();
		expect(starter.id).toBe('explore');
		expect(starter.label.trim().length).toBeGreaterThan(0);
		expect(starter.prompt.trim().length).toBeGreaterThan(0);
	});
});
