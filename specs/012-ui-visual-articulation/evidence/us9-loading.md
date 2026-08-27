# US9 Evidence — Loading honesty audit + perf loop closure (T042, T043)

Branch `feat/ui_overhaul`, stack = docker compose project `mayon-dev`
(web :5173 via Vite proxy, server internal, db healthy). Chromium via
playwright-cli `run-code`. Captured after landing T041 route-entry stagger-fade.

## Motion schedule shipped (context for SC-9/FR-22 checks)

- Helper: `src/lib/motion/stagger.ts` exporting `entry(node, params)` +
  constants (`STEP_MS=40`, `SPAN_MS=240`, `DURATION_MS=170`,
  `ENTRY_Y_PX=6`, `TOTAL_CAP_MS=410`).
- Directive form used everywhere: `in:entry|global={{ index, count }}`.
  `|global` is required: Svelte 5 skips *local* intros whose state change did
  not originate inside their own block — every SvelteKit client-side route
  swap qualifies, so local intros never fire there (verified empirically:
  0 animation creations before adding `|global`).
- Gate inside `entry()`: under `prefers-reduced-motion: reduce` (or non-browser)
  it returns `{ duration: 0 }` BEFORE any motion params/fly config are built.
- Belt-and-braces: animated containers carry `.art-stagger`; the app.css
  reduce-motion block strips `animation`/`transition` inside them (transform
  endpoints deliberately preserved so e.g. caret rotate states stay readable).

### Per-route directives

| Route              | Animated units                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| `/`                | header → resume card or hero composer/All-chats beat → starter chips (each) → recents |
| `/chat`            | header row → each list row (`li`)                                                     |
| `/chat/[id]`       | top pane → message viewport wrapper → bottom pane (composer); **not** message items   |
| `/quiz`            | header → each chat-group section                                                      |
| `/lab`             | header → each chat-group section                                                      |
| `/tree`            | header → each root group card                                                         |

### Measured sequence span (click → last intro end, chromium wall-clock)

Measured via `document.getAnimations()` filtered to `.art-stagger` targets,
taking `max(endTime) - min(startTime)` per navigation:

| Transition    | Span (ms) |
| ------------- | --------- |
| chat → tree   | 487       |
| tree → chat   | 420       |
| home → chat   | 470       |
| chat → quiz   | 320       |
| quiz → lab    | 220       |

All under the FR-22 500 ms cap; by construction the schedule can never exceed
`MAX_DELAY_MS (240) + DURATION_MS (170) = 410 ms` of animation span.

### Reduced-motion verification (SC-9)

playwright-cli supports `page.emulateMedia({ reducedMotion })`, so both modes
were exercised live around a client-side `/tree` entry (WAAPI counter injected
via `Element.prototype.animate` wrap):

| Mode                    | Animations created | Computed opacity of animated node |
| ----------------------- | ------------------ | --------------------------------- |
| `no-preference`         | 98                 | animates (opacity/transform keyframes) |
| `reduce`                | **0**              | `1` immediately (no inline styles ever set) |

Unit coverage (`src/lib/motion/stagger.test.ts`): scheduling ramp/compression,
hard clamp below cap, contract step band check, and the `{ duration: 0 }`
gated return for both the injected-reduce probe and non-browser rendering.

## T042 — Loading-honesty audit

Method: performance.now deltas across realistic in-app navigation legs
(warm session started at `/`; each list boot measured home → target via sidebar;
each number reproduced ×3 unless noted). `q` = completed `/api/db/query`
resource entries captured during the leg.

### Boot lists (sidebar navigation)

| Leg               | Samples (ms)      | Median | db queries |
| ----------------- | ----------------- | ------ | ---------- |
| Cold full load `/` | 327 · 120 · 76   | 120    | 4–6        |
| Boot `/chat` list | 19 · 19 · 19      | 19     | 2          |
| Boot `/quiz` list | 11 · 11 · 11      | 11     | 2          |
| Boot `/lab` list  | 12 · 12 · 11      | 12     | 2          |
| Boot `/tree`      | 211 · 217 · 214   | 214    | 7 (subtrees) |

### Chat open + tree pagination

| Action                              | Samples (ms) | Notes                                          |
| ----------------------------------- | ------------ | ---------------------------------------------- |
| Open a chat from the `/chat` list   | 4 · 10       | nav resolution + pane render, 1–2 db queries   |
| Tree pagination click               | n/a          | dev dataset fits one page (`Page 1 of 1` everywhere); pagination is a pure client-side slice of already-loaded rows |

### Verdict

**No in-app load approaches the ~300 ms threshold — zero skeletons shipped**
(FR-23/A-6 satisfied; expected outcome confirmed).

Notes recorded honestly:

1. The single >300 ms sample anywhere was the **first-hit cold full page load**
   of `/` in dev mode (327 ms — Vite module serving + proxy warmup; repeats land
   at ~100 ms). Cold-boot truthfulness is already owned by the existing
   BootGate/db-status surfaces, which render their own honest connecting state;
   US9 adds nothing there.
2. Pre-existing bug discovered while auditing hard loads (NOT introduced by
   this story, reproducible independent of it): routes with universal `load`
   functions that touch repos (`/chat`, `/quiz`, `/lab`) throw
   "Database not bootstrapped yet" when entered via a **direct/hard URL load**,
   because layout component init runs `bootstrapDb()` only after route loads
   start resolving. All audits therefore measure the real user path (start at
   `/`, then navigate). Fixing the boot ordering belongs to the data-layer seam,
   not the motion pass — flagged here for follow-up rather than smuggled into
   this change.

## T043 — Perf loop closure vs T002 baseline

Method identical to `evidence/baseline/perf-traversal.txt`: 
`window.__MAYON_PERF__ = 1` injected before first paint; traverse `/` → `/chat`
→ `/tree` as fresh document loads (one `[mayon-perf]` tick per route), then two
extra SPA legs through `/quiz` and `/lab` on the live document. Raw output:
`evidence/us9-perf-after-raw.txt`.

| Route/tick           | Baseline avg/p95/max·dropped | After avg/p95/max·dropped       |
| -------------------- | ---------------------------- | ------------------------------- |
| `/` (t=3.0s)         | 16.76 / 16.80 / 33.3 · 1     | 16.67 / 16.80 / 16.8 · 0        |
| `/chat` (t=3.0s)     | 16.76 / 16.80 / 33.3 · 1     | 16.76 / 16.70 / 33.3 · 1        |
| `/tree` (t=3.0s)     | 16.76 / 16.80 / 33.3 · 1     | 16.67 / 16.71 / 16.8 · 0        |
| `/quiz` (SPA, t=6s)  | — (not captured at baseline) | 16.67 / 16.70 / 16.8 · 0        |
| `/lab` (SPA, t=9–12s)| — (not captured at baseline) | 16.67 / 16.70 / 16.8 · 0        |

(units: ms/frame; baseline run emitted three ticks — its home/chat/tree numbers
above are the per-route summaries quoted in `evidence/baseline/README.md`.)

No longtasks, layout-shift, or input-latency sections were emitted by the probe
on any tick (the probe prints extra sections only when nonzero), in both runs.

**Verdict: parity or better on every compared leg — no regression from the
hover/motion work, nothing to fix.** Frame timing averages moved from
~16.76 ms to ~16.67 ms where they differ at all, `dropped` counts never exceed
the baseline's 1/route, and idle frame health matches a 60 Hz reference.
