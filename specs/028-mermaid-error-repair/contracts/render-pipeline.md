# Contract: Mermaid Render/Repair Pipeline

**Feature**: 028-mermaid-error-repair | **Seam**: `src/lib/markdown/mermaid.ts` (+ new pure `src/lib/markdown/mermaid-repair.ts`)

The single choke point for diagram rendering. Both `<Markdown>` passes (initial
mount, theme re-render) and every consumer (chat rows, labs, quizzes) go through
it. Behavior contract:

## `renderMermaidBlock(source)` — extended semantics

Input: the **original** fenced source (from `code.textContent` on first render, or
`data-mermaid-source` on theme re-render).

1. Attempts render of the original source. Success ⇒ return
   `{ svg, theme, repaired: false }`.
2. On failure, applies the pure deterministic repair
   (`repairMermaidSource(source)`) **once** and attempts render of the repaired
   source. Success ⇒ return `{ svg, theme, repaired: true }`.
3. On failure again ⇒ reject with the underlying error (the caller renders the
   contained error block). No loops, no LLM calls, no DOM writes outside the
   caller-provided target.

Invariants:

- **Idempotent/deterministic**: identical `(source, theme)` always produces an
  identical outcome and identical `repaired` flag — across re-mounts, theme
  flips, and consumers. Required for spec FR-012.
- **Zero cost for valid diagrams**: no repair work runs unless the original
  render failed (spec FR-006, SC-003).
- **No page-level side effects**: `initialize()` sets `suppressErrorRendering:
  true`; a failed render must never insert nodes anywhere except the caller's
  container (spec FR-001/FR-002). No error-SVG banner, ever.
- **Serialization preserved**: all initialize+render pairs stay chained on the
  existing module-wide `renderChain` (renders never straddle a theme re-init).
- **Streaming guard preserved**: callers keep the `live` guards — the seam is
  never invoked for a live/streaming markdown body (spec FR-011).

## `repairMermaidSource(source)` — pure repair (new)

- Pure function: `(source: string) => string` (post-repair source; identity when
  no rule matches). No DOM, no imports of mermaid, no state.
- Rule set is small, explicit, and corpus-tested; must include the spec's example
  fault class (quoted labels containing embedded double quotes/commas, e.g.
  `A -->|"sad", "SAD", "sleepy", "del"| B`).
- Must be idempotent: `repair(repair(x)) === repair(x)`.

## Caller obligations (`Markdown.svelte`, both passes)

- On success: build the existing `.mermaid-svg` wrapper with `data-mermaid-source`
  = **original** source, `data-rendered-theme` = baked theme, plus
  `data-mermaid-repaired` when `repaired: true`; render the repaired badge +
  original-source disclosure in that case (spec FR-005).
- On failure: replace the placeholder/wrapper with the contained `.mermaid-error`
  block (notice, on-demand reason, formatted source) — nothing outside the block,
  no raw parser dump inline (spec FR-008).
- Error block and badge are excluded chrome for expound selection alignment.
