# Smoothness & Performance Program

> Status: **Phase 1 complete → Phase 2 scoped** · Author: principal FE review · 2026-07-20
> Companion to `.kilo/plans/1784523974526-scroll-smoothness.md` (now shipped).

## Why we are starting over with measurement

The prior scroll-smoothness plan shipped all five of its candidates verbatim:

| Candidate | Status | Evidence |
| --- | --- | --- |
| A. Cheap live render (`renderMarkdownLive`, no `rehype-highlight`) | ✅ shipped | `render.ts:76-101`, `Markdown.svelte:22` |
| B. rAF-coalesced layout flush | ✅ shipped | `chat/[id]/+page.svelte:116-150` |
| C. Off-screen unmount + measured spacers | ✅ shipped | `LazyMount.svelte` (`unmountFar`, `measuredHeight`) |
| D. Single window-scroll bus | ✅ shipped | `src/lib/chat/scroll-bus.ts`, consumed at `Highlighter.svelte:408` |
| E. `RENDER_INTERVAL_MS=80` stream throttle (~12 Hz) | ✅ shipped | `chat.svelte.ts:122-136` |

**The app still felt janky.** Session `ses_0820e2b6…` measured the render loop at
**10–15 Hz** on a 144 Hz display after the above landed. That number is suspiciously
close to the *intentional* 12 Hz stream-flush cap, which means we likely conflated
"stream render rate" with "scroll paint rate" and have **no idea** where the real
budget is going. Everything we fixed was a *guess*.

There is **zero perf instrumentation** in the codebase today (grepped:
`PerformanceObserver|longtask|mark\(|measureUserAgent` → 0 hits in `src/`, 2 stray
`performance.now()` calls). That is the root problem. A principal eng program does
not optimize blind twice.

**This plan's invariant: no remediation lands without a measurement that proves it
is a top-3 cost.** Revert-ready, gated, data-driven.

---

## Hypothesis bank (ranked, with cheap distinguishers)

Each hypothesis has a one-line experiment that can confirm or rule it out from the
Phase-1 probe output. Ranked by prior probability given the codebase read.

| # | Hypothesis | Why plausible | Cheap distinguisher |
| --- | --- | --- | --- |
| **H1** | **`{#each}` keyed re-render churn** — `MessageList.svelte:62` rebuilds `visibleMessages` via `.filter` on every store tick; during streaming `streamBufferRender` updates ~12 Hz but also touches `messages.length` deps, so Svelte re-diffs the whole list each tick | `visibleMessages = $derived(messages.filter(...))` allocates a new array each run; `.length` is read in a stick-to-bottom `$effect` (`+page.svelte:109`) | Probe A + per-row mount counter. If rows re-mount or re-diff while idle, this is it. |
| **H2** | **rAF saturation by the stream tick** — `startRenderFlush` (`chat.svelte.ts:124`) schedules rAF *forever* while streaming and assigns `streamBufferRender` unconditionally inside the callback, even when the buffer did not change; combined with the markdown `$derived` this forces a markdown pipeline run each rAF regardless of `RENDER_INTERVAL_MS` | The throttle gates the *assignment*, not the *rAF itself*; the callback still runs at 144 Hz doing `performance.now()` + branch | Probe B: count rAF fires vs. actual flushes during a 10s stream. Ratio >> 1 ⇒ H2. |
| **H3** | **Long-task sources outside the chat** — large `buildSourceMap` per assistant row (`Highlighter.svelte:38`, runs on every finalized message mount), Mermaid SVG post-processing, KaTeX re-render | All run synchronously on mount; `LazyMount unmountFar` remounts fire them on scroll-back | Probe C: `longtask` entries with duration + attribution; group by stack. |
| **H4** | **Forced reflows in `updateVisibility`** — `+page.svelte:99-106` reads `scrollTop` + `clientHeight` + `scrollHeight` every coalesced frame; already coalesced but still inside rAF, and `updateFadeHeights` reads `offsetHeight` | Pre-existing; coalescing reduced but did not eliminate cost | Probe D: layout-thrash counter (read-after-write patterns). |
| **H5** | **CSS paint cost on large DOM** — even off-screen-unmounted, a 100-message chat keeps ~30+ rows mounted with `rootMargin=400px`; `prose` typography + KaTeX spans paint expensively | No `content-visibility: auto` anywhere (grepped); no `will-change` on scrollers | Probe E: paint duration via `PerformanceObserver({ type:'paint' })` + layer count. |
| **H6** | **Input latency from synchronous store reads** — Svelte 5 runes deep-track; `$derived` over `messages` may recompute large subtrees | Speculative; only worth pursuing if H1–H3 are clear | Probe A: per-component render count. |
| **H7** | **Animation jank** — spinner keyframes (`mayon-orbit-spin`, `mayon-pulse-ring` in `app.css:470-488`) run on CPU-transform; multiple concurrent orbit spinners during streaming could compete | Only 1–2 spinners active normally; low probability | Probe F: animation frame time with/without spinner. |

