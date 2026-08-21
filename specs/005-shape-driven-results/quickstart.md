# Quickstart: Shape-Driven Tool Result Rendering

Validation guide for `specs/005-shape-driven-results`. Run on the dev stack (`pnpm dev` → web http://localhost:5173, server :4319). Prerequisite: an MCP server with a search tool (e.g. Brave `brave_web_search`) and a stored chat containing multi-result search rows — the live regression fixture (must read correctly after the fix **with no data change**).

## Quality gates (constitution — run all before merge)

```bash
pnpm exec vitest run src/lib/components/chat/ src/lib/chat/   # targeted first
pnpm test                                   # full suite (incl. golden + new regressions)
pnpm check                                  # svelte-check
pnpm lint                                   # ESLint + Prettier
```

New/extended suites: `result-shape.test.ts` (classifier: taxonomy, precedence, thresholds, tolerant scan), `ToolResultBody.test.ts` (per-shape rendering, source-inspection), `ToolActivity.collapse.test.ts` (extended: header toggle, sources-fold, preserved collapsed behavior). Golden tests must pass **unmodified**.

## US1 — search results as link cards

1. Open the stored web-search chat: every search row stays a quiet collapsed one-liner.
2. Tap the header row (icon + tool name + chevron): the body expands **below** the header as a list of link cards — title link, muted host line, one-line description; duplicates collapsed; >10 results show "+N more".
3. A card link opens the target in a new tab (noopener). **No separate Sources row renders for these rows** — one list, not two.
4. Verify immutability (SC-005): reload the chat, re-expand — identical rendering; stored content untouched (spot-check via Drizzle studio if desired).

## US2 — markdown and JSON read as what they are

1. Trigger a tool returning markdown (or open a chat whose result metadata carries a markdown payload/marker): the expanded body renders formatted markdown in the bounded container.
2. Trigger a tool returning plain JSON data (no URLs): the expanded body is pretty-printed with 2-space indentation in the bounded `<pre>`.
3. Precedence spot-checks: a payload that both parses as JSON and contains heading-looking text renders as JSON; a `text/markdown`-marked payload renders as markdown even though it starts with `{`.

## US3 — one obvious toggle

1. On any verbose row, the header row toggles expand/collapse; the chevron flips; **no floating Show/Hide button exists anywhere**.
2. A non-records verbose row that still has extracted sources renders its Sources row **last**, below the body.
3. Short deterministic-tool summaries (≤160 chars, not payload-like) render exactly as before — inline one-liner, no expander.

## US4 — safe for everything else

1. Malformed/truncated payloads (aborted searches, error strings >160 chars): expanded body degrades to the bounded raw `<pre>`; nothing crashes, nothing unbounded.
2. Open a pre-feature chat: rows render through shape detection with zero data change — no migration ran (SC-005).
3. A failed MCP result keeps the red X and its error text renders in the bounded raw view.

## Perf probe (constitution IV — before/after)

```text
window.__MAYON_PERF__ = 1
localStorage.mayon_perf_scenario = 'shape-driven-results'
```

Compare `[mayon-perf]` summaries while scrolling/expanding the web-search chat before and after: frame timing, longtasks, `TimelineRow` render counts. Record numbers in the PR; expect flat-or-better (collapsed path unchanged; expanded cards replace one multi-KB `<pre>` text node with ≤10 small cards).
