# Contract: Pacer API (`src/lib/chat/streaming/pacer.ts`)

Internal client module contract. The pacer converts "raw arrived text length over time" into "safe visible prefix length over time". It is presentation-only: it never mutates the raw buffer and never persists.

## Types

```ts
export type PacerMode = 'idle' | 'streaming' | 'draining' | 'flushed';

export interface PacerConfig {
  /** Flush tick interval the store already uses (ms). */
  tickMs: number;              // 80 (RENDER_INTERVAL_MS)
  /** Baseline release rate in chars/sec while streaming. */
  baseCps: number;             // ≈ 90, tuning constant
  /** Backlog catch-up gain: cps = max(baseCps, backlog * catchupPerSec). */
  catchupPerSec: number;       // ≈ 3.0
  /** Max lookback when snapping a release point back to a safe boundary (chars). */
  snapLookback: number;        // 12
  /** Drain ramp: rate doubling interval (ms) after stream end. */
  drainRampMs: number;         // ≈ 120
  /** Hard bound on total drain time after stream end (ms). */
  drainBudgetMs: number;       // ≈ 900
  /** Injected clock for tests (defaults to Date.now). */
  now?: () => number;
}
```

Initial constants live in one place and are pinned by tests as *bands* (timing constants asserted within tolerance, per `src/lib/motion/stagger.test.ts:42-50` convention); exact feel tuning happens at implementation.

## API

```ts
export function createPacer(isSafeBoundary: (raw: string, index: number) => boolean, config?: Partial<PacerConfig>): Pacer;

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
  /** Current mode; the store reads `draining → flushed` to time finalization
   *  (persist the durable row only after flushed) and the overlay syncs its
   *  lift transition to the same moment. */
  readonly mode: PacerMode;
}
```

## Behavioral rules

1. **Word safety**: `tick()` returns an index such that `raw.slice(0, index)` never ends mid-word; the release point snaps back at most `snapLookback` chars to a whitespace/word/block boundary (FR-002).
2. **Adaptive cadence**: while `streaming`, release rate is `max(baseCps, backlog × catchupPerSec)` chars/sec, where `backlog = raw.length − visible.length`; hidden lag stays within the accepted few-hundred-ms window (FR-003, SC-002, SC-005).
3. **Eased drain**: `onStreamEnd()` ramps the rate (double every `drainRampMs`) under a total `drainBudgetMs` bound; completion is never a single-tick dump (FR-004, SC-002).
4. **Abort fast-path**: after `onAbort()`, the next `tick()` returns `raw.length` (FR-005).
5. **Reset tolerance**: if `raw.length` shrinks below `visible.length` (critic-phase `updateStreamBuffer('')` clears, loop.ts:225/245), the pacer resets to 0 and continues in the current mode (D2).
6. **Mid-stream activation**: `syncTo(visible, raw)` fast-forwards the release point over text that is already visible (never rewinds it). It lands on a safe boundary within the snap window when one exists; word-safety governs *withheld* text, not text already on screen. A no-op when `visible` ≤ released or the pacer is idle/flushed. The store calls it before every paced `tick` so Standard↔paced preset switches mid-stream are seamless.
7. **Presets**: the *store* decides whether to consult the pacer — preset `standard` bypasses it entirely (verbatim copy = today's behavior, FR-012); `calm`/`expressive` route through it. The pacer itself is preset-agnostic.
8. **Store integration invariants**: `streamBuffer` (raw) is never paced or mutated; `streamBufferRender` is always a prefix of `streamBuffer`; abort/error keeps today's immediate full flush + `interrupted: true` persist (D3).
9. **Instrumentation**: the store's flush path adds `mark('pacing:flush', …)` / `incRender(...)` via `src/lib/perf/mark.ts`; a source-contract test asserts the marks exist (SectionStrip.contract.test.ts pattern).

## Failure modes

| Input | Required behavior |
|---|---|
| Empty / whitespace-only deltas | No stutter; mode unchanged (no visible tick work) |
| `onStreamEnd()` with empty backlog | Immediately `flushed` (finalize on next tick) |
| `onAbort()` during `draining` | Immediately `flushed` |
| `reset()` during any mode | State discarded; next turn starts clean |
| Buffer shrink mid-drain | Release position clamps to new raw length; drain continues |
