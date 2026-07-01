import { describe, expect, it } from 'vitest';
import { isExternalLink } from './links';

describe('isExternalLink', () => {
	it('returns true for https URLs', () => {
		expect(isExternalLink('https://example.com')).toBe(true);
	});

	it('returns true for http URLs', () => {
		expect(isExternalLink('http://example.com')).toBe(true);
	});

	it('returns false for internal app links', () => {
		expect(isExternalLink('/chat/abc')).toBe(false);
		expect(isExternalLink('/lab/def')).toBe(false);
	});

	it('returns false for anchors', () => {
		expect(isExternalLink('#anchor')).toBe(false);
	});

	it('returns false for empty strings', () => {
		expect(isExternalLink('')).toBe(false);
	});

	it('returns false for mailto links', () => {
		expect(isExternalLink('mailto:test@example.com')).toBe(false);
	});

	it('returns false for ftp URLs', () => {
		expect(isExternalLink('ftp://example.com')).toBe(false);
	});
});
