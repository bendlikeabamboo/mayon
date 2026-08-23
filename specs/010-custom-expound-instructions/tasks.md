---
description: 'Task list for Customizable Expound Instructions implementation'
---

# Tasks: Customizable Expound Instructions

**Input**: Design documents from `/specs/010-custom-expound-instructions/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/expound-instructions-settings-key.md, contracts/branch-add-formats-format.md, quickstart.md

**Tests**: REQUIRED for all new/changed `src/lib/` behavior — constitution Art. II mandates tests for new `src/lib/` modules; quickstart.md defines the validation scenarios. UI-only component work is verified via `pnpm check` + manual smoke on the dev stack (constitution Art. III).

**Organization**: Tasks grouped by user story (spec.md P1–P4) over a shared foundational phase, per plan.md structure.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- File paths are repo-relative (single-project SPA; see plan.md Project Structure)

---

## Phase 1: Setup

**Purpose**: Confirm clean baseline before feature work

- [ ] T001 Verify baseline gates are green on the working branch: `pnpm check && pnpm lint && pnpm test` (fix/pre-existing failures are out of scope; note them if any)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared module + core migration that ALL user stories depend on. Delivers the expound flow working end-to-end with the five default instructions.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Create `src/lib/chat/expound-instructions.ts`: `ExpoundInstruction` type (`id`, `name`, optional `description`, optional `builtin`), `DEFAULT_EXPOUND_INSTRUCTIONS` (five built-ins incl. `mermaid-diagram` "Mermaid Diagram" and `focus-callouts` "Focus Callouts", first three names matching today's `TOGGLE_LABELS` exactly, per data-model.md table), `sanitizeInstructions(raw): ExpoundInstruction[]` (invalid elements dropped, null/corrupt → defaults), `validateInstruction(list, draft)` (name trimmed non-blank, unique case-insensitive, ≤ 60 chars; description ≤ 200 chars, empty → undefined), and `getExpoundInstructions()` / `saveExpoundInstructions(list)` over `repos.settings` key `expoundInstructions` per contracts/expound-instructions-settings-key.md
- [ ] T003 [P] Create `src/lib/chat/expound-instructions.test.ts`: defaults contain exactly the five built-ins in order incl. the two new ones; sanitize falls back to defaults on null/malformed/non-array and drops invalid elements; validation rejects blank, duplicate (case-insensitive), oversized names and oversized descriptions; round-trip save/read via the pglite test driver (`useFileTestDb()` from `src/lib/db/driver/pg-test.ts`)
- [ ] T004 Migrate `src/lib/chat/expound.ts` per contracts/branch-add-formats-format.md: change `ExpoundOptions.toggles` to `string[]` (display names), make `buildExpoundPrompt` join names, delete `ExpoundToggle` and `TOGGLE_LABELS` exports, add private frozen `LEGACY_TOGGLE_LABELS` map (`diagrams`/`tables`/`code` → current labels), and rewrite `parseAddFormats(raw): string[]` (null/malformed/non-array → `[]`, non-strings dropped, legacy keys mapped, all other strings kept verbatim — NO valid-set filtering); `serializeAddFormats` stays `JSON.stringify`
- [ ] T005 [P] Update `src/lib/chat/expound.test.ts`: prompt tests use display names (input-order preservation, empty → "Adding no extra formats whenever possible.", `(none provided)`, `provideSummary` unchanged); new `parseAddFormats` tests (legacy mapping `'["diagrams","tables"]'` → labels; unknown strings verbatim `'["diagrams","unknown"]'` → `['Diagrams (prompt diagrams)', 'unknown']`; null/`'not json'` → `[]`)
- [ ] T006 [P] Update `src/lib/stores/chat.svelte.test.ts` round-trip block (lines ~928–946): serialize/parse round-trips names; replace the unknown-dropping assertion with verbatim-preservation; keep null/invalid-JSON cases; update `branch_sources` extra-columns block to a names-based stored string (e.g. `'["Mermaid Diagram","Focus Callouts"]'`)
- [ ] T007 Update consumers for compile-green after the type migration: `src/lib/stores/chat.svelte.ts` (imports; `createExpoundBranch`/`createBranchChild` flow unchanged), `src/routes/chat/[id]/+page.svelte` (drop the `as ExpoundToggle[]` cast at line ~683; remove stale import), `src/lib/components/chat/Highlighter.svelte` + `src/lib/components/chat/rows/AssistantMessage.svelte` (type-only `ExpoundOptions` imports — no behavioral change), `src/lib/components/chat/ExpoundPromptConstructor.svelte` (options enumerated from `DEFAULT_EXPOUND_INSTRUCTIONS`, `SvelteSet<string>`, submit names in list order), `src/lib/components/chat/ExpoundCard.svelte` (render `addFormats: string[]` pills verbatim, no label lookup; `(none)` when empty)

**Checkpoint**: `pnpm check && pnpm lint && pnpm test` green; highlighting → expound works with the five defaults; branch pills show names.

---

## Phase 3: User Story 1 - Manage Expound Instructions in Settings (Priority: P1) 🎯 MVP

**Goal**: Editable settings section: list/add/edit/remove entries (name + optional description) with validation, persisting across reloads.

**Independent Test**: quickstart.md Scenario A steps 1–7 (add "Real-world Analogies", invalid adds rejected, edit, remove, reload → persisted).

### Implementation for User Story 1

- [ ] T008 [US1] Create `src/lib/components/chat/ExpoundInstructionsConfig.svelte` skeleton: settings-section layout modeled on `src/lib/components/chat/LearnerProfileConfig.svelte` / `src/lib/components/mcp/McpServers.svelte` (heading, `onMount` load via `getExpoundInstructions()`, local `$state` array, shared Tailwind `inputClass` constant for raw inputs, `Built-in` Badge for `builtin` entries from `$lib/components/ui/badge/index.js`)
- [ ] T009 [US1] Implement add/edit with validation in `src/lib/components/chat/ExpoundInstructionsConfig.svelte`: inline name+description inputs per entry, "Add instruction" appends a draft (`uuid()` from `src/lib/db/ids.ts`), `validateInstruction` gates saves (blank/duplicate/oversized) with inline `role="alert"` messages (FR-010); description optional
- [ ] T010 [US1] Implement remove + persistence in `src/lib/components/chat/ExpoundInstructionsConfig.svelte`: delete filters the array, every mutation persists the whole list via `saveExpoundInstructions` (replace-on-write per contract) with `saving` guard and inline `role="status"` feedback ("Saved." / "Save failed: …")
- [ ] T011 [US1] Mount the section in `src/routes/settings/+page.svelte` as `<ExpoundInstructionsConfig />` after `<LearnerProfileConfig />`
- [ ] T012 [US1] Manual smoke per quickstart.md Scenario A steps 1–7 on `pnpm dev`; then `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: Settings CRUD fully functional and persistent; expound flow still uses defaults until US2.

