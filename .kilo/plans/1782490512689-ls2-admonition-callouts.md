# LS2 — Admonition callouts (markdown pipeline)

**Epic:** mode-scoped teaching strategies (`refinement/learning-structure.md` §9,
`refinement/learning-structure-phased.md` LS2).
**Depends on:** LS1 (shipped — `src/lib/chat/strategies.ts` and the `Structure`
dropdown in `BriefCard.svelte` are live; the `workshop`/`guided-inquiry` blocks
already teach `> [!NOTE]` / `> [!WARNING]` / `> [!CONCEPT]`).
**Size:** S · **No DB change, no migration, no `db:generate`/`bundle:migrations`** —
pure rendering.

## Goal

`> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!CONCEPT]` / `[!INFO]` blocks emitted by
the strategy prompts render as styled shadcn-style callouts instead of plain
blockquotes with a literal `[!TYPE]`. This replaces the intentional LS1
degraded state (Build/Socratic callouts currently render as readable-but-plain
blockquotes).

## Locked decisions

1. **Implementation:** hand-rolled **rehype** plugin (hast → hast), **no new
   dependency.** Chosen so we can handle our non-standard types (`CONCEPT`,
   `INFO`), the same-line body shape the shipped prompts teach, and the
   unknown→neutral fallback exactly. (`remark-github-blockquote-alert` rejected:
   would need patching for our type set + semantics, and adds a runtime dep.)
2. **Title:** explicit DOM node `<p class="callout-title">` (selectable,
   screen-reader-friendly). The `<p>` sanitize allowlist is widened **only** for
   `/^callout-title$/` (bounded).
3. **Colors:** theme tokens in `app.css` (`--callout-info` / `--callout-warn` /
   `--callout-concept`, light + `.dark`), mirroring how `--destructive` is
   defined. Consumed by `Markdown.svelte`.

## Critical prompt fact (drives the parser)

The shipped `workshop` block teaches body text on the **same line** as the marker
(`strategies.ts:110-111`):

```
> [!NOTE] Terraform is declarative — you describe desired state; the tool reconciles.
> [!WARNING] Never commit the state file to git.
```

Therefore the parser **must not** require the marker to be alone on its line
(strict GitHub Alerts do). It matches `^\[!(\w+)\][ \t]*` at the start of the
blockquote's first paragraph, consumes the `[!TYPE]` token (+ one trailing
space), and treats the remainder of that paragraph as the first line of the body.

## New file

### `src/lib/markdown/admonition.ts`

Pure, unit-testable hast transformer + constants. No DOM, no `unified` import
inside the transform (it is a `Transformer` compatible with `.use()`).

Exports:

```ts
export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'concept', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];
export const admonitionTypes: ReadonlySet<string>;           // lowercase, for membership
export const admonition: Pluggable;                          // rehype plugin
```

Behavior of the transformer (operates on the hast tree):

- Walk top-level (and nested) `blockquote` elements.
- A blockquote is an **alert** iff its **first child is a `paragraph`** whose
  leading text node matches `/^\[!(\w+)\][ \t]*/i` (case-insensitive). The
  captured group is the **type**; everything after the matched prefix in that
  text node is the **body head**.
- Normalize the type to **lowercase**.
  - If it is in `admonitionTypes` → `class="callout callout-<type>"`, title =
    canonical label (`Note` / `Tip` / `Warning` / `Concept` / `Info`).
  - Otherwise (unknown, e.g. `[!IMPORTANT]`, `[!FOO]`) → neutral
    `class="callout"` (no suffix); title = the raw type word, **title-cased**.
    Never broken, never a literal `[!]`.
- Rewrite the `blockquote` into a `div` carrying the class, prepend a
  `<p class="callout-title">{label}</p>`, then the original paragraph children
  (with the marker prefix stripped from the first text node).
- If stripping the marker leaves the first paragraph with **no remaining text and
  no children**, drop that paragraph (avoid an empty `<p>`). If it leaves text,
  keep the paragraph with the trimmed head.
- The rest of the blockquote's children (further paragraphs, lists, code, etc.)
  are re-parented under the `div` unchanged — they pass through sanitize as
  normal prose.
- A blockquote whose first paragraph does **not** start with `[!TYPE]` (e.g. a
  plain `> just a quote`, or `[!NOTE]` appearing mid-text) is left as a
  `<blockquote>` — untouched.

## Modified files

### `src/lib/markdown/render.ts`

- `import { admonition } from './admonition';`
- In the `processor` chain, insert `.use(admonition)` **immediately before**
  `.use(rehypeSanitize, sanitizeSchema)`. (It must run after `remarkRehype` so
  blockquotes exist as hast, and before sanitize so the produced
  `<div class="callout …">` / `<p class="callout-title">` are seen and allowlisted.
  Order relative to `rehypeKatex`/`rehypeHighlight` does not matter — they only
  touch math/code nodes.)
- Widen `sanitizeSchema.attributes` (bounded, never blanket — see risk below):
  - `div`: add `['className', /^callout$/, /^callout-./]` alongside the existing
    katex entries.
  - `p`: add a `p` entry `['className', /^callout-title$/]` (default has none).
    Only this one bounded class is permitted on `<p>`; no other class survives.

### `src/app.css`

Add to `:root` and `.dark` (3 accents each; info covers note/tip/info, warn =
amber, concept = purple). Light values muted, dark values brighter — same
pattern as `--destructive`. Suggested OKLCH starting points (tune during impl):

