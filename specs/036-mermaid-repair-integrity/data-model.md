# Data Model: Mermaid Repair Integrity (028 defects)

Phase 1 output.

## Entities

**None.** Feature 036 introduces no new persistent entities, fields, kinds, or
migrations. All changes are:

- **Ordering** inside `chatStore.send()` (provider resolution moves before the
  user-row append; the persisted rows and their shapes are byte-identical for every
  successful send).
- **Presentation** of the runtime-created (non-persisted) mermaid error block.
- **Pure functions** (`repairMermaidSource` rule set, extracted error-block builder).

## Invariants preserved (from 028 data-model.md and AGENTS.md)

- The stored message keeps the diagram source exactly as the model wrote it
  (FR-004 of 028); repair remains a render-time transform over a transient string.
- Fix-affordance linkage stays prompt-content-only (no metadata coupling): the
  preflight changes when the user row is persisted, never what would be persisted.
- No sourcemap/expound offset semantics change: `.mermaid-error` remains a single
  excluded-chrome root; new child elements are covered by `closest()` exclusion.
- The `messages` table's `search_vec` and all repositories are untouched.
