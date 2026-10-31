---

description: "Task list for feature 025-text-first-runtime"

---

# Tasks: Enforceable Text-First Runtime Tier

**Input**: Design documents from `/specs/025-text-first-runtime/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md — all present.

**Tests**: Included where the design demands them (constitution II: new behavior ships with tests; quickstart V5 = wire self-tests). No app-runtime behavior is added, so logic-layer tests are limited to the enforcement tooling itself.

**Organization**: Tasks grouped by user story (spec.md): US1 wire (P1), US2 agent's map (P2), US3 text-first norm (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths in every task

## Path Conventions

Single SvelteKit project at repo root (`src/`), server package (`server/`), shared package (`packages/shared/`), CI (`.github/`), Quarto docs (`docs/`). No new directories except `scripts/` and test fixtures.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the green baseline the wire will later protect.

- [x] T001 Baseline bring-up and gate check on the working tree: `pnpm install`, `pnpm --filter @mayon/shared build`, then `pnpm lint && pnpm check && pnpm test` — record all green before any boundary work starts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make the tree façade-clean so the wire (US1) can go live **absolute, with zero baselined violations** (research.md D2/D3). Blocks all user stories.

- [x] T002 Extend the façade in `src/lib/db/index.ts`: add `export type * from './schema'`, re-export the repo payload types used by `src/lib/ai/generate/{quiz,lab}.ts`, and add runtime re-exports `runSelfCheck` (from `./self-check`) and the backup operations used by `src/lib/services/{db-import,db-backup,sandbox-backup}.ts` (from `./backup`)
- [x] T003 [P] Resolve `uuid` placement per research.md D2: inspect consumers of `src/lib/db/ids.ts`; if no `src/lib/db/**` module imports it, move it to `src/lib/ids.ts` and update importers, else re-export `uuid` from the façade; either way update `src/lib/components/mcp/McpServers.svelte`, `src/lib/components/ai/ProviderConfig.svelte`, `src/lib/components/chat/ExpoundInstructionsConfig.svelte` to import via the sanctioned surface (depends on T002 only if the façade branch is taken)
- [x] T004 [P] Rewrite deep imports in `src/routes/+layout.svelte`: `bootstrapDb` from `$lib/db/driver/client` → façade `$lib/db`; `runSelfCheck` from `$lib/db/self-check` → façade (depends on T002)
- [x] T005 [P] Rewrite `src/lib/components/labs/LabRunner.svelte`: `labsRepo` from `$lib/db/repositories/labs` → `repos.labs` from `$lib/db` (depends on T002)
- [x] T006 [P] Rewrite `src/lib/services/db-import.ts`, `src/lib/services/db-backup.ts`, `src/lib/services/sandbox-backup.ts`: import backup operations from `$lib/db` façade instead of `$lib/db/backup` (depends on T002)
- [x] T007 [P] Rewrite all type-only deep imports of `$lib/db/schema` (find with `rg "from '\$lib/db/schema'" src/ --glob '!src/lib/db/**'`) plus the dynamic `import('$lib/db/schema')` in `src/lib/components/chat/MessageList.svelte` to use façade type imports (depends on T002)
- [x] T008 Verify foundational state: `pnpm check && pnpm lint && pnpm test` green, and `rg "\ from '\$lib/db/" src/ --glob '!src/lib/db/**' --glob '!*.test.ts'` returns zero matches

**Checkpoint**: Tree is façade-clean with all gates green — the wire can now be absolute.

---

## Phase 3: User Story 1 — Boundary violations are caught by machines (Priority: P1) 🎯 MVP

**Goal**: The enforcement wire (contracts/enforcement.md rules R1–R4): lint boundary rules + CI direction backstop, self-tested, with scoped escape hatches and zero entries at launch.

**Independent Test**: Plant each violation class (deep static import, type-only deep import, dynamic deep import, inline disable) in a scratch change → the corresponding gate fails naming file + rule + sanctioned alternative; revert → gates green (quickstart V1–V5).

### Implementation for User Story 1

- [x] T009 [P] [US1] Add boundary rule blocks to `eslint.config.js`: R1 (app tier — everything under `src/` except `src/lib/db/**`, `**/*.test.ts` — may import only `$lib/db`, never `$lib/db/*` deep paths, static or type-only) and R3 (`src/lib/db/**` must not import app modules `$lib/components|$lib/stores|$lib/services|$lib/ai` or routes), using core `no-restricted-imports` patterns with the FR-004 message text from `specs/025-text-first-runtime/contracts/enforcement.md`; include a clearly-commented empty `ESCAPE HATCHES` overrides section
- [x] T010 [P] [US1] Create `scripts/check-dependency-direction.mjs` (stdlib only): R2 — scan `src/` for dynamic `import('...$lib/db/...')` deep paths outside sanctioned files; R3 backstop — `src/lib/db/**` files importing app modules; R4 — flag any `eslint-disable` line referencing the boundary rule ids (inline disables are violations); reads its own hatch table for exceptions, each entry requiring a justification string
- [x] T011 [US1] Add root script `check:boundaries` to `package.json` wrapping `node scripts/check-dependency-direction.mjs` (depends on T010)
- [x] T012 [US1] Wire the direction check into CI in `.github/actions/ci/action.yml` as a step immediately after `pnpm lint` (depends on T011)
- [x] T013 [US1] Wire self-tests: create fixture trees `tests/fixtures/boundaries/violating/` and `tests/fixtures/boundaries/clean/` and a Vitest test at `src/lib/boundaries/check-direction.test.ts` that runs the script against both (violating fixtures exit non-zero naming file + rule; clean fixtures pass) — this is the SC-001 regression net (depends on T010)
- [x] T014 [US1] Validate the wire per `specs/025-text-first-runtime/quickstart.md` V1–V5: plant/remove each violation class, exercise the scoped-hatch path, confirm all merge-blocking gates stay green

**Checkpoint**: The boundary is machine-enforced and self-tested; US1 delivers standalone value.

---

## Phase 4: User Story 2 — One-page agent's map (Priority: P2)

**Goal**: `docs/reference/agent-map.qmd` per contracts/agents-map.md, wired into the docs site and AGENTS.md, with seams.qmd as the authoritative declaration.

**Independent Test**: An agent (or reviewer) with no other Mayon context, given only the map, correctly plans a sampled boundary-placeable feature: logic behind the seam, text-first proof, browser only for UI-only behavior (SC-003, quickstart V6).

### Implementation for User Story 2

- [x] T015 [US2] Create `docs/reference/agent-map.qmd` with the four required sections from `specs/025-text-first-runtime/contracts/agents-map.md` (placement policy incl. DOM-married straddlers; proving path naming `useFileTestDb()` in `src/lib/db/driver/pg-test.ts` + an exemplar test such as `src/lib/chat/context.test.ts`; browser-as-camera allowance + RC doors `/api/health` and `/api/db/query`; enforcement & escape-hatch pointers) — links to authoritative docs, never duplicates
- [x] T016 [P] [US2] Update `docs/reference/seams.qmd`: fix stale path `src/lib/db/repos/` → `src/lib/db/repositories/` and add the enforcement cross-link (lint rule location + direction script) to the "Components and stores call repositories only" section (FR-001)
- [x] T017 [US2] Wire the map into the docs site: `docs/_quarto.yml` sidebar entry and `docs/index.qmd` reference listing (depends on T015)
- [x] T018 [P] [US2] Add the agent's map pointer to the "Where to look" section of `AGENTS.md` (depends on T015)
- [x] T019 [US2] Steering validation (SC-003): from the map alone, plan a sampled boundary-placeable feature and verify the plan matches policy; confirm quickstart V6

**Checkpoint**: The map steers placement and proving decisions without human explanation.

---

## Phase 5: User Story 3 — Text-first proving as the norm (Priority: P3)

**Goal**: Make the placement policy operational for new feature work: review-gate checklist and an annotated browser-test inventory, so the norm survives beyond the map page.

**Independent Test**: A feature PR shaped against the checklist (logic behind seam + text tests, browser only for UI-only behavior) passes review without placement debate; the e2e inventory classifies every existing browser test's allowed role (quickstart V7 for the doors half).

### Implementation for User Story 3

- [x] T020 [P] [US3] Add the placement review checklist to `docs/how-to/contributing.qmd` (and a one-line pointer from `CONTRIBUTING.md`): reviewers verify logic-placement, text-first proof presence, and that browser tests cover only UI-only behavior; references the map rather than restating rules (depends on T015)
- [x] T021 [P] [US3] Inventory the existing browser suite (locate via `pnpm test:e2e` script) and annotate its README (in the e2e directory) marking each test's allowed role per policy — camera/visual or UI-only behavior — flagging any behavior-proving browser test whose logic should live behind the seam as an opportunistic-migration candidate (do not migrate in this feature)
- [x] T022 [US3] Validate the norm end-to-end per quickstart V7: RC doors (`/api/health`, `/api/db/query`) answer on the dev stack, and confirm no new runtime surface exists anywhere in the feature diff (FR-010)

**Checkpoint**: Policy, map, wire, and review gate reinforce each other; all stories independently deliverable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final acceptance across all gates and docs.

- [x] T023 Run every merge-blocking gate: `pnpm lint && pnpm check && pnpm test && pnpm --filter @mayon/server test`; confirm R1/R2 hatch tables are empty, the R3 baseline contains only the justified straggler entries, and `pnpm check:boundaries` reports zero violations and zero inline boundary disables (R4)
- [x] T024 Verify the docs site builds and links: render `docs/` (Quarto) locally and check the agent-map page, seams cross-links, and sidebar/index entries resolve
- [x] T025 Execute the full `specs/025-text-first-runtime/quickstart.md` V1–V7 as final acceptance and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1; **BLOCKS all user stories** (the wire must find a clean tree).
- **US1 (Phase 3)**: Depends on Phase 2 (T009–T013 internally ordered: T009 ∥ T010; T011→T012; T013 after T010; T014 last).
- **US2 (Phase 4)**: Depends on Phase 2; can run in parallel with US1 (the map references config paths, not live behavior) — T016 is fully independent; T015 → T017, T018; T019 last.
- **US3 (Phase 5)**: Depends on US2 (T020 references the map; T022's doors are documented in it); T020 ∥ T021; T022 last.
- **Polish (Phase 6)**: Depends on all stories complete.

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies. MVP.
- **US2 (P2)**: After Phase 2 — parallelizable with US1; independent of US1's outcome.
- **US3 (P3)**: After US2 (needs the map to exist); independent of US1.

### Parallel Opportunities

- Phase 2: T003–T007 all touch different files → parallel after T002.
- Phase 3: T009 ∥ T010 (different files).
- Phase 4: T016 independent; T017 ∥ T018 after T015.
- Phase 5: T020 ∥ T021.
- Cross-story: US2 can proceed while US1 finishes.

---

## Parallel Example: Phase 2

```bash
# After T002, launch in parallel:
Task: "T003 Resolve uuid placement (ids.ts) per research D2"
Task: "T004 Rewrite +layout.svelte deep imports to façade"
Task: "T005 Rewrite LabRunner labsRepo → repos.labs"
Task: "T006 Rewrite services backup imports to façade"
Task: "T007 Rewrite type-only schema imports + MessageList dynamic import"
```

(Six-task subgroup: T002 + the five above — matches the repo's ≤6-tasks-per-parallel-agent convention.)

## Parallel Example: User Story 1

```bash
# Launch together (different files):
Task: "T009 ESLint boundary blocks R1/R3 in eslint.config.js"
Task: "T010 Direction-check script scripts/check-dependency-direction.mjs"
# Then: T011 → T012 (script wiring → CI), T013 (self-tests) → T014 (validation)
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + User Story 1)

1. Complete Phase 1 baseline (T001).
2. Complete Phase 2 façade-clean tree (T002–T008) — CRITICAL, blocks the wire.
3. Complete US1 wire (T009–T014).
4. **STOP and VALIDATE**: quickstart V1–V5 — the boundary is now machine-enforced.
   This alone delivers the feature's core protection (spec US1).

### Incremental Delivery

1. Phases 1–2 → clean tree.
2. + US1 → enforceable boundary (MVP).
3. + US2 → steering map (spec US2 independently testable via SC-003).
4. + US3 → norm operationalized in review + e2e inventory.
5. Phase 6 → full acceptance (V1–V7).

### Parallel Team Strategy

1. Together: Phases 1–2 (single sequential core).
2. Then: Agent A → US1; Agent B → US2 (T016 can start even during US1).
3. After US2: US3 (T020 ∥ T021), then Phase 6 acceptance.

---

## Notes

- [P] tasks = different files, no dependencies.
- Zero new npm dependencies anywhere (plan.md Technical Context).
- Launch state of the escape-hatch block MUST be empty (research.md D3) — T023 asserts it.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- Avoid: touching `src/lib/db/schema.ts` or any migration; weakening existing gates; adding runtime code paths (FR-010).
