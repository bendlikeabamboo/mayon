# Tasks: Automatic Model Context Lengths

**Input**: Design documents from `/specs/024-model-context-length/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/model-listing-harvest.md, contracts/context-window-resolution.md, quickstart.md

**Tests**: Included — the project constitution mandates tests for new behavior in `src/lib/` (gate 6); contracts enumerate the suites.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root (SvelteKit SPA; `src/lib` application layer, `src/routes` routes)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Worktree bootstrap only — the project already exists; this worktree already built feature 023, so verify rather than rebuild.

- [x] T001 Verify the worktree is implementation-ready per AGENTS.md: `pnpm install` (no-op if complete), `pnpm --filter @mayon/shared build`, then `pnpm check` green on the untouched tree

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The data foundation every story consumes: entry-returning discovery with context harvest, and the persisted `modelContextWindows` field with its normalization. **No schema migration** — settings KV only.

- [x] T002 [P] Add optional `modelContextWindows?: Record<string, number>` to `ProviderConfig` in `src/lib/ai/types.ts` (doc comment: provider-listed, non-secret, per model) and normalize it in `normalizeProviderConfig` in `src/lib/ai/registry.ts`: drop non-positive-integer values (never clamp), drop keys not present in the same config's `models` array, idempotent passthrough; extend `src/lib/ai/registry.test.ts` with these cases mirroring the existing `contextWindow` normalization tests
- [x] T003 Harvest context windows in `src/lib/ai/model-discovery.ts` per contracts/model-listing-harvest.md: export `DiscoveredModel { id: string; contextWindow?: number }`; new entry-returning parse of both the OpenAI-compatible and Copilot bodies reading top-level `context_length` then `context_window` (positive integer only, first usable wins, nested/other fields ignored); keep `parseModelIds`/`parseCopilotModelIds` as ID-mapping wrappers (connection-test probe unchanged); make `discoverModels`/`discoverCopilotModels` return `DiscoveredModel[]`; adapt `discoverProviderModels` in `src/lib/ai/client.ts` and the probe in `src/lib/ai/connection-test.ts` (map entries → ids, behavior unchanged)
- [x] T004 Extend `src/lib/ai/model-discovery.test.ts` with harvest cases: accepts both spellings; rejects zero/negative/float/string/nested (`top_provider.*`)/absent values (treated as not reported); duplicate ids with conflicting values keep exactly one deterministic entry; embedding and Copilot filters unaffected; unrecognized body shapes yield entries without windows

**Checkpoint**: Discovery yields entries with optional windows; the persisted field exists and normalizes. User story implementation can begin.

---

## Phase 3: User Story 1 - Zero-configuration context lengths (Priority: P1) 🎯 MVP

**Goal**: After a provider model fetch, each model's reported window is captured and the context gauge uses it with no manual entry (quickstart.md scenario 1).

**Independent Test**: Add the OpenRouter template, refresh its models, pick a model, send one message in a chat: the gauge shows `used / limit (pct)` — not "window unknown" — with no value typed anywhere.

### Implementation for User Story 1

- [x] T005 [P] [US1] Add the resolution rung in `src/lib/chat/context-usage.ts` per contracts/context-window-resolution.md: `deriveContextGauge` input gains `listedWindow?: number | null`; `limitSource` gains `'model-listing'`; ladder declared → listed → catalog → unknown with non-positive-integer inputs falling through at each rung
- [x] T006 [P] [US1] Extend `src/lib/chat/context-usage.test.ts`: listed used when declared absent; listed beats catalog for the same model id; all rungs miss → `no-limit` unchanged; invalid `listedWindow` falls through to catalog/unknown
- [x] T007 [US1] Capture-to-persist wiring in `src/lib/components/ai/ProviderConfig.svelte` `refreshModels` (:204-230): alongside the existing `models` merge, write `modelContextWindows` from the returned entries (values from the response; simple union with the previous map — exact rebuild semantics arrive in US3) through the existing `saveProviders` path; discovery failure still saves nothing new
- [x] T008 [US1] Pass the captured window to the gauge in `src/routes/chat/[id]/+page.svelte` (:109-115): `listedWindow: activeConfig?.modelContextWindows?.[activeModelId ?? ''] ?? null` next to the existing `declaredWindow` line

**Checkpoint**: Story 1 delivers standalone value — captured windows power the gauge end-to-end with zero configuration.

---

## Phase 4: User Story 2 - Honest values, user intent wins (Priority: P2)

**Goal**: User-declared windows beat captured ones; invalid captured values never surface; provenance is discernible in the gauge wherever a window is shown (quickstart.md scenario 2).

**Independent Test**: Copilot model outside the static catalog → "window unknown"; set the provider card's Context window to 200000 → gauge uses it and the popover attributes it to the provider card; clear it → the captured/catalog ladder re-applies.

### Implementation for User Story 2

- [x] T009 [US2] Humanize the new source in `src/lib/components/chat/ContextGauge.svelte` (:25-33): add `'model-listing'` → `provider model listing` to the label map; popover Window row and trigger title show it; unknown-window copy untouched
- [x] T010 [P] [US2] Extend `src/lib/chat/context-usage.test.ts` with override/honesty cases: declared beats listed (user wins); listed beats catalog; a positive-integer catalog hit still wins over an invalid listed value
- [x] T011 [US2] Extend `src/lib/components/chat/ContextGauge.contract.test.ts`: humanized label wiring for the new source (popover row, title), unknown-window copy unchanged

**Checkpoint**: Numbers stay honest; users can tell where each window came from.

---

## Phase 5: User Story 3 - Staying current (Priority: P3)

**Goal**: Re-fetches move captured windows to the provider's latest report; failures retain last-known (quickstart.md scenario 3).

**Independent Test**: Point a provider at a stub `/models` with a different `context_length` for the same id, strike ⟳ → the new number shows; break the endpoint and strike ⟳ → the usual fetch error appears and the previous number is retained.

### Implementation for User Story 3

- [x] T012 [US3] Extract the rebuild as a pure helper `mergeModelContextWindows(previous, entries)` exported from `src/lib/ai/model-discovery.ts` implementing the data-model state table: response values overwrite, reported-id-without-value entries are removed, ids absent from the response retain last-known; use it in both write paths — `refreshModels` and the `testConnection` auto-fill (both in `src/lib/components/ai/ProviderConfig.svelte`, :204-230 and :243-270)
- [x] T013 [P] [US3] Unit-test the merge helper in `src/lib/ai/model-discovery.test.ts`: latest-wins overwrite, unreported-dropped, unlisted-retained, empty-response empties reported entries but retains unlisted, failure paths never call it (nothing saved)

**Checkpoint**: Captured values track the provider's catalog over time.

---

## Phase 6: User Story 4 - Context length visible at model selection (Priority: P4)

**Goal**: The settings model picker shows each model's captured window as muted secondary text (quickstart.md scenario 4).

**Independent Test**: Open the picker on a provider with captured windows: rows show a compact hint (e.g. `128K`, `1M`) with the exact token count on hover; models without a value render exactly as before.

### Implementation for User Story 4

- [x] T014 [P] [US4] Add optional `contextWindows?: Record<string, number>` prop to `src/lib/components/ai/model-select/model-select.svelte`; render the hint in the row beside `ModelSelectName` (muted secondary text in the existing `text-[11px] text-muted-foreground` idiom; compact k/M formatting with the exact count in the `title` attribute); component stays presentational — no fetching, no store imports
- [x] T015 [US4] Pass `contextWindows={p.modelContextWindows}` from the `ModelSelect` usage in `src/lib/components/ai/ProviderConfig.svelte` (:580-587)
- [x] T016 [P] [US4] Extend `src/lib/components/ai/model-select/model-select.select.test.ts`: hint rendered only when a value exists for the row's model; formatting sanity (128000 → `128K`, 1000000 → `1M`); presentational assertions unchanged

**Checkpoint**: All user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T017 Run the manual validation scenarios 1-4 from `specs/024-model-context-length/quickstart.md` against `pnpm dev` and record outcomes in the PR description (optionally `quickstart-results.md` as 023 did)
- [x] T018 Run all quality gates: `pnpm check`, `pnpm lint`, `pnpm test`; verify no new file appeared in `drizzle/` and `package.json` gained no dependencies (constitution gates)
- [x] T019 [P] Update `docs/explanation/architecture.qmd` (provider/AI layer): describe the discovery context-window harvest and `modelContextWindows`; update `docs/reference/seams.qmd` only if the settings-KV write pattern's documentation changes (no new seam expected)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: T002 parallel to T003; T004 after T003 (same module's new API); **blocks all user stories**
- **User Stories (Phases 3-6)**: All depend on Phase 2. Recommended order US1 → US2 → US3 → US4; US2/US3/US4 each build on US1's end-to-end path but are mutually independent
- **Polish (Phase 7)**: Depends on all implemented stories

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies (MVP)
- **US2 (P2)**: After US1 (extends the gauge labeling and tests); independently testable against US1
- **US3 (P3)**: After US1 (refines the merge US1 wires in); independent of US2
- **US4 (P4)**: After Phase 2 only (picker display works off the persisted map); independent of US2/US3

### Within Each User Story

- US1: T005/T006 are one parallel group (module + its tests); T007/T008 are sequential wiring after T003
- US2: T009 + T010 parallel; T011 after T009
- US3: T012 then T013
- US4: T014 + T016 parallel; T015 after T014

### Parallel Opportunities

- Phase 2: T002 ∥ T003 (different files), then T004
- US1: T005 + T006 ∥ (T007 waits on T003); T008 after T005
- US2: T009 ∥ T010; US3: T013 after T012; US4: T014 ∥ T016
- Cross-story: once US1 lands, US2 (gauge labels) and US3 (merge semantics) touch mostly different files and can proceed in parallel agents; US4 can start right after Phase 2

---

## Parallel Example: User Story 1

```bash
# Launch after Phase 2 (different files, no cross-dependencies):
Task: "T005 listedWindow rung in src/lib/chat/context-usage.ts"
Task: "T006 context-usage ladder tests in src/lib/chat/context-usage.test.ts"