---

## Phase 4: User Story 2 - Use Custom Instructions in the Expound Flow (Priority: P2)

**Goal**: Picker offers the live customized list with description helper text; selected names flow into the request and the branch card.

**Independent Test**: quickstart.md Scenario B (custom entry selectable; first hidden user message contains `Adding [Mermaid Diagram, Real-world Analogies] whenever possible.`; pills match).

### Implementation for User Story 2

- [ ] T013 [US2] Wire `src/lib/components/chat/ExpoundPromptConstructor.svelte` to the live list: load options via `getExpoundInstructions()` in `onMount` (initialize from `DEFAULT_EXPOUND_INSTRUCTIONS` while loading), render each option's name as the toggle label and its `description` as helper text beneath
- [ ] T014 [US2] Confirm submit path carries names in list order (`toggles: keys.filter((k) => set.has(k))` semantics preserved over `string` ids/names) and that `buildExpoundPrompt` + `serializeAddFormats` receive the selected names unchanged through `src/routes/chat/[id]/+page.svelte` → `chatStore.createExpoundBranch`; extend `src/lib/stores/chat.svelte.test.ts` `createExpoundBranch` block with one names-based `expoundOpts` case asserting the stored `add_formats` string and prompt line
- [ ] T015 [US2] Verify SC-002 manually per quickstart.md Scenario B steps 1–5 + step B3 no-restart check (edit list in Settings → reopen picker reflects changes); run `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: Customization is live in the expound flow; US1+US2 together deliver the core user request.

---

## Phase 5: User Story 3 - Expanded Built-in Defaults (Priority: P3)

**Goal**: Fresh installs and upgraded installs present exactly the five built-ins (incl. Mermaid Diagram, Focus Callouts) with zero user action.

**Independent Test**: quickstart.md Scenario C step 4 (delete key → reload → reseeds) and Scenario A step 2 (five defaults listed).

### Implementation for User Story 3

- [ ] T016 [US3] Add null-guarded seeding to `settingsRepo.seedDefaults()` in `src/lib/db/repositories/settings.ts`: `if ((await this.get('expoundInstructions')) === null) await this.set('expoundInstructions', DEFAULT_EXPOUND_INSTRUCTIONS)` (import from `$lib/chat/expound-instructions`, precedent: `DEFAULT_PROFILE` import at settings.ts:4)
- [ ] T017 [P] [US3] Extend the settings-repository describe block in `src/lib/db/repositories/repositories.test.ts`: seed inserts the key when absent, double-run is idempotent, and an existing (customized) value is NOT overwritten (upgrade safety, FR-007)
- [ ] T018 [US3] Verify upgrade + fresh-install behavior per quickstart.md Scenario C step 4 (Drizzle Studio: delete `expoundInstructions` row → reload app → five built-ins reseeded; customized value survives reload); run `pnpm test`

**Checkpoint**: SC-003 and FR-006/FR-007 hold on fresh and upgraded installs.

---

## Phase 6: User Story 4 - Restore Defaults and Continuity (Priority: P4)

**Goal**: Restore-defaults action (confirmed) resetting to the five built-ins; historical branches keep their recorded labels.

**Independent Test**: quickstart.md Scenario C steps 1–3 (restore via dialog; renamed/removed instructions still render; legacy `'["diagrams","tables"]'` row renders mapped labels).

### Implementation for User Story 4

- [ ] T019 [US4] Add restore-defaults to `src/lib/components/chat/ExpoundInstructionsConfig.svelte`: "Restore defaults" `Button` from `$lib/components/ui/button/index.js` opening a shadcn `Dialog` confirmation (pattern: `McpServers.svelte` import dialog / `DataSection` destructive confirm); on confirm, overwrite the list via `saveExpoundInstructions(DEFAULT_EXPOUND_INSTRUCTIONS)` (overwrite, never key-delete — per contract invariant)
- [ ] T020 [US4] Verify historical continuity per quickstart.md Scenario C steps 1–3: rename/remove an instruction and confirm old branch pills unchanged; insert a legacy `branch_sources.add_formats = '["diagrams","tables"]'` row via `pnpm db:studio` and confirm pills render "Diagrams (prompt diagrams)" / "Comparison Tables" (read-time mapping is covered by T005 tests); run `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: SC-004 / FR-011 / FR-012 hold; all four stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all stories

