# Plan — Expound source map, P2 + P3: forward & reverse mapping

**Parent design:** `refinement/2026-07-19_expound-source-map.md` §5 (P2) + §6 (P3).
**Predecessors:**
- `.kilo/plans/1784448265406-expound-source-map-p0.md` (P0 — shipped:
  `src/lib/markdown/sourcemap.ts` walks hast, deviates from the §3 mdast plan;
  `canonical` is verified to equal filtered DOM `textContent` using
  `EXCLUDED_SELECTORS = ['.katex', '.callout-title', 'code.language-mermaid']`
  in `sourcemap.test.ts:191` group B).
- `.kilo/plans/1784450252941-expound-source-map-p1.md` (P1 — shipped:
  `Highlighter.svelte:44` derives `sourceMap = $derived(buildSourceMap(raw))`
  directly, deviates from the §4 `Markdown.svelte` callback plan; a dev-only
  drift `$effect` at `Highlighter.svelte:400-413` asserts
  `canonical.length <= container.textContent.length`).

**Scope:** Replace the heuristic `resolveSelectionOffsets` + full-span fallback
+ `findOccurrence`/`surroundContents` underline pass with a deterministic
source-map-based forward resolve (P2) and reverse underline wrap (P3). Existing
rows stored under the old heuristic self-heal at render time (no DB write).

P2+P3 ends when: `pnpm lint && pnpm check && pnpm test` is green,
`src/lib/chat/highlight.ts` and `src/lib/chat/highlight.test.ts` are deleted,
every manual gate in `refinement/2026-07-19_expound-source-map.md` §9 passes,
and the grep sweep in §7 of the refinement is clean.

---

## Confirmed decisions

1. **Pure resolver + thin DOM helper.** `selection.ts` exports two functions:
   `alignDomToCanonical(container, sm)` (DOM-touching, returns an
   `AlignmentTable`) and `resolveSelection(table, sm, range)` (pure, no DOM
   types beyond the standard `Range`/`Node` carried in the table). Tests mock
   the table for the pure resolver; only the align helper uses jsdom. Resolves
   the §5.1 vs §5.2 contradiction in the refinement.

2. **Reject selections touching generated content.** If any canonical index in
   `[startCanonical, endCanonical)` belongs to a segment of kind
   `math-inline`/`math-display`/`mermaid`, OR the selection's DOM range includes
   any text node absent from the alignment table (excluded chrome), return
   `{ ok: false, reason: 'generated' }`. No split/multi-span mode.

3. **Clamp inter-block-ws endpoints to the nearest content edge.** A selection
   start that lands inside an `inter-block-ws` segment snaps forward to the
   following content segment's `startChar`; an end snaps back to the preceding
   content segment's `endChar`. The ws segment's own `[prevEnd, nextStart]`
   range is never stored as the user's excerpt.

4. **Excluded-chrome selectors = P0 union + post-render chrome.**
   `['.katex', '.callout-title', 'code.language-mermaid', '.md-copy-btn',
   '.mermaid-svg']`. The first three are P0 group B's locked set; the last two
   cover the post-render injections `Markdown.svelte:99-110` (copy button) and
   `Markdown.svelte:52-61` (Mermaid SVG wrapper) make to live `textContent`.
   KaTeX's `annotation[encoding="application/x-tex"]` is covered transitively
   by `.katex` (the outer wrapper).

5. **Store takes `ResolvedOffsets`; delete `branchFromSelection`.** Replace
   `SelectionInput` everywhere it crosses the component→store boundary with
   `ResolvedOffsets` (= `{ startChar, endChar, excerpt }`). `Highlighter`
   resolves before forwarding; `chatStore.createExpoundBranch` drops its
   `resolveSelectionOffsets` call and the `?? { startChar: 0, … }` fallback.
   Delete `chatStore.branchFromSelection` (test-only; UI never calls it) and
   its two tests at `chat.svelte.test.ts:108-157`.

6. **Dev-only self-heal diagnostics + upgrade the P1 drift check.** When
   self-heal re-resolve fails, `console.warn('[expound] self-heal failed',
   { messageId, spanId, excerpt, startChar, endChar })` in dev only. Upgrade
   the existing P1 drift `$effect` (`Highlighter.svelte:400-413`) from the
   loose `canonical.length <= domLen` check to strict
   `canonical === filtered DOM textContent` using P2's excluded-chrome
   classifier — any future canonical/DOM drift surfaces loudly in dev.

7. **One PR; `canonicalize` in `selection.ts`.** `wrap-range.ts` lives at
   `src/lib/markdown/wrap-range.ts` per refinement §0 and imports
   `AlignmentTable`, `canonicalize`, and the selectors from `selection.ts`.
   P4 (delete `highlight.ts` + dedupe the in-component `collapse`/`findOccurrence`
   at `Highlighter.svelte:266-321`) is a separate cleanup PR — kept **out** of
   this plan so the suite stays green during transition (the heuristic remains
   as dead code until P4).

---

## Architecture overview

