# Plan — Expound source map, P0: source map core (pure)

**Parent design:** `refinement/2026-07-19_expound-source-map.md` §3 (P0).
**Scope:** Ship the pure, DOM-free `buildSourceMap(raw)` that the later phases
(P1 wiring, P2 forward resolve, P3 reverse underline) consume. Nothing outside
`src/lib/markdown/` changes. No DB, no component, no `render.ts` change.

---

## Goal

`buildSourceMap(raw: string): SourceMap` walks the **hast** tree (produced by
`remark-parse → remark-gfm → remark-math → remark-rehype → admonition`) in
document order and emits one `Segment` per canonical-visible-text run, each
tagged with its `kind`, its `rendered` contribution to canonical visible text,
and a half-open `[startChar, endChar)` raw-markdown range. `SourceMap.canonical`
must equal the rendered DOM `textContent` **after** removing recognized excluded
chrome (`.katex`, `.callout-title`, `code.language-mermaid`) — locked by a jsdom
verification test across a fixture suite.

P0 ends when: `pnpm lint && pnpm check && pnpm test` is green, the new
`sourcemap.test.ts` passes (pure unit cases + jsdom canonical-equality cases),
and `sourcemap.ts` has zero DOM imports.

---

## Decisions (confirmed / resolved)

1. **Walk hast, not mdast.** (Confirmed with user.) The refinement's §3.2 said
   "walk mdast, no rehype stage"; we deviate because an mdast-only walk cannot
   reproduce (a) the exact `\n` text nodes `remark-rehype`+`rehype-stringify`
   inject between block siblings and inside tables, (b) the `admonition` rehype
   plugin's `[!NOTE]` → title transform, or (c) hard-break `\n`s. Empirically,
   every hast **content** text node inherits its mdast position (e.g.
   `<strong>` → `[6,10)` = `"bold"`; `<a>` text → `[14,17)` = `"lab"`), and every
   **generated** text node (inter-block `\n`, admonition title) is exactly the
   positionless one. So hast is the single source of truth for both the
   canonical string and the raw offsets.

2. **Standalone processor in `sourcemap.ts`.** P0 builds its own `unified()`
   instance (`remark-parse → remark-gfm → remark-math → remark-rehype →
   admonition`). It deliberately stops before `rehype-katex` / `rehype-highlight`
   / `rehype-sanitize` / `rehype-stringify`: we want the transformed tree
   (admonitions applied) but not the rendered-output noise. The shared-processor
   refactor with `render.ts` is **P1** (keeps P0 narrowly scoped and
   independently shippable). The plugin list and order here MUST match
   `render.ts`'s parse+bridge stage one-for-one — locked by a test assertion.

3. **Admonition position-preservation fix is a P0 prerequisite.** The current
   `admonition.ts` creates a fresh position-less text node for `bodyHead` (the
   text after `[!NOTE]` on the same line), which makes every admonition body
   unmappable. Fix: carry the original first-child text node's position onto the
   `bodyHead` text node (offset by `prefix.length`). Without this, canonical
   diverges from textContent for every message containing a callout, and P2
   alignment fails. Details in **Changes §1**.

4. **`link-text` segment kind is kept** (per refinement §3.1) but is
   behaviorally identical to `prose`; it's emitted only when the text node's
   nearest ancestor is `<a>`. This is a one-line context override during the
   walk and preserves the refinement's vocabulary without affecting offsets.

5. **Positionless text rule** (the core discriminator):
   - positionless **whitespace-only** → `inter-block-ws` (include in canonical;
     raw range = gap between neighbouring content segments).
   - positionless **non-whitespace** → **skip entirely** (treated as excluded
     chrome — e.g. admonition title "Note"). P2 alignment will skip the matching
     `.callout-title` DOM node symmetrically.
   - positioned text → `prose` (or `link-text` inside `<a>`).

6. **Inline-code inner range strips backticks.** A hast inline `<code>` element
   carries a position covering `` `c` `` (delimiters included) but its text
   child value is `"c"`. Derive inner range as `[pos.start+1, pos.end-1)`
   (single-backtick form). Verified empirically; locked by a test.

7. **Block-code inner range via deterministic fence parse.** The hast
   `<pre><code>` element's position covers the whole fenced block (including
   fences and language tag); its text child is position-less and equals the
   inner content plus a trailing `\n` that `remark-rehype` appends. Derive
   `[startChar, endChar)` by locating the first `\n` (end of opening fence) and
   the last `\n` + closing fence run inside the position window. `rendered` is
   taken from the hast text child (so the trailing `\n` is part of canonical,
   matching DOM textContent). Locked by fixtures including empty and indented
   fences.

