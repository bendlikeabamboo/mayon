/**
 * Streaming pacer (specs/022-smooth-streaming): converts "raw arrived length
 * over time" into "safe visible prefix length over time". Presentation-only —
 * it never mutates the raw buffer and never persists. The store supplies the
 * `isSafeBoundary` predicate and consults `tick()` from its existing render
 * flush; presets decide whether the pacer is consulted at all.
 */

export type PacerMode = 'idle' | 'streaming' | 'draining' | 'flushed';

export interface PacerConfig {
	/** Flush tick interval the store already uses (ms). */
	tickMs: number;
	/** Baseline release rate in chars/sec while streaming. */
	baseCps: number;
	/** Backlog catch-up gain: cps = max(baseCps, backlog * catchupPerSec). */
	catchupPerSec: number;
	/** Max lookback when snapping a release point back to a safe boundary (chars). */
	snapLookback: number;
	/** Drain ramp: rate doubling interval (ms) after stream end. */
	drainRampMs: number;
	/** Hard bound on total drain time after stream end (ms). */
	drainBudgetMs: number;
	/** Injected clock for tests (defaults to Date.now). */
	now?: () => number;
}

export const DEFAULT_PACER_CONFIG: PacerConfig = {
	tickMs: 80,
	baseCps: 90,
	catchupPerSec: 3.0,
	snapLookback: 12,
	drainRampMs: 120,
	drainBudgetMs: 900
};

export interface Pacer {
	/** Call on every stream delta with the full raw buffer. Never throws on shrink. */
	onArrived(raw: string): void;
	/** Call once when the model stream finishes normally → enters draining. */
	onStreamEnd(): void;
	/** Call on abort/error → next tick releases everything (flushed). */
	onAbort(): void;
	/** Call at turn teardown → returns to idle. */
	reset(): void;
	/** Call on each store flush tick. Returns the length of the raw buffer that
	 *  should be visible now, snapped to a safe boundary, or raw.length when flushed. */
	tick(raw: string): number;
	/** Fast-forward the release point to `visible` chars (never rewinds). Used
	 *  when pacing activates mid-stream over text that is already on screen
	 *  (e.g. the preset switches from Standard, which never ticks the pacer). */
	syncTo(visible: number, raw: string): void;
	readonly mode: PacerMode;
}

export function createPacer(
	isSafeBoundary: (raw: string, index: number) => boolean,
	config?: Partial<PacerConfig>
): Pacer {
	const cfg = { ...DEFAULT_PACER_CONFIG, ...config };
	const now = cfg.now ?? (() => Date.now());
	let mode: PacerMode = 'idle';
	let released = 0;
	let lastTickAt = 0;
	let endedAt = 0;

	const reset = (): void => {
		mode = 'idle';
		released = 0;
		endedAt = 0;
		lastTickAt = now();
	};
	reset();

	const onArrived = (raw: string): void => {
		if (mode === 'idle' && raw.length > 0) mode = 'streaming';
	};

	const onStreamEnd = (): void => {
		if (mode === 'streaming' || mode === 'idle') {
			mode = 'draining';
			endedAt = now();
		}
	};

	const onAbort = (): void => {
		mode = 'flushed';
	};

	const tick = (raw: string): number => {
		// Critic-phase buffer clears can shrink raw below the release point.
		if (released > raw.length) released = 0;
		// Advance the clock on EVERY tick (even no-op early returns) so a tick
		// gap (rAF pause, fully-caught-up stream) never accumulates into one
		// giant release on the next arrival.
		const t = now();
		const dt = Math.max(0, t - lastTickAt);
		lastTickAt = t;
		if (mode === 'flushed' || mode === 'idle') return raw.length;
		if (raw.length === 0) return released;
		if (released >= raw.length) {
			if (mode === 'draining') mode = 'flushed';
			return raw.length;
		}
		// ponytail: fixed base+catchup rate with an exponential drain ramp and a
		// budget clamp — feel tuning lives in PacerConfig; tests pin bands, not
		// this exact curve.
		const backlog = raw.length - released;
		let cps = Math.max(cfg.baseCps, backlog * cfg.catchupPerSec);
		if (mode === 'draining') {
			const elapsed = t - endedAt;
			if (elapsed >= cfg.drainBudgetMs) {
				mode = 'flushed';
				released = raw.length;
				return released;
			}
			cps *= Math.pow(2, elapsed / cfg.drainRampMs);
		}
		const candidate = released + (cps * dt) / 1000;
		const c = Math.min(Math.floor(candidate), raw.length);
		if (c <= released) return released;
		const floor = Math.max(released, c - cfg.snapLookback);
		for (let i = c; i >= floor; i--) {
			if (isSafeBoundary(raw, i)) {
				released = i;
				return released;
			}
		}
		return released;
	};

	const syncTo = (visible: number, raw: string): void => {
		if (mode !== 'streaming' && mode !== 'draining') return;
		const target = Math.min(visible, raw.length);
		if (target <= released) return;
		// Already-visible text must never rewind, so land on a safe boundary if
		// one is in the snap window — else take the raw target (word-safety
		// governs withheld text, not text that is already on screen).
		let i = target;
		const floor = Math.max(released, target - cfg.snapLookback);
		while (i > floor && !isSafeBoundary(raw, i)) i--;
		released = i;
	};

	return {
		onArrived,
		onStreamEnd,
		onAbort,
		reset,
		tick,
		syncTo,
		get mode() {
			return mode;
		}
	};
}