```
                         ┌─ buildSourceMap(raw) ── P0 ──┐
   raw ─────────────────►│                              ├──► SourceMap { segments, canonical, canonicalToSegment }
                         └──────────────────────────────┘
                                                          ▲
                                                          │
   container ──► alignDomToCanonical(container, sm) ── P2 ─┘
                       │
                       ▼
                AlignmentTable { entries: { node, canonicalStart, canonicalEnd,
                                            segmentKind, excluded }[],
                                aligned: boolean,
                                unalignedNode: Text | null }
                       │
                       ▼
   Range ──► resolveSelection(table, sm, range) ── P2 ──► ResolveResult
                                                            { ok: true, startChar, endChar, excerpt }
                                                            { ok: false, reason: 'empty'|'generated'|'unaligned' }
                                                            │
   BranchSource ──► renderUnderlines ─► wrapRange(table, canonicalRange, attrs) ── P3 ──► per-text-node <span.expound-mark>
                                     │
                                     └─► self-heal: canonicalize(rawSlice) === canonicalize(excerpt) ? stored : re-resolve via sm.canonical
```

The alignment table is computed once per `renderUnderlines` pass and once per
`captureSelection`/`showToolbarFromSelection`/`onContextMenu` call. `wrapRange`
and `resolveSelection` share it.

---

## File layout (touch list)

| File | Action |
|---|---|
| `src/lib/chat/selection.ts` | **New.** Types `AlignmentTable`, `AlignmentEntry`, `ResolveResult`, `ResolvedOffsets`; helpers `alignDomToCanonical`, `resolveSelection`, `canonicalize`; exported const `EXCLUDED_CHROME_SELECTORS`. |
| `src/lib/chat/selection.test.ts` | **New.** Pure-resolver tests (mocked `AlignmentTable`) + jsdom tests of `alignDomToCanonical` and `resolveSelection` end-to-end across the §3.3 fixture corpus. |
| `src/lib/markdown/wrap-range.ts` | **New.** `wrapRange(table, canonicalRange, attrs)`; jsdom-tested. |
| `src/lib/markdown/wrap-range.test.ts` | **New.** Single-node wrap, cross-`<strong>` wrap, cross-`<p>` wrap, idempotency, read-only skip. |
| `src/lib/components/chat/Highlighter.svelte` | **Edit.** Replace `resolveSelectionOffsets`+fallback with `resolveSelection`; replace `findOccurrence`+`surroundContents` with `alignDomToCanonical`+`wrapRange`; add self-heal + dev drift upgrade. |
| `src/lib/components/chat/ContextMenu.svelte` | **Edit.** Per-reason disable hint (`generated`, `unaligned`, overlap). |
| `src/lib/stores/chat.svelte.ts` | **Edit.** `createExpoundBranch` takes `ResolvedOffsets`; delete `branchFromSelection`; drop `resolveSelectionOffsets` import + fallback; fix the stale doc comment at `chat.svelte.ts:588-592`. |
| `src/lib/stores/chat.svelte.test.ts` | **Edit.** Build `ResolvedOffsets` literals in the `createExpoundBranch` block; delete the `branchFromSelection` block (`chat.svelte.test.ts:107-157`). |
| `src/lib/components/chat/MessageRow.svelte` | **Edit.** Replace `SelectionInput` import with `ResolvedOffsets`. |
| `src/lib/components/chat/MessageList.svelte` | **Edit.** Same. |
| `src/routes/chat/[id]/+page.svelte` | **Edit.** Same; `onExpound` handler receives `ResolvedOffsets`. |
| `src/lib/chat/expound.ts` | **Edit.** Header comment at `expound.ts:7-12` ("as resolved by `resolveSelectionOffsets` + the full-span fallback") → "as resolved by `resolveSelection` against the source map". |
| `src/lib/chat/highlight.ts` | **Delete** (deferred to P4 — keep until P2+P3 ships so any late discoverer of the old API gets a clean TypeScript break, not a silent runtime regression). *Actually delete here*: see step 8 — the grep sweep requires zero hits of `resolveSelectionOffsets`. **Delete in this PR.** |
| `src/lib/chat/highlight.test.ts` | **Delete** in this PR (replaced by `selection.test.ts`). |

> Net: P2+P3 also performs the P4 cleanup for `highlight.ts` since leaving it
> doubles the surface area and the grep sweep is an acceptance gate. The P4
> dedupe of in-component `collapse`/`findOccurrence` (Highlighter.svelte:266-321)
> is folded in here too — those functions are deleted as `wrapRange` +
> `canonicalize` supersede them. A separate P4 plan is no longer needed.

---

## Phase 1 — `src/lib/chat/selection.ts` types + `canonicalize`

### 1.1 Types

```ts
// src/lib/chat/selection.ts
import type { SourceMap, SegmentKind } from '$lib/markdown/sourcemap';

export interface ResolvedOffsets {
	startChar: number;
	endChar: number;
	excerpt: string;
}

export type ResolveReason = 'empty' | 'generated' | 'unaligned';

export type ResolveResult =
	| ({ ok: true } & ResolvedOffsets)
	| { ok: false; reason: ResolveReason };

export interface AlignmentEntry {
	node: Text;
	/** Start index into `SourceMap.canonical` (inclusive). */
	canonicalStart: number;
	/** End index into `SourceMap.canonical` (exclusive). */
	canonicalEnd: number;
	/** The owning segment's kind. */
	segmentKind: SegmentKind;
	/** True if this DOM text node is excluded chrome (copy btn, katex, mermaid SVG, callout title). */
	excluded: boolean;
}

export interface AlignmentTable {
	entries: AlignmentEntry[];
	/**
	 * False when at least one non-excluded DOM text node did not match
	 * `canonical` at the cursor (DOM has drifted from the map).
	 */
	aligned: boolean;
	unalignedNode: Text | null;
}

export const EXCLUDED_CHROME_SELECTORS = [
	'.katex',
	'.callout-title',
	'code.language-mermaid',
	'.md-copy-btn',
	'.mermaid-svg'
] as const;
```

