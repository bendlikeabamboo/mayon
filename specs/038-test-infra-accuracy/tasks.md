---
description: "Task list for feature 038 (issue #75)"
---

# Tasks: Test-infrastructure accuracy fixes (038)

**Input**: Design documents from `/specs/038-test-infra-accuracy/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/test-helpers.md, quickstart.md

**Tests**: Explicitly requested — the constitution requires fail-first regression tests wherever behavior is missing (US1 selector, US4 helper); where the gap is assertion-only (US2, US3, US7) the task carries a documented mutation red-proof instead. Every test task runs BEFORE its implementation task.

**Test execution policy (fleet)**: SPA tests ONLY as
`systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 pnpm test:low-spec <files>`;
one process at a time. Docker/Playwright/CI legs are maintainer-verifiable — write them runnable, never `test.skip`.

**Organization**: Tasks grouped by user story (US1–US7 from spec.md); every story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependencies on incomplete tasks
- **[Story]**: maps to spec.md user stories

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Establish green baseline before any edit: run `pnpm check`, then the capped runner over the five affected fast-tier files — `src/lib/ai/generate/classification-markers.test.ts`, `src/lib/stores/toasts.svelte.test.ts`, `src/lib/stores/chat.svelte.test.ts`, `src/lib/ai/model-discovery.test.ts`, `src/lib/ai/connection-test.test.ts` — plus the container-free shard listing `pnpm exec playwright test --list --shard=1/2` (expect 21/12, the imbalance being fixed)

---

## Phase 2: Foundational (Blocking Prerequisites)

None — no shared infrastructure precedes the stories; the two extracted helpers are story-scoped (US1, US4).

---

## Phase 3: User Story 1 — Shard-log selection cannot cross projects (Priority: P1) 🎯 MVP

**Goal**: The mock-log scraping e2e resolves exactly the compose project its runner targets, proven in the fast tier.

**Independent Test**: `src/lib/dev/compose-project.test.ts` green against synthetic multi-stack listings.

### Tests for User Story 1

- [x] T002 [P] [US1] **FAIL-FIRST** — write `src/lib/dev/compose-project.test.ts` per contracts/test-helpers.md §1: sibling shards + base stack concurrent listing selects the base-URL-implied project (both directions); base-stack-only listing selects `mayon-dev`; unknown port throws; expected-name project missing throws naming it; name present but `ConfigFiles` missing this checkout's files throws; shard project requires base+shard-override files. Observe red (module does not exist) before T003.

### Implementation for User Story 1

- [x] T003 [US1] Implement `src/lib/dev/compose-project.ts` (`expectedComposeProjectName` + `selectComposeProject`, research D1/D2) until T002 is green under the capped runner.
- [x] T004 [US1] Rewire `tests/e2e/image-round-trip.spec.ts` `mockRequestCount` (:26-40): keep `compose ls --format json` + `logs`, but resolve the project via `selectComposeProject` (pass `E2E_BASE_URL`); delete the inline `projects.find` (:31). Update the comment block (:13-20) to describe name-from-base-URL selection. Verified by T002 + `pnpm check`/`pnpm lint` (Playwright leg is maintainer-verified on a shard stack).

**Checkpoint**: With sibling stacks running, the spec provably targets its own stack (unit-proven; maintainer confirms via `pnpm dev:shard:up 1/2 && pnpm dev:shard:up 2/2` + per-shard run).

---

## Phase 4: User Story 2 — Drift guard patrols every mirror (Priority: P1)

**Goal**: Renaming a fixture string or a mirror in isolation fails one named guard assertion.

**Independent Test**: `src/lib/ai/generate/classification-markers.test.ts` green; scratch-mutating any mirrored literal turns it red.

### Tests for User Story 2

- [x] T005 [P] [US2] Extend `src/lib/ai/generate/classification-markers.test.ts` with the `MIRRORS` registry + one `it` per entry (contracts/test-helpers.md §3; research D3): read each mirror's source (same `readFileSync`+`fileURLToPath` pattern as :21-28) and assert byte-containment of each listed constant's value. Registry per contract. Mutation red-proof (scratch + revert, recorded in the commit message): flip the lever trigger in `src/lib/stores/quizzes.svelte.test.ts:486` and observe the guard fail naming both files.

### Implementation for User Story 2

- [x] T006 [P] [US2] Update the stale mirror rationale comments to point at the guard: `src/lib/stores/quizzes.svelte.test.ts:419-421` ("keep the two in sync" → "kept in sync by the drift guard, classification-markers.test.ts MIRRORS"), `src/lib/stores/chat.svelte.test.ts:922-926` (same pointer), and the `tests/fixtures/mock-llm/strings.mjs` header ("fast-tier tests import from here" → document the mirror patrol + where the registry lives).

**Checkpoint**: Guard patrols 5 files (2 producers + 3 mirrors); registry is the single add-a-mirror point.

---

## Phase 5: User Story 3 — No-toast assertions for declined and latched propagation (Priority: P2)

**Goal**: A regression that toasts on a declined or latch-refused propagation turns the suite red; toast-store negatives exist.

**Independent Test**: capped run of the two store suites green; scratch-breaking the toast guard goes red.

### Tests for User Story 3

- [x] T007 [P] [US3] In `src/lib/stores/chat.svelte.test.ts`, add zero-toast assertions observing `toastState` (import from `#lib/stores/toasts.svelte.js`, the same singleton the store pushes into, `chat.svelte.ts:1648-1650`): (a) declined propagate-approval turn (reuse the `backprop-endstate.test.ts:221-272` scripting pattern in the store suite, or assert in `src/lib/chat/backprop-endstate.test.ts` where the journey already lives) — `toastState.toasts` stays length 0 across the turn; (b) second `propagateToParent` while the latch is held — no push, `lastPropagation` cleared, exactly one `branch_artifact` row in the parent. Mutation red-proof (scratch + revert): push a toast on the declined path — must go red.
- [x] T008 [P] [US3] In `src/lib/stores/toasts.svelte.test.ts`, add negative assertions: dismissing an unknown id pushes nothing new (extends :46-50 to assert no re-add), and a manually dismissed toast never re-emits after the auto-dismiss timer fires.

