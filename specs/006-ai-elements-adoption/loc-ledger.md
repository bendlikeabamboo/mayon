# LOC Ledger — AI Elements Adoption

**Spec**: SC-001 (feature-surface ≤ 533 lines), SC-002 (zero new npm packages)

## Baseline (existing bespoke .svelte components)

| Component            | Path                                                 | Lines   | Notes                     |
| -------------------- | ---------------------------------------------------- | ------- | ------------------------- |
| ModelSelect          | `src/lib/components/ai/ModelSelect.svelte`           | 124     | **DELETED** (T013)        |
| ElicitationDialog    | `src/lib/components/mcp/ElicitationDialog.svelte`    | 139     | Replaced by US2           |
| SamplingApprovalCard | `src/lib/components/mcp/SamplingApprovalCard.svelte` | 35      | Replaced by US2           |
| ToolActivity         | `src/lib/components/chat/rows/ToolActivity.svelte`   | 176     | Replaced by US3           |
| ToolResultBody       | `src/lib/components/chat/rows/ToolResultBody.svelte` | 59      | Retained inside US3 shell |
| **Total**            |                                                      | **533** | .svelte only              |

## Counting rule

The baseline 533 counts **only .svelte files** (the five components above).
All three surfaces below use the same rule for apples-to-apples comparison.
Logic helpers, barrel files, and tests are listed separately.

## Presentation surface (.svelte only — apples-to-apples vs 533 baseline)

| Component                 | Path                                                               | Lines   | Notes                                                                     |
| ------------------------- | ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| ModelSelect (root)        | `src/lib/components/ai/model-select/model-select.svelte`           | 92      | Trigger + dialog wiring + empty states (T011/T012)                        |
| ModelSelectDialog         | `src/lib/components/ai/model-select/model-select-dialog.svelte`    | 46      | Command.Dialog wrapper (T010)                                             |
| ModelSelectEmpty          | `src/lib/components/ai/model-select/model-select-empty.svelte`     | 12      | (T010)                                                                    |
| ModelSelectGroup          | `src/lib/components/ai/model-select/model-select-group.svelte`     | 14      | (T010)                                                                    |
| ModelSelectInput          | `src/lib/components/ai/model-select/model-select-input.svelte`     | 12      | (T010)                                                                    |
| ModelSelectItem           | `src/lib/components/ai/model-select/model-select-item.svelte`      | 10      | (T010)                                                                    |
| ModelSelectList           | `src/lib/components/ai/model-select/model-select-list.svelte`      | 10      | (T010)                                                                    |
| ModelSelectName           | `src/lib/components/ai/model-select/model-select-name.svelte`      | 14      | (T010)                                                                    |
| ModelSelectSeparator      | `src/lib/components/ai/model-select/model-select-separator.svelte` | 7       | (T010)                                                                    |
| **US1 subtotal**          |                                                                    | **217** |                                                                           |
| confirmation              | `src/lib/components/mcp/confirmation/confirmation.svelte`          | 24      | Alert wrapper, sets context (T016)                                        |
| confirmation-title        | `src/lib/components/mcp/confirmation/confirmation-title.svelte`    | 17      | (T016)                                                                    |
| confirmation-request      | `src/lib/components/mcp/confirmation/confirmation-request.svelte`  | 13      | (T016)                                                                    |
| confirmation-action       | `src/lib/components/mcp/confirmation/confirmation-action.svelte`   | 25      | (T016) + disabled prop (T019)                                             |
| confirmation-actions      | `src/lib/components/mcp/confirmation/confirmation-actions.svelte`  | 21      | (T016)                                                                    |
| confirmation-accepted     | `src/lib/components/mcp/confirmation/confirmation-accepted.svelte` | 13      | (T016)                                                                    |
| confirmation-rejected     | `src/lib/components/mcp/confirmation/confirmation-rejected.svelte` | 13      | (T016)                                                                    |
| confirmation-failed       | `src/lib/components/mcp/confirmation/confirmation-failed.svelte`   | 13      | Failed terminal body (T019, AP-5)                                         |
| ElicitationDialog         | `src/lib/components/mcp/ElicitationDialog.svelte`                  | 112     | Recomposed onto confirmation chrome + ElicitationForm (T026 trim)         |
| ElicitationForm           | `src/lib/components/mcp/ElicitationForm.svelte`                    | 99      | **Shared** schema-form + JSON fallback (extracted T026 from Elicit + Ask) |
| SamplingApprovalCard      | `src/lib/components/mcp/SamplingApprovalCard.svelte`               | 98      | + onError prop + failed body + restore gate (T019/T020)                   |
| **US2 subtotal**          |                                                                    | **448** |                                                                           |
| ToolActivity              | `src/lib/components/chat/rows/ToolActivity.svelte`                 | 178     | Collapsible + Badge recomposed, themed tokens (T023/T024/T027)            |
| **US3 subtotal**          |                                                                    | **178** |                                                                           |
| **Grand total (.svelte)** |                                                                    | **843** | **overage: +310 vs 533 baseline**                                         |

