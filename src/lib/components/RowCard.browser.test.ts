import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';

import { render } from '../../../tests/browser/render';
import RowCard from './RowCard.svelte';

const action = createRawSnippet(() => ({
	render: () => '<button type="button" aria-label="Delete chat">x</button>'
}));

describe('RowCard anatomy', () => {
	it('renders a link when href is given', async () => {
		const { getByRole } = await render(RowCard, {
			href: '/chat/abc',
			title: 'Algebra basics',
			meta: '2 hours ago'
		});

		const link = getByRole('link', { name: /Algebra basics/ });
		await expect.element(link).toBeVisible();
		await expect.element(link).toHaveAttribute('href', '/chat/abc');
		await expect.element(getByRole('link', { name: /2 hours ago/ })).toBeVisible();
	});

	it('renders a static card when href is absent', async () => {
		const { getByText, container } = await render(RowCard, {
			title: 'Static row',
			meta: 'no navigation'
		});

		await expect.element(getByText('Static row')).toBeVisible();
		expect(container.querySelector('[data-rowcard="static"]')).not.toBeNull();
		expect(container.querySelector('[data-rowcard="link"]')).toBeNull();
	});

	it('keeps the fixed slot order title, meta, badges and renders badge text', async () => {
		const { getByText, container } = await render(RowCard, {
			title: 'Quiz one',
			meta: '5 min',
			badges: ['3 questions', 'draft']
		});

		await expect.element(getByText('3 questions')).toBeVisible();
		await expect.element(getByText('draft')).toBeVisible();
		const slots = [...container.querySelectorAll('[data-rowcard-slot]')].map((el) =>
			el.getAttribute('data-rowcard-slot')
		);
		expect(slots).toEqual(['title', 'meta', 'badges']);
	});

	it('renders the trailing action slot when an action snippet is provided', async () => {
		const { getByRole, container } = await render(RowCard, {
			title: 'Deletable row',
			action
		});

		await expect.element(getByRole('button', { name: 'Delete chat' })).toBeInTheDocument();
		expect(container.querySelector('[data-rowcard-slot="action"]')).not.toBeNull();
	});
});
