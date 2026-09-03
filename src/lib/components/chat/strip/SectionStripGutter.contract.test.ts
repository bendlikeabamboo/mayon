import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const GUTTER = path.resolve(__dirname, 'SectionStripGutter.svelte');

function functionBody(source: string, name: string): string {
	const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\t\\}`));
	return match ? match[0] : '';
}

describe('Refinement: SectionStripGutter scroll-sync, pointer-discipline, and touch source contract', () => {
	const source = fs.readFileSync(GUTTER, 'utf-8');

	it('is a page-level layer reserving a 16px gutter right of the scrollbar', () => {
		const root = source.match(/class="section-strip [^"]*"/);
		expect(root, 'gutter root class attribute not found').not.toBeNull();
		expect(root![0]).toContain('absolute inset-y-0 right-0');
		expect(root![0]).toContain('w-4');
	});

	it('registers exactly one scroll listener — passive, on the viewport element, rAF-throttled', () => {
		expect(source.match(/addEventListener\('scroll'/g)).toHaveLength(1);
		expect(source).toContain("viewportEl.addEventListener('scroll', onScroll, { passive: true })");
		const handler = functionBody(source, 'onScroll');
		expect(handler, 'onScroll body not found').not.toBe('');
		expect(handler).toContain('requestAnimationFrame(flush)');
		expect(handler).toMatch(/if \(frame !== null\) return/);
	});

	it('scroll-time work is transform-only: the scroll handler reads no layout', () => {
		for (const name of ['onScroll', 'flush']) {
			const body = functionBody(source, name);
			expect(body, `${name} body not found`).not.toBe('');
			expect(body).not.toContain('offsetHeight');
			expect(body).not.toContain('offsetTop');
			expect(body).not.toContain('getBoundingClientRect');
			expect(body).not.toContain('clientHeight');
		}
		expect(functionBody(source, 'flush')).toContain('viewportEl.scrollTop');
		expect(source).toContain('translate3d');
	});

	it('never scrolls itself or navigates — no scroll writes, scrollIntoView, history or location', () => {
		expect(source).not.toContain('scrollIntoView');
		expect(source).not.toMatch(/\.scrollTop\s*\+?=/);
		expect(source).not.toContain('history.');
		expect(source).not.toContain('location.');
	});

	it('relays wheel gestures to the transcript: exactly one wheel listener on the gutter root', () => {
		expect(source.match(/addEventListener\('wheel'/g)).toHaveLength(1);
		expect(source).toContain('const el = rootEl');
		expect(source).toContain("el.addEventListener('wheel', relayWheel)");
		expect(source).toContain("el.removeEventListener('wheel', relayWheel)");
		const relay = functionBody(source, 'relayWheel');
		expect(relay, 'relayWheel body not found').not.toBe('');
		expect(relay).toContain('event.preventDefault()');
		expect(relay).toContain('viewportEl.scrollBy(0, event.deltaY)');
		// The clip box is a hit target so bare-gutter wheel (between ticks, past
		// the reply bands) also bubbles to the root relay (contracts §5).
		const clipBox = source.match(/overflow-hidden pointer-events-auto/);
		expect(clipBox, 'clip box must be pointer-events-auto for the relay').not.toBeNull();
	});

	it('the relay never stops propagation; no other wheel or touch handlers exist', () => {
		expect(source).not.toContain('stopPropagation');
		expect(source).not.toContain('onwheel');
		expect(source).not.toContain('on:wheel');
		expect(source).not.toContain('ontouchstart');
		expect(source).not.toContain('ontouchmove');
		expect(source).not.toContain('ontouchend');
		expect(source).not.toContain("addEventListener('touch");
	});

	it('is an inert layer: pointer-events-none root with pointer-events-auto ticks and preview', () => {
		const root = source.match(/class="section-strip [^"]*"/)!;
		expect(root[0]).toContain('pointer-events-none');
		const tick = source.match(/<button[\s\S]*?class="([^"]*)"/);
		expect(tick, 'tick button class attribute not found').not.toBeNull();
		expect(tick![1]).toContain('pointer-events-auto');
		const preview = source.match(/class="section-strip-preview[^"]*"/);
		expect(preview, 'preview class attribute not found').not.toBeNull();
		expect(preview![0]).toContain('pointer-events-auto');
	});

	it('honors reduced motion on its transitions', () => {
		expect(source).toContain('transition-');
		expect(source).toContain('motion-reduce:transition-none');
	});

	it('reports render counts for the perf probe', () => {
		expect(source).toContain("incRender('SectionStripGutter')");
	});

	it('renders thin horizontal hairline ticks, left-aligned, sized by section share', () => {
		expect(source).toContain('h-[2px]');
		const tick = source.match(/<button[\s\S]*?class="([^"]*)"/)![1];
		expect(tick).toContain('justify-start');
		expect(source).toContain('style:width');
		const width = functionBody(source, 'tickWidthPx');
		expect(width, 'tickWidthPx body not found').not.toBe('');
		expect(width).toContain('Math.max(4');
		expect(width).toContain('Math.min(12');
		expect(width).toContain('/');
	});

	it('extends the hovered tick to the right via a width transition', () => {
		const width = functionBody(source, 'tickWidthPx');
		expect(width).toContain('hovered');
		expect(source).toContain('transition-[width');
	});

	it('anchors the floating preview leftward outside the chat area with the excluded chrome class', () => {
		const preview = source.match(/<div[^>]*section-strip-preview[\s\S]*?>/);
		expect(preview, 'preview element not found').not.toBeNull();
		expect(preview![0]).toContain('right:');
		expect(preview![0]).not.toMatch(/\bleft:/);
		expect(source).toContain('role="tooltip"');
	});

	it('detects coarse pointers via matchMedia with listener cleanup on teardown', () => {
		expect(source).toContain("matchMedia('(hover: none), (pointer: coarse)')");
		expect(source).toContain("addEventListener('change'");
		expect(source).toContain("removeEventListener('change'");
	});

	it('touch taps jump directly; dwell handlers are guarded against coarse pointers', () => {
		expect(source).toContain('onJump(');
		expect(source).toMatch(/isTouch\s*\?/);
		expect(source).toContain('if (isTouch) return');
	});

	it('drives the dwell preview through the pure transition module and a component-held timer', () => {
		expect(source).toContain("from '$lib/chat/strip/dwell'");
		expect(source).toContain('dwellTransition');
		expect(source).toContain('setTimeout');
		expect(source).toContain('clearTimeout');
	});

	it('is a navigation landmark labelled "Reply sections" with per-tick labels from section titles', () => {
		expect(source).toContain('role="navigation"');
		expect(source).toContain('aria-label="Reply sections"');
		expect(source).toContain('aria-label={section.title ||');
		expect(source).toContain('`Section ${section.index + 1}`');
	});

	it('consumes the wave-6 registry and preference helpers defensively', () => {
		expect(source).toContain('getStripRegistry()');
		expect(source).toContain('getStripPrefFromContext()');
	});

	it('measures anchors at invalidation time and drops disconnected rows', () => {
		const measure = functionBody(source, 'measure');
		expect(measure, 'measure body not found').not.toBe('');
		expect(measure).toContain('getBoundingClientRect');
		expect(measure).toContain('isConnected');
		expect(source).toContain('new ResizeObserver');
		expect(source).toContain('ro.disconnect()');
	});
});