# Then sequentially (wiring consumes the above):
Task: "T007 refreshModels capture-to-persist in src/lib/components/ai/ProviderConfig.svelte"
Task: "T008 listedWindow wiring in src/routes/chat/[id]/+page.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (worktree verification)
2. Complete Phase 2 (harvest + persisted field) — CRITICAL, blocks everything
3. Complete Phase 3 (gauge uses captured windows with zero configuration)
4. **STOP and VALIDATE**: quickstart.md scenario 1 end-to-end
5. Ship if desired — auto-captured windows alone answer the original request

### Incremental Delivery

1. Setup + Foundational → data foundation
2. US1 → MVP (zero-config gauge windows)
3. US2 → honesty (user override wins, provenance labeled)
4. US3 → freshness (latest-report semantics on re-fetch)
5. US4 → picker visibility (windows shown at selection)

### Parallel Team Strategy

1. Team completes Phases 1-2 together
2. One agent takes US1 (critical path)
3. Once US1 lands: US2 and US3 in parallel (different concerns; both touch `context-usage.test.ts` — sequence T006/T010 if parallelized); US4 can run from Phase 2 onward
4. Polish last

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map task to specific user story for traceability
- Zero new npm dependencies; zero drizzle migration — any task drifting toward either must stop and re-consult plan.md's Constitution Check
- Commit after each task or logical group; run `pnpm check` + `pnpm lint` before every commit (constitution gate 3)
- Stop at any checkpoint to validate the story independently
- Sub-grouping rule (AGENTS.md): when implementing, split into subgroups of ≤ 6 tasks and launch parallel-capable subgroups in parallel agents