### Implementation for User Story 3

- [x] T009 [US3] Add the maintainer-verified e2e sweeps to `tests/e2e/backprop-tool.spec.ts`: in the declined-propagation test (:151-190) and the approval-success test (:82-113), assert the toast layer stays absent — `await expect(page.locator('button[aria-label="Dismiss"]')).toHaveCount(0)` after the journey settles (selector unique to `Toaster.svelte:30-37`; brief-intake Dismiss buttons are text-labelled, `+page.svelte:937`). Comment the Docker/shard-stack requirement (035 T018 pattern; never skipped).

**Checkpoint**: The 037 "toast never lies" guarantee is pinned at the store tier (fleet-verifiable) and swept in e2e (maintainer).

---

## Phase 6: User Story 4 — One discovery-merge implementation (Priority: P2)

**Goal**: The tested merge and the shipped merge are the same function.

**Independent Test**: `src/lib/ai/model-discovery.test.ts` + `src/lib/ai/connection-test.test.ts` green; the formula exists only in `model-discovery.ts`.

### Tests for User Story 4

- [x] T010 [P] [US4] **FAIL-FIRST** — extend `src/lib/ai/model-discovery.test.ts` with `mergeDiscoveredModels` unit tests (contracts/test-helpers.md §2): discovered order first + dedupe + manual tail (`['b','a']` × `['manual','a']` → `['b','a','manual']`); empty discovered → existing unchanged; empty both → empty; duplicate manuals collapse. Observe red (export missing) before T011.

### Implementation for User Story 4

- [x] T011 [US4] Implement `mergeDiscoveredModels` in `src/lib/ai/model-discovery.ts` (formula verbatim from `ProviderConfig.svelte:215`; sibling of `mergeModelContextWindows:82`) until T010 is green.
- [x] T012 [US4] Consume the helper at both call sites — `src/lib/components/ai/ProviderConfig.svelte:215` (`refreshModels`) and `:272` (`testConnection`) — and rewrite `src/lib/ai/connection-test.test.ts:352` to call it instead of the inline formula. Verify: capped run of `src/lib/ai/connection-test.test.ts` (the `['a','b','manual-keep']` expectation is the behavior net) + `rg -n '\.\.\.discovered,' src/` matches only `model-discovery.ts`.

**Checkpoint**: Parity by construction; `pnpm check` confirms the component refactor type-checks.

---

## Phase 7: User Story 5 — CI caches builds + balanced shards (Priority: P3)

**Goal**: Workflow builds through the actions cache; shard split ≤18/15 by the container-free oracle.

**Independent Test**: `--list` shard totals balanced; `pnpm lint` clean on workflow YAML (CI run itself is maintainer-verified).

### Implementation for User Story 5

- [ ] T013 [P] [US5] Edit `.github/workflows/ci.yml` e2e job (research D6): before `dev:shard:up` (:85) add `docker/setup-buildx-action@v3` then two commented buildx steps — `docker buildx build --cache-from type=gha --cache-to type=gha,mode=max --load -t mayon-dev-shard-${{ matrix.shard }}-web -f Dockerfile.dev .` and the `-server -f server/Dockerfile.dev` twin — so the shard path's plain `up -d` adopts the pre-built, cache-backed images. Keep comments explaining the tag↔compose-project coupling. In `.github/actions/ci/action.yml`, switch the two `docker build` lines to `docker buildx build` with the same cache flags. Validate: `pnpm lint` (Prettier covers YAML) + reasoning recorded in the commit; no local Docker use.
- [ ] T014 [US5] Rebalance shards (research D7): move the `connection coaching` describe (:113-163, 2 tests) from `tests/e2e/provider-picker.spec.ts` into new `tests/e2e/provider-picker-coaching.spec.ts` (imports/fixtures copied verbatim; zero assertion changes). Measure `pnpm exec playwright test --list --shard=1/2` and `--shard=2/2`; acceptance ≤18/15 — if worse, also move the tool-capability describe (:58) and re-measure (never split a describe). Update `tests/e2e/README.md`: new ledger row for the split file (classification + dispositions copied from the provider-picker row) and trim the original row (policy 1).

