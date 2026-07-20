# Implementation Plan — Expound Source Map (exact code-space ↔ render-space mapping)

**Role:** Principal frontend engineer.

**Date:** 2026-07-19.

**Scope:** Replace the heuristic string-search offset mapping that backs the
"Expound" feature with a **deterministic, bidirectional source map** derived
from the unified/remark mdast tree, so an expound underline lands exactly where
the user highlighted — every time, across every markdown construct the parser
supports. No DB migration; existing rows self-heal at render time.

**Companion diagnosis.** This plan exists because of two coordinate-system
bugs in `src/lib/chat/highlight.ts` and `src/lib/components/chat/Highlighter.svelte`:

1. **Forward (select → store)** — `resolveSelectionOffsets` does lossy substring
   search: it grabs the rendered excerpt ± 12 chars of context, collapses
   whitespace, and hunts for that "anchor" inside the raw markdown. It misses
   for link URLs (`[t](url)`), inline code backticks, mid-word emphasis,
   HTML entities, tables, and — worst — `container.textContent` glues block
   elements with **no separator** while the raw markdown separates them with
   newlines, so any context window crossing a block boundary diverges.

2. **Reverse (store → underline)** — the visible symptoms the user reports:
   - `findOccurrence` searches the **rendered DOM text** for `span.excerpt`
     but uses `span.startChar` (a **raw-markdown** offset) as the
     `preferredStart` hint. A raw offset is meaningless in rendered-text space,
     so when the excerpt recurs the wrong occurrence is picked → **"sometimes
     short, sometimes long."**
   - `range.surroundContents(mark)` throws `BAD_BOUNDARYPOINTS_ERR` whenever
     the excerpt crosses an inline-element boundary (`<strong>`, `<code>`,
     `<a>`, or two adjacent text nodes); the `try/catch` at
     `Highlighter.svelte:377-381` swallows it silently → **"sometimes the
     underline is not appearing at all."**

---

## 0. Terminology (locked — use these terms everywhere)

| Term | Meaning |
|---|---|
| **code-space** | The raw markdown string stored on `messages.content` (what the LLM emitted). |
| **render-space** | The visible text the user sees and selects in the rendered DOM (`container.textContent`, excluding generated nodes). |
| **canonical visible text** | The concatenation, in document order, of every "surviving" segment the source map emits. Owned by us; by construction equals render-space minus excluded nodes. |
| **source map** | A pure data structure `SourceMap` mapping each canonical-visible-text offset range to a half-open `[startChar, endChar)` range in code-space, plus a segment `kind`. |
| **segment kind** | One of `prose`, `inline-code`, `block-code`, `link-text`, `math-inline`, `math-display`, `mermaid`, `inter-block-ws`. |
| **generated content** | Rendered output with no verbatim code-space counterpart: `math-*`, `mermaid`, plus DOM-only nodes the pipeline never produced (`md-copy-btn`, KaTeX annotation clones, Mermaid SVG labels). Selections touching these **disable** Expound. |
| **self-heal** | At render time, if `raw.slice(row.startChar, row.endChar)` does not canonicalize to `row.excerpt`, re-resolve the offsets from the excerpt via the source map. No DB write. |

### File-level conventions

- Source map core (pure, mdast → data): **`src/lib/markdown/sourcemap.ts`**.
- DOM alignment + selection resolve (pure-ish, takes walked-DOM data):
  **`src/lib/chat/selection.ts`** (replaces `src/lib/chat/highlight.ts`).
- Safe underline wrapping: **`src/lib/markdown/wrap-range.ts`** (DOM util; no
  `surroundContents`).
- `renderMarkdown` gains a sibling `buildSourceMap(raw)` so the HTML pipeline
  and the map stay in lockstep from the same processor.
- `Markdown.svelte` exposes its `SourceMap` upward (callback prop
  `onSourceMap?`) so `Highlighter.svelte` can use it without re-parsing.

---

## 1. Guiding principles

