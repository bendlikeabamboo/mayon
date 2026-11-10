# Tasks: Test Suite Tiering

**Input**: Design documents from `/specs/032-test-suite-tiering/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Note on tests**: This feature refactors the test suite itself, so the test files are the implementation artifacts. There is no separate "write tests first" phase; instead every migration task must be verified by breaking the subject and watching the replacement test fail (see `specs/032-test-suite-tiering/quickstart.md`).

**Organization**: Tasks are grouped by user story so each tier can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: `US1` (Tier 1), `US2` (Tier 2), `US3` (Tier 3), `US4` (guardrails/budgets)
- Exact repository-relative paths are included in every task

## Path Conventions

- App tests: `src/**/*.test.ts` (Tier 1) and `src/**/*.browser.test.ts` (Tier 2)
- Server tests: `server/src/**/*.test.ts`
- End-to-end: `tests/e2e/**`
- Shared mocks: `tests/mocks/**`
- Tooling: `scripts/**`, root configs

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the development-only dependencies and scaffolding all tiers need

- [x] T001 Add `@vitest/browser-playwright`, `vitest-browser-svelte`, and `msw` to `devDependencies` in `package.json`, pin versions compatible with Vitest 4.1 and Playwright 1.62, and update `pnpm-lock.yaml`
- [x] T002 [P] Create `scripts/test-capacity.mjs` exporting a pure `resolveCapacity(readings)` plus a `readCapacity()` I/O wrapper per `contracts/capacity-gate.md` (OS + cgroup minimum, overrides, stable report line)
- [x] T003 [P] Create `tests/mocks/handlers.ts` with shared MSW handlers for auth session, provider discovery, and LLM proxy endpoints used by components
- [x] T004 [P] Create `tests/mocks/node.ts` (`setupServer`) and `tests/mocks/browser.ts` (`setupWorker`) using the shared handlers
- [x] T005 [P] Add the MSW worker asset under `tests/mocks/public/mockServiceWorker.js` and ensure it is served only by the test Vite server, never copied into `build/`
- [x] T006 [P] Create `test-budgets.json` with tier1 60 s, tier2 120 s, tier3 120 s per shard (480 s total work), server 120 s and the `8cpu/8GiB` reference
- [x] T007 [P] Create `scripts/check-test-budget.mjs` skeleton that reads `test-results/tier-durations.json` and `test-results/tier3-shard-*.json`, accepts `--tiers=<csv>`, and exits 3 on a missing or over-budget owned tier (full ownership rules land in T053)
- [x] T008 [P] Create `scripts/test-tier-exemptions.json` with the schema and empty list (or the temporary telemetry exemption until US3 lands)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Runner configuration, discovery, and the migration ledger every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 Modify `vitest.config.ts` to define `projects: [unit, browser]`; unit includes `src/**/*.test.ts` and `scripts/**/*.test.ts`, excluding `*.browser.test.ts` and `*.integration.test.ts`; browser includes `src/**/*.browser.test.ts` with Playwright Chromium, headless, Svelte plugin, alias test doubles, and the capacity gate
- [x] T010 [P] Create `tests/mocks/app/navigation.ts`, `tests/mocks/app/state.ts`, and `tests/mocks/app/environment.ts` test doubles for route-level component tests
- [x] T011 [P] Modify `playwright.config.ts` to read `readCapacity()` for `workers`/`fullyParallel`, set the `E2E_BASE_URL` default, and prepare the `setup` project slot without yet wiring session state
- [x] T012 [P] Update `package.json` scripts: `test` (both Vitest projects), `test:unit`, `test:browser`, `test:ci`, `test:e2e:ci`, `check:budget`, `test:integration`, `check:tests`; keep `test:low-spec` and `test:e2e` working
- [x] T013 Create `specs/032-test-suite-tiering/migration-ledger.md` from the 32 source-text files with `sourceFile`, `subject`, `claimedBehavior`, `disposition`, `replacementPath`, `rationale`, `baselineTier1Files`, `baselineTier1Tests`, `baselineTier3Cases: 37`, `targetTier3Max: 18`, `finalTier1Files`, `finalTier1Tests`, and `verified = false`
- [x] T014 [P] Rename `src/lib/ai/real-provider.integration.test.ts` to the `*.integration.test.ts` convention and confirm the default unit project excludes it
- [x] T015 [P] Create `tests/browser/render.ts` helper wrapping `vitest-browser-svelte` `render()` with the project's standard cleanup and accessible-query guidance

**Checkpoint**: Both Vitest projects resolve, the browser tier launches Chromium, the ledger exists, and commands are discoverable.

---

## Phase 3: User Story 1 — Trustworthy instant feedback for logic and server handlers (Priority: P1) 🎯 MVP

**Goal**: Every logic and server-handler test runs in-process, with no browser, build, or socket; source-text tests that masquerade as behavior are reclassified or removed.

**Independent Test**: Introduce a defect in a pure helper and in a Fastify handler; both fail under `pnpm test:unit` within seconds, and the run starts no browser and no listener.

### Implementation for User Story 1

- [x] T016 [P] [US1] Create `server/src/testing/build-app.ts` to construct the Fastify app with injected dependencies for `app.inject(...)`, following `research.md` R12
- [x] T017 [US1] Convert `server/src/auth-cli.test.ts` and `server/src/auth-gate.test.ts` socket-based cases to `app.inject(...)` where the socket is not the subject, keeping the proxy upstream listener cases
- [x] T018 [P] [US1] Audit `server/src/*.test.ts` for `app.listen`, `http.createServer`, and `fetch(` usage; convert or annotate each remaining real transport as a transport-subject test
- [x] T019 [P] [US1] Audit `src/**/*.test.ts` for browser imports and non-inject DOM helpers, record every offender in `specs/032-test-suite-tiering/migration-ledger.md`, and fix the files (the automated `TT-001` rule lands in T050)
- [x] T020 [P] [US1] Promote genuinely static invariants from source-text tests into named checks in a new `scripts/check-static-invariants.mjs` (or existing `scripts/check-dependency-direction.mjs`/ESLint) and record each as `promote-static` in `specs/032-test-suite-tiering/migration-ledger.md`
- [x] T021 [US1] Delete source-text tests ONLY for ledger rows marked `delete` in `specs/032-test-suite-tiering/migration-ledger.md` (T013 is the source of truth). Never delete a row marked `convert`; those are replaced in T026–T034. Record replacement coverage or rationale for every deletion.
- [x] T022 [P] [US1] Reclassify `src/routes/chat/[id]/image-output-gate.test.ts`, `vision-gate.test.ts`, `section-jump.contract.test.ts`, `visibility-sentinel.test.ts`, and `src/routes/tree/tree-page.render.test.ts` as either Tier 1 pure tests or ledger `convert` rows
- [x] T023 [US1] Add regression tests for any behavior that loses its only source-text assertion, using existing `src/lib/**/*.test.ts` colocated files
- [x] T024 [US1] Break a pure helper and a handler, confirm both fail under `pnpm test:unit`, then restore; record the check in the ledger
- [x] T025 [US1] Run `time pnpm test:unit` on the reference machine and confirm < 60 s, zero browser processes, and the `[test-capacity]` line

**Checkpoint**: US1 is independently complete; Tier 1 is fast, browser-free, and every former source-text claim is either tested at the right layer or recorded as retired.

---

## Phase 4: User Story 2 — Real component behavior without end-to-end cost (Priority: P2)

**Goal**: Components render in Chromium, interactions and runes are asserted through accessible queries, and no component test needs the server or database.

**Independent Test**: Render an interactive component, click through a state change, assert accessible output, and run the file alone under `pnpm test:browser` with no app server or Postgres.

### Implementation for User Story 2

- [x] T026 [P] [US2] Convert `src/lib/components/AppShell.drawer-nav.test.ts`, `src/lib/components/RowCard.anatomy.test.ts`, and `src/lib/components/ai/model-select/model-select.select.test.ts` to `*.browser.test.ts` render/interaction tests
- [x] T027 [P] [US2] Convert `src/lib/components/chat/Breadcrumb.render.test.ts`, `Composer.launchers.test.ts`, `ContextGauge.contract.test.ts`, `GrowthEdge.contract.test.ts`, and `PropagatedArtifact.test.ts` to `*.browser.test.ts`
- [x] T028 [P] [US2] Convert `src/lib/components/chat/MessageRow.mount.test.ts`, `Markdown.touch.test.ts`, `interactivity.test.ts`, `mermaid-center.test.ts`, and `strip/SectionStrip.contract.test.ts` to `*.browser.test.ts`, replacing structural source assertions with rendered behavior
- [x] T029 [P] [US2] Convert `src/lib/components/chat/rows/AssistantMessage.actions.test.ts`, `AssistantMessage.spinner.test.ts`, `AssistantMessage.strip.test.ts`, `ToolActivity.collapse.test.ts`, `ToolActivity.status.test.ts`, `ToolActivity.terminal.test.ts`, and `ToolResultBody.test.ts` to `*.browser.test.ts`
- [x] T030 [P] [US2] Convert `src/lib/components/diagnostics/DiagnosticsPanel.keys.test.ts`, `DiagnosticsPanel.render.test.ts`, `src/lib/components/settings/ChatDisplayConfig.render.test.ts`, `MobileSectionJump.render.test.ts`, `SettingsRail.render.test.ts`, and `SettingsSearch.test.ts` to `*.browser.test.ts`
- [x] T031 [P] [US2] Convert `src/lib/components/mcp/confirmation/confirmation-context.test.ts` and `src/lib/components/chat/strip/SectionStrip.contract.test.ts` to rendered interaction tests or a ledger `delete`/`promote-static` row
- [x] T032 [P] [US2] Convert `src/routes/chat/[id]/*.test.ts` and `src/routes/tree/tree-page.render.test.ts` route-level claims to `*.browser.test.ts` using the `$app/*` doubles, or record Tier 1 / static dispositions
- [x] T033 [US2] Add one MSW-backed `*.browser.test.ts` for a fetch-driven component, proving handlers intercept at the network boundary without app server or database
- [x] T034 [US2] Remove the source-text files for ledger rows marked `convert` and update every converted row in `specs/032-test-suite-tiering/migration-ledger.md` with `replacementPath` and `verified = true`
- [x] T035 [US2] Break three converted behaviors (drawer close, collapse toggle, settings search) and confirm the browser tests fail; restore
- [x] T036 [US2] Run `time pnpm test:browser` with no dev stack running and confirm < 120 s and that every component test uses role/test-id queries

**Checkpoint**: US2 is independently complete; the browser tier renders real components and no component behavior depends on the full stack.

---

## Phase 5: User Story 3 — Lean, parallel end-to-end suite (Priority: P3)

**Goal**: Tier 3 contains only true integration flows, reuses captured session state, runs fully parallel/sharded, and has no fixed waits or external-stub ports.

**Independent Test**: Run the suite from a clean checkout, confirm setup runs once, no spec repeats onboarding, no fixed waits exist, and each spec passes alone and sharded.

### Implementation for User Story 3

- [x] T037 [US3] Create `tests/e2e/global-setup.ts` implementing the setup project from `contracts/e2e-session-state.md`: seed providers, dismiss/skip first-run setup, perform auth handshake if locked, and write `test-results/.auth/state.json`
- [x] T038 [P] [US3] Create `tests/e2e/fixtures/session.ts` exposing `page`, `workerIndex`, worker-scoped `providerId`, and chat creation without the first-run journey
- [x] T039 [P] [US3] Create `tests/e2e/fixtures/network.ts` auto-fixture allowing app/mock origins and aborting third-party fonts, analytics, and CDN assets
- [x] T040 [US3] Rewrite `tests/e2e/fixtures/onboard.ts` to consume the shared session state and session fixture, removing the per-test setup/onboarding journey and `90_000` fixture timeout
- [x] T041 [US3] Update `playwright.config.ts` to add `setup` + `chromium` + `serial` projects, `storageState`, `fullyParallel` from the capability gate, and traces; keep `workers` capability-derived
- [x] T042 [US3] Remove the `setTimeout` wait and `test.setTimeout(120_000)` usage in `tests/e2e/telemetry.spec.ts`; migrate protocol/ingest coverage to `server/src/telemetry-ingest.test.ts` and a Tier 2 MSW emission test, then retire or rewrite the spec
- [x] T043 [US3] Prune and migrate `tests/e2e/provider-picker.spec.ts` and `tests/e2e/render.spec.ts` scenarios that duplicate Tier 2 coverage; record each removal in the ledger
- [x] T044 [P] [US3] Prune and migrate `tests/e2e/quiz.spec.ts`, `tests/e2e/lab.spec.ts`, `tests/e2e/onboard.spec.ts`, and `tests/e2e/prompt-contract.spec.ts` where lower-tier coverage exists
- [x] T045 [P] [US3] Prune and migrate `tests/e2e/backprop-tool.spec.ts`, `tests/e2e/image-round-trip.spec.ts`, and `tests/e2e/mock-classification.spec.ts`, keeping only flows that need real streaming/server/persistence
- [x] T046 [US3] Update `scripts/dev-shard.mjs` to drop the langfuse-stub port ownership logic, respect the capability gate, and support the configured shard count
- [x] T047 [US3] Update `.github/workflows/ci.yml` e2e matrix from 2 to 4 shards and pass the capability decision to each shard runner
- [x] T048 [US3] Verify isolation: run each e2e spec alone, then the full suite with `fullyParallel`, then every shard; confirm no ordering dependency or shared chat/provider id — CI run 42836128942 passed all four shards; shards 1/4 had zero assigned cases, so the alone check is inferred from independent shard subsets
- [x] T049 [US3] Confirm `tests/e2e` contains zero `waitForTimeout`/sleep calls and zero first-run setup journeys outside `global-setup.ts`

**Checkpoint**: US3 is independently complete; Tier 3 is lean, parallel, shard-safe, and free of fixed waits.

---

## Phase 6: User Story 4 — Enforced tier boundaries and visible budgets (Priority: P4)

**Goal**: The guardrails, budgets, and documentation make the tiered structure self-enforcing.

**Independent Test**: Add a wrong-tier test, a fixed sleep, and a source-text component assertion; the guardrail check fails with the matching rule ID within 10 seconds.

### Implementation for User Story 4

- [x] T050 [US4] Implement `TT-001` through `TT-008` in `scripts/check-test-tiers.mjs` with stable IDs, scan counts, sorted output, and exit code 2 per `contracts/guardrails.md`
- [x] T051 [US4] Implement exemption validation (missing/empty justification fails as `TT-000`) in `scripts/check-test-tiers.mjs` against `scripts/test-tier-exemptions.json` (depends on T050)
- [x] T052 [P] [US4] Add `scripts/test-capacity.test.ts` covering capable, low-spec, cgroup-mismatch, unknown, and override cases; inject readings into `resolveCapacity` and never read live `/sys` in the test
- [x] T053 [US4] Implement `scripts/check-test-budget.mjs` with `--tiers=<csv>` ownership: fail on a missing or over-budget owned tier, ignore deferred tiers, and exit 3
- [x] T054 [US4] Wire `pnpm test:ci` (tier1/tier2/server) and `pnpm test:e2e:ci` (tier3 per shard) into `.github/actions/ci` and `.github/workflows/ci.yml`, upload both reports, and run `pnpm check:budget` per owning job
- [x] T055 [P] [US4] Update `AGENTS.md` commands/testing tables with the tier commands, suffixes, capacity gate, and ledger policy
- [x] T056 [P] [US4] Update `CONTRIBUTING.md` and the relevant `docs/reference/*.qmd` page with the tier decision tree, MSW boundary, and end-to-end pruning rules
- [x] T057 [US4] Inject one violation per rule ID into `tests/e2e/__guardrail_scratch.spec.ts` and a temporary `src/lib/__guardrail_scratch.browser.test.ts`, confirm `pnpm check:tests` reports each correct ID, then remove both files
- [x] T058 [US4] Add `docs/history/032-test-suite-tiering.qmd` and link it from `docs/history/index.qmd`

**Checkpoint**: US4 is independently complete; violations fail fast and budgets are visible.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, cleanup, and end-to-end validation

- [x] T059 [P] Remove `jsdom` and `@types/jsdom` from `package.json` if no Tier 1 test still needs them after migration, and update the lockfile
- [x] T060 [P] Scan `src/**/*.test.ts`, `src/**/*.browser.test.ts`, and `tests/**` to ensure no test or helper added by this feature uses a `+` filename prefix
- [x] T061 Run `pnpm check` and `pnpm lint`; fix all new type/lint errors in tests and scripts
- [x] T062 Run `pnpm test` and `pnpm --filter @mayon/server test` on the reference machine and record the results in `specs/032-test-suite-tiering/migration-ledger.md`
- [x] T063 Run `pnpm test:low-spec` (or `MAYON_TEST_PARALLEL=off pnpm test`) and confirm 100% selection, one worker, zero skips via the `[test-capacity]` output and Vitest summary
- [x] T064 Run every scenario in `specs/032-test-suite-tiering/quickstart.md` (S1–S9) and record pass/fail in the implementation PR
- [x] T065 Verify all 15 success criteria (SC-001–SC-015), including recording the 37-case e2e baseline and confirming ≤ 18 cases remain with every removal mapped in `specs/032-test-suite-tiering/migration-ledger.md`; close the ledger with no `verified = false` rows
- [x] T066 Confirm the production build output in `build/` contains no MSW worker asset or test-only mock files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T002–T008 are parallel after T001's dependency resolution
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories
- **US1 (Phase 3)**: Depends on Foundational; no dependency on US2–US4
- **US2 (Phase 4)**: Depends on Foundational; independent of US1, but ledger rows must agree
- **US3 (Phase 5)**: Depends on Foundational; can start before US2 finishes, but pruning needs the Tier 2 replacements to exist first
- **US4 (Phase 6)**: Depends on the tier commands/configs from Foundational; guardrail checks can be built while US1–US3 land, then tightened
- **Polish (Phase 7)**: Depends on all completed user stories

### User Story Dependencies

- **US1 (P1)**: Independently shippable as the MVP; no dependency on browser or e2e work
- **US2 (P2)**: Independently shippable; needs only the browser project from Foundational
- **US3 (P3)**: Independently shippable; its pruning depends on US2 coverage for the scenarios it removes, so sequence US2 before the pruning tasks (T043–T045) if delivered separately
- **US4 (P4)**: Independently shippable; guardrails become stricter as earlier stories land

### Within Each User Story

- Convert/implement the replacement before deleting the source-text file
- Verify the replacement fails when the behavior is broken before marking the ledger row verified
- Update ledger rows in the same change as the file move
- Run the tier command and record the duration before moving on

### Parallel Opportunities

- Setup: T002–T008 are file-disjoint
- Foundational: T010, T011, T012, T014, T015 are file-disjoint; T009 and T013 are the serial spine
- US1: T016, T018, T019, T020, T022 can run in parallel; T017, T021, T023–T025 are sequential
- US2: T026–T033 are file-disjoint conversion groups; T034–T036 are sequential
- US3: T038, T039, T044, T045 are parallel; T037, T040–T043, T046–T049 are sequential
- US4: T051, T052, T055, T056 are parallel; T050, T053, T054, T057, T058 are sequential
- Polish: T059, T060 are parallel; verification tasks run after both

---

## Parallel Example: User Story 1

```bash
# Independent Tier 1 work:
Task: "Create server/src/testing/build-app.ts"
Task: "Audit server handlers for real listeners"
Task: "Add TT-001 isolation check to scripts/check-test-tiers.mjs"
Task: "Reclassify route-level source-text tests"
```

## Parallel Example: User Story 2

```bash
# Convert independent component groups:
Task: "Convert chat row components to *.browser.test.ts"
Task: "Convert settings components to *.browser.test.ts"
Task: "Convert AppShell/RowCard/model-select to *.browser.test.ts"
Task: "Add MSW-backed browser test"
```

## Parallel Example: User Story 3

```bash
# Independent e2e infrastructure and pruning:
Task: "Create tests/e2e/fixtures/session.ts"
Task: "Create tests/e2e/fixtures/network.ts"
Task: "Prune quiz/lab/onboard/prompt-contract specs"
Task: "Prune backprop/image/mock-classification specs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical — blocks all stories)
3. Complete Phase 3: US1
4. **STOP and VALIDATE**: `pnpm test:unit` under 60 s, no browser, deliberate defects fail fast
5. Ship the Tier 1 isolation and source-text reclassification as the first increment

### Incremental Delivery

1. Setup + Foundational → both projects resolve, ledger exists
2. US1 → fast, browser-free logic/handler feedback (MVP)
3. US2 → real component behavior at Vite speed
4. US3 → lean, parallel, shard-safe e2e
5. US4 → guardrails and budgets prevent regression
6. Polish → cleanup, docs, quickstart verification

### Parallel Team Strategy

With multiple developers after Foundational:

- Developer A: US1 (server harness, static invariants, deletions)
- Developer B: US2 (component conversions, MSW)
- Developer C: US3 (setup project, fixtures, pruning)
- Developer D: US4 (guardrails, budgets, docs)

US3's pruning tasks wait for US2's replacements; US4's rules can be drafted in parallel and tightened at the end.

---

## Notes

- [P] tasks touch different files and have no incomplete-task dependency
- Every deletion needs a migration-ledger row with either a replacement path or a written rationale
- Verify each replacement by breaking the subject; a passing test that never observed the behavior is not verification
- Commit after each task or logical group
- Stop at each checkpoint to validate the tier independently
- Do not let a test change the production bundle, the storage seam, or the capability-detection behavior