8. **Hard break `<br>` emits a synthetic `\n` prose segment.** `rehype-stringify`
   emits `<br>\n`; the hast has no text node for that `\n`. To keep canonical
   aligned with DOM textContent we emit one `prose` segment with
   `rendered = "\n"` and the `<br>` element's position (which in mdast covers
   the `"  \n"` or `"\\\n"` source). Without this, canonical would read
   `"line1line2"` while the DOM reads `"line1\nline2"`.

9. **Math + mermaid segments carry `rendered: ''`** and the element's raw
   position. They mark a "hole" in canonical; the matching DOM chrome (`.katex`
   for math; `code.language-mermaid` for mermaid) is excluded on the DOM side of
   the verification test. Detection: hast `<code>` whose class list contains
   `math-inline` / `math-display` (math) or `language-mermaid` (mermaid, inside
   `<pre>`).

10. **Canonical-equality verification uses jsdom** (test-only; not in the
    module). The test renders each fixture through the **full** `renderMarkdown`
    pipeline, parses with jsdom, walks text nodes skipping excluded-chrome
    ancestors, and asserts the concatenated result equals `SourceMap.canonical`.
    Excluded-chrome selectors for P0: `.katex`, `.callout-title`,
    `code.language-mermaid` (and its `<pre>` parent). This is the single guard
    against whitespace / entity drift between the source map and the rendered
    DOM.

---

## Non-goals (explicitly out of P0)

- No change to `render.ts`, `Markdown.svelte`, `Highlighter.svelte`,
  `highlight.ts`, `chatStore`, or `expound.ts`. Those are P1+.
- No shared-processor refactor (P1).
- No forward/reverse mapping (P2/P3).
- No removal of the old `highlight.ts` heuristic (P4).
- No persistence / self-heal / write-back.
- HTML-entity edge cases (`&amp;` etc.) are covered by a fixture but no special
  decoding logic is added in P0; the segment's hast position covers the entity
  verbatim in raw, and `rendered` carries the decoded form — any divergence is
  reconciled by P3's `canonicalize` during self-heal, not here.

---

## Changes

### 1. `src/lib/markdown/admonition.ts` — preserve body positions (prerequisite)

The plugin currently builds `firstParagraphChildren` by pushing a brand-new
`{ type: 'text', value: bodyHead }` (around line 84-89), discarding the original
first-child text node's position. This makes the entire admonition body
unmappable.

Fix: when `bodyHead.length > 0`, compute the new text node's position from the
original `firstChild` text node's position:

```ts
// firstChild is the original text node carrying position info.
const origStart = firstChild.position?.start?.offset ?? null;
const origEnd = firstChild.position?.end?.offset ?? null;
const bodyHeadNode: HastText = { type: 'text', value: bodyHead };
if (origStart !== null && typeof origEnd === 'number') {
  bodyHeadNode.position = {
    start: { offset: origStart + prefix.length, line: firstChild.position!.start.line, column: firstChild.position!.start.column + prefix.length },
    end: { offset: origStart + prefix.length + bodyHead.length, line: firstChild.position!.start.line, column: firstChild.position!.start.column + prefix.length + bodyHead.length }
  };
}
```

(Line/column are best-effort; only `.offset` is consumed by `sourcemap.ts`.)
Reuse the same carry-over idea for any other freshly-created text nodes in the
plugin (audit `transformBlockquote`). Existing `admonition.test.ts` must stay
green — positions are additive, the tree shape and classes are unchanged.

### 2. `src/lib/markdown/sourcemap.ts` — new pure module

Exports the types from refinement §3.1 (verbatim) plus `buildSourceMap`:

```ts
export type SegmentKind =
  | 'prose' | 'inline-code' | 'block-code' | 'link-text'
  | 'math-inline' | 'math-display' | 'mermaid' | 'inter-block-ws';

export interface Segment {
  kind: SegmentKind;
  rendered: string;
  startChar: number;
  endChar: number;
}

export interface SourceMap {
  segments: Segment[];
  canonical: string;
  canonicalToSegment: number[];
}

export function buildSourceMap(raw: string): SourceMap;
```

