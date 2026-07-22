# Smoothness Perf Phase 4 — Continuous Guardrails (Preventing Regression)

> Companion: `refinement/2026-07-20_smoothness-perf-program.md` (Phase 4 spec, lines 336–354).
> Phases 0–3 all shipped (uncommitted). This is the final phase.
> Scope: 5 tasks — probe documentation, 3 regression-guard tests, and a dev longtask warning.

## Context

Phases 2–3 remediated the top scroll-smoothness bottlenecks. Phase 2 replaced per-frame
layout reads (`updateVisibility` reading `scrollTop`/`clientHeight`/`scrollHeight` every frame)
with IntersectionObserver sentinels in `+page.svelte:161-184`. Phase 2 also widened
LazyMount `rootMargin` to `1200px` in `MessageList.svelte:64` and added an LRU source-map
cache. Phase 3 added `prefers-reduced-motion`, `will-change: transform` on spinners, and
fixed the scroll-bus window-vs-div bug.

Phase 4 locks these gains in with regression-guard tests and documents the perf probe for
future use.

### Confirmed current state (from codebase research)

- **`updateVisibility` is fully removed.** Zero grep hits in `src/`. Confirmed gone.
- **IntersectionObserver sentinels** are at `+page.svelte:161-184` (the `$effect` that creates
  an IO with `root: el`, observes `topSentinel` and `bottomSentinel`). The old `onScroll`
  listener and `updateVisibility()` call inside `flush()` are removed. `flush()` only
  handles `pendingForceScroll` + `pendingFadeHeights` now.
- **LazyMount `rootMargin="1200px"`** at `MessageList.svelte:64`.
- **`incRender('MessageRow')`** is in `onMount` at `MessageRow.svelte:79` — counts mounts,
  not re-renders. This is the correct metric for mount-churn (Phase 2 plan explicitly chose
  to keep mount-counting semantics).
- **`startRenderFlush`** throttle at `chat.svelte.ts:122-136`. `RENDER_INTERVAL_MS = 80`.
- **Existing H2 throttle test** at `chat.svelte.test.ts:1086-1163` (`describe('chatStore rAF
  stream throttle (UJ13)')`). See Task D analysis below.
- **Dev self-check** runs in `+layout.svelte:32`: `if (import.meta.env.DEV) void runSelfCheck()`.
  The `DbStatus` badge at `DbStatus.svelte` consumes `dbStatus.selfCheck`.
- **Probe module** at `src/lib/perf/probe.ts`. Auto-starts only when `window.__MAYON_PERF__ === 1`
  (line 287-293). Exposes `_startProbe()` and `_resetProbe()` for tests. Already has a
  `longtask` PerformanceObserver (lines 158-177) that buckets into 50-100/100-250/250+ ms
  ranges. No public API for reading longtask entries externally — the data only flows into
  the 3-second summary log.

---

## Task A — Probe documentation in AGENTS.md

**Problem:** The perf probe (`src/lib/perf/probe.ts`) is shipped but undocumented. Agents and
developers need to know how to enable it, what it measures, and where the code lives.

**Change:** Add a new `## Perf debugging` section in `AGENTS.md` between the `## Architecture
boundaries (do not violate)` section (line 38) and the `## Manual acceptance gates (P-pg-2)`
section (line 55). Insert at line 54 (after the architecture boundaries block ends).

Content:

```markdown
## Perf debugging

The perf probe (`src/lib/perf/{probe,mark}.ts`) is an opt-in dev tool that measures
frame timing, longtasks, layout shifts, input latency, custom marks, and render counts.
It emits a JSON summary to the console every 3 seconds via `[mayon-perf]`.

**Enable:** set `window.__MAYON_PERF__ = 1` in the browser console before or after page load.
**Scenario tag:** set `localStorage.mayon_perf_scenario = 'idle-scroll'` (or any label) to tag
summary output. The probe imports at `+layout.svelte:6` but is inert without the flag.
```

**Files:**

| File | Lines | Change |
| --- | --- | --- |
| `AGENTS.md` | After line 54 | Insert `## Perf debugging` section (6 lines) |

**Risk:** None (documentation only).

**Test:** `pnpm lint` (Prettier passes on markdown). No functional test.

---

## Task B — H4 regression guard test (IntersectionObserver sentinels)