### 1.2 `canonicalize`

```ts
/**
 * Single-pass whitespace normalization: runs of whitespace collapse to a
 * single space; leading/trailing trimmed. No syntax stripping (the source
 * map makes that unnecessary). Used by P3 self-heal to compare a stored
 * excerpt against the raw markdown slice.
 */
export function canonicalize(s: string): string;
```

Behavior matches `collapse(s).collapsed` from the current `highlight.ts:62-89`
minus the `toOriginal` map (not needed — we re-resolve via the source map, not
via offset arithmetic).

---

## Phase 2 — `alignDomToCanonical(container, sm)`

DOM-touching helper. Walks `container`'s text nodes in document order
(`document.createTreeWalker(container, NodeFilter.SHOW_TEXT)`) and streams
them against `sm.canonical`:

```ts
export function alignDomToCanonical(container: HTMLElement, sm: SourceMap): AlignmentTable;
```

Algorithm:

1. `cursor = 0` into `sm.canonical`; `entries = []; aligned = true; unalignedNode = null`.
2. For each text node `n` in document order:
   1. Classify `n` via `EXCLUDED_CHROME_SELECTORS`: if `n.parentElement?.closest(sel)`
      for any selector → push an entry with `excluded: true`, `canonicalStart =
      canonicalEnd = cursor` (excluded nodes consume no canonical text),
      `segmentKind` = the kind of the segment at `cursor - 1` or `cursor`
      (used only for the dev drift assertion), and **do not advance** `cursor`.
   2. Else: assert `sm.canonical.startsWith(n.textContent, cursor)`.
      - If yes: derive `segmentKind` from `sm.canonicalToSegment[cursor]` (and
        verify it stays constant across `[cursor, cursor + len)` — if it crosses
        a segment boundary inside one DOM text node, split the entry at the
        boundary so each entry maps to exactly one segment kind). Push the
        entry; advance `cursor += len`.
      - If no: set `aligned = false`, `unalignedNode = n`, push nothing further
        for this node, continue walking (so the table still covers the rest of
        the DOM — useful for partial resolves in dev diagnostics).
3. Return `{ entries, aligned, unalignedNode }`.

**Boundary-crossing inside one DOM text node:** remark-rehype emits e.g.
`<p>Hello <strong>world</strong>.</p>` as three text nodes
(`"Hello "`, `"world"`, `"."`), so segment boundaries typically align with DOM
text-node boundaries. The split-entry branch is defensive (covers e.g. raw HTML
that sanitize rewrites); it does not split the DOM node, only the *entry* record.

**jsdom test fixtures** (group B of `sourcemap.test.ts:227-251` already covers
canonical equality; reuse the same fixtures end-to-end through `renderMarkdown`):
every fixture must produce `aligned: true` with `entries` whose non-excluded
text sums to `sm.canonical`.

---

## Phase 3 — `resolveSelection(table, sm, range)`

Pure resolver. Takes the alignment table, the source map, and a DOM `Range`
(captured at context-menu / toolbar time). Returns a `ResolveResult`.

```ts
export function resolveSelection(
	table: AlignmentTable,
	sm: SourceMap,
	range: Range
): ResolveResult;
```

Algorithm:

1. **Empty check.** If `range.collapsed` or the range's text content trims to
   `''` → `{ ok: false, reason: 'empty' }`.
2. **Aligned check.** If `!table.aligned` AND `table.unalignedNode` is inside
   `range` → `{ ok: false, reason: 'unaligned' }`.
3. **Compute canonical `[startCanonical, endCanonical)`.** Walk `table.entries`
   in order; for each non-excluded entry whose `node` is inside `range`:
   - If `node === range.startContainer`: contribute from
     `canonicalStart + range.startOffset` to `canonicalEnd`.
   - Else if `node === range.endContainer`: contribute from `canonicalStart` to
     `canonicalStart + range.endOffset`.
   - Else (fully inside the range): contribute the full entry.
   - Track the min start and max end across contributions → `[startCanonical,
     endCanonical)`.
   - If no contribution → `{ ok: false, reason: 'empty' }`.
4. **Excluded-chrome-in-range check.** If any *excluded* entry's `node` is
   inside `range` (excluding the boundary case where `range.endOffset === 0` at
   the start of an excluded node, or `range.startOffset === node.length` at the
   end of one) → `{ ok: false, reason: 'generated' }`.
5. **Segment-kind check.** For each canonical index in
   `[startCanonical, endCanonical)`, look up `sm.canonicalToSegment[i]` →
   `sm.segments[kind]`. If any kind ∈ `{ 'math-inline', 'math-display',
   'mermaid' }` → `{ ok: false, reason: 'generated' }`.
6. **Clamp inter-block-ws endpoints.**
   - If `sm.segments[sm.canonicalToSegment[startCanonical]].kind === 'inter-block-ws'`:
     advance `startCanonical` forward to the start of the next non-ws segment
     (or return `empty` if there is none in `[startCanonical, endCanonical)`).
   - Symmetric for `endCanonical`: if the end's segment is `inter-block-ws`,
     pull `endCanonical` back to the end of the previous non-ws segment.
