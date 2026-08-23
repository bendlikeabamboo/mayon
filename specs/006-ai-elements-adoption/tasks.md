---
description: 'Task list for feature implementation'
---

# Tasks: AI Elements Adoption (Selective Community UI Convergence)

**Input**: Design documents from `/specs/006-ai-elements-adoption/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included — constitution Core Principle II mandates tests for new `src/lib/` behavior (confirmation state machine, picker filtering, tool-status mapping). Presentation aspects are covered by `pnpm check` + dev-stack smoke per quickstart.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project (SPA): all feature code under `src/lib/components/`. Vocabulary primitives under `src/lib/components/ui/` (same first-party model as existing `button/`, `dialog/`). Spec artifacts under `specs/006-ai-elements-adoption/`.

## Phase 1: Setup (Shared Vocabulary)

**Purpose**: Acquire the four dependency-free shadcn-svelte vocabulary primitives all stories build on (research D5).

- [x] T001 Add the `command` primitive family (12 files: command.svelte, command-dialog, -input, -item, -list, -group, -empty, -separator, -shortcut, -link-item, -loading, index.ts) to `src/lib/components/ui/command/` from the shadcn-svelte registry (`pnpm dlx shadcn-svelte@latest add command` or copy from registry JSON); confirm the installed `bits-ui` (^2.18) exports the `Command` primitive the files import
- [x] T002 [P] Add the `alert` primitive family to `src/lib/components/ui/alert/` (shadcn-svelte registry; zero npm deps)
- [x] T003 [P] Add the `badge` primitive family to `src/lib/components/ui/badge/` (shadcn-svelte registry; zero npm deps)
- [x] T004 [P] Add the `collapsible` primitive family to `src/lib/components/ui/collapsible/` (shadcn-svelte registry; zero npm deps)
- [x] T005 Run `pnpm check && pnpm lint` and verify the dependency manifest gained ZERO new entries (spec SC-002 / research D5) — gates must be green before proceeding

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stage donor sources and the measurement baseline all stories reference.

**⚠️ CRITICAL**: Complete before user story implementation.

- [x] T006 Fetch donor sources for reference into `specs/006-ai-elements-adoption/donors/{model-selector,confirmation,tool}/` by extracting `files[]` from the registry JSONs (`https://svelte-ai-elements.vercel.app/r/{block}.json`); record the keep/drop file list per research D1 (drop `model-selector-logo*`, `model-selector-shortcut`; drop donor `tool` context auto-open; skip donor `code` block per D3/D4)
- [x] T007 Create the LOC baseline ledger at `specs/006-ai-elements-adoption/loc-ledger.md` per research D6: baseline = ModelSelect 124 + ElicitationDialog 139 + SamplingApprovalCard 35 + ToolActivity 176 + ToolResultBody 59 = 533 feature-surface lines; define the two ledgers (feature-surface ≤ 533 vs vocabulary tracked separately)

**Checkpoint**: Vocabulary in place, donors staged, measurement defined — user story implementation can now begin (stories may proceed in parallel)

---

## Phase 3: User Story 1 - Searchable Model Picker (Priority: P1) 🎯 MVP

**Goal**: Command-palette model picker with type-to-filter, full keyboard nav, focus handling, and clear empty states (contract MP-1..MP-8).

**Independent Test**: quickstart.md Scenario 1 — configure ≥2 providers, open picker, filter by model and provider name, select via keyboard, dismiss with Escape; empty-state guidance with zero providers.

### Tests for User Story 1

> **NOTE**: Write these FIRST, ensure they FAIL before implementation

- [x] T008 [P] [US1] Create filtering-logic tests in `src/lib/components/ai/model-select/filter-models.test.ts` covering: match on model id / display name / provider label (case-insensitive), active value prepended when missing from discovered list, no-match → empty (contract MP-1, MP-3)

### Implementation for User Story 1