> **Non-goals** (out of scope unless Phase 2+ data says otherwise): replacing
> Svelte's reactivity, swapping the markdown pipeline, virtual-list windowing
> beyond the current `LazyMount` pattern, server-side changes, network/RPS work.

---

## Phase 0 — Instrumentation scaffolding (no user-visible change)

**Deliverable:** a dev-only perf probe module that self-mounts in `app.html` (or a
dev-only `+layout.svelte` guard), exposes a structured console summary every 3 s,
and can be toggled via `localStorage.mayon_perf = '1'` or `?perf=1`.

This is the script the user runs during Phase 1. It must be:
- **Removable in one commit** (single feature flag, no behavior change when off).
- **Self-contained** (no new deps; uses `PerformanceObserver`, `performance.now`,
  rAF — all available in the browser).
- **Copy-paste friendly:** prints a compact JSON block every 3 s that the user can
  select-all from the console and paste to the implementing agent.

### Probe surfaces (all live behind the flag)

1. **FPS / frame-time histogram.** rAF loop measures `now - last`, keeps a ring
   buffer (last 180 frames ≈ 3 s @ 60 Hz), reports `count`, `avgMs`, `p50Ms`,
   `p95Ms`, `p99Ms`, `maxMs`, and `droppedFrames` (delta > `1.5 × expected`,
   where `expected` is derived from the median).
2. **`longtask` observer.** `new PerformanceObserver(... 'longtask')`; bucketed by
   duration (50–100ms, 100–250ms, 250ms+) and, where `attribution` is available
   (LongTask V2), the script URL.
3. **`layout-shift` observer** (CLS-ish). Reports cumulative shift + count per
   3 s window; useful for H4 and for the "unmount spacer" regressions in C.
4. **`event` observer for `pointermove`/`wheel`.** Reports input-to-frame latency
   (`processingStart - startTime`) on scroll/pointer events; this is the literal
   "does it feel smooth" number.
5. **Scoped marks** (opt-in, wrapped helpers):
   - `mark('markdown:render', fn)` around both `renderMarkdown`/`renderMarkdownLive`.
   - `mark('layout:flush', fn)` around the coalesced `flush()` in `+page.svelte`.
   - `mark('sourcemap:build', fn)` around `buildSourceMap`.
   - These are wired by editing the 3 call sites in Phase 0 (tiny diff) and
     report `count` + `totalMs` + `maxMs` per summary tick.
6. **Render-count probe** (Svelte `$effect` inspector): in dev, a tiny helper
   `incRender(label)` called from the top of `MessageRow`/`Markdown`/`Highlighter`
   `$effect` bodies. Reports per-label counts per 3 s tick. This directly tests H1.

### Output format (what the user pastes back)

```
[mayon-perf] t=6.0s
{"fps":{"n":360,"avgMs":8.2,"p50":6.9,"p95":18.1,"p99":34.0,"max":51.2,"dropped":12},
 "longtask":{"50-100":3,"100-250":1,"250+":0,"topAttribution":"render.ts:90"},
 "cls":{"score":0.04,"entries":2},
 "inputLatency":{"wheel":{"n":42,"p50Ms":3.1,"p95Ms":9.4},"pointermove":{"n":18,"p50Ms":4.0}},
 "marks":{"markdown:render":{"n":12,"totalMs":84,"maxMs":14},"layout:flush":{"n":60,"totalMs":31,"maxMs":2.1}},
 "renders":{"MessageRow":{"n":0},"Markdown":{"n":12},"Highlighter":{"n":0}},
 "scenario":"idle-scroll-long-chat"}
```

The `scenario` tag is set by the user via `localStorage.mayon_perf_scenario = '…'`
before each run so we can keep runs straight.

### Files touched in Phase 0

- **new** `src/lib/perf/probe.ts` — all six surfaces, flag-gated, zero-op when off.
- **new** `src/lib/perf/mark.ts` — `mark(label, fn)` + `incRender(label)` helpers
  (no-op when flag off).