7. **Map to raw offsets, clamped per segment.** Let
   `firstIdx = sm.canonicalToSegment[startCanonical]`,
   `lastIdx = sm.canonicalToSegment[endCanonical - 1]`.
   - `startChar = sm.segments[firstIdx].startChar + (startCanonical -
     <canonical offset of firstIdx's start>)` — i.e. for partial-segment starts,
     offset within the segment's rendered string.
   - `endChar = sm.segments[lastIdx].startChar + (endCanonical -
     <canonical offset of lastIdx's start>)`.
   - For `inter-block-ws` segments (whose `startChar`/`endChar` are the
     synthetic `[prevEnd, nextStart]` from P0): the clamp in step 6 already
     excludes them from `[firstIdx, lastIdx]`, so this branch is unreachable
     here; document it.
8. **Build excerpt.** `excerpt = sm.canonical.slice(startCanonical, endCanonical)`.
9. **Final invariant.** Assert `sm.canonical.slice(startCanonical, endCanonical)
   === excerpt` (trivially true). Also assert that
   `raw.slice(startChar, endChar)` — passed in by the caller — canonicalizes to
   `canonicalize(excerpt)` when the caller provides `raw` (it does, via
   `Highlighter.raw`). For the pure function, this check is the caller's
   responsibility; document it.
10. Return `{ ok: true, startChar, endChar, excerpt }`.

> **Note on inter-block-ws raw ranges.** P0 (`sourcemap.ts:249-272`) sets
> `inter-block-ws` segments' `[startChar, endChar]` to `[prevEnd, nextStart]`,
> which straddles real raw content. Step 6's clamp ensures these segments are
> never inside the resolved `[firstIdx, lastIdx]` — only at its boundary, where
> the clamp consumes them. This means a selection like "end of paragraph 1 +
> all of paragraph 2" resolves cleanly: the trailing ws of paragraph 1 is
> clamped to `paragraph1.endChar`, and `[firstIdx, lastIdx]` covers paragraph 1
> + paragraph 2 only.

### Pure-resolver tests (`selection.test.ts`, mocked `AlignmentTable`)

The fixtures from `sourcemap.test.ts:227-251` are reused (group B already
asserts `canonical === filtered DOM textContent`). For each fixture, the test
parses the raw markdown, builds a synthetic `AlignmentTable` from
`sm.canonical` (one entry per character, all `excluded: false`, `aligned: true`,
segment kinds from `sm.canonicalToSegment`), constructs a `Range` over a
synthetic jsdom document, and asserts:

- **Plain prose** "Hello world." selecting "world" → exact raw range.
- **Bold** "Hello **world**." selecting "world" → raw range covers the inner
  text only (not the `**`); `raw.slice(s, e) === 'world'`.
- **Link** "[the label](u)" selecting "the label" → raw range covers `[1, 10)`;
  the URL has no segment.
- **Inline code** "`inline code`" selecting "inline code" → raw range covers
  the inner text (backticks stripped, P0 has already adjusted offsets in
  `sourcemap.ts:201-203`).
- **Duplicate prose** "the cat chased the bird in the tree" selecting the
  *second* "the" → resolves to the second raw range, not the first. The pure
  resolver gets this for free because the Range's startContainer/startOffset
  disambiguates which canonical indices are in play — there's no substring
  search.
- **Cross-`<strong>`/`<code>`/`<a>` selection** "> - **a** [b](u) `c`"
  selecting "a b c" → raw range spans the markdown markers across all three
  inline elements.
- **Generated content (mermaid)** "before\n```mermaid\nA->B\n```\nafter"
  selecting across the mermaid block → `{ ok: false, reason: 'generated' }`.
- **Generated content (math)** "Text with $x^2$ inline." selecting across the
  `$x^2$` → `{ ok: false, reason: 'generated' }`.
- **Generated content (copy button)** synthetic DOM with a `.md-copy-btn` text
  node inside the range → `{ ok: false, reason: 'generated' }`.
- **Inter-block-ws clamp** two paragraphs, selection starts at end of P1 and
  ends mid-P2 → `startChar` snaps to P1's end, `endChar` is mid-P2 (no ws
  contribution).
- **Empty selection** collapsed range → `{ ok: false, reason: 'empty' }`.
- **Unaligned** `table.aligned === false` and the unaligned node is in range →
  `{ ok: false, reason: 'unaligned' }`.

### End-to-end align+resolve tests (jsdom)

For each fixture in group B of `sourcemap.test.ts`: render via
`renderMarkdown(raw)`, mount in jsdom, run `alignDomToCanonical` +
`resolveSelection` against a programmatically-constructed `Range` covering the
expected prose, assert the resolved offsets match the raw slice.

---

## Phase 4 — `src/lib/markdown/wrap-range.ts`