1. **One coordinate system, owned by us.** The source map is the single source
   of truth for code-space ↔ render-space. No second heuristic. No string
   search at resolve time. If the map can't answer, the action is disabled —
   never silently approximated.
2. **Positions come from the parser, not from search.** `remark-parse` already
  annotates every mdast node with `position.{start,end}.offset` against the
   raw markdown. We consume those; we never re-derive them by looking for
   substrings.
3. **Generated content is an explicit state, not a fallback.** A selection
   that includes math, mermaid, or DOM-only chrome disables Expound with a
   clear hint. The `startChar=0, endChar=excerpt.length` full-span fallback
   is **removed** — that path is what produces the "underline in the wrong
   place" symptoms today.
4. **The underline never throws.** `surroundContents` is gone. Wrapping splits
   text nodes at the resolved boundaries and wraps each contained run; it works
   across `<strong>`, `<code>`, `<a>`, and arbitrary inline boundaries.
5. **Existing rows heal, they aren't migrated.** Rows stored under the old
   heuristic are corrected in memory at render time. No migration script, no
   DB write. New rows are always exact.
6. **Half-open `[startChar, endChar)` everywhere.** Consistent with
   `expound.ts`'s `CharSpan` / `spansOverlap`. Adjacent excerpts remain legal.
7. **Tests gate every phase.** A phase is done when `pnpm lint && pnpm check
   && pnpm test` is green and that phase's manual acceptance signal passes.

---

## 2. Phase overview

| Phase | Name | Goal | Risk | Acceptance signal |
|---|---|---|---|---|
| **P0** | Source map core (pure) | `buildSourceMap(raw)` walks mdast and emits `SourceMap` with exact raw offsets per canonical-visible segment. | Medium (mdast walking) | Unit tests pass for emphasis, links, inline/block code, lists, tables, math, mermaid, nested constructs. |
| **P1** | Expose the map through `Markdown.svelte` | `renderMarkdown`/`buildSourceMap` share one processor; `Markdown.svelte` emits the map upward; `Highlighter.svelte` consumes it. | Low | Map is present in the Highlighter for every rendered assistant message; no double-parse. |
| **P2** | Forward map: selection → raw offsets | `selection.ts` aligns DOM text nodes to the source map and resolves a selection to exact `[startChar, endChar)`. Generated-content detection disables Expound. | Medium (DOM alignment) | Forward resolve is exact for every construct in P0; duplicate-prose selects the right occurrence; generated content disables the menu. |
| **P3** | Reverse map: raw offsets → safe underline | `wrap-range.ts` wraps the exact canonical range across element boundaries without `surroundContents`. Stale rows self-heal. | Medium | Underlines land exactly on the highlighted span, including across `<strong>`/`<code>`/`<a>`; stale rows render correctly. |
| **P4** | Cleanup | Delete `highlight.ts` heuristic, dedupe `collapse`, remove the full-span fallback, prune dead tests, refresh docs. | Low | Grep sweep clean; suite green. |
| **P5** | Acceptance & docs | Manual gates pass; AGENTS.md / architecture notes updated. | Low | All manual gates in §9 pass. |

---

## 3. P0 — Source map core (pure)

### 3.1 Data shape

```ts
// src/lib/markdown/sourcemap.ts
export type SegmentKind =
  | 'prose'            // ordinary text leaf — survives verbatim
  | 'inline-code'      // `code` → content survives, backticks stripped
  | 'block-code'       // fenced code → content survives
  | 'link-text'        // the label of [label](url) — url never enters render-space
  | 'math-inline'      // $...$  → generated (KaTeX HTML); no verbatim counterpart
  | 'math-display'     // $$...$$ → generated
  | 'mermaid'          // ```mermaid → generated (SVG swap)
  | 'inter-block-ws';  // whitespace remark-rehype emits between block siblings

export interface Segment {
  kind: SegmentKind;
  /** What this segment contributes to canonical visible text. '' for generated. */
  rendered: string;
  /** Half-open [startChar, endChar) into raw markdown. */
  startChar: number;
  endChar: number;
}

