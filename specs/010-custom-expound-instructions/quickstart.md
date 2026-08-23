# Quickstart: Customizable Expound Instructions

**Feature**: `010-custom-expound-instructions` | **Date**: 2026-08-23

Runnable validation scenarios proving the feature end-to-end. Shapes and semantics: [data-model.md](./data-model.md), [contracts/](./contracts/). Implementation steps live in `tasks.md` (Phase 2, not this file).

## Prerequisites

- Node 22 + pnpm 10 installed; repo dependencies present (`pnpm install`).
- Dev stack runnable: `pnpm dev` (web on http://localhost:5173, server :4319, db). First boot runs migrations + `seedDefaults()` automatically.

## Automated validation

Targeted (fast loop, while implementing):

```bash
pnpm test src/lib/chat/expound.test.ts src/lib/chat/expound-instructions.test.ts
pnpm test src/lib/db/repositories/repositories.test.ts
pnpm test src/lib/stores/chat.svelte.test.ts
```

Expected: all green, covering — default list contains exactly the five built-ins including "Mermaid Diagram" and "Focus Callouts"; sanitize falls back to defaults on garbage; validation rejects blank/duplicate/oversized names; `parseAddFormats` maps legacy keys, keeps unknown strings verbatim, degrades malformed input to `[]`; round-trip `serializeAddFormats` → `parseAddFormats` with names; `seedDefaults` seeds the key once and never overwrites a stored value.

Full gates (before finishing the feature — constitution Quality Gates):

```bash
pnpm check   # svelte-check
pnpm lint    # ESLint + Prettier --check
pnpm test    # full Vitest suite (pglite)
```

## Manual validation (dev stack)

### Scenario A — Settings CRUD & persistence (FR-001..005, FR-010, FR-011; SC-001, SC-005)

1. Open http://localhost:5173/settings → find the expound instructions section (after Learner Profile).
2. **Defaults visible**: five entries — Diagrams (prompt diagrams), Comparison Tables, Code Examples, Mermaid Diagram, Focus Callouts — the new two showing their descriptions as helper text, built-ins badged.
3. **Add**: create "Real-world Analogies" with no description → appears immediately; inline status confirms save.
4. **Add invalid**: blank name → validation alert, not saved. Duplicate name "mermaid diagram" (case differs) → validation alert, not saved.
5. **Edit**: rename the custom entry and add a description → list reflects changes.
6. **Remove**: delete "Comparison Tables" → gone from the list.
7. **Reload the page** → list identical to post-edit state (SC-005).
8. **Restore defaults**: click Restore → confirmation dialog → confirm → list is exactly the five built-ins.

### Scenario B — Picker uses the customized list; request carries names (FR-008, FR-009; SC-002)

1. Continuing from A, add "Real-world Analogies".
2. Open a chat with an assistant reply; highlight a passage → "Branch from this" → expound constructor opens.
3. **Picker shows the current list** (six entries incl. the custom one, with descriptions as helper text; no restart happened — SC-002).
4. Select "Mermaid Diagram" + "Real-world Analogies", add custom instructions text, submit.
5. In the new branch, inspect the first (hidden) user message: contains `Adding [Mermaid Diagram, Real-world Analogies] whenever possible.`
6. **Branch card** at the top shows pills "Mermaid Diagram" and "Real-world Analogies" (FR-009, plus Story 2 scenario 3).

### Scenario C — Historical stability (FR-012) & upgrade path (FR-007; SC-004)

1. In Settings, rename "Real-world Analogies" to something else; then remove "Mermaid Diagram".
2. Re-open the branch from Scenario B → pills still read "Mermaid Diagram" and "Real-world Analogies" (recorded names survive edits/removals — SC-004 analogue).
3. **Legacy rows**: create one expound on the pre-feature format by inserting directly (dev only, e.g. via Drizzle Studio `pnpm db:studio`): `branch_sources.add_formats = '["diagrams","tables"]'` for some branch, then open that branch → pills read "Diagrams (prompt diagrams)" and "Comparison Tables" (read-time legacy mapping, no rewrite).
4. **Upgrade simulation**: delete the `expoundInstructions` settings row (Drizzle Studio), reload the app → the five built-ins reappear on next boot seed without user action (FR-007 mechanics).

### Scenario D — Regression sweep

1. Zero selections: expound with no instruction toggles → prompt line reads `Adding no extra formats whenever possible.`; branch card shows `(none)`.
2. Overlap guard unaffected: try to expound an overlapping highlight → blocked exactly as before.
3. `pnpm check && pnpm lint && pnpm test` all green.

## Expected outcome

All scenarios pass → spec Success Criteria SC-001..SC-005 verified (SC-003 via A2, SC-001 via A3 timing, SC-002 via B3, SC-005 via A7, SC-004 via C2/C3).
