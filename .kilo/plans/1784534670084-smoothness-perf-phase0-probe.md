# Phase 0 — Smoothness Perf Probe (instrumentation scaffolding)

> Plan for Phase 0 of `refinement/2026-07-20_smoothness-perf-program.md`.
> Goal: ship a flag-gated perf probe that the user runs in Phase 1 to collect
> frame/longtask/CLS/input-latency/mark/render data. **No user-visible change,
> no remediation.** Diagnosis-first; the invariant is *no remediation lands
> without a top-3 measurement.*

## Context & resolved decisions

- **Prior work** shipped 5 scroll-smoothness candidates but the app still measures
  10–15 Hz on a 144 Hz display, and there is **zero perf instrumentation** in `src/`.
  Everything fixed so far was a guess. This phase removes the guesswork.
- **D1 — Probe ships in PRODUCTION builds** (user-confirmed), behind the runtime
  flag, **not** `import.meta.env.DEV`-stripped. Rationale: Phase 1 must measure a
  *representative* build; the Vite dev server (un-minified + HMR + sourcemaps)
  distorts frame timing and would invalidate the data-driven premise. The probe is
  inactive (no observers, no rAF, no console) unless `?perf=1` /
  `localStorage.mayon_perf === '1'`.
- **D2 — Consequence / gate deviation:** the doc's literal "flag off →
  byte-identical ±0.1KB" Phase-0 gate is **superseded** by a *behavioral* gate
  (zero `PerformanceObserver` / rAF / interval / console when the flag is off) plus
  an *informational* recorded prod gzip delta. The inactive probe code does ride in
  the prod bundle (expected small, no deps); byte-identity is no longer the test.
- **D3 — Target bar = 60 Hz** (user-confirmed): Phase-1 success = p95 frame time
  < 16.7 ms. The probe's dropped-frame threshold stays **adaptive** (1.5 × observed
  median), so 60 Hz is the reporting bar, not a hardcoded threshold.
- **D4 — Bootstrap split:** `src/app.html` reads the flag **pre-hydration** (so boot
  longtasks are captured) and sets a global; the probe *module* self-initializes via
  a top-level side-effect import from `src/routes/+layout.svelte`. This is cleaner
  than a full inline script and still starts before route components mount.
- **D5 — `MessageRow.svelte` has no `$effect`** (only `$derived`/`$state`), so the
  doc's "incRender at top of first `$effect`" can't apply there. Instead
  `incRender('MessageRow')` goes in `onMount` to capture **mount/unmount churn** (the
  `LazyMount unmountFar` path — the mount facet of H1). `Markdown.svelte:72` and
  `Highlighter.svelte:63` *do* have `$effect`s and capture the **re-run** facet.
- **D6 — Node-test safety:** vitest env is `node` (`vite.config.ts:18`) with no
  `PerformanceObserver`/`window`. `render.ts` is exercised by `render.test.ts`, so
  `mark.ts` (imported by `render.ts`) must be **import-safe** (no browser-API access
  at module top level) and a pure passthrough when the sink is unset. The probe
  module is feature-detecting and never imported by node tests.

## Files

| # | File | Action |
| - | --- | --- |
| 1 | `src/lib/perf/mark.ts` | **new** — `mark()` / `incRender()` + sink registry |
| 2 | `src/lib/perf/probe.ts` | **new** — 6 surfaces, flag-gated self-init, cleanup |
| 3 | `src/lib/perf/mark.test.ts` | **new** — passthrough + sink unit tests |
| 4 | `src/lib/perf/probe.test.ts` | **new** — flag-off inert + flag-on summary (mocked APIs) |
| 5 | `src/app.html` | **edit** — pre-hydration flag-read → global |
| 6 | `src/routes/+layout.svelte` | **edit** — side-effect `import '$lib/perf/probe'` |
| 7 | `src/lib/markdown/render.ts` | **edit** — wrap both `processSync` calls |
| 8 | `src/routes/chat/[id]/+page.svelte` | **edit** — wrap `flush()` body |
| 9 | `src/lib/components/chat/Highlighter.svelte` | **edit** — wrap `buildSourceMap` + `incRender` |
| 10 | `src/lib/components/chat/Markdown.svelte` | **edit** — `incRender` in `$effect` |
| 11 | `src/lib/components/chat/MessageRow.svelte` | **edit** — `incRender` in `onMount` |

No new runtime dependencies (platform APIs only). Nothing under `server/`.

## API contract (exact, so the implementer need not re-derive)

### `src/lib/perf/mark.ts`

