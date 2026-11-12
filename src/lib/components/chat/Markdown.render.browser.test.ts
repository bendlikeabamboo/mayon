import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../../../tests/browser/render';
import kitchenSink from '../../../../tests/fixtures/mock-llm/kitchen-sink.md?raw';
import { themeState } from '#lib/stores/theme.svelte.js';
import Markdown from './Markdown.svelte';

function copyButtons(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll<HTMLButtonElement>('pre .md-copy-btn'));
}

afterEach(() => {
	themeState.hydrate('system');
});

describe('Markdown rendering', () => {
	it('renders the fixture markdown structure as semantic elements', async () => {
		const { container, getByRole, getByText } = await render(Markdown, { raw: kitchenSink });

		await expect
			.element(getByRole('heading', { level: 1, name: 'The Kitchen-Sink Fixture' }))
			.toBeVisible();
		await expect
			.element(getByRole('heading', { level: 2, name: 'Markdown Structure' }))
			.toBeVisible();
		await expect.element(getByRole('heading', { level: 3, name: 'Nested Emphasis' })).toBeVisible();

		expect(container.querySelectorAll('ul > li')).toHaveLength(5);
		expect(container.querySelectorAll('ul input[type="checkbox"]')).toHaveLength(2);
		expect(container.querySelectorAll('ol > li')).toHaveLength(3);
		expect(container.querySelectorAll('table tbody tr')).toHaveLength(3);

		await expect.element(getByText(/quiet deterministic assertion/)).toBeVisible();
		await expect
			.element(getByRole('link', { name: 'Mermaid docs' }))
			.toHaveAttribute('href', 'https://mermaid.js.org');
	});

	it('renders inline and display math as KaTeX', async () => {
		const { container } = await render(Markdown, { raw: kitchenSink });

		await vi.waitFor(() => {
			expect(container.querySelectorAll('.katex')).toHaveLength(2);
		});
		expect(container.querySelector('.katex')?.textContent?.length).toBeGreaterThan(0);
	});

	it('renders the mermaid fence as a themed SVG and re-renders it when the theme flips', async () => {
		themeState.hydrate('light');
		const { container } = await render(Markdown, { raw: kitchenSink });

		const wrapper = await vi.waitFor(
			() => {
				const element = container.querySelector<HTMLElement>('.mermaid-svg');
				expect(element).not.toBeNull();
				expect(element?.querySelector('svg')).not.toBeNull();
				return element!;
			},
			{ timeout: 30_000 }
		);
		expect(wrapper.getAttribute('data-rendered-theme')).toBe('light');
		expect(container.querySelectorAll('code.language-mermaid')).toHaveLength(0);

		themeState.set('dark');
		await vi.waitFor(
			() => {
				const element = container.querySelector<HTMLElement>('.mermaid-svg');
				expect(element?.getAttribute('data-rendered-theme')).toBe('dark');
				expect(element?.querySelector('svg')).not.toBeNull();
			},
			{ timeout: 30_000 }
		);

		themeState.set('light');
		await vi.waitFor(
			() => {
				const element = container.querySelector<HTMLElement>('.mermaid-svg');
				expect(element?.getAttribute('data-rendered-theme')).toBe('light');
			},
			{ timeout: 30_000 }
		);
	}, 30_000);

	it('gives every non-mermaid code block a copy affordance', async () => {
		const originalClipboard = navigator.clipboard;
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true
		});

		try {
			const { container } = await render(Markdown, { raw: kitchenSink });

			const buttons = copyButtons(container);
			expect(buttons).toHaveLength(2);

			buttons[0]!.click();
			await vi.waitFor(() => {
				expect(buttons[0]!.textContent).toBe('Copied');
			});
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(writeText.mock.calls[0]![0]).toContain('def dominate');
		} finally {
			Object.defineProperty(navigator, 'clipboard', {
				value: originalClipboard,
				configurable: true
			});
		}
	});
});