- **edit** `src/app.html` — inject probe bootstrap `<script>` guarded by the flag
  (reads `localStorage` / querystring before app load so we capture boot).
- **edit** `src/lib/markdown/render.ts:90,99` — wrap both `processSync` calls with
  `mark('markdown:render', …)`.
- **edit** `src/routes/chat/[id]/+page.svelte:129` — wrap `flush()` body with
  `mark('layout:flush', …)`.
- **edit** `src/lib/components/chat/Highlighter.svelte:38` — wrap `buildSourceMap`
  with `mark('sourcemap:build', …)`.
- **edit** `src/lib/components/chat/{MessageRow,Markdown,Highlighter}.svelte` — add
  one `incRender('Label')` at the top of the first `$effect`.

**Acceptance for Phase 0:** `pnpm lint && pnpm check && pnpm test` green; with the
flag off, the app is byte-identical (assert via a snapshot of the production bundle
size ±0.1 KB). No new runtime deps.

---

## Phase 1 — Data collection (user-driven, paste-back loop)

**This is where the user comes in.** No code changes land in Phase 1; we only
collect data and triage the hypothesis bank.

### Run protocol

For each scenario below: set the scenario tag, reproduce the action for ~15 s,
copy the last **5 summary blocks** (≈15 s) from the console, and paste into a
single message to the implementing agent.

```
localStorage.mayon_perf = '1'
localStorage.mayon_perf_scenario = '<scenario-name>'
location.reload()
```

### Scenarios (run all five if time permits; the first three are the minimum)

1. **`idle-short-chat`** — small finalized chat (~5 messages), do nothing. Baseline.
   Tells us the idle floor.
2. **`idle-long-chat`** — finalized chat with 80+ messages. Slowly scroll up and
   down for 15 s. Tests H5, H4, and the `LazyMount` spacer math.
3. **`stream-long-reply`** — trigger a reply that streams for ~15 s with code
   blocks. Do **not** scroll. Tests H1, H2, H3 (markdown pipeline frequency).
4. **`stream-and-scroll`** — during a stream, scroll up and back down. Tests the
   interaction between `RENDER_INTERVAL_MS` and scroll paint (H2 vs H4
   interaction).
5. **`expound-remount`** — open a long chat, scroll far enough that rows unmount,
   scroll back, trigger an expound. Tests H3 (`buildSourceMap` on remount) and the
   expound source-map self-heal.

Also useful (optional): **`mermaid-heavy`** (chat with ≥3 Mermaid diagrams) and
**`theme-toggle`** (rapid light/dark flips, to stress paint).

### What the implementing agent does with the paste

- Bucket each scenario's numbers into a table (one row per 3 s tick).
- Re-rank the hypothesis bank by which metrics lit up:
  - High `renders.Markdown` while idle → **H1** confirmed.
  - `marks.markdown:render.n` ≫ stream flush count → **H2** confirmed (rAF running
    pipeline on no-op ticks).
  - `longtask` clusters on `render.ts` or `Highlighter.svelte` → **H3** confirmed.
  - High `inputLatency.wheel.p95` with low `longtask` → **H4/H5** (many small
    reflows, not single long tasks).
- Produce a short Phase-2 proposal naming the top-3 costs with evidence, and
  *only those three* become remediation tasks.

**Phase 1 exit criterion:** a ranked, evidenced shortlist. If the data shows the
app is already smooth (p95 frame time < 1.5× refresh interval, < 2 longtasks / 15 s),
we **stop** and document that the prior "10–15 Hz" reading was the stream-flush
throttle misread as scroll fps — no remediation warranted.

---

## Phase 1 — Results & hypothesis triage

> Raw probe output: `data.log` (5 scenarios, ~35 summary ticks).
> Run: 2026-07-20. Display: high-refresh (idle baseline ≈ 164 fps / 6.1 ms avg).

### Go / no-go: **GO**

The app is smooth at idle (~164 fps) and during pure streaming (p95 ≈ 12 ms). It
is **not smooth during scrolling**: p50 frame time triples from 6.1 ms to 17.8 ms
in `idle-long-chat`, exceeding the 60 Hz budget (16.7 ms). The prior "10–15 Hz"
reading was the **scroll paint rate**, not the stream-flush throttle. Remediation
warranted.

### Per-scenario summary (worst tick shown)