export interface SourceMap {
  segments: Segment[];
  /** segments.map(s => s.rendered).join('') — precomputed for O(1) slice. */
  canonical: string;
  /** For each index into `canonical`, the index of the owning segment. */
  canonicalToSegment: number[];
}
```

### 3.2 Algorithm

1. Parse with the **same** `unified` processor `renderMarkdown` uses, but stop
   after `remark-parse` (+ `remark-gfm` + `remark-math` so GFM/math nodes are
   normalized identically to the HTML pipeline). No rehype stage — mdast
   positions are the raw offsets we need; rehype positions describe HTML, not
   markdown, and would lose the mapping.
2. Walk the mdast tree in document order. For each node, branch on type:
   - `text`, `break` → push a `prose` segment with the node's `position` range.
   - `inlineCode` → `inline-code` segment; `rendered` = `node.value` (backticks
     stripped, content survives).
   - `code` (fenced) → if `node.lang === 'mermaid'`, push a `mermaid` segment
     with `rendered: ''`; else `block-code` with `rendered = node.value` (plus
     a trailing newline if remark-rehype emits one — verified by a fixture).
   - `link` → recurse into children as `link-text` segments; **the URL in
     `node.url` is never emitted** (it has no render-space presence).
   - `math` (inline) → `math-inline`, `rendered: ''`.
   - `math` (display, `\`\`\`math` or `$$…$$`) → `math-display`, `rendered: ''`.
   - `html` (raw HTML in markdown) → `prose` if it's whitespace-only text
     content, else mark `generated`-ish (treat as opaque; selections inside
     disable Expound). Documented edge case; tests lock the chosen behavior.
   - Block siblings (`paragraph`, `heading`, `listItem`, `tableRow`, …) →
     emit an `inter-block-ws` segment between siblings whose `rendered` is
     exactly the separator remark-rehype stringifies (a single `\n`). This is
     the correction for today's "textContent glues blocks" bug.
3. Build `canonical` and `canonicalToSegment` from the segment list.
4. **Verify** in dev/test: re-stringify the mdast through the full pipeline,
   walk the resulting DOM text nodes, and assert that canonical visible text
   equals DOM `textContent` **after** removing recognized excluded chrome
   (`.md-copy-btn`, `.mermaid-svg`, `katex-html`, `annotation`).

### 3.3 Tests (pure, in `sourcemap.test.ts`)

Each case asserts both `canonical` and the raw slice for a segment:

- Plain prose round-trips 1:1.
- `**bold text**` → `rendered` = `"bold text"`, raw range covers the inner
  text only (not the `**`).
- `[the label](https://example.com/x)` → one `link-text` segment
  `rendered = "the label"`; the URL has **no** segment.
- `` `inline code` `` → `inline-code`, `rendered = "inline code"`.
- Fenced non-mermaid block → `block-code` with full content; copy-button text
  ("Copy") is not in canonical.
- Fenced ```mermaid``` → `mermaid`, `rendered = ''`.
- `- a\n- b\nc` (list) → two `prose` segments with `inter-block-ws` between.
- GFM table → cell texts as `prose`, pipes stripped, `inter-block-ws` between
  cells/rows matching what remark-rehype emits.
- `$x^2$` inline math → `math-inline`, `rendered = ''`.
- `$$\int x\,dx$$` display math → `math-display`, `rendered = ''`.
- Nested: `> - **a** [b](u) \`c\``  — one segment per leaf, in order, with
  correct raw ranges and kinds.
- Empty / whitespace-only input → empty `segments`.

### 3.4 Acceptance

`pnpm test src/lib/markdown/sourcemap.test.ts` green; no DOM imports in the
module (it stays pure and unit-testable).

---

## 4. P1 — Expose the map through `Markdown.svelte`

### 4.1 Shared processor

