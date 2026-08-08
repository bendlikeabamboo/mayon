# Expound underline not rendering on "view on parent" (mid-segment `locateCanonical` bug)

## Problem

When a user highlights text → right-click → Expound → submit, navigating to the
branch works, but **View on parent** shows the excerpt with **no underline** (the
`.expound-mark` link affordance). Underlines are missing for almost every real
selection.

## Root cause (confirmed by trace, not timing)

The underline data **is already persisted** correctly in `branch_sources`
(`startChar`/`endChar`/`excerpt`/`branchChatId`), and the renderer already covers
prose + inline/block code + admonitions + callouts + blockquotes uniformly via
char-offset DOM wrapping. The break is a pure-logic bug in the Highlighter-local
`locateCanonical()` (`src/lib/components/chat/Highlighter.svelte:238`).

`resolveSelection` (`src/lib/chat/selection.ts:251-252`) stores offsets that can
fall **mid-segment**:

```
startChar = seg.startChar + (startCanonical - firstSegCanonicalStart)
endChar   = seg.startChar  + (endCanonical   - lastSegCanonicalStart)   // last seg
```

For a prose segment `Hello world` (one segment, raw chars 0–11), selecting `lo wo`
stores `startChar=3, endChar=8`.

`locateCanonical()` tries to invert that, but uses whole-segment predicates:

```
if (segStart === -1 && seg.startChar >= startChar) segStart = i;  // 0 >= 3 → false → skipped
if (seg.endChar <= endChar) segEnd = i;                            // 11 <= 8 → false → never set
...
if (segStart === -1 || segEnd === -1 || segStart > segEnd) return null;
```

It only matches when a selection starts **and** ends exactly on segment
boundaries. Any mid-word/mid-segment selection (the common case) returns `null` →
`continue` (`Highlighter.svelte:359`) → **no underline, no flash**. The `selfHeal`
rescue path is never reached because `canonicalize(raw.slice(3,8)) === canonicalize(excerpt)`
(`"lo wo" === "lo wo"`), so the `else` branch at `Highlighter.svelte:361` is skipped.

Secondary fragility (defense-in-depth, not the trigger): `renderUnderlines()`
commits `lastSignature` *before* attempting the wrap (`Highlighter.svelte:331`) and
returns early on alignment failure (`:344`). Recovery then depends solely on a DOM
`textContent` change firing the `MutationObserver`, which never happens for
already-synchronously-rendered prose/code (`renderMarkdown` is sync via
`processSync`, `render.ts:92`).

Mermaid expounding is **already disabled**: `SegmentKind 'mermaid'` →
`resolveSelection` returns `{ok:false, reason:'generated'}` (`selection.ts:219`),
which disables the menu (`Highlighter.svelte:90`) and the floating toolbar (same
path). KaTeX math is banned identically. Admonitions/callouts/blockquotes are
prose DOM text and need no special handling.

## Decisions

- **Approach: harden the existing non-destructive renderer** (chosen). Keep ONE
  char-offset + DOM-wrap mechanism for all content; do NOT rewrite stored markdown.
  Markdown-rewrite was rejected: it mutates canonical assistant content, cascades
  offset invalidation to every sibling `branch_sources` row on the same message,
  breaks on cross-block/partial-format selections, and yields two mechanisms.
- **Primary fix:** rewrite `locateCanonical` to invert `resolveSelection`
  correctly, including the intra-segment delta (mirror `selection.ts:251`).
- **Defense-in-depth:** make `renderUnderlines` retry to success and stop
  suppressing retries after a failed wrap; couple `flashExpoundMark` to mark
  existence.
- Keep `selfHeal` as the drifted-content fallback (stale rows self-heal in memory
  only; no DB write — invariant preserved).

## Tasks

### 1. Confirm root cause via DEV logging (quick, before editing)
`renderUnderlines` already warns on alignment/self-heal failure. Add a temporary
DEV log per span capturing: `rawSlice`, `excerpt`, `canonicalize` equality,
`locateCanonical` result, `selfHeal` result, `wrapRange` result. Repro: expound a
**mid-word** prose selection → **View on parent**. Expect `locateCanonical → null`.
Remove the temp log after the fix.

### 2. Extract + fix `locateCanonical` (CORE FIX)
- Move `locateCanonical` and the duplicated `canonicalOffsetOfSegmentStart`
  (`Highlighter.svelte:238` and `:263`; note `selection.ts:71` has its own private
  copy) into a new pure module `src/lib/markdown/locate.ts` and import it back into
  `Highlighter.svelte`. (Consolidates 3 copies; matches the pure-helper/tested
  pattern used elsewhere in `src/lib/markdown/`.)