| Scenario | fps avg ms | p50 ms | p95 ms | dropped | layout:flush /3s | md:render /3s | MessageRow /3s | longtask |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `idle-short-chat` (idle) | 6.1 | 6.1 | 6.1 | 0 | 0 | 0 | 0 | 0 |
| `idle-long-chat` (scroll) | 17.5 | 17.8 | 21.4 | 2 | **171** | 2 | 4 | 0 |
| `stream-long-reply` (no scroll) | 11.0 | 12.1 | 12.2 | 5 | 4 | 2 | 0 | 0 |
| `stream-and-scroll` | 16.4 | 18.1 | 18.4 | 2 | **162** | 4 | 3 | 0 |
| `expound-remount` (burst) | 14.9 | 12.2 | 18.3 | 6 | **199** | 6 | 12 | **1 (50–100 ms)** |

**Key signal:** `layout:flush` fires once per scroll frame (~170/3 s ≈ 57 Hz) and
is the single dominant cost during any scroll interaction. `markdown:render` stays
low (2–6/3 s) everywhere — the stream throttle is working as designed. The only
longtask observed was a single 50–100 ms event during the `expound-remount`
remount burst. Frame time recovers to 6.1 ms the instant scrolling stops.

### Hypothesis verdicts

| # | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| **H4** | Forced reflows in `updateVisibility` | **CONFIRMED — #1 cost** | `layout:flush` fires every scroll frame (170–199/3 s). Frame time triples during scroll. Each call reads `scrollTop` + `clientHeight` + `scrollHeight` + `offsetHeight`. |
| **H1** | `{#each}` keyed re-render churn | **CONFIRMED — #2 cost** | `MessageRow` re-renders 2–13/3 s during scroll with no message changes. Scroll-state writes (`topVisible`/`bottomVisible`/`stickToBottom`) propagate through the `{#each}` dependency graph. Zero renders at idle ⇒ trigger is scroll state, not store ticks. |
| **H3** | Long-task sources on mount | **MILDLY CONFIRMED — #3 cost** | 1 longtask (50–100 ms) + `sourcemap:build` at 4–5 ms during `expound-remount`. Burst-only, not steady-state. |
| H2 | rAF saturation by stream tick | **Not primary** | `markdown:render` fires 2–3×/3 s during streaming (≈1/s), consistent with `RENDER_INTERVAL_MS`. No evidence of rAF running the pipeline on no-op ticks. Kept as a Phase-4 guardrail regardless. |
| H5 | CSS paint cost | Unlikely | p95 during scroll (21 ms) modestly exceeds what layout:flush alone accounts for, but no paint observer data. Deprioritized — revisit only if H4/H1 fixes don't recover the full budget. |
| H6 | Input latency from store reads | Inconclusive | `inputLatency` surface reported no data in any run (probe may not have captured scroll events). |
| H7 | Animation jank | **Ruled out** | Idle max frame = 6.2 ms. Spinners are not the issue. Phase 3 deprioritized. |

---

## Phase 2 — Top-3 remediations (data-selected)

Three tasks, ranked by evidence weight. Each targets a measured Phase-1 metric
and must show improvement on re-run or be reverted.

### Task 1 — Throttle scroll-driven `layout:flush` to one paint frame

- **Hypothesis:** H4 (forced reflows in `updateVisibility`)
- **Evidence:** `layout:flush` fires 170–199×/3 s during scroll (≈57 Hz); p50
  frame time 6.1 → 17.8 ms. `+page.svelte:155` `onScroll` calls `schedule()` on
  every scroll event, and `schedule()` requests a new rAF as soon as the previous
  flush clears `pending`.
- **Target metric:** `layout:flush.n` ≤ 60/3 s during `idle-long-chat` scroll;
  p95 frame time ≤ 10 ms; dropped frames ≤ 5/3 s.
- **Change:** Throttle `schedule()` so at most one `flush()` runs per ~16 ms
  window. After `flush()` clears `pending`, record `lastFlushTime`; in
  `schedule()`, if `performance.now() - lastFlushTime < 16`, defer via a short
  timer rather than requesting rAF immediately. Alternatively, keep a `dirty`
  flag set by `onScroll` and cleared by `flush()` so consecutive scroll events
  within the same frame coalesce into a single rAF.
  - **Files:** `src/routes/chat/[id]/+page.svelte:130-155`.
- **Risk:** Up to 1-frame lag in stick-to-bottom / fade-height detection. Must
  verify no visible snapping during `stream-long-reply`. Rollback = revert
  single commit.