Refactor `src/lib/markdown/render.ts` so the `unified` processor is built once
and reused by both `renderMarkdown` (HTML) and `buildSourceMap` (mdast walk).
This guarantees the two never drift.

### 4.2 Component plumbing

- `Markdown.svelte` calls `buildSourceMap(raw)` (cheap; the mdast is already
  parsed internally by the processor) and emits it through a new optional
  callback prop: `onsourcemap?: (map: SourceMap) => void`.
- `Highlighter.svelte` owns the `SourceMap` for its message (it already wraps
  the rendered `<Markdown>` via its `children` snippet). It stores the latest
  map in `$state` and re-runs underline wrapping whenever it changes.
- Re-render on `raw` change is already handled by `$derived(renderMarkdown(raw))`
  in `Markdown.svelte`; the source-map callback rides the same update.

### 4.3 Acceptance

For every rendered assistant message, `Highlighter.svelte` has a non-null
`SourceMap` whose `canonical` length is within a known tolerance of
`container.textContent.length` (tolerance = excluded chrome only).

---

## 5. P2 — Forward map: selection → raw offsets

### 5.1 DOM alignment (the only non-pure step)

`selection.ts` exports a function that takes walked-DOM data + the `SourceMap`
and returns either resolved offsets or a typed rejection:

```ts
export type ResolveResult =
  | { ok: true; startChar: number; endChar: number; excerpt: string }
  | { ok: false; reason: 'empty' | 'generated' | 'unaligned' };
```

Alignment walks `container`'s text nodes in document order and streams them
against `canonical`:

- Maintain a cursor `canonicalPos` into `SourceMap.canonical`.
- For each DOM text node, classify it:
  - **Excluded chrome** (text node inside `.md-copy-btn`, `.mermaid-svg`,
    `.katex-html`, `annotation[encoding="application/x-tex"]`) → skip; mark
    a flag `sawExcludedChrome = true`.
  - Otherwise: assert `canonical.startsWith(node.textContent, canonicalPos)`.
    If yes, record
    `{ node, domStart: canonicalPos, domEnd: canonicalPos + len }` and advance.
    If no, the DOM has drifted from the map (unexpected text) → any selection
    touching this node resolves as `unaligned`.

### 5.2 Resolve

Given a `Selection`/`Range` captured at context-menu time:

1. Compute the selection's `[startCanonical, endCanonical)` against the
   aligned table (same `textOffsetFromRange` walk, but offset is now into
   **canonical**, not raw `container.textContent`).
2. Map `[startCanonical, endCanonical)` to segment(s) via
   `canonicalToSegment`. The raw range is
   `segments[first].startChar … segments[last].endChar`, **clamped per
   segment** so a selection ending mid-segment still resolves to the exact
   raw sub-span.
3. **Generated-content rule:** if any segment in the span has kind in
   `{ math-inline, math-display, mermaid }` **or** `sawExcludedChrome` within
   the selection's DOM range → return `{ ok: false, reason: 'generated' }`.
4. **Unaligned rule:** if the selection touches an unaligned text node →
   `{ ok: false, reason: 'unaligned' }`.

### 5.3 UX wiring

- `Highlighter.svelte` calls `resolveSelection` from `captureSelection`.
- `ContextMenu.svelte` gains a per-reason disabled hint:
  - `generated` → "Can't branch from a rendered diagram or formula."
  - `unaligned` → "Selection can't be mapped to the source text."
- The full-span fallback in `chatStore.createExpoundBranch`
  (`?? { startChar: 0, endChar: excerpt.length }`) is removed: a non-`ok`
  result means the menu disabled Expound, so the store is never reached with
  an unresolved selection.

### 5.4 Tests (`selection.test.ts`, DOM-walk data mocked)

- Forward-resolves every P0 fixture to the exact raw range.
- Duplicate prose `"the the the"` — selecting the middle "the" returns the
  middle raw range, not the first or last.
- Selection crossing `<strong>` / `<code>` / `<a>` boundaries resolves to the
  full raw span including the markdown markers around the inner leaves.
