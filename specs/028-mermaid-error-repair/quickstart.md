# Quickstart: Mermaid Diagram Error Repair & Containment

**Feature**: 028-mermaid-error-repair | **Date**: 2026-11-08

Validation guide on the dev stack. Contracts: [render-pipeline.md](./contracts/render-pipeline.md),
[fix-affordance.md](./contracts/fix-affordance.md); model: [data-model.md](./data-model.md).

## Prerequisites

- Fresh worktree bootstrap: `pnpm install && pnpm --filter @mayon/shared build`.
- Dev stack: `pnpm dev` (web on http://localhost:5173, project `mayon-dev`).
- A configured provider with a stored key (only needed for scenarios 5–6).
- The canonical broken diagram (the spec's example fault — quoted edge label with
  embedded quotes/commas):

  ````
  ```mermaid
  graph TD
    A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]
  ```
  ````

## Automated gates (always run first)

```bash
pnpm check   # svelte-check
pnpm lint    # ESLint + Prettier
pnpm test    # Vitest (incl. mermaid-repair corpus + containment regression tests)
```

Expected: all green. The repair corpus test must include the canonical example
above and fail without the repair module (constitution II regression rule).

## Scenario 1 — Containment (P1, no provider needed)

1. Start a chat whose assistant reply contains the canonical broken diagram
   (paste it into a user message asking the model to echo it, or use a mock/dev
   flow that persists it).
2. Inspect the rendered message.

Expected: an error presentation **inside the diagram's own block**; the page has
no new vertical page-level scrollbar; no "Syntax error in text" banner anywhere;
`document.body` gains no stray SVG node (verify in devtools if desired).

## Scenario 2 — Auto-repair (P2, no provider needed)

1. Render a reply containing the canonical broken diagram (from Scenario 1's
   message, or any message whose fault is in the repair corpus).

Expected: the diagram **renders** (no error block) and carries a repaired
indication (badge) — because the canonical fault class is deterministic-repair
territory.

## Scenario 3 — Original source preserved (P2)

1. On a repaired diagram, open the badge's original-source disclosure.
2. Toggle light/dark theme.

Expected: disclosure shows the **original, unrepaired** source verbatim; theme
flip re-renders the diagram in place with the same repaired result, no error
flash; the stored message (reload the page) still contains the original source.

## Scenario 4 — Valid diagrams unchanged (P2)

1. Render a reply with a valid mermaid diagram and compare against `main`.

Expected: identical rendering, no badge, no perceptible delay.

## Scenario 5 — Fix action (P3, provider required)

1. Render a diagram whose fault is **outside** the repair corpus (e.g.
   `graph TD\n  A -->` — unterminated edge), arriving via a real model turn or
   mock.
2. Activate "fix this diagram" in the error block.

Expected: a visible canned user message containing the broken source + reason is
sent; the assistant replies with a corrected diagram that renders; the original
message is unmodified.

## Scenario 6 — No provider (P3 degradation)

1. With no provider key stored, view a failed diagram in an assistant message.

Expected: containment + error block + deterministic repair still work; the fix
action is absent/unavailable without silent failure.

## Scenario 7 — Expound alignment on failed messages (regression, F3)

1. On a message containing a **failed** diagram, select text elsewhere in the
   same message and open the expound/branch toolbar.

Expected: selection maps to source cleanly (no "can't be mapped" degradation
caused by the error block's text). Selections intersecting the error block
itself behave like selections on rendered diagrams (generated-content refusal).

## Scenario 8 — Other consumers

1. Open a lab (or any non-chat `<Markdown>` surface) containing the canonical
   broken diagram.

Expected: same containment/repair behavior; no fix action (no chat context).
