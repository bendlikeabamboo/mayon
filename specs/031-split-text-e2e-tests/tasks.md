---
description: "Task list for 031-split-text-e2e-tests"
---

# Tasks: Split Text-Generation Tests from UI E2E

**Input**: Design documents from `/specs/031-split-text-e2e-tests/`

**Prerequisites**: plan.md (required), spec.md (required), research.md (decisions D1–D8, per-spec triage), data-model.md, contracts/{shared-fixtures,browser-inventory}.md, quickstart.md (V1–V8)

**Tests**: This feature *is* tests — the tasks below author/modify test artifacts only. No product source may change (FR-010).

**Organization**: Tasks grouped by user story (spec.md P1→P2→P3) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependencies on incomplete tasks)
- **[Story]**: user story (US1/US2/US3)
- Exact file paths in every task; research/contract/quickstart references for context

## Path Conventions

Monorepo per plan.md: fast tier colocated `src/**/*.test.ts` (+ `server/src/`), browser tier `tests/e2e/*.spec.ts`, mock fixtures `tests/fixtures/mock-llm/`. Run single fast tests with `pnpm test <file>`; single e2e specs with `pnpm test:e2e -- <file>` (stack required: `pnpm dev:up`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bootstrap the fresh worktree and establish a green baseline.

- [X] T001 Bootstrap worktree: `pnpm install` and `pnpm --filter @mayon/shared build` (AGENTS.md worktree rules; no `pnpm dev:build` needed — deps/config/shared untouched)
- [X] T002 Baseline green: `pnpm test` passes on the untouched tree (fixtures for later timing: note approximate duration)

**Checkpoint**: Tree installable and green before any edit.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared fixture single-source (FR-005, research D3, contracts/shared-fixtures.md) that every US1 fast-tier scenario and every e2e assertion depends on.

- [X] T003 Extract fixture-only assertion strings (`PROPAGATE_*`, `OFFER_*`, `LEVER_TRIGGER_*`, `IMAGE_*`, …) from `tests/fixtures/mock-llm/server.mjs` into `tests/fixtures/mock-llm/strings.mjs` (or extend `markers.mjs`); `server.mjs` serves from the constants, zero inline copies of served text
- [X] T004 Convert `tests/e2e/fixtures/kitchen-sink.ts` to import/re-export the shared constants (precedent: its existing `quiz-fixture.mjs`/`lab-fixture.mjs` imports); delete every hand-mirrored copy
- [X] T005 Add the drift-guard test (extend `src/lib/ai/generate/classification-markers.test.ts` or a sibling): fails when a constant diverges from what `server.mjs` serves, or when `kitchen-sink.ts` re-defines a served string (depends T003, T004)
- [X] T006 [P] Cross-link the harness rule: `tests/fixtures/mock-llm/README.md` points import rules at `specs/031-split-text-e2e-tests/contracts/shared-fixtures.md`

**Checkpoint**: Single fixture source + drift guard green (`pnpm test src/lib/ai/generate/classification-markers.test.ts`, then `pnpm test`); e2e constants unchanged in value.

---

## Phase 3: User Story 1 — Text-generation behavior proven in the fast suite (Priority: P1) 🎯 MVP

**Goal**: Composed end-state invariants get fast-tier homes (add-first), then behavior-only assertions leave the e2e specs (FR-002/FR-003/FR-008).

**Independent Test**: quickstart V1+V2 — with the docker stack down, `pnpm test` proves the migrated invariants; a planted logic break fails naming the invariant.

### Composed fast-tier scenarios (research D2; add-before-remove — all green before Phase prunes)

- [X] T007 [US1] Offer-turn end-state in `src/lib/chat/backprop-endstate.test.ts` (new file; `useFileTestDb()` → seed branch chat via `repos` → offer-classified reply turn ⇒ exactly +2 durable message rows, 0 approval-ask rows, offer never repeats, parent chat untouched); import fixture text per contracts/shared-fixtures.md
- [X] T008 [US1] Declined-turn end-state in `src/lib/chat/backprop-endstate.test.ts`: declined tool result persisted, `toolsRun` never invoked, never re-asked, parent untouched (depends T007 — same file)
- [X] T009 [US1] Root-trigger end-state in `src/lib/chat/backprop-endstate.test.ts`: `propagate_unavailable` plain reply persisted, 0 ask rows, next turn's tool set excludes `propagate_to_parent` (depends T008 — same file)
- [X] T010 [P] [US1] Capability-toggle → tool-less trace: extend `src/lib/agent/loop.test.ts` — flip provider tool capability ⇒ next turn's persisted agent trace records 0 tool iterations
- [X] T011 [P] [US1] Discovery → persisted settings merge: extend `src/lib/ai/connection-test.test.ts` and/or the provider store test — successful model discovery merges the catalog into the persisted provider record
- [X] T012 [P] [US1] Telemetry per-turn record emission: extend `src/lib/telemetry/telemetry.test.ts` (or sibling) — a composed turn emits chat-turn + title records with expected attrs; aborted turn emits the aborted record; metadata mode carries no conversation text
- [X] T013 [P] [US1] Image reload-serves-from-row decision: verify store-hydration coverage of "reload serves the image from the persisted row" in `src/lib/stores/chat.svelte.test.ts`; add the scenario only if genuinely absent; record the ledger decision (migrated → home, or already-covered → home)

### Parity ledger entries, then e2e pruning (research D8 rubric: counts/absence-windows/trace-counts/mock-log scrapes only; keep render, reload-render, nav, live-path steps)

- [ ] T014 [US1] Record ledger dispositions in `tests/e2e/README.md` for every cluster with a landed fast home from T007–T013 (`migrated → <file>` / `already-covered → <file>`) — dispositions MUST exist before any deletion (contracts/browser-inventory.md policy 3)
- [X] T015 [P] [US1] Prune behavior-only assertions from `tests/e2e/backprop-tool.spec.ts` (durable-row counts, 12s no-modal/no-toast/no-re-ask windows, parent-artifact absence checks; keep Approve/Decline UI, badges, reload-render persistence, breadcrumb, live-path steps) (depends T014)
- [X] T016 [P] [US1] Prune behavior-only assertions from `tests/e2e/provider-picker.spec.ts` (persisted-trace tool-count iterations; keep card UI, status text, discovery dialog, live fetch) (depends T014)
- [X] T017 [P] [US1] Prune behavior-only assertions from `tests/e2e/telemetry.spec.ts` (span attribute/usage/composition checks now proven in T012; keep one thin live-delivery check per stub path) (depends T014)
- [X] T018 [P] [US1] Apply the T013 ledger decision to `tests/e2e/image-round-trip.spec.ts` (drop the mock-log zero-request scrape only if the fast home exists; else record `retained-ui`/`retained-live-path` and keep) (depends T014)

**Checkpoint**: `pnpm test` green incl. all composed scenarios; `pnpm dev:up && pnpm test:e2e` green with pruned specs; coverage never dipped (every deleted assertion has a `migrated →`/`pruned-covered` disposition).

---

## Phase 4: User Story 2 — Browser suite fully classified (Priority: P2)

**Goal**: `tests/e2e/README.md` becomes the complete classification + parity ledger per contracts/browser-inventory.md (FR-004, SC-001).

**Independent Test**: quickstart V3 — one row per `tests/e2e/*.spec.ts` (10/10, incl. `backprop-tool` + `telemetry`), every row states a `ui-only`/`live-path` classification and UI-residue line, zero `proposed` dispositions, policy statements present.

- [X] T019 [US2] Restructure `tests/e2e/README.md` to the full contract: table columns (Spec / Classification / UI residue / Behavior invariants → fast-tier home), policy statements 1–4 from contracts/browser-inventory.md, classification + residue rows for the 8 classification-only specs (`mock-classification`, `quiz`, `lab`, `prompt-contract`, `onboard`, `render`, plus completing `backprop-tool`/`telemetry` rows)
- [X] T020 [US2] Ledger completeness sweep against `contracts/browser-inventory.md`: every cluster from the research triage has a disposition (`already-covered →` / `migrated →` / `retained-ui` / `retained-live-path` / `pruned-covered`), zero unclassified specs, zero `proposed` entries

**Checkpoint**: Inventory answers "what is this browser test for?" for all 10 specs; policy makes behavior-proving additions a visible mismatch.

---

## Phase 5: User Story 3 — Fast feedback loop as the default proof cycle (Priority: P3)

**Goal**: Prove the measurable outcomes (SC-003/SC-005) and the no-runtime-change constraint (FR-010) on the finished shape.

**Independent Test**: quickstart V6+V7+V8.

- [ ] T021 [P] [US3] No-runtime-change proof (quickstart V8): `git diff --stat` across the branch shows only `specs/`, `tests/`, `src/**/*.test.ts`, `server/src/**/*.test.ts` — zero product source, routes, schemas, workflows
- [ ] T022 [US3] Full gates green (quickstart V1/V4): `pnpm lint && pnpm check && pnpm test` with the stack down, then `pnpm dev:up && pnpm test:e2e && pnpm dev:down`
- [ ] T023 [US3] Measurements (quickstart V6/V7): 5× consecutive runs of `pnpm test src/lib/chat/backprop-endstate.test.ts` all green (flake-class-free by construction); record fast-tier vs browser-tier wall times, confirm ≤ 1/10 ratio; record both in the validation-pass commit message

**Checkpoint**: All quickstart measurable criteria demonstrated on the final tree.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation of the finished split.

- [ ] T024 Run `specs/031-split-text-e2e-tests/quickstart.md` V1–V8 end-to-end; fix anything it catches; only then mark this feature's tasks complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on Phase 1 — BLOCKS all user stories (fixture source + drift guard underpin US1 scenarios)
- **US1 (Phase 3)**: depends on Phase 2; within it: scenarios T007→T008→T009 (same file) run sequentially; T010–T013 parallel after T007 starts; T014 after all landed homes; T015–T018 after T014 (each prune independent of the other prunes)
- **US2 (Phase 4)**: depends on US1 (ledger dispositions reference US1 homes); T019 → T020
- **US3 (Phase 5)**: depends on US1+US2 (measures the finished shape); T021 parallel with T022/T023
- **Polish (Phase 6)**: depends on all stories

### User Story Dependencies

- **US1 (P1)**: starts after Foundational — no story deps (MVP)
- **US2 (P2)**: after US1 (dispositions need landed homes); structurally independent otherwise
- **US3 (P3)**: after US1+US2 (validates the final state)

### Parallel Opportunities

- Phase 2: T006 alongside T003–T005
- Phase 3: T010, T011, T012, T013 all [P] (different files) once T007 is underway; T015–T018 prunes (different spec files) all [P] after T014
- Phase 5: T021 [P] alongside T022/T023

---

## Parallel Example: User Story 1

```bash
# After T007 scaffolds the new file, launch together (different files):
Task: "Capability-toggle → tool-less trace in src/lib/agent/loop.test.ts"
Task: "Discovery → persisted settings merge in src/lib/ai/connection-test.test.ts"
Task: "Telemetry per-turn record emission in src/lib/telemetry/"
# After all homes are green, launch prunes together (different spec files):
Task: "Prune tests/e2e/backprop-tool.spec.ts"
Task: "Prune tests/e2e/provider-picker.spec.ts"
Task: "Prune tests/e2e/telemetry.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (bootstrap + baseline) → Phase 2 (fixture single-source + drift guard)
2. Phase 3 (composed scenarios → ledger → prunes)
3. **STOP and VALIDATE**: V1+V2 — stack down, `pnpm test` proves migrated invariants; planted break fails fast
4. The flakiest, slowest behavior proofs are already out of the browser at this point

### Incremental Delivery

1. MVP (US1) → biggest feedback-speed and flake win
2. US2 → durable classification guardrail (inventory + policy)
3. US3 → measured outcomes recorded
4. Polish → full quickstart pass

---

## Notes

- [P] = different files, no dependencies on incomplete tasks
- Add-before-remove is absolute (FR-008): no e2e assertion is deleted before its ledger disposition exists and its fast home is green
- No product source, no new dependencies, no CI edits (research D6); verify with T021
- No `+`-prefixed filenames (SvelteKit route namespace)
- Commit after each task or logical group; worktree pushes to its own branch — never merge into `main` (AGENTS.md worktree rules)
