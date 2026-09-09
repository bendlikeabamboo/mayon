# Contract: Growth-edge overlay (`src/lib/components/chat/GrowthEdge.svelte`)

Live-row-only presentation component. It paints the "growing edge" visual (soft blur/fade for Expressive, plain caret for Calm) over the in-flight reply. It must be invisible to every downstream consumer of the message DOM.

## Props

```svelte
{
  /** Visual variant; derived from the streaming preset. */
  variant: 'blur-fade' | 'caret';
  /** The rendered live markdown string (same value AssistantMessage renders),
   *  observed to re-measure the edge on each flush. */
  buffer: string;
  /** True while the stream is finishing/draining → arms the lift transition. */
  lifting: boolean;
}
```

## Placement (load-bearing)

- Mounted **only** in the live branch of `AssistantMessage.svelte` (the `live={true}` path that renders plain `<Markdown live>`). Durable rows never mount it.
- Structurally a sibling overlay inside a `position: relative` wrapper around `<Markdown live>` in the live branch — **outside** any `Highlighter` alignment container (live rows have none) and **outside** the `{@html}` markdown output. Zero text nodes.
- Because of that placement, it requires **no change** to `EXCLUDED_CHROME_SELECTORS` (`src/lib/chat/selection.ts:27-38`) and cannot enter expound alignment, sourcemap, search, or copy paths. Durable DOM is byte-identical to today's (FR-010).

## Behavioral rules

1. **Edge tracking**: after each render flush (observed via `buffer` change + post-render measurement of the trailing text of the last block), position the overlay over the measured rect of the trailing text (re-wrap safe). Recompute per flush; hide while measurement is unavailable.
2. **Suppression** (FR-008): when the growth edge lands in a `<pre>`/code block or a `<table>`, suppress the effect entirely; for list items, soften (weaker blur, shorter feather). The caret variant suppresses on the same content classes.
3. **Non-interference** (FR-009): `pointer-events: none` always; `z-10` (in-content overlay rung of the z-ladder, `AssistantMessage.svelte:157-161`); never covers floating UI (`z-50`).
4. **Completion** (FR-007): when `lifting` becomes true, run a short (~200 ms) un-blur / caret fade-out transition (`motion-reduce:transition-none`, reduced-motion gating at the source per `src/lib/motion/stagger.ts:57-78`) synchronized with the pacer reaching `flushed`; the overlay unmounts with the live row at finalization.
5. **Abort/error** (FR-005): overlay must vanish instantly (live branch flushes + unmounts on abort; no lingering transition past unmount).
6. **Styling conventions**: Tailwind v4 utilities + tokens from `src/app.css` (`--background`, `--card`, oklch / `color-mix`); component-specific keyframes appended at the bottom of `src/app.css` (`.expound-flash` precedent) or `:global()` rules in the component `<style>` block; `backdrop-filter: blur()` + gradient mask for `blur-fade`, a thin blinking bar for `caret`; grain/body-level `pointer-events: none` precedents apply.
7. **Performance**: measurement is a per-flush rAF-coalesced read (no per-frame layout thrash beyond the existing flush cadence); the component reports `incRender('GrowthEdge')` via `src/lib/perf/mark.ts` so the perf probe tracks its cost (constitution IV).

## Failure modes

| Situation | Required behavior |
|---|---|
| Stream ends inside code block / table | Overlay suppressed before/at completion; clean finish |
| Rapid re-wrap during streaming | Rect recomputed per flush; worst case a one-flush cosmetic lag (accepted, spec'd) |
| Selection over the blurred tail mid-stream | Selection works (pointer-events none); visual oddity accepted (spec'd) |
| Preset switched mid-stream | Variant transitions on next flush; `standard` hides the overlay without touching the stream |
| Live row unmounts (finalize/abort) | Overlay unmounts with it; no orphan elements, no timers left behind |