- [ ] T021 [P] Run full quality gates per constitution: `pnpm check && pnpm lint && pnpm test` (no server-side changes, so `pnpm --filter @mayon/server test` is not required — confirm no `server/`/`packages/` files were touched)
- [ ] T022 Execute the full quickstart.md validation pass (Scenarios A–D incl. the zero-selection regression `Adding no extra formats whenever possible.` and the overlap-guard check)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories (module + type migration is the shared substrate)
- **User Stories (Phases 3–6)**: All depend on Phase 2 completion
  - US1 (Phase 3): independent after foundation
  - US2 (Phase 4): independent after foundation (T013 replaces the T007 static-defaults scaffold)
  - US3 (Phase 5): independent after foundation (seeding rides on the module + boot hook)
  - US4 (Phase 6): continuity verification is independent after foundation; **T019 (restore-defaults UI) extends US1's component** — sequence Phase 6 after Phase 3, or land T019 as a patch to the same file
- **Polish (Phase 7)**: Depends on all completed stories being in scope

### User Story Dependencies

- **US1 (P1)**: after Phase 2 only — no story dependencies
- **US2 (P2)**: after Phase 2 only — independent of US1 (picker reads settings key directly)
- **US3 (P3)**: after Phase 2 only — independent
- **US4 (P4)**: after Phase 2; T019 touches `ExpoundInstructionsConfig.svelte` (US1 artifact); T020 needs no other story

### Within Each User Story

- Module/lib changes before component wiring (foundation already enforces this)
- Component skeleton before flows (T008 → T009/T010)
- Manual quickstart scenarios after `pnpm check/lint/test` pass

### Parallel Opportunities

- T003, T005, T006: three independent test files, all parallelizable once T002/T004 contracts are fixed (they are — data-model.md + contracts/)
- T017 parallel with T016's manual verification (T018)
- After Phase 2: US1, US2, US3 phases can proceed in parallel on disjoint files (US1/US4 share `ExpoundInstructionsConfig.svelte`; US2 touches `ExpoundPromptConstructor.svelte`; US3 touches `repositories/settings.ts`)

---

## Parallel Example: Phase 2 test files

```bash
# After T002 + T004 semantics are fixed by the contracts, launch together:
Task: "Create src/lib/chat/expound-instructions.test.ts (T003)"
Task: "Update src/lib/chat/expound.test.ts (T005)"
Task: "Update src/lib/stores/chat.svelte.test.ts (T006)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline gates)
2. Complete Phase 2: Foundational (module, migration, compile-green)
3. Complete Phase 3: US1 (Settings CRUD + persistence)
4. **STOP and VALIDATE**: quickstart Scenario A — add/edit/remove/persist works
5. Ship/demo if ready (the list is editable; picker still shows defaults)

### Incremental Delivery

1. Setup + Foundational → five defaults live end-to-end (US3 mechanics effectively proven)
2. + US1 → editable, persistent list (MVP)
3. + US2 → customization live in the expound flow (core request complete)
4. + US3 → seeded defaults for fresh/upgraded installs (upgrade safety proven)
5. + US4 → restore-defaults + historical continuity (safety nets)
6. Polish → full quickstart pass

### Parallel Team Strategy

- Dev A: US1 → US4 (shared component)
- Dev B: US2 (picker + submit path)
- Dev C: US3 (seed + repo tests)
- All after Phase 2; integrate at Phase 7

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map to spec.md user stories for traceability
- Tests are constitution-mandated for `src/lib/` changes (Art. II); UI sections verified via `pnpm check` + dev-stack smoke (Art. III)
- Commit after each task or logical group; stop at any checkpoint to validate independently
- Known intentional test-semantics change: `parseAddFormats('["diagrams","unknown"]')` now preserves `'unknown'` verbatim (FR-012) — the old unknown-dropping assertion is replaced in T006/T005
