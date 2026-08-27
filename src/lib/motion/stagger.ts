/**
 * Route-entry stagger-fade (feature 012 US9 / FR-22).
 *
 * `entry()` is a gated wrapper over svelte/transition's `fly` (which fades and
 * rises in one animation). Routes attach it as `in:entry={{ index, count }}`.
 * Under `prefers-reduced-motion: reduce` — or any non-browser render — the
 * gate returns a zero-duration config before any motion params are built, so
 * reduced-motion users get an instant render instead of relying on CSS to
 * suppress Svelte-injected keyframes after the fact. Containers are still
 * tagged `.art-stagger` as belt-and-braces for any pure-CSS motion.
 */
import { browser } from '$app/environment';
import { fly, type TransitionConfig } from 'svelte/transition';

/** Per-child delay increment; contract §4 pins ≈40–60 ms (FR-22). */
export const STEP_MS = 40;
/** Longest permitted delay span across a staggered group. */
export const SPAN_MS = 240;
/** How long each child's fade/fly runs. */
export const DURATION_MS = 170;
/** Vertical offset of the slight rise-in (px). */
export const ENTRY_Y_PX = 6;
/** Whole-sequence budget: max delay + duration stays under FR-22's 500 ms. */
export const TOTAL_CAP_MS = 410;

/** Hard ceiling applied to every computed per-child delay. */
export const MAX_DELAY_MS = TOTAL_CAP_MS - DURATION_MS;

export interface EntryParams {
	/** 0-based position of this child within its staggered sequence. */
	index?: number;
	/** Size of the staggered sequence; larger groups compress steps toward SPAN_MS. */
	count?: number;
	/** Test-only seam to override the reduced-motion probe (ignored at runtime). */
	_probe?: ReducedMotionProbe;
}

/**
 * Pure scheduler: a linear ramp that compresses its step once a group would
 * otherwise exceed SPAN_MS, clamped so index×step never pushes past
 * MAX_DELAY_MS (the FR-22 total cap is enforced centrally here, not per call site).
 */
export function entryDelay(
	index: number,
	count: number,
	stepMs: number = STEP_MS,
	spanMs: number = SPAN_MS
): number {
	if (count <= 1) return 0;
	const effectiveStep = Math.min(stepMs, spanMs / (count - 1));
	return Math.min(Math.round(Math.max(index, 0) * effectiveStep), MAX_DELAY_MS);
}

/** Injectable seam so unit tests can drive both probe outcomes without DOM. */
export type ReducedMotionProbe = () => boolean;

function mediaProbe(): boolean {
	if (!browser || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function prefersReducedMotion(probe: ReducedMotionProbe = mediaProbe): boolean {
	return probe();
}

/** Zero-length config: the shortest legal suppression Svelte typings allow. */
const MOTION_NONE: TransitionConfig = { duration: 0 };

/**
 * Route-entry transition: a zero-duration no-op for reduced-motion users
 * (SC-9), otherwise a gentle fade + small rise with the scheduled delay.
 */
export function entry(node: Element, params: EntryParams = {}): TransitionConfig {
	const probe = params._probe ?? mediaProbe;
	if (!browser || prefersReducedMotion(probe)) return MOTION_NONE;
	const { index = 0, count = 1 } = params;
	const delay = entryDelay(index, count);
	return fly(node, { delay, duration: DURATION_MS, y: ENTRY_Y_PX });
}