```css
:root {
  --callout-info: oklch(0.55 0.12 250);     /* neutral-blue  */
  --callout-warn: oklch(0.68 0.15 70);      /* amber         */
  --callout-concept: oklch(0.55 0.16 300);  /* purple        */
}
.dark {
  --callout-info: oklch(0.7 0.13 250);
  --callout-warn: oklch(0.78 0.15 75);
  --callout-concept: oklch(0.72 0.15 305);
}
```

### `src/lib/components/chat/Markdown.svelte`

Add `:global(.markdown-body .callout)` and per-type accent rules inside the
existing `<style>` block. The callout is a **superset** of the current
blockquote style; the existing `:global(.markdown-body blockquote)` rule stays
**unchanged** (plain blockquotes are unaffected). Each type gets a left border +
faint tinted background via `color-mix(in oklch, var(--callout-*) 12%, var(--card))`
and a colored title; `note`/`tip`/`info` share `--callout-info`. Keep radius /
padding consistent with the card aesthetic (`--radius-sm`, spacing like the code
`<pre>` block).

## Tests

### `src/lib/markdown/admonition.test.ts` (new — pure transform)

Feed the plugin a hast tree built from markdown via `renderMarkdown` (or
construct hast directly) and assert:

- Each recognized type (`NOTE`, `TIP`, `WARNING`, `CONCEPT`, `INFO`, mixed case
  `[!Note]`) → `<div class="callout callout-<type>">` with the correct
  `<p class="callout-title">{Label}</p>` and the body preserved.
- **Same-line body** (the exact prompt shape) `> [!NOTE] Terraform is declarative.`
  → callout with title `Note` and body `Terraform is declarative.` (marker fully
  consumed, not leaked into the body or title).
- **Marker alone on its line** `> [!WARNING]\nbody` → title `Warning`, body
  `body`, no empty `<p>`.
- **Unknown type** `> [!IMPORTANT]\nbody` → `<div class="callout">` (no suffix),
  title `Important` (title-cased), body intact — no literal `[!]` anywhere.
- **Non-alert blockquote** `> just a quote` → unchanged `<blockquote>` (no
  `callout` class, no title node).
- **Multi-paragraph / nested body** (`> [!NOTE]\n> - item\n> - item` and a callout
  with a follow-on paragraph) → body children re-parented under the div, types
  preserved (list stays a list).

### `src/lib/markdown/render.test.ts` (extend — integration with sanitize)

Add cases asserting `renderMarkdown(...)` end-to-end:

- `> [!WARNING]\nNever commit the state file.` → output contains
  `<div class="callout callout-warning">`, `<p class="callout-title">Warning</p>`,
  and the body text; the `callout` / `callout-warning` / `callout-title` classes
  **survive `rehype-sanitize`** (not stripped). This is the sanitize-regression
  guard the plan calls out.
- A plain `> quote` still renders as `<blockquote>` with **no** `callout` class.

## Acceptance gates

- `pnpm test`, `pnpm check`, `pnpm lint` all clean.
- Manual (browser, `pnpm dev`):
  - In a **Build** chat, the strategy's `> [!WARNING]` renders as an **amber**
    callout (not a blockquote with a literal `[!WARNING]`).
  - In a **Socratic** chat, a `[!CONCEPT]` renders **purple**.
  - A plain `>` quote still renders as before.
  - **Mixed turn:** a single assistant turn containing both a callout and a
    separate fenced `mermaid` block renders both correctly (callout as a div,
    mermaid as an SVG) — verifies the in-pipeline transform and the post-mount
    mermaid scan don't collide.
  - Toggling light/dark theme recolors callouts (tokens are theme-aware).
  - DevTools: no sanitize-related warnings; classes present in the DOM.

## Risks / edge cases

- **Sanitize weakening:** widening `div`/`p` classNames is the flagged risk.
  Mitigation: `div` allows only `/^callout$/, /^callout-./` and `p` allows only
  `/^callout-title$/` — both bounded, **never** a blanket `/^.*$/`. Unknown
  admonition types degrade to a neutral callout, not raw `[!]` text.
  - Note: `/^callout-./` also matches `callout-title`, which is acceptable
    (bounded family). Verify the test asserts no arbitrary class survives.
- **Mermaid coexistence:** the admonition transform produces `<div
  class="callout">` in-pipeline; mermaid is post-mount DOM scanning for
  `code.language-mermaid`. They are orthogonal — covered by the mixed-turn
  acceptance check. A callout *containing* a fenced mermaid block (not taught,
  unlikely) still works: the scan finds the `code.language-mermaid` inside the
  div and swaps it. No special handling needed.
- **Empty marker paragraph:** stripping `[!NOTE]` from a paragraph that contained
  only the marker would leave `<p></p>`; the transform drops such a paragraph.
  Covered by the "marker alone on its line" test.
- **Strict vs. lenient marker matching:** a blockquote that merely *contains*
  `[!NOTE]` mid-text is NOT converted (only the first paragraph's leading text
  qualifies). Covered by the non-alert-blockquote test.
- **Streaming / partial markdown:** the transform runs on finished HTML in
  `renderMarkdown` (called per render, including during streaming re-renders). A
  half-streamed `> [!NOT` is just an incomplete blockquote → renders as a plain
  blockquote until the token completes; no corruption.

## Out of scope (deferred)

- **Restraint enforcement** (frequency budget, earned-usage) stays **prompt-side**
  (the blocks already say "≤1 per ~4–5 paragraphs"). The renderer does **not**
  post-process, count, or collapse callouts — it only styles what the model
  emits. (LS4's optional density linter is separate.)
- Tier-2 structured `gate` blocks (LS4).
- Localized title labels.
