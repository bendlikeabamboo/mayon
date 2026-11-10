import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPointerMedia } from '../../../../tests/browser/media';
import { render } from '../../../../tests/browser/render';
import Markdown from './Markdown.svelte';

const raw = [
	'```ts',
	'const answer = 42;',
	'```',
	'',
	'| Column one | Column two | Column three | Column four |',
	'| --- | --- | --- | --- |',
	`| ${'alpha '.repeat(24)} | ${'x'.repeat(300)} | ${'gamma '.repeat(24)} | ${'delta '.repeat(24)} |`
].join('\n');

function styleOf(element: Element): CSSStyleDeclaration {
	return getComputedStyle(element);
}

afterEach(async () => {
	await setPointerMedia(null);
});

describe('Markdown touch affordances', () => {
	it('hides the copy affordance and keeps the 24px table-focus trigger on fine pointers', async () => {
		await setPointerMedia(false);
		const { getByRole } = await render(Markdown, { raw });

		const copy = getByRole('button', { name: 'Copy' });
		const expand = getByRole('button', { name: 'Expand' });
		await expect.element(copy).toBeVisible();
		await expect.element(expand).toBeVisible();

		await vi.waitFor(() => expect(styleOf(copy.element()).opacity).toBe('0'));
		await vi.waitFor(() => expect(styleOf(expand.element()).width).toBe('24px'));
	});

	it('keeps the copy button visible and grows the table-focus trigger to 2rem on coarse pointers', async () => {
		await setPointerMedia(true);
		const { getByRole } = await render(Markdown, { raw });

		const copy = getByRole('button', { name: 'Copy' });
		const expand = getByRole('button', { name: 'Expand' });
		await expect.element(copy).toBeVisible();

		expect(window.matchMedia('(any-pointer: coarse)').matches).toBe(true);
		await vi.waitFor(() => expect(styleOf(copy.element()).opacity).toBe('1'));
		await vi.waitFor(() => expect(styleOf(expand.element()).width).toBe('32px'));
	});

	it('scrolls wide tables instead of clipping them', async () => {
		const { container } = await render(Markdown, { raw });

		const table = container.querySelector('table');
		expect(table, 'table was not rendered').not.toBeNull();
		expect(styleOf(table!).overflowX).toBe('auto');
		expect(table!.scrollWidth).toBeGreaterThan(table!.clientWidth);
	});
});
