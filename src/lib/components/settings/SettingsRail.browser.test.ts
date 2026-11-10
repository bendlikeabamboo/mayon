import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SectionEntry } from '#lib/settings/sections.js';

import { render } from '../../../../tests/browser/render';
import SettingsRail from './SettingsRail.svelte';

const sections: SectionEntry[] = [
	{ id: 'providers', label: 'Providers', aliases: [], cap: null },
	{ id: 'chat', label: 'Chat', aliases: ['streaming'], cap: null },
	{ id: 'security', label: 'Security', aliases: ['auth'], cap: null }
];

describe('SettingsRail', () => {
	it('renders a labelled nav landmark with section buttons in prop order', async () => {
		const { getByRole } = await render(SettingsRail, {
			sections,
			activeId: null,
			onJump: vi.fn()
		});

		const nav = getByRole('navigation', { name: 'Settings sections' });
		await expect.element(nav).toBeVisible();
		const buttons = nav.getByRole('button').all();
		expect(buttons.map((button) => button.element().textContent?.trim())).toEqual([
			'Providers',
			'Chat',
			'Security'
		]);
		for (const button of buttons) {
			expect(button.element().getAttribute('type')).toBe('button');
		}
	});

	it('marks exactly the active entry with aria-current', async () => {
		const { getByRole } = await render(SettingsRail, {
			sections,
			activeId: 'chat',
			onJump: vi.fn()
		});

		await expect
			.element(getByRole('button', { name: 'Chat' }))
			.toHaveAttribute('aria-current', 'true');
		expect(getByRole('button', { name: 'Providers' }).element().hasAttribute('aria-current')).toBe(
			false
		);
		expect(getByRole('button', { name: 'Security' }).element().hasAttribute('aria-current')).toBe(
			false
		);
	});

	it('delegates a jump with the entry id when a button is clicked', async () => {
		const onJump = vi.fn();
		const { getByRole } = await render(SettingsRail, {
			sections,
			activeId: null,
			onJump
		});

		await userEvent.click(getByRole('button', { name: 'Security' }));

		expect(onJump).toHaveBeenCalledTimes(1);
		expect(onJump).toHaveBeenCalledWith('security');
	});
});