- Selection over a Mermaid SVG → `generated`.
- Selection over inline `$x^2$` → `generated`.
- Selection partially over a copy button → `generated`.
- Empty/collapsed selection → `empty`.

### 5.5 Acceptance

`pnpm test src/lib/chat/selection.test.ts` green; in the browser, every
expound-able selection resolves to offsets whose `raw.slice(start, end)`
matches the visible excerpt (after whitespace normalization) for **every**
construct in §3.3.

---

## 6. P3 — Reverse map: raw offsets → safe underline

### 6.1 `wrap-range.ts`

A DOM utility that wraps a canonical-text `[start, end)` range in a mark
element **without `surroundContents`**:

1. Use the aligned table from §5.1 to find the DOM text nodes spanning
   `[start, end)`.
2. For the first and last text nodes, call `node.splitText(offset)` to break
   at the boundaries (only if the boundary isn't already at a node edge).
3. For every text node (or partial node) inside `[start, end)`, wrap it in a
   fresh `<span class="expound-mark" data-branch-chat="…">`.
4. Never throws: if a boundary can't be split (e.g. read-only node — none
   exist here), skip the excerpt and report it (logged in dev).

Because wrapping is per-text-node, it naturally handles selections crossing
inline-element boundaries — the mark will be N adjacent spans, all styled
identically by the existing `.expound-mark` CSS (which already uses
`text-decoration: underline`).

### 6.2 Stale-row self-heal

In `renderUnderlines`, before wrapping:

1. Compute `rawSlice = raw.slice(span.startChar, span.endChar)`.
2. If `canonicalize(rawSlice) === canonicalize(span.excerpt)` → use the stored
   offsets directly (fast path; the overwhelmingly common case for new rows).
3. Else (stale row from the old heuristic) → re-resolve via the source map:
   find `span.excerpt` in `SourceMap.canonical`, map back to raw offsets, and
   use **those** for this render only. **No DB write.** If re-resolve fails,
   skip the underline for this row (do not fall back to `startChar=0`).

`canonicalize` here is a single whitespace-normalization (no syntax stripping
— the source map makes that unnecessary).

### 6.3 Idempotency & feedback loops

- Keep the existing `lastSignature` guard: re-wrapping is a no-op when
  `fullText + existingSpans` is unchanged.
- The `MutationObserver` stays; per-text-node wrapping changes text-node
  topology but not `textContent`, so the signature is stable and the observer
  doesn't spin.

### 6.4 Tests (`wrap-range.test.ts`, jsdom)

- Wrap inside a single `<p>` text node → one mark span, exact range.
- Wrap across `<p>one <strong>two</strong> three</p>` selecting "one two" →
  mark spans both the bare text and the `<strong>` text, no throw.
- Wrap across two sibling `<p>` elements → handled or skipped deterministically
  (inter-block boundaries are legal in canonical space; the wrap produces two
  mark spans, one per block).
- Re-wrap is idempotent; signature guard prevents loops.
- Self-heal: a row with `startChar=0, endChar=5` but `excerpt="brown fox"`
  against raw `"The brown fox jumps"` re-resolves to the `brown fox` span.

### 6.5 Acceptance

In the browser, every existing and new expound mark underlines **exactly** the
highlighted prose, including across inline elements; no mark ever silently
disappears on a `<strong>`/`<code>`/`<a>` crossing.

---

## 7. P4 — Cleanup

- Delete `src/lib/chat/highlight.ts` (the `collapse`/`collapseStripped`/
  `MARKDOWN_SYNTAX`/`resolveSelectionOffsets` heuristic) and its test file.
- Delete the duplicate `collapse` and `findOccurrence` in `Highlighter.svelte`.
- Remove the `?? { startChar: 0, endChar: excerpt.length }` fallback in
  `chatStore.createExpoundBranch` and the comment that justifies it.
- Update `chatStore` / `+page.svelte` call sites that referenced
  `SelectionInput` to use the new `selection.ts` types.
