# Data Model: Mermaid Diagram Error Repair & Containment

**Feature**: 028-mermaid-error-repair | **Date**: 2026-11-08

## Persistent schema impact

**None.** No new tables, columns, migrations, settings keys, or artifact kinds.
Stored assistant markdown (`messages.content`) is never modified by this feature —
repair is render-time only (spec FR-004; constitution expound-offset discipline).
The agent critic's existing `self_corrected` report kind (`src/lib/chat/kinds.ts`)
already covers generation-time corrections and is reused as-is.

## Ephemeral entities

### MermaidRenderOutcome (per diagram block, per render attempt — not persisted)

The result contract of the render/repair seam (see
[contracts/render-pipeline.md](./contracts/render-pipeline.md)).

| Field | Type | Notes |
|---|---|---|
| `source` | `string` | The original fenced source, exactly as stored in the message. Never altered. |
| `svg` | `string \| null` | Rendered SVG when the attempt succeeded (after repair if needed). |
| `repairedSource` | `string \| null` | The repaired source when success required repair; `null` when the original rendered as-is or the attempt failed. |
| `error` | `{ message: string } \| null` | The underlying failure (mermaid's parse/render error) when the attempt failed after repair. |
| `theme` | `'light' \| 'dark'` | Theme the SVG was baked with (existing behavior, carried through). |

**Validation rules (from spec FRs)**:

- `svg` and `error` are mutually exclusive; exactly one is non-null.
- `repairedSource != null` implies `svg != null` (a repair that still fails yields
  `error` with `repairedSource: null` — the broken original is what the user sees).
- Attempts are bounded: at most one deterministic repair pass per render attempt
  (FR-003); no retry loop.

**State transitions**:

```text
pending ("Generating Diagram…" placeholder, existing .mermaid-pending)
  ├── render(original) ok ──────────────► rendered { repaired: false }
  ├── render(original) failed
  │     └── render(repaired) ok ────────► rendered { repaired: true }
  └── render(original) failed
        └── render(repaired) failed ────► failed { reason }  (contained error block)
```

`rendered`/`failed` are re-entered identically on theme re-render and message
re-mount because the outcome is a pure function of `(original source, theme)`
(deterministic repair — research D2); no memory of previous attempts is kept.

### DOM dataset contract (rendered wrappers)

The durable, in-memory "storage" of this feature is the existing wrapper dataset,
extended by one attribute:

| Attribute | Existing/New | Content |
|---|---|---|
| `data-mermaid-source` | existing | **Original** source (unchanged semantics — theme pass re-renders from it). |
| `data-rendered-theme` | existing | Theme the SVG was baked with. |
| `data-mermaid-repaired` | NEW | Present (`"true"`) iff the displayed SVG came from repaired source; drives the badge + original-source disclosure. |

Derived DOM chrome and their selection-exclusion requirements
(`EXCLUDED_CHROME_SELECTORS`, `src/lib/chat/selection.ts:27-38`):

| Node | Purpose |
|---|---|
| `.mermaid-error` (block) | Contained failure presentation: notice, on-demand reason, formatted source, fix-action button (when wired). |
| `.mermaid-repaired` (badge) | Repaired indication; discloses original source. |

Both must be added to the excluded list (research F3: the current failure `<p>`
is not excluded and degrades whole-message expound alignment).

## Key relationships

- `MermaidRenderOutcome.source` ↔ `messages.content` fence (read-only projection;
  never written back).
- Fix affordance (see [contracts/fix-affordance.md](./contracts/fix-affordance.md))
  creates an ordinary `user_message` row via the existing chat send path — no new
  kinds, no metadata coupling to the failed block (the prompt text itself carries
  the source and reason).
