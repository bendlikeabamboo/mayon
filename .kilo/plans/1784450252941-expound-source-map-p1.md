# Plan — Expound source map, P1: derive the SourceMap in Highlighter

**Parent design:** `refinement/2026-07-19_expound-source-map.md` §4 (P1).
**Predecessor:** `.kilo/plans/1784448265406-expound-source-map-p0.md` (P0 —
shipped: `src/lib/markdown/sourcemap.ts` + `sourcemap.test.ts` groups A/B/C).
**Scope:** Make the P0 `SourceMap` available inside `Highlighter.svelte` for
every rendered assistant message, reactively derived from `raw`. Nothing outside
`src/lib/components/chat/Highlighter.svelte` changes. No `Markdown.svelte`,
`render.ts`, `highlight.ts`, `chatStore`, or DB change. No new user-visible
behavior — the map is computed but **not yet consumed** (P2/P3 consume it).

> Note on location: the request asked for this plan inside
> `refinement/2026-07-19_expound-source-map.md`. Plan-mode edit permissions
> restrict writes to plan directories (`.kilo/plans/`, …), which also matches
> AGENTS.md's split (`.kilo/plans/` = active implementation plans;
> `refinement/` = historical design notes). The P1 implementation plan therefore
> lives here and cross-references the refinement doc; the refinement doc's §4
> should be updated separately (by an implementation-capable agent) to point at
> this file once P1 ships.

---

## Goal

`Highlighter.svelte` holds a non-null `SourceMap` for every rendered assistant
message, derived from the `raw` prop via `$derived(buildSourceMap(raw))`, present
for the lifetime of the component and rebuilt whenever `raw` changes. The map is
ready for P2 (forward: selection → raw offsets) and P3 (reverse: raw offsets →
underline) but is **not** read by any P1 code path except a dev-only drift sanity
check.

P1 ends when: `pnpm lint && pnpm check && pnpm test` is green, the dev drift
assertion is silent across a representative assistant reply, and `Highlighter`'s
`sourceMap` is observably non-null in the browser.

---

## Decisions (confirmed / resolved)