Module body (pure — imports only `unified` + the same remark/admonition plugins
as `render.ts`'s parse+bridge stage; **no DOM**):

1. Build the processor once at module scope:
   `unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).use(admonition)`.
2. `parse(raw)` → mdast, `run(tree)` → hast. (Both are sync via `runSync`.)
3. Recursive `walk(node, linkOverride)` emitting segments into an array:
   - **root / element**: recurse children; for `<a>` pass `linkOverride='link-text'`.
   - **element `<br>`**: push `{ kind:'prose', rendered:'\n', startChar, endChar }`
     from the element position.
   - **element `<pre>`**: inspect its `<code>` child:
     - class contains `language-mermaid` → push `mermaid` segment
       `{ rendered:'', startChar, endChar }` from the `<pre>` (or `<code>`)
       position; do **not** recurse into the code text.
     - otherwise → push `block-code` segment with `rendered` = concatenation of
       descendant text values, and `[startChar, endChar)` from the
       fence-parsing helper (`codeInnerRange(raw, codePos)`); do not recurse.
   - **element `<code>` (inline, i.e. not inside `<pre>`)**:
     - class contains `math-inline` → push `math-inline`, `rendered:''`,
       range = element position; do not recurse.
     - class contains `math-display` → push `math-display`, likewise.
     - otherwise → push `inline-code` with `rendered` = descendant text
       concatenation and range = `[pos.start+1, pos.end-1)` (strip backticks);
       do not recurse.
   - **text node**:
     - has `position` → push `{ kind: linkOverride ?? 'prose', rendered: value,
       startChar: pos.start.offset, endChar: pos.end.offset }`.
     - no position, `/^\s*$/` → push `inter-block-ws` placeholder (range filled
       in step 4).
     - no position, non-whitespace → **skip** (excluded chrome; e.g. admonition
       title).
4. Post-pass: fill `inter-block-ws` ranges as the half-open gap between the
   previous and next positioned segment's raw offsets (clamped to
   `[0, raw.length]`); drop any `inter-block-ws` that ended up empty *and*
   rendered-empty.
5. Build `canonical = segments.map(s => s.rendered).join('')` and
   `canonicalToSegment` (parallel array, one entry per canonical char).
6. Return `{ segments, canonical, canonicalToSegment }`.