- Rewrite the inversion to add intra-segment deltas:
  - `segStart` = the non-`inter-block-ws` segment **containing** `startChar`
    (`seg.startChar <= startChar && startChar < seg.endChar`, i.e. first seg with
    `seg.endChar > startChar`).
  - `canonStart = canonicalOffsetOfSegmentStart(segStart) + (startChar - seg.startChar)`.
  - `segEnd` = the non-`inter-block-ws` segment **containing** `endChar`
    (last seg with `seg.startChar < endChar`).
  - `canonEnd = canonicalOffsetOfSegmentStart(segEnd) + (endChar - seg.startChar)`.
  - Clamp `startChar`/`endChar` into each segment's `[startChar, endChar]` and
    return `null` only when no containing segment exists or the range is inverted.
- This is the exact reverse of `resolveSelection`'s math, so a selection round-trips
  perfectly for prose, inline-code, and block-code segments.

### 3. Harden `renderUnderlines` idempotency/retry (`Highlighter.svelte:325`)
- Compute a **target** signature = `fullText + '|' + spanIds`. Track
  `lastAppliedSignature` and only short-circuit when the previous run **successfully
  wrapped all spans** (not merely "ran"). A failed/`unaligned` wrap must not
  suppress retries.
- Add a bounded retry: if alignment or any span's wrap did not fully succeed,
  schedule a `requestAnimationFrame` retry, capped (~10 frames / ~160 ms). Covers
  the genuinely-async mermaid-SVG-swap case.
- Keep the `MutationObserver` as a safety net (unchanged).

### 4. Couple `flashExpoundMark` to mark existence (`src/routes/chat/[id]/+page.svelte:326`)
- Poll for `.expound-mark[data-branch-chat="${branchId}"]` until it exists or the
  retry budget is exhausted, then add `.expound-flash`. Do not give up on a fixed
  rAF count while the renderer is still retrying. (Cheap once task 2 lands, since
  the mark will exist.)

### 5. Verify the mermaid ban (expected: no code change)
- Confirm a selection fully inside a rendered Mermaid SVG disables **both** the
  right-click "Branch from this text" item and the floating "Branch from this"
  toolbar (both route through `resolveSelection` → `'generated'`).
- If the toolbar does not surface the disable hint, mirror the ContextMenu hint
  ("Can't branch from a rendered diagram or formula.").
- Add a unit test asserting a `mermaid`-segment selection resolves to
  `{ok:false, reason:'generated'}`.

### 6. Tests
- New `src/lib/markdown/locate.test.ts` covering `locateCanonical`:
  - mid-segment start only; mid-segment end only; both mid-segment;
  - spanning multiple segments; exactly boundary-aligned (still works);
  - a single `inline-code` segment; a `block-code` segment;
  - no containing segment / inverted range → `null`.
- Keep `wrap-range.test.ts`, `selection.test.ts`, `expound.test.ts` green.
- Manual checklist:
  1. Expound a **mid-word prose** selection → **View on parent** → underline
     present + flashes.
  2. Expound inside a **fenced code block** → **View on parent** → underline
     present + flashes.
  3. Expound inside an **admonition/callout/blockquote** → underline present.
  4. Try to expound a **Mermaid** diagram → menu/toolbar disabled with hint.
  5. Reload the parent chat directly (cold load) → underlines still present.

## Boundaries / invariants respected
- No stored-markdown mutation; offsets remain raw-markdown offsets resolved via the
  source map (`src/lib/markdown/sourcemap.ts`) + DOM alignment
  (`src/lib/chat/selection.ts`).
- No substring heuristics / `surroundContents` / `startChar=0` full-span fallback
  reintroduced.
- Stale rows still self-heal in memory only (no DB write).
- Client-only change; no server/schema/migration impact; no `@mayon/shared` rebuild.

## Validation
- `pnpm test` (Vitest) — new + existing unit tests green.
- `pnpm check` (svelte-check) — type-checks clean.
- `pnpm lint` — ESLint + Prettier clean.
- Manual checklist above.

## Out of scope
- Changing what the underline does on click (still shows the branch popover).
- Rendering underlines during live streaming (`renderMarkdownLive`).
- Any persistence/schema change.