**Problem:** Phase 2 Task C replaced per-frame `updateVisibility` (forced layout reads every
scroll frame) with IntersectionObserver sentinels. If someone re-introduces per-frame layout
reads in the scroll path, scroll smoothness regresses silently. We need a test that fails
if the old pattern returns.

**Change:** Create a new test file `src/routes/chat/[id]/+page.visibility.test.ts` that:
1. Polyfills `IntersectionObserver` (since Vitest runs in `node` env — no IO available).
   Use `vi.stubGlobal` following the rAF polyfill pattern from `chat.svelte.test.ts:12-16`.
2. Imports and mounts the chat page's visibility logic by importing the module and
   exercising the sentinel setup path.
3. Asserts that **no `scrollTop`, `clientHeight`, or `scrollHeight` reads occur during
   simulated scroll** — i.e. the old `updateVisibility` pattern is absent.

### Concrete approach

The test cannot fully mount the Svelte component (that requires a DOM). Instead, it performs
a **code-level structural guard**: import the page module and assert that:
- `IntersectionObserver` is referenced in the module (sentinel pattern present).
- The string `updateVisibility` does NOT appear in the module source.

This is a lightweight grep-style guard that catches revert/regression. Full behavioral
testing of the IO callback would require jsdom + `@testing-library/svelte`, which this repo
does not use (Vitest `node` env, no jsdom).

**Files:**

| File | Lines | Change |
| --- | --- | --- |
| `src/routes/chat/[id]/+page.visibility.test.ts` (new) | — | Structural guard: assert IO present, `updateVisibility` absent, `scrollTop`/`clientHeight`/`scrollHeight` not read in any `$effect` tied to scroll |

### Polyfill notes

- `IntersectionObserver`: use `vi.stubGlobal('IntersectionObserver', vi.fn())` to ensure the
  module can import without crash. The test does not need IO to actually fire — it only needs
  to verify the code structure.
- `requestAnimationFrame` / `cancelAnimationFrame`: already polyfilled by
  `chat.svelte.test.ts:12-16` pattern. Replicate in this test file.

### Test assertions

```ts
import fs from 'node:fs';
import path from 'node:path';

describe('H4 guard: IntersectionObserver sentinels (no per-frame layout reads)', () => {
    it('page module uses IntersectionObserver and has no updateVisibility', async () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '+page.svelte'), 'utf-8'
        );
        expect(source).toContain('IntersectionObserver');
        expect(source).not.toContain('updateVisibility');
    });

    it('scrollTop/clientHeight/scrollHeight reads are not in any scroll-tied effect', async () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '+page.svelte'), 'utf-8'
        );
        // The force-scroll effect at line 107 reads scrollTop + scrollHeight,
        // but that's gated by ResizeObserver (content-change), not scroll events.
        // Verify there is no onScroll listener.
        expect(source).not.toContain('onScroll');
    });
});
```

**Risk:** Low. Structural guard — reads source file at test time. If the file is renamed,
the path resolution breaks (easy fix). Rollback = delete test file.

---

## Task C — H1 regression guard test (MessageRow mount-count stability)

**Problem:** Phase 2 Task B widened LazyMount `rootMargin` to `1200px` to reduce mount churn.
If someone reverts this to a smaller value or removes `rootMargin`, mount frequency
regresses. We need a test that locks in mount-counting semantics.

**Change:** Create a new test file `src/lib/components/chat/MessageRow.mount.test.ts` that:
1. Imports `MessageRow.svelte` source.
2. Asserts that `incRender('MessageRow')` is called inside `onMount` (line 79) — confirming
   mount-counting semantics are in place.
3. Asserts that `MessageList.svelte` passes `rootMargin="1200px"` to `LazyMount`.

### Concrete approach

Like Task B, this is a **structural guard** reading source files, since mounting Svelte
components requires a DOM. The assertions are:

```ts
import fs from 'node:fs';
import path from 'node:path';

describe('H1 guard: MessageRow mount-counting + LazyMount rootMargin', () => {
    it('incRender(MessageRow) is in onMount (mount-counting, not re-render-counting)', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, 'MessageRow.svelte'), 'utf-8'
        );
        expect(source).toContain("onMount(() => incRender('MessageRow')");
    });

    it('MessageList passes rootMargin="1200px" to LazyMount', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, 'MessageList.svelte'), 'utf-8'
        );
        expect(source).toContain('rootMargin="1200px"');
    });
});
```