```ts
import type { AlignmentTable } from '$lib/chat/selection';

export interface WrapAttrs {
	'data-branch-chat': string;
}

export type WrapResult =
	| { ok: true; wrapped: number } /* count of text nodes wrapped */
	| { ok: false; reason: 'empty' | 'unaligned' };

/**
 * Wrap every text node (or partial text node) contributing to the canonical
 * range [startCanonical, endCanonical) in a fresh
 * `<span class="expound-mark" data-branch-chat="…">`. Splits text nodes at
 * the boundaries via `node.splitText(offset)` when the boundary isn't already
 * at a node edge. Never calls `Range.surroundContents`; never throws.
 *
 * Caller (renderUnderlines) is responsible for unwrapping prior marks and
 * for the signature/idempotency guard. wrapRange is a primitive: one canonical
 * range → N adjacent spans.
 */
export function wrapRange(
	table: AlignmentTable,
	startCanonical: number,
	endCanonical: number,
	attrs: WrapAttrs
): WrapResult;
```

Algorithm:

1. Validate `[startCanonical, endCanonical)` ∈ `[0, sm.canonical.length]` and
   `startCanonical < endCanonical`; else `{ ok: false, reason: 'empty' }`.
2. Walk `table.entries` (non-excluded only). For each entry that overlaps
   `[startCanonical, endCanonical)`:
   - Compute `localStart = max(0, startCanonical - entry.canonicalStart)` and
     `localEnd = min(entry.canonicalEnd, endCanonical) - entry.canonicalStart`.
   - If `localStart > 0` and the node has a previous non-wrapped sibling text
     at the boundary: call `entry.node.splitText(localStart)` to break off the
     pre-range text; the returned new node is now the target.
     `splitText` updates `entry.node` to contain only the pre-range text and
     returns the new post-split node — rebind the target to the new node and
     adjust `localEnd` accordingly (it does not change since the new node
     starts at `localStart`).
   - If `localEnd < entry.node.length`: call `target.splitText(localEnd -
     localStart)` to break off the post-range text.
   - Wrap `target` in a new `<span class="expound-mark">` with `attrs`.
   - Increment `wrapped`.
