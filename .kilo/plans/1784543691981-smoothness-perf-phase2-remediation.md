# Smoothness Perf Phase 2 — Top-3 Remediations

> Companion: `refinement/2026-07-20_smoothness-perf-program.md` (Phase 1 results).
> Phase 0 probe: `src/lib/perf/{probe,mark}.ts` (shipped). Phase 1: data collected, GO.
> Scope: 3 tasks, each targeting a measured Phase-1 metric. Each must show improvement
> on probe re-run or be reverted. Ship order = risk order (lowest first).

## Context — why the draft's Phase 2 was revised

The refinement doc drafted 3 tasks. Code review against the actual source found two of
the three premises were wrong. This plan reflects the corrected direction (approved):

1. **Draft Task 1 (throttle `layout:flush` to 16ms) was a no-op.** `+page.svelte:146-153`
   already coalesces via a `pending` flag — `flush()` runs exactly once per frame
   (measured 57–66 Hz = browser scroll-event rate). A 16ms timer changes nothing. The
   real H4 cost is the **forced layout reads** inside `updateVisibility()` (`scrollTop` +
   `clientHeight` + `scrollHeight` every frame, `+page.svelte:100-107`) and
   `updateFadeHeights()` (`offsetHeight`). **Reframed to IntersectionObserver sentinels**
   that track visibility without per-frame layout reads.

2. **Draft Task 2 (isolate scroll state from MessageList) targeted a non-problem.** The
   H1 evidence was `renders.MessageRow` during scroll, but `incRender('MessageRow')` is
   in `onMount` (`MessageRow.svelte:79`), not a `$effect` as the Phase 0 spec required —
   so it counts **mounts** (LazyMount `unmountFar` boundary crossings), not re-renders.
   No scroll state flows into MessageList (`visibleMessages` is a stable memoized
   `$derived`), so there is no re-render churn. **Reframed to widen LazyMount rootMargin**
   (reduces mount frequency) + the cache in Task 1 reduces mount cost.

3. **Draft Task 3 (memoize buildSourceMap) is sound** — kept with an LRU bound.

> Probe note for validation: `renders.MessageRow.n` counts mounts (via `onMount`). This
> is the **correct** metric for the mount-churn task. Do not "fix" the placement to
> `$effect` before Phase 2 validation — it would change what the number means.

---

## Task A — LRU cache for `buildSourceMap` (H3, mount cost) — ship first

**Problem:** `Highlighter.svelte:40` computes `sourceMap = $derived(buildSourceMap(raw))`,
running the full unified/remark pipeline (parse + gfm + math + rehype + admonition)
synchronously on every mount. `LazyMount unmountFar` remounts re-fire it on scroll-back.
Phase 1 measured `sourcemap:build` at 4–5 ms/remount + 1 longtask (50–100 ms) during
`expound-remount`.

**Change:** Add a module-level LRU cache inside `buildSourceMap` in `sourcemap.ts`.

- Key: the raw input string (identity). Same content on remount → cache hit → ~0 ms.
- Bound: 64 entries (LRU via `Map` insertion order: `delete` + `set` on hit moves to end;
  `keys().next().value` evicts oldest at capacity).
- Export `_clearSourceMapCache()` (matches the existing `_testPlugins` convention at
  `sourcemap.ts:58`) so tests can reset between cases if needed.

**Files:**
- `src/lib/markdown/sourcemap.ts:244` — wrap `buildSourceMap` body with cache lookup/insert.
- `src/lib/markdown/sourcemap.test.ts` — add 2 tests: (1) same input returns same
  `SourceMap` reference (cache hit); (2) 65 distinct inputs evict the oldest. Call
  `_clearSourceMapCache()` in `beforeEach` to keep existing 16 tests deterministic.

**Out of scope:** `requestIdleCallback` deferral (draft mentioned it). With the cache,
remount is a ~0 ms hit, so deferral adds complexity (disabled-expound loading state) for
no gain. First-ever mount (cache miss) stays synchronous — needed to enable expound.

**Target metric (re-run `expound-remount`):** `sourcemap:build.maxMs` < 1 ms and
`totalMs` ≈ 0 on the second scroll-back through unchanged rows. `longtask` count = 0.
(Note: `sourcemap:build.n` may stay > 0 because the function is still *called* — the
cache is inside it. The cost metric is `maxMs`/`totalMs`, not `n`.)

