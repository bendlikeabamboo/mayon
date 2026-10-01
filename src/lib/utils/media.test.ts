// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
/* eslint-disable svelte/no-svelte-internal -- test-only effect root; no public API exists for this */
// @ts-expect-error svelte/internal/client has no type declarations
import { effect_root } from 'svelte/internal/client';
/* eslint-enable svelte/no-svelte-internal */
import { mediaQuery } from './media.svelte.js';

type ChangeListener = (e: { matches: boolean }) => void;

function stubMatchMedia(initial: boolean) {
	const listeners = new Set<ChangeListener>();
	const mql = {
		matches: initial,
		addEventListener: (_: string, fn: ChangeListener) => listeners.add(fn),
		removeEventListener: (_: string, fn: ChangeListener) => listeners.delete(fn)
	};
	vi.stubGlobal('window', { matchMedia: vi.fn(() => mql) });
	return {
		listeners,
		set(matches: boolean) {
			mql.matches = matches;
			for (const fn of [...listeners]) fn({ matches });
		}
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('mediaQuery', () => {
	it('initializes matches synchronously from matchMedia', () => {
		stubMatchMedia(true);
		let mq: { matches: boolean } | undefined;
		const cleanup = effect_root(() => {
			mq = mediaQuery('(min-width: 1024px)');
		});

		expect(mq?.matches).toBe(true);
		expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
		cleanup();
	});

	it('updates matches via the change listener', async () => {
		const mm = stubMatchMedia(false);
		let mq: { matches: boolean } | undefined;
		const cleanup = effect_root(() => {
			mq = mediaQuery('(min-width: 1024px)');
		});
		await tick();

		expect(mq?.matches).toBe(false);
		mm.set(true);
		expect(mq?.matches).toBe(true);
		mm.set(false);
		expect(mq?.matches).toBe(false);
		cleanup();
	});

	it('removes its listener on cleanup', async () => {
		const mm = stubMatchMedia(false);
		let mq: { matches: boolean } | undefined;
		const cleanup = effect_root(() => {
			mq = mediaQuery('(min-width: 1024px)');
		});
		await tick();
		expect(mm.listeners.size).toBe(1);

		cleanup();
		mm.set(true);
		expect(mm.listeners.size).toBe(0);
		expect(mq?.matches).toBe(false);
	});
});
