# Smoothness Perf Phase 3 — Animation Polish

> Companion: `refinement/2026-07-20_smoothness-perf-program.md` (Phase 1 results).
> Phase 0 probe: `src/lib/perf/{probe,mark}.ts` (shipped). Phase 2 remediations: shipped.
> Scope: 4 tasks — unconditional accessibility win, low-risk compositing safety net,
> textarea audit, and a pre-existing scroll-bus dead-code fix.

## Context

Phase 1 ruled out H7 (animation jank): idle max frame time was 6.2 ms with spinners active,
so CSS keyframes are not a meaningful cost. Phase 3 was marked "conditional reserve — only
revisit if post-Phase-2 scroll p95 > 12 ms AND paint is residual." However, the principal
directed unconditional execution. Since we cannot re-measure, this phase is scoped to:
- Unconditional wins (accessibility compliance).
- Very low-risk perf safety nets (compositing hints).
- Code-level bug fixes identified by audit (not data-dependent).
- Exclusions where audit shows no issue exists.

---

## Task A — `prefers-reduced-motion` respect

### Problem

The app has a partial `prefers-reduced-motion` block at `app.css:423-431` that disables
spinner animations (`.mayon-spinner { animation: none !important }`). However, several
other motion effects are **not** covered:

1. **Keyframe definitions themselves are not gated** — `mayon-pulse-ring` (line 470) and
   `mayon-orbit-spin` (line 484) live outside the media query. The existing block disables
   them on `.mayon-spinner` elements via `animation: none !important`, which works because
   `Spinner.svelte:10,16` applies animations via inline `style`. But this is fragile — any
   future consumer of these keyframes would not be gated.

2. **`transition: opacity 0.15s` in Markdown.svelte** (lines 276, 318) — copy-button and
   focusable-button hover transitions. Not reduced under `prefers-reduced-motion`.

3. **`.tip::after` tooltip opacity transition** in `app.css:537` — `transition: opacity
   0.15s ease`. Not reduced.

4. **Tailwind `transition-opacity` classes** on fade indicators in
   `+page.svelte:709,715` already include `motion-reduce:transition-none` — these are already
   handled. No change needed there.

### Change

1. **Expand the existing `@media (prefers-reduced-motion: reduce)` block** in
   `app.css:423-431` to also cover:
   - `.md-copy-btn` — add `transition: none` (currently `transition: opacity 0.15s` at
     `Markdown.svelte:276`). Use `:global(.md-copy-btn)` inside Markdown.svelte's scoped
     style, adding a nested `@media (prefers-reduced-motion: reduce)` block.
   - `.md-focusable-btn` — same treatment (`Markdown.svelte:318`).
   - `.tip::after` — add `transition: none` (currently `transition: opacity 0.15s ease`
     at `app.css:537`). Add to the existing `app.css` media query block.

2. **Add `expound-flash` animation gating** — `expound-flash-bg` (app.css:499) and
   `expound-flash-bg-dark` (app.css:510) are flash animations on expounded text. Under
   reduced motion, these should be instant (jump to final state). Add
   `.expound-flash { animation-duration: 0s !important }` to the media query block.

No JS `matchMedia` listener is needed — this is a pure CSS media query change.

### Files

| File | Lines | Change |
| --- | --- | --- |
| `src/app.css` | 423–431 | Expand media query: add `.tip::after { transition: none }`, `.expound-flash { animation-duration: 0s !important }` |
| `src/lib/components/chat/Markdown.svelte` | 276 | Add nested `@media (prefers-reduced-motion: reduce) { :global(.md-copy-btn) { transition: none } }` after existing rule |
| `src/lib/components/chat/Markdown.svelte` | 318 | Add nested `@media (prefers-reduced-motion: reduce) { :global(.md-focusable-btn) { transition: none } }` after existing rule |

### Target metric

Accessibility compliance (unconditional). Perf: under `prefers-reduced-motion`, paint
time attributable to CSS transitions drops to zero (no 150 ms opacity interpolation).
Probe would show `paint:total` unchanged (transitions were already negligible at 6.2 ms
idle max), but motion-sensitive users get a correct experience.

