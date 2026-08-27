# US5 Evidence — Hidden powers become discoverable (T022–T026)

Date: 2026-08-27 · Branch `feat/ui_overhaul` · Dev stack `mayon-dev` (web :5173)
Method: playwright-cli (chromium, 1440×900) + iPhone-15 touch session + CDP media emulation.

## T022 — Hover-revealed action row (`AssistantMessage.svelte`)

- Copy · Branch · Regenerate consolidated as compact ghost icon buttons
  (`size-6`, accessible `aria-label`s) on a strip aligned to the message's
  trailing edge (`self-end`), reusing the page's existing
  `onCopy`/`onBranchWhole`/`onRegenerate` props — handlers untouched in
  `src/routes/chat/[id]/+page.svelte`.
- Reveal: `opacity-0 → group-hover/message:opacity-100` +
  `focus-within:opacity-100`, hidden state also `pointer-events-none` so the
  invisible strip never intercepts clicks. Reserved `h-6` row in normal flow:
  reveal/hide shifts nothing.
- Legacy placements removed: always-visible "Branch from this message" header
  button and interrupted-only outline Regenerate (the "This reply was
  interrupted." notice is retained).
- Live checks (chat `us3seed-0001-chat`):
  - hidden: `opacity 0 / pointer-events none`
  - hover region: `opacity 1` (captured: `evidence/us5-hover-actions.png`)
  - `btn.focus()` (no hover): `opacity 1` — keyboard reveal works
  - copy click → clipboard read back `"Glucose fuels the leaf."`
  - message bubble `boundingBox` identical before/after reveal → no layout
    shift

## Regenerate scoping decision (documented per task T022)

`onRegenerate` (page :413) deletes the reply row and re-sends the *preceding*
user turn via `chatStore.send`, which appends at the **end** of the timeline.
That is chronology-safe only for the newest assistant turn; regenerating an
older mid-thread reply would strand the fresh answer after later messages.
Decision: the affordance renders for every durable assistant row (FR-15
consolidation), but the **Regenerate button** is reveal-gated to the newest
assistant turn via a `canRegenerate` prop computed in `MessageList.svelte`
(`item.entry.id === lastAssistantId`, disabled while `streaming` or when the
tail isn't an assistant message). Interrupted replies always occupy the tail,
so the previous interrupted-only behavior remains a subset. The prop contract
of `onRegenerate` itself is unchanged; page handlers untouched.

## T023 — Touch parity + layering

- Coarse-pointer override: component `<style>` block keyed by grep-token
  `us5-coarse-pointer`; `@media (pointer: coarse)` forces
  `.message-actions.message-actions { opacity: 1; pointer-events: auto }`.
  Verified in a dedicated `--device="iPhone 15"` session:
  `matchMedia('(pointer: coarse)') === true`, every action row computed
  `opacity 1 / pointer-events auto` with no hover. (CDP `pointer` feature
  emulation is a no-op in this chromium build, hence the real device session.)
- Reduced motion (CDP `prefers-reduced-motion: reduce`):
  - action row: computed `transition-property: none` → instant reveal/hide
    (`motion-reduce:transition-none`).
  - tree caret: `transition-property: none` (snaps) while `rotate: 90deg`
    ENDPOINT survives, so expand-state stays readable without animation. This
    required refining the T004 hook: `.art-caret` no longer strips `transform`
    (it only kills animation/transition); `.art-stagger` keeps full stripping.
- Z-order: action row `z-10`; Highlighter selection pill and ContextMenu are
  `fixed z-50`. Live text-selection flow: drag-selected inside the last
  assistant message while hovered — pill rendered above message content,
  computed z `50` vs row z `10`; no occlusion or gesture fight
  (screenshot `/tmp/kilo/us5-selection-pill.png`, pill + selection + revealed
  row coexist).

## T024 — Row hover tints

Swept with real pointer hover; computed background:

| Surface                              | Resting                | Hover                  |
| ------------------------------------ | ---------------------- | ---------------------- |
| chat list row (`/chat`)              | `oklch(0.975 0.008 90)` | `oklch(0.97 0.006 90)` |
| quiz group row (`/quiz`)             | (surface-card bg)      | `oklch(0.97 0.006 90)` |
| lab group row (`/lab`)               | (surface-card bg)      | `oklch(0.97 0.006 90)` |
| home recents mini-rows (`/`)         | transparent            | `oklch(0.97 0.006 90)` |
| Pagination Prev/Next (outline Button)| `bg-background`        | `hover:bg-accent` (variant-carried; disabled at 1 page, class verified in DOM) |

All five now speak the identical `hover:bg-accent hover:text-accent-foreground`
idiom at Sidebar-nav intensity; keyboard `focus-visible:ring` equivalents were
already present and untouched (chat/home/pagination), quiz/lab rows use ghost
Button deletes whose focus states come from the shared Button recipe.

## T025 — Tree ancestry visuals (`/tree`)

- Single `ChevronRight` per caret; expanded = `rotate-90` (renders pointing
  down), collapsed = 0°. `transition-transform duration-150`; `art-caret` class
  attached (see reduced-motion above). `aria-expanded` added to caret buttons
  (label Expand/Collapse retained).
- Children containers wrapped in `ml-2 border-l border-border/60 pl-4` guide
  rail; each non-root row carries a `before:` hairline elbow tick
  (`w-4 h-px bg-border/60`) bridging rail → row. Indentation now comes from
  nesting (`1.5rem/level` equivalent visual), replacing the inline
  `padding-left` formula.
- PRESERVED (verified in DOM + source): recursive `{#snippet row(node, depth)}`,
  `SvelteSet` collapsed memory (toggle Collapse → children + rail hide, caret
  unrotates; re-expand restores), `buildSubtreeModel`, pagination block,
  `class:bg-primary` current-node styling, hover-only delete.
- Captured: `evidence/us5-tree.png` (expanded carets, rails, elbow ticks).

## T026 — Source-text assertions

`src/lib/components/chat/rows/AssistantMessage.actions.test.ts` (9 tests,
repo source-text convention): pins the three aria-labels, `group/message`
scope, `group-hover/message:` + `focus-within:` reveal classes, inert hidden
state, opacity-only transition + `motion-reduce:transition-none`,
`us5-coarse-pointer` marker + `.message-actions.message-actions` override
values, reserved-height (`h-6`) strategy, legacy-placement removal, and the
`canRegenerate`/`lastAssistantId` gate across both files.

## Gates (final)

- `pnpm check` — PASS (0 errors, 0 warnings)
- `pnpm lint` — PASS (eslint clean, prettier clean)
- `pnpm test` — PASS (95 files / 1501 tests)

## Notes / deviations

- Regenerate reveal scoped to newest assistant turn (rationale above) —
  revealed as a documented decision, not a deviation from the prop contract.
- `app.css` reduced-motion block: `.art-caret` split out of the
  transform-stripping group so the rotate endpoint survives (comment updated
  in place; block otherwise unchanged).
- Environment observation (pre-existing, unrelated to US5): a cold hard-load
  of a deep link (e.g. direct `goto /chat`) can 500 with "Database not
  bootstrapped yet" from the SPA boot race; in-app SPA navigation is
  unaffected. No US5 file participates in boot ordering.
