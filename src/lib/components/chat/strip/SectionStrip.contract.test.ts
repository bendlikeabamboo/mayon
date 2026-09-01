import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STRIP = path.resolve(__dirname, 'SectionStrip.svelte');

describe('US1: SectionStrip pointer-discipline, motion, and touch source contract', () => {
	const source = fs.readFileSync(STRIP, 'utf-8');

	it('is a navigation landmark labelled "Reply sections"', () => {
		expect(source).toContain('role="navigation"');
		expect(source).toContain('aria-label="Reply sections"');
	});

	it('never scrolls or navigates itself — the page orchestrates jumps', () => {
		expect(source).not.toContain('scrollIntoView');
		expect(source).not.toContain('scrollTop');
		expect(source).not.toContain('history.');
		expect(source).not.toContain('location.');
	});

	it('attaches no wheel or touch handlers so the transcript scrolls natively', () => {
		expect(source).not.toContain('onwheel');
		expect(source).not.toContain('ontouchstart');
		expect(source).not.toContain('ontouchmove');
		expect(source).not.toContain('ontouchend');
		expect(source).not.toContain("addEventListener('wheel'");
		expect(source).not.toContain("addEventListener('touchstart'");
		expect(source).not.toContain("addEventListener('touchmove'");
	});

	it('is an inert overlay: pointer-events-none wrapper, pointer-events-auto bars', () => {
		const wrapper = source.match(/class="[^"]*group\/strip[^"]*"/);
		expect(wrapper, 'strip wrapper class attribute not found').not.toBeNull();
		expect(wrapper![0]).toContain('pointer-events-none');
		const bar = source.match(/<button[\s\S]*?class="([^"]*)"/);
		expect(bar, 'bar button class attribute not found').not.toBeNull();
		expect(bar![1]).toContain('pointer-events-auto');
	});

	it('honors reduced motion on its transitions', () => {
		expect(source).toContain('transition-');
		expect(source).toContain('motion-reduce:transition-none');
	});

	it('reports render counts for the perf probe', () => {
		expect(source).toContain("incRender('SectionStrip')");
	});

	it('detects coarse pointers via matchMedia with listener cleanup on teardown', () => {
		expect(source).toContain("matchMedia('(hover: none), (pointer: coarse)')");
		expect(source).toContain("addEventListener('change'");
		expect(source).toContain("removeEventListener('change'");
	});

	it('touch taps jump directly; dwell handlers are guarded against coarse pointers (FR-011)', () => {
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

	it('opens dwell on bar pointerenter and dismisses on pointer leave', () => {
		expect(source).toContain('onpointerenter');
		expect(source).toContain('onpointerleave');
	});

	it('renders the preview card with the selection-excluded chrome class and tooltip semantics', () => {
		expect(source).toContain('section-strip-preview');
		expect(source).toContain('role="tooltip"');
		expect(source).toContain('aria-describedby');
		expect(source).toContain('pointer-events-auto');
	});
});
