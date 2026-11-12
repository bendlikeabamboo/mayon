import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { page, userEvent } from 'vitest/browser';

import { render } from '../../../tests/browser/render';
import AppShell from './AppShell.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>Main content</p>' }));

describe('AppShell drawer navigation', () => {
	beforeEach(async () => {
		localStorage.clear();
		await page.viewport(480, 800);
	});

	it('keeps the navigation in a closed drawer below lg', async () => {
		const { getByRole } = await render(AppShell, { children });

		await expect.element(getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
		expect(getByRole('link', { name: 'Chat' }).query()).toBeNull();
	});

	it('renders the shared Sidebar in the left drawer sheet', async () => {
		const { getByRole } = await render(AppShell, { children });

		await userEvent.click(getByRole('button', { name: 'Toggle sidebar' }));
		const dialog = getByRole('dialog', { name: 'Navigation' });
		await expect.element(dialog).toBeVisible();

		for (const label of ['Home', 'Chat', 'Labs', 'Quizzes', 'Tree', 'Search', 'Settings']) {
			await expect.element(dialog.getByRole('link', { name: label })).toBeVisible();
		}
	});

	it('closes the drawer when a nav link is clicked', async () => {
		const { getByRole } = await render(AppShell, { children });
		await userEvent.click(getByRole('button', { name: 'Toggle sidebar' }));
		const dialog = getByRole('dialog', { name: 'Navigation' });
		await expect.element(dialog).toBeVisible();

		// The test document has no router; suppress the anchor's default navigation
		// so the click reaches the component's onNavigate handler.
		const stopNavigation = (event: Event) => event.preventDefault();
		document.addEventListener('click', stopNavigation, true);
		try {
			await userEvent.click(dialog.getByRole('link', { name: 'Chat' }));
		} finally {
			document.removeEventListener('click', stopNavigation, true);
		}

		await vi.waitFor(() => expect(dialog.query()).toBeNull());
	});
});