**Risk:** Low. Pure memoization; output is referentially identical. Existing
`sourcemap.test.ts` + `selection.test.ts` (27 `buildSourceMap` calls across both) stay
green. Rollback = revert single commit.

---

## Task B — Widen LazyMount `rootMargin` (mount frequency) — ship second

**Problem:** `MessageList.svelte:64` renders `<LazyMount unmountFar>` with the default
`rootMargin='400px'` (`LazyMount.svelte:19`). During scroll, rows within 400 px of the
viewport stay mounted; anything beyond unmounts. Phase 1 measured 4–12 mounts/3s during
scroll (each triggering Task A's `buildSourceMap` + full Highlighter re-instantiation).

**Change:** Pass `rootMargin="1200px"` on the LazyMount in MessageList.

**Files:**
- `src/lib/components/chat/MessageList.svelte:64` — `<LazyMount unmountFar rootMargin="1200px">`.

**Tradeoff:** More DOM nodes mounted simultaneously (rows within ~1200 px above/below
the viewport stay alive). For typical chats (< 200 messages) this is negligible memory.
The mount-cost drop from Task A makes each mounted row cheaper regardless.

**Target metric (re-run `idle-long-chat`):** `renders.MessageRow.n` drops from ~4/3s
to ~0/3s during slow/medium scroll. (Fast scroll past 1200 px still remounts — that is
expected and acceptable.)

**Risk:** Low. One-line prop change. If memory becomes a concern on very large chats,
revert to a smaller margin (e.g. 800 px). Rollback = revert single commit.

---

## Task C — IntersectionObserver sentinels for scroll visibility (H4) — ship last

**Problem:** `updateVisibility()` (`+page.svelte:100-107`) runs inside every `flush()`,
reading `el.scrollTop` + `el.clientHeight` + `el.scrollHeight` every scroll frame
(~57–66 Hz). These force synchronous layout on a large DOM. `updateFadeHeights()` also
reads `offsetHeight`. Phase 1: p50 frame time 6.1 → 17.8 ms during scroll; `layout:flush`
170–199/3s. Frame time recovers to 6.1 ms the instant scrolling stops.

**Change:** Replace per-frame `updateVisibility()` with IntersectionObserver-driven
sentinels. Visibility state (`topVisible` / `bottomVisible` / `stickToBottom`) updates
only on boundary crossings, not every frame.

### Sentinel placement (inside the scroll container)

```svelte
<div bind:this={viewport} class="h-full overflow-y-auto overflow-x-hidden p-4">
    <div bind:this={topSentinel} class="h-0 -mt-4"></div>
    <MessageList ... />
    <div bind:this={bottomSentinel} class="h-0"></div>
</div>
```

- `topSentinel`: 0-height element as the first child of the viewport (positioned above
  all content). `-mt-4` pulls it above the viewport padding so "at top" is accurate.
- `bottomSentinel`: 0-height element as the last child (after all content + padding).

### New `$effect` (replaces the onScroll + updateVisibility path)

```js
$effect(() => {
    const el = viewport;
    const top = topSentinel;
    const bottom = bottomSentinel;
    if (!el || !top || !bottom) return;
    const io = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.target === top) {
                    topVisible = !entry.isIntersecting;   // scrolled away from top → show top fade
                } else if (entry.target === bottom) {
                    const atBottom = entry.isIntersecting;
                    stickToBottom = atBottom;
                    bottomVisible = !atBottom;            // not at bottom → show bottom fade
                }
            }
        },
        { root: el, threshold: 0 }
    );
    io.observe(top);
    io.observe(bottom);
    return () => io.disconnect();
});
```

### What gets removed / simplified in the existing flush `$effect` (`+page.svelte:117-174`)

- **Remove** the `onScroll` listener (line 155, 165) — it only fed `updateVisibility`.
- **Remove** the `updateVisibility()` call from `flush()` (line 143).
- **Remove or delete** the `updateVisibility` function (lines 100-107).
- **Keep** `flush()` / `schedule()` / rAF for `pendingForceScroll` + `pendingFadeHeights`
  — these are already rare (resize / content-growth only, not scroll).
- **Keep** `updateFadeHeights()` (reads `topPane.offsetHeight`/`bottomPane.offsetHeight`
  on resize, gated by `pendingFadeHeights`).
- **Keep** the initial `schedule({ forceScroll: true, fadeHeights: true })` at setup
  (line 167) for the initial scroll-to-bottom.
- **Keep** the force-scroll-to-bottom `$effect` (lines 109-115) unchanged — it depends on
  `chatStore.messages.length` + `stickToBottom` + `scrolledToHash`; `stickToBottom` now
  comes from the IntersectionObserver instead of per-frame `updateVisibility`.

### Behavioral equivalence notes

- IntersectionObserver fires its initial callback async after layout, so `stickToBottom`
  is set correctly on chat load (after the initial force-scroll via `schedule`).
- The 1-frame lag between user-scroll-up and `stickToBottom` flipping to false is
  equivalent to the current rAF-delayed `updateVisibility` — no regression.
- `handleHashScroll` / `flashExpoundMark` are unaffected — sentinels track the resulting
  position correctly; `scrolledToHash` still disables force-scroll.
- The 2 px tolerance in the old `atBottom` check is dropped (0-height sentinel at
  `threshold: 0` is close enough). If exact tolerance is desired, use
  `rootMargin: '0px 0px -2px 0px'` on the observer — optional, noted for the implementer.

**Files:** `src/routes/chat/[id]/+page.svelte` only (sentinels + effect rewrite, lines
~82-174 + template ~667-695).

**Target metrics (re-run `idle-long-chat` + `stream-and-scroll`):**
- `layout:flush.n` during pure scroll drops from ~170/3s to ≈ 0/3s (flush only fires on
  resize/content-growth now).
- p95 frame time during scroll ≤ 10 ms (from ~21 ms). p50 ≤ 8 ms (from ~18 ms).
- Dropped frames ≤ 2/3s (from 2).
- No visible scroll-snap regression during `stream-long-reply` (stick-to-bottom still
  tracks streaming content growth).

**Risk:** Highest of the three (touches scroll/visibility logic). Key risk is
stick-to-bottom failing during streaming if the sentinel/observer wiring is wrong.
Manual acceptance: stream a long reply, confirm the viewport sticks to bottom; scroll up
mid-stream, confirm it stops sticking; scroll back to bottom, confirm it resumes.
Rollback = revert single commit.

---

## Validation protocol (after all three land)

1. Re-run **all 5 Phase-1 scenarios** (`idle-short-chat`, `idle-long-chat`,
   `stream-long-reply`, `stream-and-scroll`, `expound-remount`) with the probe on.
2. Compare per-scenario metrics to the Phase-1 baseline table. Every target metric above
   must improve; no scenario may regress on p95 or dropped frames.
3. Manual expound suite (Phase-1 #5): open long chat → scroll far enough that rows
   unmount → scroll back → trigger expound on a remounted row → confirm offset
   resolution + underline rendering are correct (source-map semantics unchanged).
4. `pnpm lint && pnpm check && pnpm test` green. `pnpm --filter @mayon/server test`
   untouched (server out of scope).

Any task that does not move its target metric on re-measure is **reverted** — no
"it probably helps" commits (refinement doc acceptance gate, line 308).

---

## Boundaries (do not violate)

- **No behavior change when the perf flag is off** (`localStorage.mayon_perf`).
  Production bundle delta ≤ 0.1 KB with flag off.
- **No new runtime dependencies.** IntersectionObserver, Map LRU — all platform APIs.
- **No changes to expound offset semantics** — `sourcemap.ts` → `selection.ts` →
  `wrap-range.ts` stays deterministic. The cache returns a referentially-identical
  `SourceMap`; offset math is unchanged. Existing expound tests + manual remount-expound
  scenario must pass.
- **No virtual-list library.** Extend the existing `LazyMount` pattern only (Task B).
- **Server package out of scope.**
- **No removal of `rehypeSanitize`** in any fast path (AGENTS.md security invariant).

## Out of scope (noted for future phases)

- **Phase 0 probe `incRender` placement bug** (`onMount` vs `$effect`): leave as-is for
  Phase 2 (mount-counting is what Task B validates). Revisit in Phase 4 guardrails if
  true re-render counting is needed.
- **`scroll-bus.ts` listens to `window` scroll but the chat scroller is a `<div>`** —
  `Highlighter.svelte:410` `subscribeScroll` → `onScrollClear` never fires for chat
  viewport scroll. Pre-existing bug; not addressed here.
- **Phase 3 (animation polish):** Phase 1 ruled out H7 (idle max frame 6.2 ms with
  spinners). Only revisit if post-Phase-2 scroll p95 still > 12 ms AND paint (not
  layout) is the residual cost.
- **Phase 4 (guardrails):** regression tests for the throttle/sentinel pattern + probe
  docs in AGENTS.md. Defer until Phase 2 metrics are green.