### Risk

Minimal — CSS-only change inside an existing media query block. No JS, no behavior change
when motion is not reduced. Rollback = revert single commit.

### Test

- `pnpm lint && pnpm check && pnpm test` green (no JS change).
- Manual: toggle OS reduced-motion setting → verify spinners freeze, tooltips appear
  instantly, copy/focusable buttons appear instantly, expound flash is instant.
- No automated test needed (CSS media query; `matchMedia` not available in node vitest
  without full jsdom, and this is a visual/OS-level feature).

---

## Task B — Spinner composited layer hint

### Problem

`Spinner.svelte` renders `.mayon-spinner` elements with inline `style="animation: …"`
(orbit at line 16, pulse at line 10). When actively streaming, the orbit spinner is always
visible (`MessageList.svelte:85` — rendered inside `{#if streaming}` when `streamBuffer` is
truthy). The pulse spinner renders when `streamBuffer` is empty ("Thinking…" state).

Without `will-change: transform`, the browser may or may not promote these to their own
composited layers. Adding a scoped hint ensures the animation runs on the GPU compositor
thread without triggering main-thread paint on the surrounding content.

### Change

1. **Add `will-change: transform` to the animating elements only** — apply via a CSS class
   `.mayon-spinner` rule in `app.css` (inside the existing spinner styles area around
   line 423), but **outside** the `prefers-reduced-motion` block so it only applies when
   animation is active:
   ```css
   .mayon-spinner {
       will-change: transform;
   }
   @media (prefers-reduced-motion: reduce) {
       .mayon-spinner {
           animation: none !important;
           will-change: auto;   /* remove hint when animation is disabled */
       }
   }
   ```
   This replaces the current bare `animation: none !important` rule with the pair above.

2. **No change to Spinner.svelte** — the `will-change` applies via the existing
   `.mayon-spinner` class already on all spinner elements (lines 6, 9, 15 of
   Spinner.svelte).

### Files

| File | Lines | Change |
| --- | --- | --- |
| `src/app.css` | 423–431 | Add `will-change: transform` to `.mayon-spinner`; add `will-change: auto` inside reduced-motion override |

### Target metric

Paint isolation: spinner animation paint cost fully offloaded to compositor. On a
streaming chat, main-thread `paint:` counters should show no contribution from spinner
frames. Probe would show `paint:total` unchanged (already negligible at 6.2 ms idle max),
but this is a safety net against future layout changes that might cause compositing
breakdown.

### Risk

Very low. Two known caveats:
- `will-change: transform` consumes GPU memory for the promoted layer. Mitigated by:
  (a) spinners are tiny (16×16 px), (b) at most 2 spinners exist simultaneously (orbit +
  pulse are `{#if}`-gated, never both visible), (c) `will-change: auto` in reduced-motion
  reclaims the layer.
- Over-use causes "too many layers" regression. Mitigated by scoping to `.mayon-spinner`
  only — not applied broadly.

Rollback = revert single commit.

### Test

- `pnpm lint && pnpm check && pnpm test` green.
- Manual: open DevTools → Layers panel → stream a reply → confirm the spinner element
  has its own composited layer.
- No automated test (layer promotion is a browser rendering detail).

---

## Task C — Composer textarea auto-grow audit

### Problem

The master doc (line 331) suggested the textarea auto-grow might read `scrollHeight`
synchronously on every `input` event, causing forced reflow. Audit needed.

### Findings

`Composer.svelte:59-68` contains the auto-grow logic:

```svelte
$effect(() => {
    void prompt;
    const el = textareaEl;
    if (!el) return;
    if (!prompt) { el.style.height = ''; return; }
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_H) + 'px';
});
```

This is a **Svelte 5 `$effect`** (reactive to `prompt` state changes), **not** an `oninput`
event handler. It fires when `prompt` changes (i.e., on each keystroke or paste), but Svelte
5 batches state updates and runs effects after the microtask — it does **not** fire
synchronously inside the input event handler. The `scrollHeight` read happens inside the
effect's synchronous body, which is already deferred from the input event by at least one
microtask boundary.

