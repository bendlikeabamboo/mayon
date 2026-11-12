import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Section } from '#lib/markdown/sections.js';

import { setPointerMedia } from '../../../../../tests/browser/media';
import { render } from '../../../../../tests/browser/render';
import SectionStrip from './SectionStrip.svelte';

function section(index: number, title: string, excerpt = '', length = 120): Section {
	return {
		index,
		level: 2,
		title,
		start: index * 100,
		end: index * 100 + length,
		length,
		excerpt
	};
}

const sections = [
	section(0, 'Introduction', 'Where the reply begins'),
	section(1, 'Details', 'The supporting argument'),
	section(2, 'Summary')
];

afterEach(async () => {
	vi.restoreAllMocks();
	await setPointerMedia(null);
});

/**
 * Headless Chromium here reports no fine pointer (`pointer: fine` and
 * `hover: hover` never match), so the component's JS coarse-pointer branch
 * always wins. Stub only that media query so the dwell path can be exercised;
 * the preview and timers under test stay real. The coarse test uses the real
 * CDP touch emulation below.
 */
function forceFinePointer() {
	const realMatchMedia = window.matchMedia.bind(window);
	vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
		if (query === '(hover: none), (pointer: coarse)') {
			return {
				matches: false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false
			} as MediaQueryList;
		}
		return realMatchMedia(query);
	});
}

describe('SectionStrip pointer, motion, and touch contract', () => {
	it('renders a labelled navigation landmark with one named bar per section', async () => {
		const { getByRole } = await render(SectionStrip, {
			msgId: 'msg-1',
			sections,
			onJump: vi.fn()
		});

		await expect.element(getByRole('navigation', { name: 'Reply sections' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Introduction' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Details' })).toBeVisible();
		await expect.element(getByRole('button', { name: 'Summary' })).toBeVisible();
	});

	it('jumps from a bar click without scrolling or navigating the page itself', async () => {
		const onJump = vi.fn();
		const href = window.location.href;
		const scrollY = window.scrollY;
		const { getByRole } = await render(SectionStrip, {
			msgId: 'msg-1',
			sections,
			onJump
		});

		(getByRole('button', { name: 'Details' }).element() as HTMLElement).click();

		expect(onJump).toHaveBeenCalledWith(1);
		expect(window.location.href).toBe(href);
		expect(window.scrollY).toBe(scrollY);
	});

	it('opens a described tooltip preview after dwell and jumps from the preview', async () => {
		forceFinePointer();
		const onJump = vi.fn();
		const { getByRole } = await render(SectionStrip, {
			msgId: 'msg-1',
			sections,
			onJump
		});

		const bar = getByRole('button', { name: 'Introduction', exact: true });
		bar.element().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));

		await expect.element(getByRole('tooltip')).toBeVisible();
		await expect.element(getByRole('tooltip')).toHaveTextContent('Where the reply begins');
		await vi.waitFor(() =>
			expect(bar.element().getAttribute('aria-describedby')).toBe('section-strip-preview-msg-1')
		);

		(getByRole('tooltip').getByRole('button').element() as HTMLElement).click();
		expect(onJump).toHaveBeenCalledWith(0);
	});

	it('skips dwell previews on coarse pointers but still jumps on tap', async () => {
		await setPointerMedia(true);
		const onJump = vi.fn();
		const { getByRole } = await render(SectionStrip, {
			msgId: 'msg-1',
			sections,
			onJump
		});
		expect(window.matchMedia('(any-pointer: coarse)').matches).toBe(true);

		const bar = getByRole('button', { name: 'Details' });
		bar.element().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
		await new Promise((resolve) => setTimeout(resolve, 600));

		expect(getByRole('tooltip').query()).toBeNull();
		(bar.element() as HTMLElement).click();
		expect(onJump).toHaveBeenCalledWith(1);
	});
});
