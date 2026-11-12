import { describe, expect, it, vi } from 'vitest';

import { render } from '../../../../tests/browser/render';
import GrowthEdge from './GrowthEdge.svelte';

function insertMarkdown(container: HTMLElement, html: string): HTMLElement {
	const host = container.firstElementChild as HTMLElement;
	const markdown = document.createElement('div');
	markdown.innerHTML = html;
	container.insertBefore(markdown, host);
	return host;
}

describe('GrowthEdge', () => {
	it('renders an empty overlay that sits over its sibling content', async () => {
		const { container } = await render(GrowthEdge, {
			variant: 'caret',
			buffer: 'hello',
			lifting: false
		});

		const host = container.firstElementChild as HTMLElement;
		expect(host).not.toBeNull();
		expect(host.textContent?.trim()).toBe('');
		expect(container.querySelector('.growth-caret')).toBeNull();
	});

	it('renders the caret effect at the trailing edge of the preceding markdown', async () => {
		const { container, rerender } = await render(GrowthEdge, {
			variant: 'caret',
			buffer: 'hello',
			lifting: false
		});
		insertMarkdown(container, '<p>Hello world</p>');

		await rerender({ buffer: 'hello world' });
		await vi.waitFor(() => expect(container.querySelector('.growth-caret')).not.toBeNull());
	});

	it('renders the blur effect with soften for list content and the lift class while lifting', async () => {
		const { container, rerender } = await render(GrowthEdge, {
			variant: 'blur-fade',
			buffer: 'hello',
			lifting: true
		});
		insertMarkdown(container, '<ul><li>List item text</li></ul>');

		await rerender({ buffer: 'hello again' });
		await vi.waitFor(() => {
			const blur = container.querySelector('.growth-edge-blur');
			expect(blur).not.toBeNull();
			expect(blur?.className).toContain('growth-edge-soften');
			expect(blur?.className).toContain('growth-edge-lift');
		});
	});

	it('suppresses the edge when the trailing block is a code fence', async () => {
		const { container, rerender } = await render(GrowthEdge, {
			variant: 'blur-fade',
			buffer: 'hello',
			lifting: false
		});
		insertMarkdown(container, '<pre><code>const x = 1;</code></pre>');

		await rerender({ buffer: 'hello again' });
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);
		expect(container.querySelector('.growth-edge-blur')).toBeNull();
		expect(container.querySelector('.growth-caret')).toBeNull();
	});
});