- **Test:** Re-run `idle-long-chat` + `stream-and-scroll`; assert flush count
  and p95 targets met. Manual replay confirms no scroll snap.

### Task 2 — Isolate scroll state from the message-list render path

- **Hypothesis:** H1 (`{#each}` keyed re-render churn)
- **Evidence:** `MessageRow` re-renders 2–13×/3 s during scroll with zero message
  changes; 0 at idle. `visibleMessages = $derived(messages.filter(...))`
  (`MessageList.svelte:54`) re-allocates on parent state propagation; the
  stick-to-bottom `$effect` (`+page.svelte:110`) depends on `messages.length`.
- **Target metric:** `renders.MessageRow.n` = 0 during `idle-long-chat` scroll
  (non-streaming); `renders.Markdown.n` = 0 during scroll.
- **Change:**
  1. Move `topVisible`/`bottomVisible`/`stickToBottom` out of the component scope
     that wraps `MessageList`, or into a standalone store, so scroll writes don't
     invalidate the `{#each}` block.
  2. Change the stick-to-bottom `$effect` to depend on a stable `lastMessageId`
     (e.g. `messages[messages.length - 1]?.id`) instead of `messages.length`, so
     appending a message triggers it but scroll-driven reactivity does not.
  - **Files:** `src/routes/chat/[id]/+page.svelte:100-115`,
    `src/lib/components/chat/MessageList.svelte:54,62`.
- **Risk:** Refactoring the state boundary around the message list could break
  prop drilling or fade-gradient visibility. Verify `onExpound`/`onCopy`
  callbacks and fade UI still work. Rollback = revert single commit.
- **Test:** Re-run `idle-long-chat`; assert `MessageRow.n` = 0. Re-run
  `stream-long-reply`; assert renders only for the streaming row. Full expound
  test suite stays green.

### Task 3 — Memoize `buildSourceMap` and defer to idle on remount

- **Hypothesis:** H3 (long-task sources on mount)
- **Evidence:** `expound-remount` t=3.7: 1 longtask (50–100 ms),
  `sourcemap:build` 4–5 ms per remount. `Highlighter.svelte:38` calls
  `buildSourceMap` synchronously on mount; `LazyMount unmountFar` remounts
  re-fire it on scroll-back.
- **Target metric:** `sourcemap:build.n` = 0 on second scroll-back through
  unchanged rows; longtask count = 0 during `expound-remount`.
- **Change:** Add a module-level cache (e.g. `Map<string, SourceMap>` keyed on
  raw content hash) in `sourcemap.ts`. On mount, check cache; if miss, schedule
  via `requestIdleCallback` (fallback `setTimeout(…, 0)`) so the build doesn't
  block the scroll frame. Disable the expound affordance until the map resolves.
  - **Files:** `src/lib/components/chat/Highlighter.svelte:38`,
    `src/lib/markdown/sourcemap.ts`.
- **Risk:** If the user clicks expound before the map is ready, the menu must be
  disabled or show a loading state. The expound offset semantics
  (`sourcemap.ts` → `selection.ts` → `wrap-range.ts`) must not change — only
  *when* the map is computed. Rollback = revert single commit.