```ts
export interface PerfSink {
	mark(label: string, ms: number): void;
	incRender(label: string): void;
}

let sink: PerfSink | null = null; // node-safe: no top-level browser access

/** Wrap a synchronous fn; record (label, durationMs) when a sink is attached,
 *  else pass through with zero overhead beyond the call. */
export function mark<T>(label: string, fn: () => T): T {
	if (sink) {
		const t0 = performance.now();
		const r = fn();
		sink.mark(label, performance.now() - t0);
		return r;
	}
	return fn();
}

/** Increment a per-label render counter when a sink is attached, else no-op. */
export function incRender(label: string): void {
	sink?.incRender(label);
}

/** Called by probe.ts on active init (and cleared on teardown). */
export function setPerfSink(s: PerfSink | null): void {
	sink = s;
}
```

`mark` is synchronous (all wrapped call sites are sync). `performance.now()` is only
touched inside `if (sink)`, so node tests that never attach a sink never reach it.

### `src/lib/perf/probe.ts`

Self-initializing top-level module. Idempotent (`if (started) return`). Reads the
flag from the global set by `app.html`; if absent, **does nothing** (no observers,
no rAF, no interval). If present:

1. `setPerfSink(sink)` where `sink` writes into in-memory accumulators.
2. **FPS / frame-time** — rAF loop; push `now - last` into an array **flushed each
   summary tick** (not a fixed 180-frame ring — a fixed ring under-covers at
   120/144 Hz; deviation from the doc's wording for correctness). Report `n`,
   `avgMs`, `p50Ms`, `p95Ms`, `p99Ms`, `maxMs`, `dropped` (delta > 1.5 × median).
3. **longtask** — `PerformanceObserver({ type: 'longtask', buffered: true })`;
   bucket 50–100 / 100–250 / 250+ ms; record top attribution via
   `entry.attribution?.[0]` (LongTask V2) when present.
4. **layout-shift** — accumulate `entry.value` for entries with
   `!entry.hadRecentInput`; report `score` (sum) + `entries` per window.
5. **input latency** — `PerformanceObserver({ type: 'event', durationThreshold: 16 })`;
   filter `entry.name` ∈ {`pointermove`, `wheel`}; report per-name `n`, `p50Ms`,
   `p95Ms` of `processingStart - startTime`.
6. **Scoped marks** — consumed via the sink (surfaces 7–11 below).
7. **render counts** — consumed via the sink.

Every `SUMMARY_INTERVAL_MS = 3000`: build the JSON block (shape below) and
`console.log('[mayon-perf] t=' + elapsed + 's\n' + JSON.stringify(obj, null, 1))`.
Read `scenario` from `localStorage.mayon_perf_scenario`. **Cleanup** on
`pagehide`: disconnect observers, `cancelAnimationFrame`, `clearInterval`,
`setPerfSink(null)`. Each observer wrapped in `try/catch` + feature-detect
(`typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes(type)`)
so unsupported entry types degrade silently.

Output JSON shape (matches the doc exactly):

```jsonc
{"fps":{"n":360,"avgMs":8.2,"p50":6.9,"p95":18.1,"p99":34.0,"max":51.2,"dropped":12},
 "longtask":{"50-100":3,"100-250":1,"250+":0,"topAttribution":"render.ts:90"},
 "cls":{"score":0.04,"entries":2},
 "inputLatency":{"wheel":{"n":42,"p50Ms":3.1,"p95Ms":9.4},"pointermove":{"n":18,"p50Ms":4.0}},
 "marks":{"markdown:render":{"n":12,"totalMs":84,"maxMs":14},"layout:flush":{"n":60,"totalMs":31,"maxMs":2.1}},
 "renders":{"MessageRow":{"n":0},"Markdown":{"n":12},"Highlighter":{"n":0}},
 "scenario":"idle-scroll-long-chat"}
```

Percentiles via a sorted copy of the frame-delta array (linear interpolation ok).

## Ordered task list

1. **`mark.ts`** — implement the contract above. Pure, node-safe, no top-level
   browser access.
2. **`probe.ts`** — implement the 6 surfaces + summary + cleanup behind the flag
   global. Feature-detect every observer. Idempotent.
3. **`app.html`** — extend the existing inline `<script>` IIFE: compute
   `enabled = localStorage.getItem('mayon_perf') === '1' || /[?&]perf=1\b/.test(location.search)`;
   if enabled set `(window as any).__MAYON_PERF__ = 1`. Keep the theme logic intact.
4. **`+layout.svelte`** — add a top-level side-effect `import '$lib/perf/probe';`
   (no guard; the module self-gates). Place near the other imports.
5. **`render.ts`** (lines 90–101) — change both returns to
   `return mark('markdown:render', () => String(<processor>.processSync(raw)));`
   for `renderMarkdown` and `renderMarkdownLive`.
6. **`+page.svelte`** — wrap the `flush()` body (lines 129–142) in
   `mark('layout:flush', () => { … })` preserving the force-scroll / fade / visibility
   semantics exactly. Import `mark` from `$lib/perf/mark`.
7. **`Highlighter.svelte`** — line 39 becomes
   `const sourceMap = $derived(mark('sourcemap:build', () => buildSourceMap(raw)));`;
   add `incRender('Highlighter')` as the first statement in the `$effect` at line 63.
8. **`Markdown.svelte`** — add `incRender('Markdown')` as the first statement inside
   the `$effect` at line 72 (before `const rendered = html;`).
9. **`MessageRow.svelte`** — import `onMount` and `incRender`; add
   `onMount(() => incRender('MessageRow'))` (mount-churn signal for H1).
10. **`mark.test.ts`** — assert: `mark` returns fn's value & calls `sink.mark` with a
    non-negative ms when a sink is set; returns fn's value unchanged and never calls
    `performance.now()` (assert via a spy that throws) when no sink. `incRender` is a
    no-op without a sink and increments with one.
11. **`probe.test.ts`** — polyfill mocks (mirror `chat.svelte.test.ts:12` for rAF;
    stub `PerformanceObserver` + `performance.now` + `setInterval`/`clearInterval`
    via fake timers). Assert: (a) with flag global absent → no observer constructed,
    no rAF scheduled, no interval set, no console output; (b) with global present →
    observers attached, sink registered, and a manual summary tick emits the
    documented JSON with all 7 sections present.
12. **Manual smoke** — `pnpm build && pnpm preview`, open with `?perf=1`, confirm
    `[mayon-perf]` blocks appear every 3s; reload without the flag, confirm silence
    and that DevTools shows no `PerformanceObserver`/rAF from the probe.

## Validation gates (Phase 0)

- **V1 — Inert when off (behavioral, replaces doc's ±0.1KB gate):** with the flag
  absent, importing the probe registers zero `PerformanceObserver`, schedules zero
  rAF, sets zero intervals, prints nothing; `mark()` returns `fn()` without timing;
  `incRender` is a no-op. Asserted in `probe.test.ts` + `mark.test.ts`.
- **V2 — Active when on:** the documented 7-section JSON prints every 3s with all
  keys present. Asserted in `probe.test.ts`.
- **V3 — Suite green:** `pnpm lint && pnpm check && pnpm test` green; existing
  `render.test.ts` and `chat.svelte.test.ts` unaffected by the `mark` wrapping.
- **V4 — No new deps (informational bundle delta):** `package.json`/lockfile
  unchanged (grep for any added runtime dep — must be none). Record the prod gzip
  delta from `pnpm build` before/after (not gated at 0.1KB; just recorded for the
  record since the probe now ships to prod).
- **V5 — Removal path:** removing the *active* instrumentation = delete `probe.ts`,
  the `app.html` flag block, and the `+layout.svelte` import (3 changes); the
  `mark`/`incRender` call sites then become permanent harmless no-ops (sink stays
  null). Full removal of all traces = revert all 11 files.

## Risks

- **Mark closure allocation per call** (e.g. ~12 Hz `renderMarkdown`) even when the
  flag is off — trivial; accepted. Do not "optimize" by inlining `if (sink)` at call
  sites (spreads probe logic into app code).
- **Boot window gap:** a few ms of longtasks before `+layout.svelte`'s module init
  may be missed. Acceptable — the vast majority of boot is captured.
- **`event`/`longtask`/`layout-shift` `PerformanceObserver` support varies by
  browser** — every observer is feature-detected and try/caught so unsupported types
  degrade to "section omitted", never throw.
- **Svelte 5 `$derived` wrapping** (`sourceMap = $derived(mark(...))`) — `mark` must
  return the fn's value (it does) so reactivity is unchanged; verify expound tests
  stay green (`sourcemap.test.ts`, `wrap-range.test.ts`).
- **`flush()` wrapping** — must not alter scroll/stick-to-bottom timing semantics;
  re-run the manual scroll scenarios after editing.

## Out of scope / deferred

- **Phase 1** (data collection + hypothesis triage) and **Phase 2** (top-3
  remediations) are explicitly out of scope for this plan.
- The doc's remaining open questions — benchmark machine, and whether the ~12 Hz
  stream-flush feel is acceptable — are **Phase-1 interpretation** concerns and do
  not block Phase 0 implementation (the probe is adaptive; the 60 Hz bar is set).
- No changes to the markdown sanitize path, expound offset semantics, `LazyMount`,
  or the server package.