Additionally, Svelte 5's `$effect` scheduler already uses `queueMicrotask` by default, so
multiple rapid `prompt` changes (e.g., fast typing) are batched into a single effect run.

**Verdict:** The textarea auto-grow is already coalesced via Svelte 5's reactive effect
system. No forced-reflow-in-input-handler bug exists. The Phase 1 probe's failure to
capture `inputLatency.pointermove` data is consistent with this — there was nothing to
measure.

### Change

None.

### Files

None.

### Test

None.

---

## Task D — scroll-bus window-vs-div bug fix

### Problem

`scroll-bus.ts` (21 lines) listens to `window` scroll events:
```ts
window.addEventListener('scroll', listener, { passive: true });  // line 12
```

But the chat viewport is a `<div bind:this={viewport}>` at `+page.svelte:677`:
```svelte
<div bind:this={viewport} class="h-full overflow-y-auto overflow-x-hidden p-4">
```

This `<div>` scroll events do **not** bubble to `window`. The only consumer of
`subscribeScroll` is `Highlighter.svelte:409-411`:
```svelte
$effect(() => {
    return subscribeScroll(onScrollClear);
});
```

where `onScrollClear` (line 172-174) sets `selectionToolbar = null` — dismissing the
expound selection toolbar when the user scrolls.

**Result:** The selection toolbar never auto-dismisses on scroll within the chat viewport.
It only dismisses if the user scrolls `window` (which requires the chat viewport to not be
full-height, or the page itself to scroll — unlikely in the chat layout).

### Change

1. **Generalize `scroll-bus.ts`** to accept an optional target element (defaulting to
   `window` for backward compat). When a target element is provided, listen on that
   element instead:

   ```ts
   let listener: (() => void) | null = null;
   const callbacks = new Set<() => void>();
   let activeTarget: EventTarget = window;

   function dispatch() {
       for (const cb of callbacks) cb();
   }

   export function subscribeScroll(
       cb: () => void,
       target?: HTMLElement
   ): () => void {
       if (target && target !== activeTarget) {
           // Teardown existing window listener if any
           if (listener) {
               activeTarget.removeEventListener('scroll', listener);
               listener = null;
           }
           activeTarget = target;
       }
       callbacks.add(cb);
       if (!listener) {
           listener = dispatch;
           activeTarget.addEventListener('scroll', listener, { passive: true });
       }
       return () => {
           callbacks.delete(cb);
           if (callbacks.size === 0 && listener) {
               activeTarget.removeEventListener('scroll', listener);
               listener = null;
               activeTarget = window;
           }
       };
   }
   ```

2. **Pass the viewport element in Highlighter.svelte** — `Highlighter.svelte` already has
   access to the chat container via `bind:this={container}` (line 417). However, the
   **scrollable ancestor** is the viewport `<div>` in `+page.svelte`, not the Highlighter's
   own container. The Highlighter is rendered inside the viewport. We need to find the
   closest scrollable ancestor.

   Simpler approach: have `+page.svelte` expose the viewport element (it's already bound as
   `let viewport = $state<HTMLDivElement | null>(null)` at line 78) and pass it down to
   Highlighter as a prop.

   Check how Highlighter is used in the template:

   Let me re-read this to verify.

   Actually — looking at the component hierarchy, `Highlighter.svelte` wraps the message
   content. The viewport `<div>` is an ancestor. The Highlighter can find it via
   `container.closest('.overflow-y-auto')` or we pass it as a prop.

   The cleanest approach: **find the scrollable ancestor at subscribe time**. In the
   `$effect` in Highlighter.svelte:409-411, `container` is already bound. Find the
   scrollable parent:

   ```svelte
   $effect(() => {
       const el = container;
       if (!el) return () => {};
       const scrollable = el.closest<HTMLElement>('.overflow-y-auto');
       return subscribeScroll(onScrollClear, scrollable ?? undefined);
   });
   ```

   This uses the existing `.overflow-y-auto` class on the viewport div
   (`+page.svelte:677`) to locate it. No prop threading needed.