- **Test:** Re-run `expound-remount`; assert `sourcemap:build.n` = 0 on cached
  pass. Existing expound tests stay green; manual remount-expound scenario
  (Phase-1 #5) still works end-to-end.

### Acceptance for Phase 2

Each task lands with (a) the Phase-1 metric it targets printed in its PR
description, (b) a re-run of the same scenario after the fix showing the metric
improved, and (c) `pnpm lint && pnpm check && pnpm test` green. Any task that
does not move its target metric on re-measure is **reverted** — no "it probably
helps" commits. After all three land, re-run all five Phase-1 scenarios to
confirm no regression.

---

## Phase 3 — Animation polish (only if Phase 2 leaves residual jank)

**Phase 1 ruled out H7 (animation jank):** idle max frame time was 6.2 ms with
spinners active, so the CSS keyframes (`mayon-orbit-spin`, `mayon-pulse-ring`)
are not a meaningful cost. This phase is now **unlikely to be needed** at all.
Keep it as a conditional reserve — only revisit if post-Phase-2 scroll p95 still
exceeds ~12 ms *and* paint (not layout) is the residual cost (H5 territory).

Candidates, in priority order, all gated on Phase-2 data:
1. **`prefers-reduced-motion` respect** — currently unimplemented; add a media
   query that collapses `mayon-orbit-spin`, `mayon-pulse-ring`, and the two
   `transition: opacity .15s` rules to instant. Cheap accessibility + perf win.
2. **Spinner compositing** — ensure orbit/pulse spinners sit on their own
   composited layer (`will-change: transform` scoped to the spinner element only,
   removed when not animating) so they don't trigger main-thread paint on a
   streaming chat.
3. **Composer grow** — if `inputLatency.pointermove` is high while typing, audit
   the textarea auto-grow for sync layout reads (likely a `scrollHeight` read on
   every `input` event); rAF-coalesce.

---

## Phase 4 — Continuous guardrails (preventing regression)

After Phases 2–3 land and metrics are green:
1. Keep the probe module but downgrade it to an opt-in dev tool, documented in
   `AGENTS.md` under a new "Perf debugging" section.
2. Add **two** Vitest perf-budget tests (not benchmarks, regression guards):
   - **H4 guard:** assert that `schedule()` in `+page.svelte` does not request a
     new rAF when the last flush was < 16 ms ago (locks in the Task-1 throttle).
     Use `fake timers` + a rAF polyfill.
   - **H1 guard:** assert that `MessageRow` does not re-render when only scroll
     state (`topVisible`/`bottomVisible`/`stickToBottom`) changes (locks in the
     Task-2 state isolation).
   - Keep the pre-existing H2 guard as well: assert `startRenderFlush` does not
     schedule rAF when `streamBuffer === streamBufferRender` (locks in the
     existing throttle — H2 was not a top-3 cost but the guard is cheap).
3. Wire `longtask` observer into the dev self-check badge (the one already used
   for the DB health check in P0): if a boot-time longtask > 200 ms is observed
   in dev, surface a non-blocking console warning. Catches regressions early.

---

## Boundaries (do not violate)

- **No behavior change when the perf flag is off.** The probe is observability,
  not a feature. Production bundle delta ≤ 0.1 KB with flag off.
- **No new runtime dependencies.** Everything uses platform APIs already
  available in the browser.
- **No removal of the markdown sanitization path** (`rehypeSanitize`) in any
  "fast path" — security invariant from AGENTS.md.
- **No changes to expound offset semantics** — source-map → DOM mapping
  (`sourcemap.ts`, `selection.ts`, `wrap-range.ts`) stays deterministic; if any
  Phase-2 task touches `buildSourceMap`, the existing expound tests must stay
  green and the manual remount-expound scenario (Phase-1 #5) must pass.
- **No virtual-list library.** Extend the existing `LazyMount` pattern only.
- **Server package is out of scope** unless Phase-1 data shows the bottleneck is
  network/streaming backpressure (unlikely; `longtask` is main-thread only).

---

## Validation gates (per phase)

| Phase | Gate |
| --- | --- |
| 0 | ✅ Flag-on probe runs without errors; flag-off bundle is byte-identical (±0.1 KB); `pnpm lint && pnpm check && pnpm test` green. |
| 1 | ✅ User pastes ≥3 scenarios; ranked hypothesis shortlist produced; explicit go/no-go decision documented. (5 scenarios run; GO decision — see Phase 1 Results.) |
| 2 | Each of the ≤3 remediation tasks shows target-metric improvement on re-run; full green suite; manual replays of the 5 Phase-1 scenarios show no regressions. |
| 3 | `prefers-reduced-motion` confirmed (DevTools → Rendering → emulate); spinner compositing verified via Layers panel. |
| 4 | Regression-guard tests fail on deliberate reintroduction of the H4 (flush-per-scroll-event) and H1 (scroll-state re-render) anti-patterns; probe documented in `AGENTS.md`. |

---

## Open questions for the user (answer before Phase 0 starts)

1. **Target refresh rate?** 60 Hz is the safe budget; 120/144 Hz is aspirational.
   Confirm we are optimizing for 60 Hz p95 < 16.7 ms as the bar, with 120 Hz as a
   stretch goal. *(Affects the "dropped frame" threshold in the probe.)*
2. **Are there known slow client environments** (e.g. a low-end laptop you test on)
   that we should use as the benchmark machine, or is your dev machine the
   reference? *(Affects which scenario numbers count as "regression".)*
3. **Is the live-stream render rate (currently ~12 Hz via `RENDER_INTERVAL_MS=80`)
   acceptable to you as a feel, or do you want the stream to feel faster even at
   the cost of more markdown runs?** *(If you want faster streaming, H2's fix
   becomes higher priority regardless of Phase-1 data.)*
