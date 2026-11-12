import { describe, expect, it } from 'vitest';

import { render } from '../../../../../tests/browser/render';
import ToolResultBody from './ToolResultBody.svelte';

const cards = Array.from({ length: 12 }, (_, index) => ({
	title: `Card ${index + 1}`,
	url: `https://example.com/${index + 1}`,
	description: '<b>Bold</b> <script>alert(1)</script>'
}));

describe('ToolResultBody shape rendering', () => {
	it('links records externally and caps the card list at MAX_CARDS', async () => {
		const { container, getByRole, getByText } = await render(ToolResultBody, {
			shape: { kind: 'records', values: cards }
		});

		const links = getByRole('link').all();
		expect(links).toHaveLength(10);
		for (const link of links) {
			await expect.element(link).toHaveAttribute('target', '_blank');
			expect(link.element().getAttribute('rel')).toBe('noopener noreferrer');
		}
		await expect.element(getByRole('link', { name: /Card 1\b/ })).toBeVisible();
		await expect.element(getByText('+2 more')).toBeVisible();
		expect(container.querySelector('script')).toBeNull();
	});

	it('bounds the records container', async () => {
		const { getByRole } = await render(ToolResultBody, {
			shape: { kind: 'records', values: cards }
		});

		const bounded = (getByRole('link', { name: /Card 1\b/ }).element() as HTMLElement).closest(
			'.max-h-60'
		);
		expect(bounded).not.toBeNull();
		expect(bounded!.classList.contains('overflow-y-auto')).toBe(true);
	});

	it('renders markdown shapes through the markdown renderer in a bounded container', async () => {
		const { container, getByRole } = await render(ToolResultBody, {
			shape: { kind: 'markdown', text: '# Heading\n\nSome **bold** text' }
		});

		await expect.element(getByRole('heading', { name: 'Heading' })).toBeVisible();
		expect(container.querySelector('strong')?.textContent).toBe('bold');
		const bounded = (getByRole('heading', { name: 'Heading' }).element() as HTMLElement).closest(
			'.max-h-60'
		);
		expect(bounded).not.toBeNull();
		expect(bounded!.classList.contains('overflow-y-auto')).toBe(true);
	});

	it('pretty-prints json shapes with a 2-space indent in a bounded pre', async () => {
		const value = { alpha: 1, nested: { beta: [2, 3] } };
		const { container } = await render(ToolResultBody, { shape: { kind: 'json', value } });

		const pre = container.querySelector('pre');
		expect(pre?.textContent).toBe(JSON.stringify(value, null, 2));
		expect(pre?.classList.contains('max-h-60')).toBe(true);
		expect(pre?.classList.contains('overflow-y-auto')).toBe(true);
	});

	it('renders text shapes verbatim in a bounded pre', async () => {
		const text = 'A long tool summary '.repeat(12);
		const { container } = await render(ToolResultBody, { shape: { kind: 'text', text } });

		const pre = container.querySelector('pre');
		expect(pre?.textContent).toBe(text);
		expect(pre?.classList.contains('max-h-60')).toBe(true);
		expect(pre?.classList.contains('overflow-y-auto')).toBe(true);
	});
});