3. If `wrapped === 0` → `{ ok: false, reason: 'unaligned' }` (the canonical
   range didn't intersect any aligned DOM text — table drift).
4. Return `{ ok: true, wrapped }`.

**Read-only / unsplittable nodes:** none exist in this DOM (the rendered
markdown body is fully editable script-side), but if `splitText` ever throws
`DOMException` (e.g. a future Shadow DOM root), catch it, log in dev, and skip
that entry — never propagate.

### Tests (`wrap-range.test.ts`, jsdom)

- **Single text node**: `<p>Hello world</p>` wrap canonical `[0, 5)` → one
  `<span class="expound-mark">Hello</span>world`, exact range.
- **Partial text node at end**: `<p>Hello world</p>` wrap `[2, 7)` →
  `He<span>llo w</span>orld`.
- **Cross-`<strong>`**: `<p>one <strong>two</strong> three</p>` wrap "one two"
  → two `<span class="expound-mark">` (one wrapping the bare `"one "`, one
  wrapping the `<strong>` text `"two"`). No throw.
- **Cross-`<a>`**: same shape with `<a>` instead of `<strong>`.
- **Cross-`<p>` (two siblings)**: `<p>foo</p><p>bar</p>` wrap canonical
  covering `"foo"` + inter-block-ws + `"bar"` → two mark spans (one per `<p>`).
  Inter-block-ws contributes no text node (it's canonical-only), so this just
  wraps each content text node in turn.
- **Empty range** → `{ ok: false, reason: 'empty' }`.
- **Idempotency**: caller unwraps prior marks before calling; verify wrapRange
  itself doesn't double-wrap when the same target is passed twice in a row
  (defensive — the caller's signature guard already prevents this).

---

## Phase 5 — `Highlighter.svelte` wiring

### 5.1 Imports + state (replaces `Highlighter.svelte:5-6, 44-55`)

```ts
import { alignDomToCanonical, resolveSelection, type ResolvedOffsets } from '$lib/chat/selection';
import { wrapRange } from '$lib/markdown/wrap-range';
```

Replace `pendingSel: SelectionInput | null` with `pendingRange: Range | null`
(the live Range captured at menu-open time). Replace `resolvedPending` with
a `$derived` over the current `Range`:

```ts
const resolvedPending = $derived(
	pendingRange && container
		? resolveSelection(alignDomToCanonical(container, sourceMap), sourceMap, pendingRange)
		: null
);
const disabledExpound = $derived(
	resolvedPending !== null &&
		(!resolvedPending.ok ||
			selectionOverlapsExisting(
				resolvedPending.ok
					? resolvedPending
					: { startChar: -1, endChar: -1 },
				existingSpans
			))
);
const disableReason = $derived(
	!resolvedPending || resolvedPending.ok
		? (disabledExpound ? 'This excerpt already belongs to an expound branch.' : '')
		: resolvedPending.reason === 'generated'
			? "Can't branch from a rendered diagram or formula."
			: resolvedPending.reason === 'unaligned'
				? "Selection can't be mapped to the source text."
				: ''
);
```

> `selectionOverlapsExisting` only runs when `resolvedPending.ok` is true: a
> `{ ok: false }` result already disables Expound via the `!resolvedPending.ok`
> short-circuit, so overlap is irrelevant.

### 5.2 `captureSelection` (replaces `Highlighter.svelte:93-116`)

Drop the `SelectionInput` construction; instead return a cloned `Range` (live
Ranges can mutate as the user clicks the menu):

```ts
function captureRange(): Range | null {
	if (!container) return null;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return null;
	if (!range.toString().trim()) return null;
	return range.cloneRange();
}
```

`onContextMenu`/`showToolbarFromSelection` store `pendingRange = captureRange()`
instead of `pendingSel = captureSelection()`. `selectionToolbar.sel` becomes
`selectionToolbar.range`.

### 5.3 `submitConstructor` (replaces `Highlighter.svelte:228-234`)

```ts
function submitConstructor(opts: ExpoundOptions) {
	if (!constructorState) return;
	const { range, resolved } = constructorState;
	constructorState = null;
	pendingRange = null;
	if (!resolved?.ok) return; // defense-in-depth; menu already disabled.
	void onExpound(raw, resolved, opts);
}
```

`constructorState` carries `{ range: Range; resolved: ResolvedOffsets; x; y }`
— the resolve happens at menu-open so the disabled state and the constructor
share a single source of truth.

### 5.4 `renderUnderlines` (replaces `Highlighter.svelte:326-386`)

Keep: the `lastSignature` guard, the unwrap-prior-marks loop
(`Highlighter.svelte:351-357`), the `MutationObserver` (395-397), the
`existingSpans.length === 0` early return (359). Replace the find/locate/
`surroundContents` block (361-385) with:

```ts
const table = alignDomToCanonical(c, sourceMap);
if (!table.aligned) {
	if (import.meta.env.DEV) {
		console.warn('[expound] alignment failed; skipping underline pass', { messageId });
	}
	return;
}

for (const span of existingSpans) {
	const { startChar, endChar, excerpt } = span;
	const rawSlice = raw.slice(startChar, endChar);
	let canonicalStart: number;
	let canonicalEnd: number;

	if (canonicalize(rawSlice) === canonicalize(excerpt)) {
		// Fast path: stored offsets are correct.
		const hit = locateCanonical(sourceMap, startChar, endChar);
		if (!hit) continue;
		({ start: canonicalStart, end: canonicalEnd } = hit);
	} else {
		// Self-heal: re-resolve via canonical search.
		const healed = selfHeal(sourceMap, excerpt, span.startChar);
		if (!healed) {
			if (import.meta.env.DEV) {
				console.warn('[expound] self-heal failed', {
					messageId, spanId: span.id, excerpt, startChar, endChar
				});
			}
			continue;
		}
		({ start: canonicalStart, end: canonicalEnd } = healed);
	}

	wrapRange(table, canonicalStart, canonicalEnd, { 'data-branch-chat': span.branchChatId });
}
```

Where `locateCanonical(sm, startChar, endChar)` finds the canonical range
whose segments' raw offsets are `[startChar, endChar)` (linear scan over
`sm.segments` — small), and `selfHeal(sm, excerpt, preferredStart)` finds
`excerpt` in `sm.canonical` (with `canonicalize` equality to tolerate ws
reflow), preferring the occurrence whose raw `startChar` is closest to
`preferredStart` (so a stale row under the old heuristic lands at the
occurrence the original heuristic was aiming at, not a random one).

### 5.5 Self-heal helpers (private to `Highlighter.svelte`)

```ts
function locateCanonical(
	sm: SourceMap,
	startChar: number,
	endChar: number
): { start: number; end: number } | null {
	// Scan segments; find contiguous run whose [seg.startChar, seg.endChar)
	// union equals [startChar, endChar). Inter-block-ws segments contribute
	// no canonical text but their range straddles content — skip them as
	// boundaries.
}

function selfHeal(
	sm: SourceMap,
	excerpt: string,
	preferredStart: number
): { start: number; end: number } | null {
	// canonicalize both sides; find all matches of canonicalize(excerpt) in
	// canonicalize(sm.canonical); map each match's [0, len) back to original
	// canonical indices via a parallel map (mirroring collapse's toOriginal
	// from highlight.ts:62-89); for each, compute the raw startChar via
	// sm.segments[sm.canonicalToSegment[i]].startChar; pick the one closest
	// to preferredStart. Return null if no match.
}
```

> `canonicalize` is the same function from `selection.ts` — imported, not
> redefined. The `toOriginal`-style parallel-map logic lives inside `selfHeal`
> (it's needed only here, not in `resolveSelection`).

### 5.6 Upgrade the P1 drift `$effect` (replaces `Highlighter.svelte:400-413`)

```ts
$effect(() => {
	if (!import.meta.env.DEV) return;
	const c = container;
	if (!c) return;
	const table = alignDomToCanonical(c, sourceMap);
	const filtered = table.entries
		.filter((e) => !e.excluded)
		.map((e) => e.node.textContent ?? '')
		.join('');
	if (filtered !== sourceMap.canonical) {
		console.warn('[expound] source map canonical diverges from filtered DOM textContent', {
			messageId,
			canonicalLen: sourceMap.canonical.length,
			domLen: filtered.length
		});
	}
});
```

---

## Phase 6 — `ContextMenu.svelte` per-reason hint

`ContextMenu.svelte` already takes `disabledExpound` + `disableHint`. The
hint string is computed in `Highlighter.disableReason` (phase 5.1) and passed
through unchanged. No `ContextMenu.svelte` source change required unless the
caller wants distinct styling per reason — keep the existing single `disableHint`
prop; the per-reason logic lives in `Highlighter`.

---

## Phase 7 — Store + component prop type migration

### 7.1 `chatStore.createExpoundBranch` (replaces `chat.svelte.ts:781-813`)

```ts
async createExpoundBranch(
	messageId: string,
	rawContent: string,
	resolved: ResolvedOffsets,
	prompt: string,
	expoundOpts?: ExpoundOptions
): Promise<string> {
	const existing = await repos.branchSources.listBySourceMessage(messageId);
	if (selectionOverlapsExisting(resolved, existing)) {
		throw new ExcerptOverlapError();
	}

	const childId = await this.createBranchChild(
		messageId,
		resolved.startChar,
		resolved.endChar,
		resolved.excerpt,
		expoundOpts ? { /* same as today */ } : undefined
	);
	this.pendingPrompt = { text: prompt, hidden: true };
	return childId;
}
```

Drop the `resolveSelectionOffsets` import + the fallback. The defense-in-depth
(the caller disables the menu on `ok: false`) is now structural: the store's
input type is `ResolvedOffsets`, not `SelectionInput`, so an unresolved
selection is a TypeScript error at the call site.

### 7.2 Delete `chatStore.branchFromSelection` (`chat.svelte.ts:761-772`)

Unused by UI; only its own tests at `chat.svelte.test.ts:108-157` referenced
it. Delete the method and both tests.

### 7.3 `MessageRow.svelte`, `MessageList.svelte`, `+page.svelte`

Replace every `SelectionInput` reference with `ResolvedOffsets`:

- `MessageRow.svelte:10, 26` (import + `onExpound` prop type).
- `MessageList.svelte:9, 32` (same).
- `+page.svelte:38, 372, 377` (import + `onExpound` signature + call site).

`+page.svelte`'s `onExpound` becomes:

```ts
async function onExpound(
	messageId: string,
	raw: string,
	resolved: ResolvedOffsets,
	opts: ExpoundOptions
) {
	const prompt = buildExpoundPrompt(opts);
	// ... same error handling ...
	const childId = await chatStore.createExpoundBranch(messageId, raw, resolved, prompt, opts);
	await goto(`/chat/${childId}`);
}
```

### 7.4 `expound.ts` header comment

`expound.ts:7-12`: replace "as resolved by `resolveSelectionOffsets` + the
full-span fallback" with "as resolved by `resolveSelection` against the source
map (`src/lib/chat/selection.ts`); an unresolved selection disables the menu
before reaching the store".

### 7.5 Delete `highlight.ts` + `highlight.test.ts`

Both files deleted in this PR. `selection.test.ts` is the successor;
`selection.ts` is the new home for `ResolvedOffsets` (re-exported from there
so existing `import type { ResolvedOffsets }` sites compile).

---

## Phase 8 — Test updates

### 8.1 `chat.svelte.test.ts`

- Delete the `describe('chatStore branching round-trip')` block at
  `chat.svelte.test.ts:107-172` (both `branchFromSelection` tests + the
  `branchFromMessage` test is unrelated and stays — verify by reading; the
  block at 159-172 is `branchFromMessage`, keep it).
- Rewrite the `describe('chatStore.createExpoundBranch')` block at
  `chat.svelte.test.ts:188-375` to build `ResolvedOffsets` literals
  directly instead of `SelectionInput`. Example:

  ```ts
  const start = reply.indexOf('powerhouse');
  const end = start + 'powerhouse of the cell'.length;
  const childId = await chatStore.createExpoundBranch(
	  assistant.id,
	  reply,
	  { startChar: start, endChar: end, excerpt: 'powerhouse of the cell' },
	  prompt
  );
  ```

  All five tests in that block convert cleanly (the assertions on
  `src.startChar`/`src.endChar` stay identical).

### 8.2 New test files

- `src/lib/chat/selection.test.ts` — Phase 1/2/3 tests above.
- `src/lib/markdown/wrap-range.test.ts` — Phase 4 tests above.

### 8.3 Grep sweep (acceptance gate, must be zero hits in `src/`)

```
resolveSelectionOffsets | collapseStripped | MARKDOWN_SYNTAX |
surroundContents | findOccurrence | branchFromSelection | SelectionInput
```

(All seven patterns must be absent after this PR.)

---

## Validation

### Automated

- `pnpm check` — typechecks the new `selection.ts`/`wrap-range.ts` and the
  updated `Highlighter.svelte`/store/components.
- `pnpm lint` — ESLint + Prettier clean; no unused imports (the deleted
  `collapse`/`findOccurrence` from `Highlighter.svelte`).
- `pnpm test` (root) — green; `selection.test.ts`, `wrap-range.test.ts`,
  `sourcemap.test.ts`, and the updated `chat.svelte.test.ts` all pass.
- `pnpm --filter @mayon/server test` — untouched (no server change); run only
  if `pnpm test` somehow touches shared code (it doesn't).

### Manual (the real P2+P3 gate — `refinement/2026-07-19_expound-source-map.md` §9)

`pnpm dev:deps && pnpm dev`, then open a chat and trigger an assistant reply
containing, in one message: plain prose, `**bold**`, `[a link](u)`,
`` `inline code` ``, a fenced non-mermaid code block, a bulleted list, a GFM
table, an admonition (`> [!NOTE] …`), inline math `$x^2$`, display math
`$$…$$`, and a ```` ```mermaid ```` block.

- **Across emphasis:** select a span crossing `**bold**` + `` `code` `` +
  `[link](u)` → Expound → underline covers exactly the selected characters,
  including across the element boundaries. Verify in DevTools that the
  underline is N adjacent `<span class="expound-mark">` (one per text node).
- **Duplicate prose:** reply containing `"the cat chased the bird in the
  tree"` → select the **second** "the" → underline is on the second "the",
  not the first or third. (No substring search → trivially correct.)
- **Lists / tables:** select across list items / table cells → underline lands
  exactly; no off-by-N drift from stripped markers/pipes.
- **Generated content — Mermaid:** select over a rendered Mermaid diagram →
  Expound is **disabled** with the hint "Can't branch from a rendered diagram
  or formula."
- **Generated content — math:** select over `$E=mc^2$` rendered output →
  disabled with the same hint.
- **Copy button:** select prose that happens to include a code block's "Copy"
  button text → disabled (the button is excluded chrome).
- **Cross-paragraph:** select from end of paragraph 1 into paragraph 2 →
  underline spans both, no ws contribution to the stored offsets.
- **Self-heal:** with an existing DB row stored under the old heuristic whose
  `raw.slice(start,end)` ≠ excerpt → reload → the underline now lands
  correctly (re-resolved in memory); verify via the `branch_sources` row being
  unchanged (no DB write). Check the dev console: no `[expound] self-heal
  failed` warning on a row that should heal; warnings only for genuinely
  unresolvable rows.
- **Drift assertion silent:** the dev console shows **no**
  `[expound] source map canonical diverges from filtered DOM textContent`
  warning for the representative message.
- **Persistence:** reload the tab → the underline survives and still lands
  exactly on the highlighted span.
- **Grep sweep:** zero hits for the seven patterns in §8.3 across `src/`.

### Out of scope for P2+P3 acceptance

- The shared-processor refactor between `render.ts` and `sourcemap.ts`
  (deferred per `.kilo/plans/1784450252941-expound-source-map-p1.md` decision 2;
  `admonition` stage difference blocks it).
- Lazy write-back of self-healed offsets to the DB (refinement §11 explicitly
  out of scope).
- Multi-message selections (refinement §11 explicitly out of scope).
- Changing the `.expound-mark` visual style (CSS stays as-is).
- A separate P4 plan — the cleanup work (delete `highlight.ts`, dedupe
  `collapse`/`findOccurrence`) is folded into this PR.

---

## Risks / notes

- **Alignment cost per render.** `alignDomToCanonical` walks every text node
  on every `renderUnderlines` pass and every context-menu open. The signature
  guard already short-circuits identical passes; the per-open alignment is
  O(text nodes) and bounded by message size. If long messages jank, the lever
  is to cache the alignment table on the `$effect` that owns `container` and
  invalidate on MutationObserver — out of scope here, not anticipated.
- **Excluded-chrome selector set is brittle.** A future `Markdown.svelte`
  change that injects new chrome (e.g. a "fold" button on long code) would
  silently desync `canonical` from filtered `textContent` and trigger the
  `unaligned` reason. Mitigation: the upgraded dev drift `$effect` (phase 5.6)
  surfaces this loudly in dev before it ships.
- **`splitText` and the MutationObserver.** Per-text-node wrapping splits text
  nodes; the observer sees the splits as mutations. The signature guard
  (`fullText + existingSpans`) is computed from `textContent`, which doesn't
  change under splitting, so the loop terminates. Verify in the manual gate
  with a long message + a re-render (e.g. theme toggle) — the underline must
  not flicker or duplicate.
- **`data-branch-chat` attribute on multiple spans.** Today's
  `surroundContents` produces one span per excerpt; the new code produces N
  (one per text node). The click handler at `Highlighter.svelte:191-203` uses
  `.closest('.expound-mark')` so it works for any of the N spans; verify in
  the manual gate that clicking any of the N underlines opens the popover.
- **Streaming rebuild.** `sourceMap` re-derives per token (P1 decision 6). The
  underline pass is gated by `existingSpans.length > 0`, which is false
  mid-stream for the streaming message. Other messages' underlines are
  unaffected by the stream.
- **Self-heal `preferredStart` heuristic.** Picking the canonical occurrence
  whose raw `startChar` is closest to the stored `span.startChar` is the
  most charitable reading of a stale row. It can be wrong if the old heuristic
  picked a wildly off offset; in that case the underline lands somewhere
  plausible but not exactly where the user originally clicked. Accepted: the
  self-heal is a one-time bridge for old rows; new rows are always exact.
- **`branchFromSelection` deletion is a public API change.** The method is
  undocumented and unused by UI; if any external consumer (e.g. a future
  MCP/test harness) depended on it, they break. Acceptable: the method was
  always test-internal in practice.

---

## Open questions (none blocking)

- Should `wrapRange` return the wrapped `<span>` list for the caller to attach
  extra data (e.g. `data-branch-source-id`)? **No** — the current
  `.expound-mark` + `data-branch-chat` attrs are sufficient for the click
  handler; keep `wrapRange` a primitive.
- Should the dev drift `$effect` also assert the *inverse* (DOM textContent
  longer than canonical is fine, but flag if it's *shorter*)? Already covered
  by the strict equality check (excluded chrome makes DOM strictly longer, so
  filtered DOM must equal canonical exactly).
