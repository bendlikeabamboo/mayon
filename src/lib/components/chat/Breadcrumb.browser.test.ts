import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import type { Chat } from '#lib/db/index.js';

import { render } from '../../../../tests/browser/render';
import Breadcrumb from './Breadcrumb.svelte';

function chat(id: string, title: string): Chat {
	return { id, title } as Chat;
}

const chain = [
	chat('root', 'Root chat'),
	chat('middle', 'Middle ancestor'),
	chat('current', 'Current chat')
];

describe('Breadcrumb truncation and narrow collapse', () => {
	it('renders a labelled single-line nav with root links and a static current entry', async () => {
		await page.viewport(1000, 800);
		const { getByRole, getByText } = await render(Breadcrumb, { chain });

		const nav = getByRole('navigation', { name: 'Breadcrumb' });
		await expect.element(nav).toBeVisible();

		await expect
			.element(getByRole('link', { name: 'Root chat' }))
			.toHaveAttribute('href', '/chat/root');
		await expect.element(getByRole('link', { name: 'Middle ancestor' })).toBeVisible();
		await expect.element(getByText('Current chat')).toBeVisible();
		expect(getByRole('link', { name: 'Current chat' }).query()).toBeNull();
	});

	it('collapses middle ancestors to an ellipsis below sm while keeping root and current', async () => {
		await page.viewport(400, 800);
		const { getByRole, getByText, container } = await render(Breadcrumb, { chain });

		await expect.element(getByRole('link', { name: 'Root chat' })).toBeVisible();
		await expect.element(getByText('Current chat')).toBeVisible();
		await expect.element(getByText('…')).toBeVisible();
		expect(getByRole('link', { name: 'Middle ancestor' }).query()).toBeNull();
		expect(container.querySelectorAll('a')).toHaveLength(1);
	});

	it('renders only the current entry when the chain has a single chat', async () => {
		await page.viewport(1000, 800);
		const { getByText, container } = await render(Breadcrumb, {
			chain: [chat('solo', 'Solo chat')]
		});

		await expect.element(getByText('Solo chat')).toBeVisible();
		expect(container.querySelectorAll('a')).toHaveLength(0);
	});

	it('renders nothing for an empty chain', async () => {
		await page.viewport(1000, 800);
		const { container } = await render(Breadcrumb, { chain: [] });

		expect(container.querySelector('nav')).toBeNull();
	});
});