- Update `src/lib/chat/expound.ts`'s header comment to reference the source
  map (the "as resolved by `resolveSelectionOffsets` + the full-span fallback"
  wording is now wrong).

### Grep sweep (must be zero hits in `src/`)

```
resolveSelectionOffsets | collapseStripped | MARKDOWN_SYNTAX |
surroundContents | findOccurrence
```

### Acceptance

Sweep clean; `pnpm lint && pnpm check && pnpm test` green.

---

## 8. P5 — Acceptance & docs

- Update the relevant section of `docs/dev/architecture.qmd` (and any
  referencing note in `AGENTS.md`) to describe the source-map approach in one
  paragraph; the old "best-effort; raw vs rendered offsets differ" comment in
  `Highlighter.svelte` is gone.
- Add a one-line entry to `refinement/2026-07-18_notes_on_use.md` (or the next
  notes file) pointing at this plan once shipped.

---

## 9. Manual acceptance gates (final)

Reproduce each of the user's reported failure modes; each must now be exact.

- **Across emphasis:** assistant reply containing `**bold** and `code` and
  [a link](u)` → select a span crossing all three → Expound → underline covers
  exactly the selected characters, including across the element boundaries.
- **Duplicate prose:** reply containing `"the cat chased the bird in the tree"`
  → select the **second** "the" → underline is on the second "the", not the
  first or third.
- **Lists / tables:** select across list items / table cells → underline lands
  exactly; no off-by-N drift from stripped markers/pipes.
- **Generated content — Mermaid:** select over a rendered Mermaid diagram →
  Expound is **disabled** with the hint "Can't branch from a rendered diagram
  or formula."
- **Generated content — math:** select over `$E=mc^2$` rendered output →
  disabled with the same hint.
- **Copy button:** select prose that happens to include a code block's "Copy"
  button text → disabled (the button is excluded chrome).
- **Self-heal:** with an existing DB row stored under the old heuristic whose
  `raw.slice(start,end)` ≠ excerpt → reload → the underline now lands
  correctly (re-resolved in memory); no DB write occurred (verify via the
  `branch_sources` row being unchanged).
- **Persistence:** reload the tab → the underline survives and still lands
  exactly on the highlighted span.
- **Suite:** `pnpm lint && pnpm check && pnpm test` green; no new
  DOM/`surroundContents` imports outside `wrap-range.ts`.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| mdast walk disagrees with remark-rehype's emitted text for an exotic construct (e.g. GFM task list checkbox, autolink). | P0 §3.2 step 4 dev-asserts canonical vs DOM textContent equality; mismatches surface as test failures before shipping. |
| Post-render DOM mutations (copy button, mermaid swap, KaTeX annotation) change textContent after alignment. | Alignment classifies excluded chrome explicitly and skips it; mutations trigger re-align via the existing `MutationObserver`. |
| Splitting text nodes during wrap interferes with the `MutationObserver`. | Signature guard ignores `textContent`-preserving mutations; wrap is idempotent. |
| Streaming (`live={true}`) messages re-parse on every token, rebuilding the map. | Map build is cheap (mdast already parsed); underline pass is gated by `existingSpans.length > 0`, which is false while streaming. No action needed; called out for awareness. |
| A future markdown plugin changes what survives to render-space. | The shared-processor refactor (§4.1) keeps map and HTML in lockstep; adding a plugin updates both atomically. |

---

## 11. Out of scope

- Replacing the post-render Mermaid/KaTeX/copy-button DOM mutations with a
  pure pipeline. They stay; the source map treats them as excluded chrome.
- Persisting self-healed offsets back to the DB (write-back). Re-resolve is
  render-only; a later phase may add a lazy write-back if desired.
- Multi-message selections (selecting across two assistant replies). The
  container is per-message; selections crossing containers already bail in
  `captureSelection`.
- Changing the `.expound-mark` visual style. CSS stays as-is.