### Why mount-counting (not re-render counting)?

The Phase 2 plan (line 231-233) explicitly chose to keep `incRender` in `onMount` because:
- Mount-counting is the correct metric for the LazyMount rootMargin task (Task B).
- Moving `incRender` to a `$effect` would change what the number means and invalidate the
  Phase 1 baseline comparison.
- The probe's `renders.MessageRow` intentionally measures mount churn, not re-renders.

The Phase 4 guard locks in this design decision: `onMount` placement stays.

**Files:**

| File | Lines | Change |
| --- | --- | --- |
| `src/lib/components/chat/MessageRow.mount.test.ts` (new) | — | Structural guard: `onMount` placement, `rootMargin="1200px"` |

**Risk:** Low. Same structural-guard pattern as Task B. Rollback = delete test file.

---

## Task D — H2 guard consolidation (stream throttle)

**Problem:** The master doc asks for an H2 guard asserting that `startRenderFlush` does not
assign `streamBufferRender` when the throttle hasn't elapsed. There is already an existing
test at `chat.svelte.test.ts:1086-1163` (`describe('chatStore rAF stream throttle (UJ13)')`).

### Assessment of the existing test

The existing test (`chat.svelte.test.ts:1087-1130`, first case) does the following:
1. Starts a streaming turn, captures `updateStreamBuffer`.
2. Calls `capturedUpdate!('a')`, `capturedUpdate!('ab')`, `capturedUpdate!('abc')` in rapid
   succession (no timer advance).
3. Asserts `chatStore.streamBuffer` is `'abc'` (the latest value) but
   `chatStore.streamBufferRender` is `''` (throttled — not yet flushed).
4. Waits 90 ms (one `setTimeout(r, 90)`).
5. Asserts `chatStore.streamBufferRender` is now `'abc'` (flushed after throttle elapsed).

This **does** assert the no-op-tick invariant: step 3 proves that multiple rapid buffer
updates within the throttle window do NOT propagate to `streamBufferRender`. The throttle is
80 ms; no timer was advanced between updates, so all rAF ticks would have `now - last < 80`
and skip the assignment.

**The existing test is a sufficient H2 guard.** It directly tests the invariant that
`streamBufferRender` lags behind `streamBuffer` until the throttle window elapses.

**Change:** No new test. Add a comment to the existing `describe` block referencing it as
the H2 regression guard:

```ts
// H2 regression guard (Phase 4): asserts streamBufferRender does not update
// until the RENDER_INTERVAL_MS (80 ms) throttle has elapsed. Prevents removal
// or weakening of the rAF throttle in startRenderFlush.
describe('chatStore rAF stream throttle (UJ13)', () => {
```

**Files:**

| File | Lines | Change |
| --- | --- | --- |
| `src/lib/stores/chat.svelte.test.ts` | 1086 | Add comment before `describe` referencing H2 guard role |

**Risk:** None (comment only).

---

## Task E — Dev longtask warning in self-check

**Problem:** Phase 4 spec (line 351-353) asks to wire a `longtask` observer into the dev
self-check badge so boot-time longtasks > 200 ms surface a non-blocking `console.warn`.

**Current state:** The probe module (`probe.ts:158-177`) already has a `longtask`
PerformanceObserver, but it's gated behind the `__MAYON_PERF__` flag and only reports via
3-second summary logs. It does not expose individual entries or fire warnings. The self-check
(`self-check.ts`) is a DB-only write/read/delete check called from `+layout.svelte:32`.

**Change:** Add a new module `src/lib/perf/longtask-warn.ts` that:
1. In dev mode only (`import.meta.env.DEV`), creates a standalone `PerformanceObserver` for
   `longtask` entries.
2. On each entry with `duration > 200`, emits `console.warn('[mayon-perf] Boot longtask:
   {duration.toFixed(0)} ms — possible regression. Enable the perf probe
   (`window.__MAYON_PERF__ = 1`) for details.')`.
3. Disconnects after 10 seconds (no need to monitor longtasks forever — boot regressions are
   the target). This avoids runtime cost in long sessions.

Wire it into `+layout.svelte` alongside the existing self-check call:

```ts
// +layout.svelte:32, after runSelfCheck():
if (import.meta.env.DEV) import('$lib/perf/longtask-warn');
```