### Overage rationale

The 843 .svelte lines vs 533 baseline (+310) is driven by **new capabilities the old code lacked**:

1. **Keyboard nav + focus trap** (~40 lines across US1 dialog/command): old ModelSelect was a plain `<select>`; new uses `Command` primitive with full keyboard navigation.
2. **Focus-trap + Escape-cancel** (~20 lines): old SamplingApprovalCard had no keyboard interaction; new uses `ConfirmationActions` with proper focus management.
3. **Badge tones for distinct failure states** (~15 lines): old ToolActivity used a single text label; new uses `Badge` variant + icon per status.
4. **Failure body + restore gating** (~46 lines across US2): old code had no `failed` terminal state and no `serverStatus.restoring` degradation.
5. **Shared ElicitationForm** (net 0 vs duplicated form — the form was duplicated in ElicitationDialog and AskEntry; extraction saved 291→215 in AskEntry but adds 99 for ElicitationForm; net -77 in AskEntry but ElicitationForm is shared infrastructure).
6. **Confirmation chrome family** (~139 lines across 7 sub-components): provides one-way state machine, context propagation, and terminal-state rendering — the old code inlined all of this per-consumer.
7. **Multiple thin pass-through wrappers** (~40 lines): model-select-item/group/list/name/separator/empty are thin Command.\* wrappers that enable the compositional pattern; eliminating them would force a monolithic component.

## Logic + barrel surface (.ts only — not counted in baseline)

| File                           | Lines   | Notes                            |
| ------------------------------ | ------- | -------------------------------- |
| filter-models.svelte.ts        | 24      | Pure filter/group helper         |
| model-select/index.ts          | 13      | Barrel exports                   |
| confirmation-context.svelte.ts | 52      | State machine + Svelte context   |
| confirmation/index.ts          | 26      | Barrel exports + re-export types |
| tool-status.ts                 | 32      | Pure status derivation           |
| **Logic subtotal**             | **147** |                                  |

## Test surface (not counted in baseline)

| File                         | Lines   | Notes                                 |
| ---------------------------- | ------- | ------------------------------------- |
| filter-models.test.ts        | 64      | Picker filter logic                   |
| confirmation-context.test.ts | 137     | Approval state machine transitions    |
| tool-status.test.ts          | 168     | Status derivation mapping             |
| ToolActivity.status.test.ts  | 55      | Source-inspection: icon/badge present |
| **Test subtotal**            | **424** |                                       |

## Vocabulary ledger (tracked separately — reusable library code)

| Primitive   | Path                                 | Lines | Notes                                       |
| ----------- | ------------------------------------ | ----- | ------------------------------------------- |
| command     | `src/lib/components/ui/command/`     | —     | 12 files; composes bits-ui Command + Dialog |
| alert       | `src/lib/components/ui/alert/`       | —     | Zero npm deps                               |
| badge       | `src/lib/components/ui/badge/`       | —     | Zero npm deps                               |
| collapsible | `src/lib/components/ui/collapsible/` | —     | Zero npm deps                               |

## Trim actions (Phase 6, T026)

1. **ElicitationForm extraction**: Duplicated JSON-schema form (~60 lines of template + ~10 lines of computeFields logic + state) in both `ElicitationDialog.svelte` and `AskEntry.svelte` extracted to shared `ElicitationForm.svelte` (99 lines). AskEntry went from 291 → 215 lines (**-76 lines**). ElicitationDialog went from 187 → 112 lines (**-75 lines**, now imports the form). Net: 99 shared lines replace 2×(~60) duplicated template lines — genuine deduplication.
2. **No pass-through collapses**: The 6 model-select sub-wrappers (item/group/list/name/separator/empty, 7+10+14+14+10+12=67 lines) are thin but serve the compositional pattern; collapsing them into model-select.svelte would create a monolith and hurt readability. Kept.

## Dependency-manifest diff (T029)

- **Target**: zero new packages (SC-002)
- **Method**: `git diff --stat -- package.json pnpm-lock.yaml server/package.json packages/shared/package.json`
- **Result**: `(no output)` — empty diff, zero changes to any dependency manifest.
- **Status**: **PASS** — confirmed zero new packages end-to-end.

## Theming fixes (T027)

| File                        | Change                                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SamplingApprovalCard.svelte | `border-amber-500/40 bg-amber-500/5` → `border-border bg-card`; `bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300` → `bg-secondary text-secondary-foreground`                                       |
| ToolActivity.svelte         | `text-amber-500` → `text-foreground`; `text-red-500` → `text-destructive`; `text-green-600 dark:text-green-400` → `text-foreground`; `text-red-500/60` → `text-muted-foreground`                                        |
| AskEntry.svelte             | `chipClass`: green/amber/red raw → `bg-secondary text-secondary-foreground border-border` / `bg-destructive/10 text-destructive border-destructive/30`; sampling badge amber → `bg-secondary text-secondary-foreground` |