### Files

| File | Lines | Change |
| --- | --- | --- |
| `src/lib/chat/scroll-bus.ts` | 1–21 | Rewrite: add optional `target` param to `subscribeScroll`, listen on target instead of window when provided, restore to window on full unsubscribe |
| `src/lib/components/chat/Highlighter.svelte` | 409–411 | Pass `container.closest('.overflow-y-auto')` as target to `subscribeScroll` |

### Target metric

**Functional fix** — not a perf metric. The selection toolbar now correctly dismisses when
the user scrolls within the chat viewport. This is a correctness/polish fix. No probe metric
changes expected (the bug caused missing dismisssal, not perf cost).

### Risk

Low. The change is localized to `scroll-bus.ts` (21 lines → ~35 lines) and one call site.
Key risks:
- If `container.closest('.overflow-y-auto')` returns the wrong element in edge cases (e.g.,
  nested scrollable containers). Mitigated: the chat viewport is the only `.overflow-y-auto`
  ancestor of Highlighter content in the chat layout.
- If other consumers of `subscribeScroll` exist. Grep shows only one consumer
  (Highlighter.svelte:410). No other call sites.

Rollback = revert single commit.

### Test

- `pnpm lint && pnpm check && pnpm test` green.
- Manual: open a chat → select text → right-click to open expound toolbar → scroll the
  chat viewport → confirm toolbar dismisses.
- No new automated test needed (the scroll-bus behavior requires a real DOM with a
  scrollable div; vitest node environment lacks this). The existing expound tests exercise
  selection but not scroll-dismissal.

---

## Validation protocol

1. `pnpm lint && pnpm check && pnpm test` green. `pnpm --filter @mayon/server test`
   untouched (server out of scope).
2. Manual reduced-motion check: enable OS "Reduce motion" → verify all animations freeze,
   transitions become instant, tooltips appear immediately, expound flash is instant.
3. Manual scroll-bus fix: open chat → trigger expound toolbar → scroll chat viewport →
   toolbar dismisses.
4. Manual spinner layer check: DevTools Layers panel during streaming → spinner has own
   composited layer.
5. Composer: type rapidly in the textarea → observe no jank or layout thrashing (already
   the case per audit, confirming no regression).

---

## Boundaries (do not violate)

- **No behavior change when the perf flag is off** (`localStorage.mayon_perf`).
  Production bundle delta ≤ 0.1 KB with flag off.
- **No new runtime dependencies.** CSS media queries, `will-change`,
  `closest()` — all platform APIs.
- **No changes to expound offset semantics** — `sourcemap.ts` → `selection.ts` →
  `wrap-range.ts` stays deterministic. Task D only changes toolbar dismissal, not offset
  resolution.
- **No virtual-list library.**
- **Server package out of scope.**
- **No removal of `rehypeSanitize`** in any fast path (AGENTS.md security invariant).
- **Vitest environment is `node`** (not jsdom) — no `matchMedia`, no `IntersectionObserver`
  in tests. New tests requiring browser APIs must polyfill following the pattern in
  `chat.svelte.test.ts:12-16` (rAF polyfill). Tasks A and B are CSS-only and need no
  new tests. Task C has no change. Task D needs no new test (scroll dismissal requires a
  real scrollable div).

---

## Out of scope (noted for future phases)

- **Composer textarea rAF coalescing (Task C audit):** audited and found no bug.
  `Composer.svelte:59-68` uses a Svelte 5 `$effect` which is already batched via
  microtask scheduling. No forced-reflow-in-input-handler exists.
- **Phase 4 guardrails:** regression tests for Phase 2 throttle/sentinel pattern + probe
  docs in AGENTS.md. Defer to Phase 4.
- **Phase 0 probe `incRender` placement bug** (`onMount` vs `$effect`): not addressed.
- **`inputLatency` surface:** Phase 1 probe did not capture pointer input latency. No data
  to drive composer-level perf work. Revisit if future Phase-1-style measurement captures
  it.