Helpers (private, same file):
- `codeInnerRange(raw, codePosStart, codePosEnd)` — locate first `\n` (end of
  opening fence) and the closing ```` ``` ```` run; return `[contentStart,
  contentEnd)`. Handle empty-fence and indented-fence edge cases; if parsing
  fails, fall back to the element position and log in dev (never throw).
- `textConcat(element)` — join all descendant `text` node values (for code
  blocks where highlight.js would later split text; here the pre-highlight tree
  has a single text child).

### 3. `src/lib/markdown/sourcemap.test.ts` — new test file

Two test groups:

**A. Pure unit tests** (`describe('buildSourceMap')`) — assert `segments`
(kind, rendered, startChar, endChar) and spot-check `canonical`:

- Plain prose round-trips 1:1; range covers the exact substring.
- `**bold text**` → one `prose` segment `rendered="bold text"`, range covers
  inner text only (not `**`).
- `[the label](https://example.com/x)` → one `link-text` segment
  `rendered="the label"`; URL has no segment.
- `` `inline code` `` → `inline-code`, `rendered="inline code"`, range excludes
  backticks; `raw.slice(start,end)` === `"inline code"`.
- Fenced non-mermaid block → `block-code` with full content; `raw.slice(start,
  end)` starts after the opening fence line and ends before the closing fence;
  `rendered` ends with `\n`.
- Empty fenced block (```` ```\n\n``` ````) → `block-code`, `rendered=""` (or
  `"\n"` per the tree — locked by fixture).
- Fenced ```` ```mermaid ```` → `mermaid`, `rendered=''`.
- `- a\n- b\nc` → two `prose` segments for the list text, separated by
  `inter-block-ws` whose `rendered` matches the DOM `\n`s exactly.
- GFM table → cell texts as `prose`, pipes stripped, `inter-block-ws` between
  cells/rows matching DOM output.
- `$x^2$` inline math → `math-inline`, `rendered=''`, range covers `$x^2$`.
- `$$\int x\,dx$$` display math → `math-display` (or `math-inline` if the
  remark-math/remark-rehype version collapses the distinction — assert which
  and lock it; either way `rendered=''`).
- `> - **a** [b](u) \`c\`` (nested blockquote + list + emphasis + link + code)
  → one segment per leaf, in document order, correct kinds and ranges.
- Hard break `line1  \nline2` → canonical === `"line1\nline2"`; the `<br>`
  contributes a `prose` segment with `rendered="\n"`.
- Admonition `> [!NOTE] body text\n> second line` → the title "Note" has **no**
  segment; the body text segments carry correct raw offsets (validates the
  `admonition.ts` position fix); canonical excludes "Note".
- Empty / whitespace-only input → `segments` is `[]` (or a single
  `inter-block-ws`), `canonical === ''` or whitespace, no throw.
- HTML entity `a &amp; b` → segment range covers the raw `&amp;`, `rendered`
  is the decoded form (lock the exact behavior; if remark keeps it encoded,
  assert that instead).

**B. Canonical-equality verification** (`describe('canonical === filtered DOM
textContent')`) — for each fixture, render via `renderMarkdown` (full pipeline),
parse with jsdom, walk text nodes excluding `.katex`, `.callout-title`,
`code.language-mermaid` (+ `<pre>` ancestor), and assert equality with
`buildSourceMap(raw).canonical`. Fixtures: every case from group A **plus**
multi-paragraph, nested lists, blockquote + code + list mix, table + prose
interleave, admonition with multi-line body, inline math mid-sentence, display
math between paragraphs, mermaid between paragraphs, message with a copy-button
`<pre>` (the copy button is added by `Markdown.svelte`, not by `render.ts`, so
it's absent here — note this in a comment).

**C. Processor-parity assertion** — one test that builds the sourcemap
processor and `render.ts`'s processor and asserts the remark-parse / gfm / math
/ rehype / admonition plugin list and order are identical (guards the P1
shared-processor refactor; catches drift if someone edits one without the
other).

---

## Validation

### Automated
- `pnpm test src/lib/markdown/sourcemap.test.ts` — new suite green.
- `pnpm test src/lib/markdown/admonition.test.ts` — existing suite still green
  (position carry-over is additive).
- `pnpm test src/lib/markdown/render.test.ts` — still green (no change to
  `render.ts`).
- Full gates: `pnpm lint && pnpm check && pnpm test` (root). Server tests
  untouched (`pnpm --filter @mayon/server test` — no server change).

### Manual (quick sanity, not a full gate)
- In a scratch `node -e` or a temp test: `buildSourceMap('Hello **world**.')`
  returns `canonical === 'Hello world.'` and the `world` segment's
  `[startChar, endChar)` slices to `"world"` in the raw. (This is covered by
  unit tests; the manual check is just a fast smoke.)

### Out of scope for P0 acceptance
- Browser / `pnpm dev` checks — those belong to P1+ (the map isn't wired into
  the component yet).
- Expound underline correctness — P3.

---

## Risks / notes

- **`remark-math` display-vs-inline class collapse.** My empirical check showed
  `$$…$$` producing a `math-inline` class on the hast `<code>`; this may be a
  remark-math/remark-rehype version artifact. Either way both kinds are
  `rendered:''` so P0 is unaffected; the test locks whichever the installed
  version produces so a future bump is caught.
- **HTML entities** (`&amp;`, `&#39;`, …). If `remark-parse` keeps the encoded
  form in text `value` while `remark-rehype` decodes, `rendered` (from hast)
  will be decoded while `raw.slice(start,end)` is encoded. P0's segment range is
  still correct (covers the entity); only P3's self-heal `canonicalize` needs to
  decode for comparison. The test locks the actual behavior so it's not a
  silent divergence.
- **`admonition.ts` position fix scope.** Only `bodyHead` (same-line text after
  `[!NOTE]`) is the proven gap; the audit in Changes §1 should check the
  `bq.children[i]` reuse path too, but that one already preserves positions
  (it reuses element references). If the fix touches more than `bodyHead`,
  expand `admonition.test.ts` to cover the new position assertions.
- **Streaming rebuilds.** `buildSourceMap` is cheap (single mdast/hast parse,
  no render-stage plugins). P1 will call it on every token; the cost is
  acceptable and noted in the refinement §10 risk table. Not a P0 concern.
- **Tables.** The inter-cell `\n`s come from `remark-rehype`'s hast
  serialization and appear as positionless whitespace text nodes — the walk
  picks them up natively. No hardcoded table rule is needed; the canonical
  fixture + jsdom equality test is the guard.