1. **Highlighter derives the map from `raw` (confirmed with user).** The
   refinement §4.2 specified a callback prop (`onsourcemap`) on `Markdown.svelte`.
   That wiring is blocked by the actual component tree: `Markdown` is rendered
   inside `Highlighter`'s `children` snippet (via `LazyMount` in
   `MessageRow.svelte:138`), so a callback prop on `Markdown` fires into
   `MessageRow`'s scope, not `Highlighter`'s. Since `buildSourceMap(raw)` is a
   pure function of `raw` and `Highlighter` already receives `raw` as a prop,
   `Highlighter` derives the map directly. Benefits: map exists immediately
   (independent of `LazyMount`'s `IntersectionObserver`), no callback/context
   bridge, no tree restructuring, `Markdown.svelte` unchanged. Accepted cost:
   `raw` is parsed twice (once by `render.ts` for HTML, once by `sourcemap.ts`)
   — unavoidable, since the two pipelines use different tails
   (katex/highlight/sanitize/stringify vs. hast-walk) and is negligible.

2. **The §4.1 shared-processor refactor is deferred (out of P1).** Its original
   justification (Markdown parses once and hands the hast to both pipelines) no
   longer applies under decision 1 — `render.ts` and `sourcemap.ts` parse `raw`
   independently regardless. Deduplicating the `[parse, gfm, math, rehype]`
   front matter is cosmetic and carries a real risk: **`admonition` is a rehype
   plugin that runs at different pipeline stages in the two files** — after
   `rehype-katex`/`rehype-highlight` in `render.ts` (`render.ts:65-74`), but
   immediately after `remark-rehype` in `sourcemap.ts` (`sourcemap.ts:60-65`).
   Merging `admonition` into a shared base would reorder it (admonition-first in
   `render.ts`) and silently change callout-with-math/code edge cases. Lockstep
   is instead enforced by P0's existing tests (decision 3). Revisit in P4
   cleanup if desired; do **not** bundle into P1.

3. **P1 adds no new automated mapping test.** P0's `sourcemap.test.ts` already
   ships two lockstep guards that P1 was originally meant to provide:
   - **Group B** — `buildSourceMap(raw).canonical === filtered DOM textContent`
     of `renderMarkdown(raw)` (jsdom, excluding `.katex`, `.callout-title`,
     `code.language-mermaid`) across the full fixture corpus.
   - **Group C** — processor-parity assertion: the
     `parse/gfm/math/rehype/admonition` plugin list and order are identical
     between `sourcemap.ts` and `render.ts`.
   Since P1 changes no mapping logic, those guards remain authoritative. P1's
   validation is typecheck + lint + existing suites green + a manual browser
   check + the dev-only drift assertion in decision 5.

4. **No Svelte component-mount test in P1.** The repo has no
   `@testing-library/svelte`; `vite.config.ts:18` pins vitest to
   `environment: 'node'` (the `jsdom` devDep is imported directly by individual
   pure tests like `sourcemap.test.ts`). Introducing component-test infra is out
   of scope for P1. `Highlighter` is validated manually in the browser.

5. **Dev-only runtime drift assertion (one-way, `console.warn`, no throw).**
   Inside a `$effect` guarded by `import.meta.env.DEV`, assert the invariant
   `sourceMap.canonical.length <= container.textContent.length`. If violated,
   `console.warn('[expound] source map canonical exceeds DOM textContent',
   { messageId, canonicalLen, domLen })`. Rationale:
   - `canonical` longer than DOM text is **never** legitimate — it signals a map
     bug, most likely the raw-HTML / `rehype-sanitize` divergence (markdown raw
     HTML that `sourcemap.ts` sees as text but `rehype-sanitize` strips from the
     DOM). The assertion surfaces this loudly in dev.
   - It is robust against **all** post-render chrome because those only ever
     make `textContent` *longer* than `canonical`: the copy-button `"Copy"`
     (`Markdown.svelte:99-110`), KaTeX `.katex-mathml`/`.katex-html`, and Mermaid
     SVG label text are all excluded from `canonical` (`rendered=''` or
     positionless-skipped per P0 decision 5) but present in `textContent`.
   - The strict `canonical === DOM textContent` equality (which needs the
     excluded-chrome classifier) is **P2**'s job; P1 ships only the cheap
     one-way guard.
   - Doubles as the in-P1 *consumer* of `sourceMap` so the `$derived` isn't
     flagged unused before P2/P3 wire it in.

6. **Streaming rebuild cost is accepted.** `$derived(buildSourceMap(raw))`
   re-runs on every `raw` change, including per-token while streaming. `raw` is
   small and `buildSourceMap` is a single mdast/hast parse with no render-stage
   plugins, so the cost is acceptable (refinement §10). The underline pass is
   gated by `existingSpans.length > 0` (`Highlighter.svelte:356`), which is
   false while streaming, so no underlines render mid-stream. If long-message
   jank appears later, the lever is to forward the `live` prop
   (`Markdown.svelte:19`) from `MessageRow` → `Highlighter` and skip the rebuild
   while streaming — out of scope for P1, not anticipated.

---

## Non-goals (explicitly out of P1)

- No change to `Markdown.svelte`, `render.ts`, `highlight.ts`, `chatStore`,
  `expound.ts`, or any DB schema/repository.
- No consumption of `sourceMap` in `resolveSelectionOffsets` /
  `captureSelection` (P2) or in `renderUnderlines` + self-heal (P3).
- No excluded-chrome classifier and no strict `canonical === DOM textContent`
  equality assertion (P2).
- No removal of `highlight.ts` / the full-span fallback / `collapse` dedup (P4).
- No shared-processor refactor between `render.ts` and `sourcemap.ts` (deferred;
  see decision 2).
- No new component-test framework.
- No forwarding of `live` into `Highlighter` (only if P1 perf measurement shows
  streaming jank; not anticipated).

---

## Changes

### 1. `src/lib/components/chat/Highlighter.svelte` — derive + dev drift check

The only source file touched in P1.

**(a) Import + derived map.** Near the existing imports
(`Highlighter.svelte:1-10`):

```ts
import { buildSourceMap, type SourceMap } from '$lib/markdown/sourcemap';
```

and alongside the existing `$state`/`$effect` declarations (after the `raw` prop
is destructured at `Highlighter.svelte:23-39`):

```ts
// Source map for this message's raw markdown. Derived from `raw` (pure); not
// yet consumed by the underline/selection paths (P2/P3). The dev drift $effect
// below is its only P1 reader, which also keeps this from being unused.
const sourceMap: SourceMap = $derived(buildSourceMap(raw));
```

Do **not** wire `sourceMap` into `resolvedPending`, `captureSelection`, or
`renderUnderlines` — those stay on the existing heuristic (P2/P3 replace them).
Behavior is unchanged.

**(b) Dev-only drift assertion.** Add a new `$effect` (e.g. near the existing
underline `$effect` at `Highlighter.svelte:387-395`):

```ts
$effect(() => {
	// One-way sanity invariant (dev only): canonical visible text must never
	// exceed the rendered DOM text. If it does, the map and the renderer have
	// drifted (typical cause: raw HTML that rehype-sanitize strips from the DOM
	// but sourcemap.ts still sees). Chrome (copy button, KaTeX, Mermaid) only
	// ever makes textContent longer, so this never false-positives on chrome.
	if (!import.meta.env.DEV) return;
	const c = container;
	if (!c) return;
	const domLen = c.textContent?.length ?? 0;
	const canonicalLen = sourceMap.canonical.length;
	if (canonicalLen > domLen) {
		console.warn('[expound] source map canonical exceeds DOM textContent', {
			messageId,
			canonicalLen,
			domLen
		});
	}
});
```

Reading both `container` and `sourceMap.canonical` inside the effect registers
both as dependencies, so it re-runs on mount and on every `raw` change. The
`import.meta.env.DEV` guard is static, so in prod the whole body is dead-code
eliminated; the source-level reference to `sourceMap` remains so `svelte-check`
and ESLint still see it as used.

**(c) No other edits.** The existing `lastSignature` guard, `MutationObserver`,
`captureSelection`, `textOffsetFromRange`, `collapse`, `findOccurrence`, and
`renderUnderlines` are untouched.

---

## Tests

No new test files and no new test cases. Rationale (decision 3): P0's
`sourcemap.test.ts` groups B and C already lock the lockstep guarantee that P1
was originally responsible for, and P1 introduces no new mapping logic.

- `pnpm test src/lib/markdown/sourcemap.test.ts` — stays green (no change to
  `sourcemap.ts`).
- `pnpm test src/lib/chat/highlight.test.ts` — stays green (no change to
  `highlight.ts`).
- `pnpm check` — typechecks the new `Highlighter.svelte` import and `$derived`.

If the dev drift assertion fires during P1 manual validation on a fixture not
covered by P0 group B, the response is to **backport that fixture into P0 group
B** (a P0 test addition, not a P1 test) and assess whether `sourcemap.ts` needs
a generated/excluded rule for that construct.

---

## Validation

### Automated
- `pnpm check` — new Highlighter code typechecks.
- `pnpm lint` — ESLint + Prettier clean (no unused-var on `sourceMap`).
- `pnpm test` (root) — green; no new tests, no regressions.
- `pnpm --filter @mayon/server test` — untouched (no server change); run only
  if `pnpm test` somehow touches shared code (it doesn't in P1).

### Manual (the real P1 gate)
`pnpm dev:deps && pnpm dev`, then open a chat and trigger an assistant reply
(editable in `/chat`, or paste content into a user message and have the model
echo it) containing, in one message: plain prose, `**bold**`, `[a link](u)`,
`` `inline code` ``, a fenced non-mermaid code block, a bulleted list, a GFM
table, an admonition (`> [!NOTE] …`), inline math `$x^2$`, display math
`$$…$$`, and a ```` ```mermaid ```` block.

- **Map present:** in DevTools (Svelte devtools or a temporary `console.log` /
  `$effect` probe), `Highlighter`'s `sourceMap` is non-null and
  `sourceMap.canonical` equals the visible prose (bold inner text, link label
  text, inline-code text, list/table cell text, admonition body — **excluding**
  the "Note" title, the math, and the mermaid).
- **Drift silent:** the console shows **no** `[expound] source map canonical
  exceeds DOM textContent` warning for that message (chrome legitimately makes
  `textContent` longer than `canonical`).
- **No regression:** existing expound underlines still render (old heuristic,
  unchanged); the "Branch from this" toolbar and right-click context menu behave
  as before; streaming a new reply still works token-by-token.

### Out of scope for P1 acceptance
- Expound underline *correctness* (P3) — underlines may still be wrong in P1;
  that's expected and unchanged from today.
- Forward-resolve correctness (P2).

---

## Risks / notes

- **Raw-HTML / `rehype-sanitize` divergence** is the one realistic trigger of
  the dev drift assertion: e.g. markdown containing `<script>…</script>` or raw
  `<div>…</div>` that sanitize strips from the DOM but `sourcemap.ts` (which
  stops before sanitize) still emits as a prose/`inline-code`/`block-code`
  segment. If the assertion fires on legitimate input during P1 validation,
  capture the exact fixture; the fix is a generated/excluded rule in
  `sourcemap.ts` (P0 follow-up) or the P2 excluded-chrome classifier — **not** a
  P1 blocker. Do not silence the warning.
- **`admonition` stage difference is intentional.** `render.ts` runs admonition
  after katex/highlight; `sourcemap.ts` runs it right after remark-rehype. This
  is locked by P0 test C. Do **not** "fix" the discrepancy by merging the two
  processors (decision 2) — admonition-first would change rendering of
  callouts whose first line begins with math or code.
- **No component-test infra** means P1's component behavior is validated only
  manually. If automated coverage of `Highlighter` is later desired, adding
  `@testing-library/svelte` + a per-test `environment: 'jsdom'` (or the vitest
  browser mode) is a separate infra task and should not be conflated with P1.
- **`sourceMap` unused-in-P1 smell.** The dev drift `$effect` is deliberately
  the P1 reader of `sourceMap` so the `$derived` isn't dead code before P2/P3
  consume it. If the drift assertion is later removed, an explicit consumer must
  be added in the same change (or the derivation moved to the phase that first
  reads it).
- **Streaming rebuild cost** — see decision 6; accepted, with a documented lever.
