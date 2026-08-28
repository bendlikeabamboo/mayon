// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHashSync, sectionHash, sectionIdFromHash } from './hash-sync';

const pushSpy = () => vi.spyOn(window.history, 'pushState');
const replaceSpy = () => vi.spyOn(window.history, 'replaceState');

describe('sectionIdFromHash', () => {
	it('parses a slug hash', () => {
		expect(sectionIdFromHash('#data')).toBe('data');
		expect(sectionIdFromHash('#sandbox-db')).toBe('sandbox-db');
	});

	it('returns null for empty and bare hash', () => {
		expect(sectionIdFromHash('')).toBeNull();
		expect(sectionIdFromHash('#')).toBeNull();
	});

	it('passes unknown ids through for caller validation', () => {
		expect(sectionIdFromHash('#nope')).toBe('nope');
	});
});

describe('sectionHash', () => {
	it('appends the id to the pathname', () => {
		expect(sectionHash('/settings', 'data')).toBe('/settings#data');
		expect(sectionHash('/base/settings', 'mcp')).toBe('/base/settings#mcp');
	});

	it('round-trips with sectionIdFromHash', () => {
		expect(sectionHash('/settings', sectionIdFromHash('#data') ?? '')).toBe('/settings#data');
		const url = sectionHash('/settings', 'data');
		expect(sectionIdFromHash(url.slice(url.indexOf('#')))).toBe('data');
	});
});

describe('createHashSync', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		window.history.replaceState({}, '', '/settings');
		window.location.hash = '';
	});

	it('pushJump pushes exactly one entry with the built hash and returns the id', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/settings');

		expect(sync.pushJump('data')).toBe('data');
		expect(push).toHaveBeenCalledTimes(1);
		expect(push).toHaveBeenCalledWith({}, '', '/settings#data');
	});

	it('uses the pathname getter on every write', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/base/settings');

		sync.pushJump('mcp');
		expect(push).toHaveBeenCalledWith({}, '', '/base/settings#mcp');
	});

	it('duplicate-suppresses pushJump to a settled id without pushing', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/settings');

		expect(sync.pushJump('data')).toBe('data');
		sync.settle('data');

		expect(sync.pushJump('data')).toBeNull();
		expect(push).toHaveBeenCalledTimes(1);
	});

	it('duplicate-suppresses a re-jump to the in-flight target before settle', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/settings');

		sync.pushJump('data');
		expect(sync.pushJump('data')).toBeNull();
		expect(push).toHaveBeenCalledTimes(1);

		sync.settle('data');
		expect(sync.pushJump('mcp')).toBe('mcp');
		expect(push).toHaveBeenCalledTimes(2);
	});

	it('treats a landed external id as settled for duplicate suppression', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/settings');
		sync.onExternalHash(() => {});

		window.location.hash = '#data';
		window.dispatchEvent(new HashChangeEvent('hashchange'));

		expect(sync.pushJump('data')).toBeNull();
		expect(push).not.toHaveBeenCalled();
	});

	it('replaceActive writes replaceState only, never pushState', () => {
		const push = pushSpy();
		const replace = replaceSpy();
		const sync = createHashSync(() => '/settings');

		sync.replaceActive('data');

		expect(replace).toHaveBeenCalledTimes(1);
		expect(replace).toHaveBeenCalledWith({}, '', '/settings#data');
		expect(push).not.toHaveBeenCalled();
	});

	it('ignores replaceActive while a jump is in flight, resumes after settle', () => {
		const replace = replaceSpy();
		const sync = createHashSync(() => '/settings');

		sync.pushJump('data');
		sync.replaceActive('mcp');
		expect(replace).not.toHaveBeenCalled();

		sync.settle('data');
		sync.replaceActive('mcp');
		expect(replace).toHaveBeenCalledTimes(1);
		expect(replace).toHaveBeenCalledWith({}, '', '/settings#mcp');
	});

	it('counts a replace as settling at the replaced id', () => {
		const push = pushSpy();
		const sync = createHashSync(() => '/settings');

		sync.replaceActive('data');
		expect(sync.pushJump('data')).toBeNull();
		expect(push).not.toHaveBeenCalled();
	});

	it('delivers external hashchange events with the parsed id', () => {
		const sync = createHashSync(() => '/settings');
		const cb = vi.fn();
		sync.onExternalHash(cb);

		window.location.hash = '#data';
		window.dispatchEvent(new HashChangeEvent('hashchange'));

		expect(cb).toHaveBeenCalledWith('data');

		window.location.hash = '#';
		window.dispatchEvent(new HashChangeEvent('hashchange'));

		expect(cb).toHaveBeenCalledWith(null);
	});

	it('suppresses hashchange within the settle window after our own writes', () => {
		vi.useFakeTimers();
		try {
			const sync = createHashSync(() => '/settings');
			const cb = vi.fn();
			sync.onExternalHash(cb);

			sync.pushJump('data');
			sync.replaceActive('mcp');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(cb).not.toHaveBeenCalled();

			vi.advanceTimersByTime(200);
			window.history.pushState({}, '', '/settings#data');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith('data');
		} finally {
			vi.useRealTimers();
		}
	});

	it('unsubscribes the external hash listener', () => {
		const sync = createHashSync(() => '/settings');
		const cb = vi.fn();
		const off = sync.onExternalHash(cb);
		off();

		window.location.hash = '#data';
		window.dispatchEvent(new HashChangeEvent('hashchange'));

		expect(cb).not.toHaveBeenCalled();
	});

	it('initial() parses the current location hash', () => {
		window.location.hash = '#data';
		expect(createHashSync(() => '/settings').initial()).toBe('data');

		window.location.hash = '';
		expect(createHashSync(() => '/settings').initial()).toBeNull();
	});
});