- [x] T009 [P] [US1] Create `src/lib/components/ai/model-select/filter-models.svelte.ts` — pure filter/group helper (models + active value + query → grouped filtered options)
- [x] T010 [US1] Create the model-select component family in `src/lib/components/ai/model-select/` from donor sources (research D1 trim: keep trigger, dialog, content, input, list, item, empty, group, separator, name, index; drop logo/logo-group/shortcut), composing `ui/command` + existing `ui/dialog`; no `runed` (model-selector has none); adapt class tokens to repo conventions
- [x] T011 [US1] Export the prop-compatible root from `src/lib/components/ai/model-select/index.ts` (`models`, `value`, `discoverable`, `discovering`, `onselect`, `onrefresh` — contract "Consumers") with refresh affordance gated on `discoverable` (MP-6)
- [x] T012 [US1] Implement empty states in the family: no models configured → provider-setup guidance (+ refresh when discoverable); filter miss → "No matches." (MP-5)
- [x] T013 [US1] Swap all mount sites of the old picker (search usages of `$lib/components/ai/ModelSelect.svelte`) to the new family root, preserving behavior; DELETE `src/lib/components/ai/ModelSelect.svelte`
- [x] T014 [US1] Verify on dev stack (`pnpm dev`): quickstart Scenario 1 pass (filter, ↑/↓/Enter/Escape, focus return to trigger, persistence of selection), then `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: User Story 1 fully functional and independently testable — MVP deliverable

---

## Phase 4: User Story 2 - Consensus Tool-Approval Flows (Priority: P2)

**Goal**: One shared confirmation pattern (chrome + one-way state machine) for MCP elicitation and sampling; pending/succeeded/rejected/failed visible; degradation intact (contract AP-1..AP-8).

**Independent Test**: quickstart.md Scenario 2 — trigger elicitation and sampling from a tool server, complete approve/decline/submit on each, invalid-JSON inline error, dropped-server → failed (not hanging pending), no approval UI without the runtime.

### Tests for User Story 2

> **NOTE**: Write these FIRST, ensure they FAIL before implementation

- [x] T015 [P] [US2] Create state-machine tests in `src/lib/components/mcp/confirmation/confirmation-context.test.ts` covering data-model rules: `pending → succeeded | rejected | failed` transitions allowed; re-acting on a settled request is a no-op (duplicate-request guard); failure settles (never perpetual pending)

### Implementation for User Story 2

- [x] T016 [P] [US2] Port the confirmation family (9 files: confirmation, confirmation-context.svelte.ts, -title, -request, -action, -actions, -accepted, -rejected, index.ts) into `src/lib/components/mcp/confirmation/` from donor sources, replacing the donor's `runed` `watch(() => approval, …)` with native `$derived`/`$effect` context propagation (research D2 — zero new packages); compose `ui/alert` + existing `ui/button`
- [x] T017 [US2] Recompose `src/lib/components/mcp/ElicitationDialog.svelte` onto the confirmation chrome: ConfirmationTitle (server name), ConfirmationRequest (message), existing JSON-schema form body retained between request and actions (field renderer + JSON fallback with inline parse errors), ConfirmationActions submit/cancel, terminal accepted/rejected bodies (AP-2, AP-4)
- [x] T018 [US2] Convert `src/lib/components/mcp/SamplingApprovalCard.svelte` to a thin instantiation of the same pattern: request = collapsible prompt preview + token-budget line, actions approve/decline, preserve existing `entry`/`onApprove`/`onDecline` prop shape for its mount site (AP-3)
- [x] T019 [US2] Implement failure semantics in `src/lib/components/mcp/confirmation/` and both consumers: transport drop / server error settles the entry `failed` with dismissible outcome (AP-5); settled entries ignore further actions (state-machine no-op)
- [x] T020 [US2] Verify degradation across `src/lib/components/mcp/confirmation/`, `src/lib/components/mcp/ElicitationDialog.svelte`, `src/lib/components/mcp/SamplingApprovalCard.svelte`: restore-window busy state disables submit/approve actions (AP-7); with `stdio-mcp` capability absent no approval UI renders (AP-6); dialog keeps focus-trap + Escape=cancel, sampling card stays inline non-modal (AP-8)
- [x] T021 [US2] Verify on dev stack: quickstart Scenario 2 pass, then `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Collapsible Tool-Call Display (Priority: P3)

**Goal**: Transcript tool rows on the collapsible tool-block pattern: collapsed by default, keyboard-accessible toggle, distinct failure/decline states, retained rich rendering (contract TD-1..TD-8).

**Independent Test**: quickstart.md Scenario 3 — run a tool-invoking session (verbose, terse, failing calls); verify collapsed-by-default, expand/collapse via click and keyboard, failure distinguishable collapsed, artifact links and sources intact.

### Tests for User Story 3

> **NOTE**: Write these FIRST, ensure they FAIL before implementation

- [x] T022 [P] [US3] Extract the status derivation from `ToolActivity.svelte` (current lines 45–72) into pure `src/lib/components/chat/rows/tool-status.ts` (`ToolGroup | OrphanToolResult` + terminal-tool lookup → `ToolStatus`) and port its mapping tests to `src/lib/components/chat/rows/tool-status.test.ts` — status set unchanged (TD-3)