**Checkpoint**: Balanced, listing-verified; ledger complete (11 rows for 11 files).

---

## Phase 8: User Story 6 — 031 artifacts reflect the CI edit (Priority: P3)

**Goal**: The "no CI edits" claims are annotated, history intact.

**Independent Test**: Read the three sites; each claim followed by a dated addendum cross-referencing 038.

### Implementation for User Story 6

- [ ] T015 [US6] After T013 lands, append the dated addendum (research D8) beneath the three claims: `specs/031-split-text-e2e-tests/plan.md:103`, `specs/031-split-text-e2e-tests/research.md` (D6 section, :142-148), `specs/031-split-text-e2e-tests/tasks.md` (Notes bullet, :174-176) — "*(2026-11-<land-date>, feature 038 / issue #75: the CI workflow was subsequently edited — cache-backed image builds + shard rebalance; see `specs/038-test-infra-accuracy/`.)*" Original text untouched.

---

## Phase 9: User Story 7 — Reload parity across all AI SDK entry points (Priority: P3)

**Goal**: Hydration firing streaming, object-, or text-generation fails the parity test.

**Independent Test**: capped run of `src/lib/stores/chat.svelte.test.ts`; scratch-firing `generateText` in hydration goes red.

### Tests for User Story 7

- [x] T016 [US7] Extend the reload-hydration test (d) in `src/lib/stores/chat.svelte.test.ts:2674-2698` (research D9): capture `mockedStreamText` (:2681) PLUS `mockedGenerateObject`/`mockedGenerateText` call lengths after the turn; assert all three unchanged after the re-`load()` (:2686). Mocks already exist (:61-63, :121-123). Mutation red-proof (scratch + revert): call `mockedGenerateText` inside the hydration block — must go red. Update the test's comment to state the pin is total over the three entry points.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T017 Add the CHANGELOG entry inside `## [0.10.0]` → `### Fixed` (release-train style, bold lead + em-dash): test accuracy — shard e2e reads only its own stack; drift guard patrols every mirror; no-toast assertions for declined/latched propagation; single discovery merge; CI image-build cache + balanced shards; 031 artifacts annotated; reload parity over all AI SDK entry points (issue #75 / feature 038).
- [ ] T018 Full validation per quickstart.md: capped runs — batch 1 `src/lib/dev/compose-project.test.ts src/lib/ai/generate/classification-markers.test.ts src/lib/stores/toasts.svelte.test.ts src/lib/ai/model-discovery.test.ts src/lib/ai/connection-test.test.ts`, batch 2 (own process) `src/lib/stores/chat.svelte.test.ts`; then `pnpm check` and `pnpm lint`; confirm shard listing still ≤18/15 and the ledger has 11 rows.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks all edits (green baseline).
- **Foundational (Phase 2)**: none.
- **Stories (Phases 3-9)**: US1 (T002→T003→T004) and US4 (T010→T011→T012) are fail-first chains — test before implementation within each. Cross-story constraints:
  - T015 (US6) depends on T013 (US5) — the addenda describe the landed CI edit.
  - T016 (US7) edits `chat.svelte.test.ts`, as does T007 (US3) — sequence them (T007 first) or land as one careful pass; never two agents in one file.
  - T005 (US2) and T006 touch files disjoint from US3/US4 work — parallel-safe.
- **Polish (Phase 10)**: after all stories.

### Parallel Opportunities

- T002 (US1 test) ∥ T005 (US2) ∥ T007/T008 (US3) ∥ T010 (US4) ∥ T013 (US5-CI) — mutually file-disjoint.
- T014 (US5 split) is file-disjoint from all except the shared ledger README — sequence after nothing, but commit separately.
- T013 ∥ T014 within US5 (workflow vs specs).

### MVP Scope

User Story 1 alone (T002-T004) removes the wrong-subject test failure mode; US2 is the other P1 and lands next; the rest are independent.

---

## Implementation Strategy

MVP first (US1), then its P1 sibling (US2), then the P2 pair (US3, US4 — US4 second because it touches a product file, however refactor-only), then the P3 trio in dependency order (US5 → US6, US7 anytime after T007 lands). Each story closes with its quickstart.md capped command; the full close-out (T018) gates the handoff.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks
- Fail-first applies to T002/T010 (missing behavior); US2/US3/US7 carry mutation red-proofs recorded in commit messages instead (assertion-only gaps — constitution II note).
- No product behavior changes: `ProviderConfig.svelte` is a call-site swap; `Toaster.svelte` untouched; no e2e assertion deleted (ledger policy 3).
- CI/Playwright legs are maintainer-verified: workflow changes validated by `pnpm lint` + reasoning; e2e additions written runnable (never skipped) with the stack requirement in a comment (035 T018 pattern).
- No `+`-prefixed filenames (SvelteKit route namespace).
- Commit after each task or logical group; worktree pushes to its own branch — never merge into `main` (AGENTS.md worktree rules).