Using dynamic `import()` ensures the module is only loaded in dev and doesn't add to the
production bundle. The module self-initializes on import (side-effect import).

### Module implementation

```ts
// src/lib/perf/longtask-warn.ts
// Dev-only: warns on boot-time longtasks > 200 ms.
// Auto-disconnects after 10 s to avoid runtime cost.

if (import.meta.env.DEV && typeof PerformanceObserver !== 'undefined') {
    const THRESHOLD_MS = 200;
    const OBSERVE_DURATION_MS = 10_000;

    let warned = false;
    try {
        if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > THRESHOLD_MS) {
                        console.warn(
                            `[mayon-perf] Longtask ${entry.duration.toFixed(0)} ms — ` +
                            'possible regression. Enable the perf probe ' +
                            '(window.__MAYON_PERF__ = 1) for details.'
                        );
                        warned = true;
                    }
                }
            });
            po.observe({ type: 'longtask', buffered: true });
            setTimeout(() => {
                po.disconnect();
                if (!warned) {
                    // Silent — no longtasks observed during boot window.
                }
            }, OBSERVE_DURATION_MS);
        }
    } catch {
        /* longtask not supported */
    }
}
```

### Files

| File | Lines | Change |
| --- | --- | --- |
| `src/lib/perf/longtask-warn.ts` (new) | — | Dev-only longtask observer with 200 ms threshold, 10 s window |
| `src/routes/+layout.svelte` | 32 | Add `if (import.meta.env.DEV) import('$lib/perf/longtask-warn');` after self-check |

**Risk:** Very low.
- Dev-only via `import.meta.env.DEV` gate + dynamic import.
- Non-blocking (`console.warn` only).
- Auto-disconnects after 10 s.
- Zero production footprint (dynamic `import()` is tree-shaken; the condition is `false` in
  production).
- Rollback = delete the new file and remove the import line.

**Test:** No automated test needed — `PerformanceObserver` is not available in Vitest `node`
env, and the module is a side-effect import gated on `import.meta.env.DEV`. Manual
verification: in dev, open console, look for the warning on boot. No warning in production.

---

## Validation protocol

1. `pnpm lint && pnpm check && pnpm test` green. `pnpm --filter @mayon/server test` green.
2. New guard tests (Tasks B, C) pass against the current codebase.
3. Manual: in dev, open console → no spurious warnings from `longtask-warn.ts` during normal
   boot. The module initializes and disconnects silently if no longtasks > 200 ms occur.
4. Manual: in dev, set `window.__MAYON_PERF__ = 1` → probe starts and emits summary logs →
   the new AGENTS.md instructions are accurate.
5. Grep verification: `rg updateVisibility src/` returns 0 hits (confirming the guard test's
   assertion matches reality).

---

## Boundaries (do not violate)

- **No behavior change when the perf flag is off.** The probe remains inert without
  `window.__MAYON_PERF__ = 1`. The longtask warning is dev-only (`import.meta.env.DEV`).
  Production bundle delta from Task E: 0 bytes (dynamic import + dev gate tree-shaken).
- **No new runtime dependencies.** `IntersectionObserver`, `PerformanceObserver` — all
  platform APIs. Test polyfills via `vi.stubGlobal` (no new packages).
- **No changes to expound offset semantics** — `sourcemap.ts` → `selection.ts` →
  `wrap-range.ts` untouched.
- **No removal of `rehypeSanitize`** or any security changes.
- **Server package out of scope.**
- **Vitest `node` environment** — browser APIs need polyfilling in tests. Follow the pattern
  at `chat.svelte.test.ts:12-16` for rAF. Tasks B and C use source-file structural guards
  (no DOM needed).

---

## Out of scope

- **True re-render counting for MessageRow:** `incRender` stays in `onMount` (mount-counting).
  Re-render counting would require `$effect` placement and is not needed for the guard.
- **jsdom / @testing-library/svelte:** this repo uses Vitest `node` env. Structural source
  guards are the appropriate testing strategy.
- **PerformanceObserver polyfill in tests:** the longtask warning (Task E) is not unit-tested
  because `PerformanceObserver` is unavailable in node. It's a dev-only side-effect module.
- **Probe summary format changes:** the probe's output format is frozen. No changes to the
  `[mayon-perf]` JSON structure.
- **CI integration:** these guard tests run in `pnpm test` but are not wired to CI quality
  gates beyond the existing `pnpm test` step.
