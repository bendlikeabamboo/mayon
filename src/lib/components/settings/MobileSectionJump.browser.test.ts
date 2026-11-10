import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SectionEntry } from '#lib/settings/sections.js';

import { render } from '../../../../tests/browser/render';
import MobileSectionJump from './MobileSectionJump.svelte';

const sections: SectionEntry[] = [
	{ id: 'providers', label: 'Providers', aliases: [], cap: null },
	{ id: 'chat', label: 'Chat', aliases: ['streaming'], cap: null },
	{ id: 'security', label: 'Security', aliases: ['auth'], cap: null }
];

function fakeMedia(matches: boolean, query: string): MediaQueryList {
	return {
		matches,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	} as MediaQueryList;
}

afterEach(() => {
	vi.restoreAllMocks();
});

function setXl(matches: boolean) {
	const realMatchMedia = window.matchMedia.bind(window);
	vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
		if (query === '(min-width: 1280px)') return fakeMedia(matches, query);
		return realMatchMedia(query);
	});
}

describe('MobileSectionJump bottom sheet', () => {
	it('shows the labelled trigger below xl and opens a bottom sheet with sections in prop order', async () => {
		setXl(false);
		const { getByRole } = await render(MobileSectionJump, {
			sections,
			onJump: vi.fn()
		});

		const trigger = getByRole('button', { name: 'Jump to section' });
		await expect.element(trigger).toBeVisible();
		await userEvent.click(trigger);

		const dialog = getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		expect(dialog.element().getAttribute('data-side')).toBe('bottom');
		await expect.element(getByRole('heading', { name: 'Jump to section' })).toBeVisible();

		const nav = getByRole('navigation', { name: 'Jump to section' });
		await expect.element(nav).toBeVisible();
		const picks = nav.getByRole('button').all();
		expect(picks.map((pick) => pick.element().textContent?.trim())).toEqual([
			'Providers',
			'Chat',
			'Security'
		]);
	});

	it('closes the sheet and delegates the jump exactly once per pick', async () => {
		setXl(false);
		const onJump = vi.fn();
		const { getByRole } = await render(MobileSectionJump, {
			sections,
			onJump
		});

		await userEvent.click(getByRole('button', { name: 'Jump to section' }));
		await userEvent.click(
			getByRole('navigation', { name: 'Jump to section' }).getByRole('button', { name: 'Chat' })
		);

		expect(onJump).toHaveBeenCalledTimes(1);
		expect(onJump).toHaveBeenCalledWith('chat');
		await vi.waitFor(() => expect(getByRole('dialog').query()).toBeNull());
	});

	it('does not scroll or alter history when picking a section', async () => {
		setXl(false);
		const href = window.location.href;
		const scrollY = window.scrollY;
		const { getByRole } = await render(MobileSectionJump, {
			sections,
			onJump: vi.fn()
		});

		await userEvent.click(getByRole('button', { name: 'Jump to section' }));
		await userEvent.click(
			getByRole('navigation', { name: 'Jump to section' }).getByRole('button', { name: 'Security' })
		);

		expect(window.location.href).toBe(href);
		expect(window.scrollY).toBe(scrollY);
	});

	it('hides the trigger and sheet at the xl breakpoint', async () => {
		setXl(true);
		const { getByRole } = await render(MobileSectionJump, {
			sections,
			onJump: vi.fn()
		});

		expect(getByRole('button', { name: 'Jump to section' }).query()).toBeNull();
		expect(getByRole('navigation', { name: 'Jump to section' }).query()).toBeNull();
	});
});
