# Quickstart: Section Peek Strip — Validation Guide

**Feature**: specs/017-section-peek-strip | **Date**: 2026-09-02

Runnable scenarios proving the feature end-to-end. Implementation detail lives in
[tasks.md](./tasks.md) (after `/speckit.tasks`); design detail lives in
[contracts/section-strip.md](./contracts/section-strip.md) and
[data-model.md](./data-model.md).

## Prerequisites

- Node 22 (`.nvmrc`), pnpm 10, Docker or Podman (`MAYON_DEV_ENGINE`).
- A chat whose assistant replies can be made long and header-structured (ask the
  model for a long markdown document with many `##` sections — 5+ sections, several
  screens tall — plus keep a short reply around for the negative case).

## Setup

```bash
pnpm install
pnpm dev                 # all-Docker dev stack; web on http://localhost:5173
# after changing shared packages or deps: pnpm dev:build && pnpm dev
```

## Gates (must be green before merge, in this order)

```bash
pnpm check                           # svelte-check
pnpm lint                            # ESLint + Prettier
pnpm test                            # Vitest (pglite driver)
```

New tests expected from this feature: `src/lib/markdown/sections.test.ts`,
`src/lib/chat/strip/dwell.test.ts`, `src/lib/chat/strip/pref.test.ts`,
`src/lib/chat/strip/registry.test.ts`, extended `src/lib/chat/selection.test.ts`,
and source-contract tests for the gutter component / AssistantMessage integration
(patterns: `scroll-spy.test.ts`, `selection.test.ts`,
`AssistantMessage.actions.test.ts`, `visibility-sentinel.test.ts`).

## Scenario 1 — Glanceable tick gutter + jump (US1, P1)

1. Open a chat, get a reply with ≥3 headings that is taller than the transcript
   viewport. **Expect**: a slim gutter outside the chat area — immediately right of
   the scrollbar — holding one thin horizontal tick per section, left-aligned at the
   chat border, widths visibly proportional, ticks vertically beside their sections;
   no content displaced or overlaid; the reply column is narrowed only by the gutter.
2. Get a short reply (or one with <3 headings). **Expect**: no ticks for it at all.
3. Scroll the transcript. **Expect**: the ticks stay glued to their sections
   (scroll-synced) — a tick always points at the content beside it.
4. Hover the gutter. **Expect**: ticks brighten; pausing on a tick extends it a
   tiny bit to the right; the conversation does not shift.
5. Click the tick for a middle section. **Expect**: smooth scroll within the
   transcript; that heading lands at the top of the viewport and flashes briefly;
   viewport is not yanked back to the bottom even while a new reply streams.
6. In a conversation with two long replies, jump within the *older* reply. **Expect**
   landing on the correct reply's section; both replies' tick columns coexist in the
   gutter without colliding.
7. For a reply with two identical section titles, click the second one's tick.
   **Expect**: viewport lands on the second occurrence.

## Scenario 2 — Dwell preview (US2, P2)

1. Hover a tick and hold ~half a second. **Expect**: a floating preview window
   appears anchored outside the chat area at that tick (never inside the reply
   content), showing the section's heading and opening lines as plain text (no raw
   `#`/`**` syntax).
2. Sweep the pointer across the gutter without stopping. **Expect**: no preview fires.
3. Open a preview, then move the pointer away. **Expect**: preview dismisses
   immediately.
4. Click the open preview. **Expect**: same jump as Scenario 1.5.
5. Regenerate the reply (or send a follow-up that changes sections). **Expect**: after
   the new reply completes, previews show the *new* sections' text — never the
   previous version's.

## Scenario 3 — Setting toggle (US3, P3)

1. Open `/settings`, find the section-strip toggle. **Expect**: it reflects the
   current state (default on).
2. Toggle off, return to the chat. **Expect**: every tick gone immediately — no
   ticks, hover affordances, or previews — and the gutter reservation released
   (reply column regains its pre-feature width).
3. Reload the page (or restart the dev stack). **Expect**: strip stays off —
   preference persisted.
4. Toggle back on. **Expect**: the gutter is reserved again and ticks reappear on
   qualifying replies, jumps work.

## Scenario 4 — Touch fallback (FR-012)

On a touch device (or DevTools touch emulation with a coarse pointer):

1. Open a qualifying reply. **Expect**: ticks present (hairlines).
2. Tap a tick. **Expect**: direct jump to that section — no dwell, no preview.

## Scenario 5 — No regressions (FR-013, FR-014, FR-016)

1. With ticks visible on a reply: select text inside the reply body, run
   expound/highlight on the selection, copy it. **Expect**: selection and highlight
   land on exactly the same source text as on a reply without ticks; copy is
   correct. Selecting preview text must never produce a misaligned highlight.
2. Wheel-scroll / drag the scrollbar with the pointer over the gutter.
   **Expect**: the transcript scrolls normally; the gutter never captures the gesture.
3. Enable OS "reduce motion", click a tick. **Expect**: instant (non-animated) jump
   to the same landing position with the same flash emphasis.
4. While a reply is streaming: **Expect** no ticks for the live tail at any point;
   ticks appear once the reply completes.

## Performance validation (Constitution IV)

```bash
# in the browser console, before interacting:
window.__MAYON_PERF__ = 1
localStorage.mayon_perf_scenario = 'section-strip'
```

- Exercise Scenarios 1–2 for ~30 s, then read the `[mayon-perf]` summary:
  **Expect** no longtask spikes on strip hover/dwell, no layout-shift accumulation
  from the strip, and `strip:extract` marks present with sub-millisecond timings on
  repeat renders (memoized). Compare against a pre-feature run on `main` if in doubt —
  unmeasured claims don't count.

## Where to look when something fails

| Symptom | First suspects (contracts) |
|---|---|
| Jump misses / does nothing on far replies | rAF retry ≤5 (`LazyMount`), nth-heading anchoring — contracts §7 |
| Viewport yanks back to bottom after a jump | stick-suppression flag not set — contracts §7 |
| Selection/expound misaligns near the strip | missing selector in `EXCLUDED_CHROME_SELECTORS` — contracts §8 |
| Preview fires while brushing past | dwell transition edge — contracts §3 + `dwell.test.ts` |
| Ticks drift out of alignment while scrolling | anchor invalidation missing (bump/viewport RO) — contracts §5 |
| Ticks at the wrong offset after content above grows | recompute-all not triggered on member `bump` — contracts §5 |
| Gutter steals the scroll gesture | wheel relay missing/broken (must `scrollBy` the viewport) — contracts §5 + §10.2 |
| Strip jitters during streaming | live-tail gate leaking — contracts §6 rule 4 |
| Toggle not persisting | sole-writer module bypassed / defensive read — contracts §2 |
