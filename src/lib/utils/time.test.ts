import { describe, it, expect } from 'vitest';
import { timeAgo } from './time';

describe('timeAgo', () => {
	it('returns "just now" for < 1 minute', () => {
		const now = Date.now();
		expect(timeAgo(now)).toBe('just now');
	});

	it('returns "5m ago" for 5 minutes', () => {
		expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
	});

	it('returns "1m ago" boundary', () => {
		expect(timeAgo(Date.now() - 60_000)).toBe('1m ago');
	});

	it('returns "1h ago" for 60 minutes', () => {
		expect(timeAgo(Date.now() - 60 * 60_000)).toBe('1h ago');
	});

	it('returns "3h ago" for 3 hours', () => {
		expect(timeAgo(Date.now() - 3 * 60 * 60_000)).toBe('3h ago');
	});

	it('returns "1d ago" for 24 hours', () => {
		expect(timeAgo(Date.now() - 24 * 60 * 60_000)).toBe('1d ago');
	});

	it('returns "2d ago" for 2 days', () => {
		expect(timeAgo(Date.now() - 2 * 24 * 60 * 60_000)).toBe('2d ago');
	});
});