### Implementation for User Story 3

- [x] T023 [US3] Re-compose `src/lib/components/chat/rows/ToolActivity.svelte` onto `ui/collapsible` (Collapsible/CollapsibleTrigger/CollapsibleContent) + `ui/badge` status chip: collapsed by default for every entry with input or output content, header shows badge/icon + tool name + terminal-artifact link (TD-1, TD-4, TD-5); consume `tool-status.ts`; NO auto-open on streaming state changes (TD-7, research D2)
- [x] T024 [US3] Replace the hand-rolled `role="button"` + keydown expand/collapse with the collapsible primitive's semantics (button + `aria-expanded`) in `src/lib/components/chat/rows/ToolActivity.svelte` (TD-2); retain `ToolResultBody.svelte` for output bodies and `ToolSources.svelte` for sources (TD-6)
- [x] T025 [US3] Verify on dev stack: quickstart Scenario 3 pass including perf spot-check with `window.__MAYON_PERF__ = 1` (TimelineRow render counts vs pre-change baseline, TD-8), then `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: All user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Measurement, theming consistency, and full regression.

- [x] T026 [P] Update `specs/006-ai-elements-adoption/loc-ledger.md` with final counts: feature-surface total must be ≤ 533 lines (SC-001) — trim dead donor variants if over
- [x] T027 [P] Theming pass across all three surfaces (picker, approval, tool rows) in dark and light modes against existing token conventions (SC-005)
- [x] T028 Run the full quickstart.md regression sweep: expound selection across math/code/paragraphs, branch create/navigate, restore-window degradation, all gates (`pnpm check`, `pnpm lint`, `pnpm test`) — spec FR-006/SC-004 evidence
- [x] T029 [P] Final dependency-manifest diff proving zero new packages end-to-end (SC-002); record result in `specs/006-ai-elements-adoption/loc-ledger.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T006 references vocabulary decisions; T007 independent) — BLOCKS all user stories
- **User Stories (Phases 3–5)**: All depend on Phase 2 completion; stories are independent of each other and may proceed in parallel or sequentially (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: After Phase 2 — no story dependencies (uses `ui/command`, `ui/dialog`)
- **User Story 2 (P2)**: After Phase 2 — no story dependencies (uses `ui/alert`, `ui/button`); independent of US1
- **User Story 3 (P3)**: After Phase 2 — no story dependencies (uses `ui/collapsible`, `ui/badge`); independent of US1/US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD for the logic pieces)
- Helpers/pure logic before component composition
- Component family before mount-site swap
- Story fully verified (smoke + gates) before moving on

### Parallel Opportunities

- T002/T003/T004 (three vocabulary primitives) run in parallel
- T008/T015/T022 (story logic tests) run in parallel across stories
- T009 (filter helper) parallels T016 (confirmation port) and T022 extraction — different files, different stories
- US1/US2/US3 phases can run in parallel with three workers after Phase 2
- T026/T027/T029 in Phase 6 run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch logic test + helper together:
Task: "T008 filtering-logic tests in src/lib/components/ai/model-select/filter-models.test.ts"
Task: "T009 filter helper in src/lib/components/ai/model-select/filter-models.svelte.ts"

# Then family files (single task T010 — one directory, no conflicts), then mount-site swap T013.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (vocabulary primitives)
2. Complete Phase 2: Foundational (donors staged, ledger baseline)
3. Complete Phase 3: User Story 1 (model picker)
4. **STOP and VALIDATE**: quickstart Scenario 1 independently
5. Ship/demo if ready — picker already replaces the largest bespoke surface

### Incremental Delivery

1. Setup + Foundational → vocabulary and measurement ready
2. Add US1 → validate Scenario 1 → MVP
3. Add US2 → validate Scenario 2 → approval consolidation delivered
4. Add US3 → validate Scenario 3 → tool display delivered
5. Polish → ledgers closed, theming verified, regression sweep green

### Parallel Team Strategy

With multiple developers:

1. Team completes Phases 1–2 together
2. Then: Developer A → US1, Developer B → US2, Developer C → US3 (disjoint directories: `ai/model-select/`, `mcp/confirmation/`, `chat/rows/`)
3. Stories integrate independently; Phase 6 closes measurement

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable (disjoint directories by design)
- Verify tests fail before implementing (T008, T015, T022)
- Commit after each task or logical group
- Hard invariants while editing (spec FR-006/FR-008, constitution III): do not touch `src/lib/markdown/**`, `src/lib/chat/selection.ts`, or message rendering; add nothing to the dependency manifest
- Stop at any checkpoint to validate the story independently
