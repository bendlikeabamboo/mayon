# Tasks: Quiz & Labs RC Verification

**Input**: Design documents from `/specs/020-rc-ui-verification/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: This feature's deliverable IS test coverage — the "test tasks" are implementation tasks here, per the spec (browser deck, logic suites, prompt-contract spec).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Single web-app repo: product code in `src/` (+ `src/lib/ai/generate/`, `src/lib/components/`), test stack in `tests/` (`tests/e2e/`, `tests/fixtures/mock-llm/`). Matches plan.md Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline safety and the written-down guardrail, before any change

- [x] T001 Bring up the dev stack (`pnpm dev:up`) and run `pnpm test:e2e` to confirm the existing onboard/chat/render specs are green before any change (baseline for US1's "chat unchanged" requirement)
- [x] T002 [P] Write the FR-005 guardrail and fixture-library map in `tests/fixtures/mock-llm/README.md`: real-path-only rule ("every request flows browser → placeholder key in IndexedDB → `/api/llm/proxy` → server container → `http://mock-llm:9999/v1/...`; `page.route` interception of the provider path is prohibited, including as a flake workaround"), per-kind fixture inventory, and pointer to `specs/020-rc-ui-verification/contracts/mock-llm-protocol.md`

**Checkpoint**: Baseline green recorded; guardrail written down before the first flake

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Deterministic fixture library and shared deck constants consumed by US1 (mock), US2 (deck), and US4 (logic suite)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 [P] Create the deterministic quiz fixture `tests/fixtures/mock-llm/quiz-fixture.mjs`: a `GeneratedQuiz`-conforming object with exactly one question per type — `mcq` (options with a textually unique correct answer + `answerIndex`), `flashcard` (`front`/`back`), `short` (`prompt` + rubric worded so both lever outcomes are legitimately gradeable) — exported as a JS object (stringified at reply time, per research.md D2)
- [x] T004 [P] Create the deterministic lab fixture `tests/fixtures/mock-llm/lab-fixture.mjs`: a `GeneratedLab`-conforming object with `title`, `intro`, ≥2 known `steps`, ≥2 known `checklist` items, exported as a JS object
- [x] T005 [P] Add shared deck constants to `tests/e2e/fixtures/kitchen-sink.ts`: per-kind classification marker substrings (grading tool-description marker, quiz/lab contract-section markers), lever trigger phrases (`should be correct` / `should be wrong`), and expected fixture payloads (question texts, lab steps/checklist texts) for assertions

**Checkpoint**: Fixture library and constants ready — user story implementation can now begin

---

## Phase 3: User Story 1 — The stand-in learns the quiz/lab/grading dialects (Priority: P1) 🎯 MVP

**Goal**: `tests/fixtures/mock-llm/server.mjs` classifies request kinds from user-un-influenceable aspects and serves a deterministic fixture per kind, with the grading lever and loud unknown-kind failure (contracts/mock-llm-protocol.md)

**Independent Test**: Run `tests/e2e/mock-classification.spec.ts` against the stack: each request kind receives its own fixture reply, identical across runs, regardless of user-authored text; existing onboard/render specs stay green

### Implementation for User Story 1

- [x] T006 [US1] Refactor request handling in `tests/fixtures/mock-llm/server.mjs` into the ordered classification dispatcher from contracts/mock-llm-protocol.md: (1) `stream && !tools` → existing SSE chat path byte-identical; (2) `!tools && !stream` → existing non-streamed chat reply; (3) `tools` with grading tool-description marker → grading; (4) quiz contract marker in first system message → quiz; (5) lab contract marker → lab; (6) else unknown. Markers come from the code-owned strings mirrored in `tests/e2e/fixtures/kitchen-sink.ts` (T005)
- [x] T007 [US1] Implement the OpenAI tool-call reply shape in `tests/fixtures/mock-llm/server.mjs` for kinds 3–5: non-streamed completion with `tool_calls: [{ function: { name: 'json', arguments: '<fixture JSON string>' } }]`, `finish_reason: 'tool_calls'`, model echo (research.md D2)
- [x] T008 [US1] Implement the grading lever in `tests/fixtures/mock-llm/server.mjs`: scan the request user block case-insensitively for `should be correct` → `{isCorrect: true, feedback: FIXED}` / `should be wrong` → `{isCorrect: false, feedback: FIXED}` / neither → default `{isCorrect: false, feedback: DEFAULT}` with fixed feedback constants (research.md D3)
- [x] T009 [US1] Implement the unknown-kind response in `tests/fixtures/mock-llm/server.mjs`: HTTP 400 `{error: 'unrecognized request kind', hints: [hasTools, toolDescriptionPrefix, systemPrefix]}` plus a server-side log line (research.md D7)
- [x] T010 [US1] Create `tests/e2e/mock-classification.spec.ts`: using the `onboarded` fixture, issue each kind through the real app/proxy path and assert per contracts/mock-llm-protocol.md — chat still streams kitchen-sink SSE; a quiz-generation request returns the quiz fixture as a `json` tool call; lab likewise; grading returns lever-selected `isCorrect` for both triggers and the `false` default; unknown-kind bodies get a 400 that fails loudly (assert via a deliberately malformed probe hitting the mock only from the server container side, never via `page.route`)

**Checkpoint**: US1 fully functional independently — mock discriminates all kinds; `pnpm test:e2e` (existing + new spec) green; chat behavior unchanged

---

## Phase 4: User Story 2 — One automated run replaces the manual RC pass (Priority: P2)

**Goal**: Browser deck drives the full journey — real settings onboarding → chat → quiz (every question type, both grading outcomes) → lab to completion — through the real proxy hop and placeholder-key path

**Independent Test**: Run `tests/e2e/quiz.spec.ts` and `tests/e2e/lab.spec.ts` on a fresh stack; both journeys pass green end to end

### Implementation for User Story 2

- [x] T011 [US2] Create `tests/e2e/quiz.spec.ts`: from the `onboarded` fixture, chat until the kitchen-sink reply renders, click "Generate quiz" from the chat composer, land on `/quiz/[id]`, assert the fixture's questions rendered (MCQ options located by answer text, never position — research.md D5; flashcard front; short prompt+rubric), answer MCQ by clicking the known-correct option label, self-mark the flashcard, submit the short answer containing `should be correct` and assert the "Correct" grade, then edit the answer to `should be wrong` and use Re-grade to assert "Incorrect", and assert the attempt score reflects the payload-derived expected value (data-model.md quiz-attempt lifecycle)
- [x] T012 [US2] Create `tests/e2e/lab.spec.ts`: from the `onboarded` fixture, chat to the kitchen-sink reply, click "Generate lab", land on `/lab/[id]`, assert fixture `title`/`intro`/steps render via the markdown body, toggle every checklist item through `LabRunner.svelte`, and assert the `doneCount/items.length` header reaches full (no phantom "complete" DB state — data-model.md)

**Checkpoint**: US2 delivers the RC replacement — both deck specs green in one run alongside US1; no `page.route` anywhere in `tests/`

---

## Phase 5: User Story 3 — Read-only generation contract (Priority: P3)

**Goal**: Contract section of quiz/lab generation prompts becomes code-owned and read-only; users view the effective prompt and attach custom instructions (contracts/prompt-settings-contract.md, invariants I1–I4)

**Independent Test**: Open `/settings` quiz/lab prompt config — contract visible read-only, no edit path; attach instructions → saved and included in generation; `tests/e2e/prompt-contract.spec.ts` green

### Implementation for User Story 3

- [x] T013 [US3] Restructure prompt assembly in `src/lib/ai/generate/generate-quiz.ts` and `src/lib/ai/generate/generate.ts` per contracts/prompt-settings-contract.md: export the code-owned contract constants (contract sections + tool descriptions, keeping the classification markers of research.md D1 stable — invariant I4), implement assembly = contract + (`# Custom instructions` block when instructions exist) (invariants I1/I2), and replace whole-prompt reads of the `quizPrompt`/`labPrompt` settings keys with `quizInstructions`/`labInstructions` reads including the one-time idempotent legacy migration (legacy value → instructions key, delete legacy key; invariant I3) (research.md D4)
- [x] T014 [P] [US3] Rework `src/lib/components/quizzes/QuizPromptConfig.svelte`: effective-prompt view (contract rendered read-only + instructions block), instructions textarea saving to the `quizInstructions` settings key on blur with empty→delete, "Reset instructions" button, and removal of any path that binds the contract to an editable field (replaces the whole-prompt textarea and the default-only `<details>` block)
- [x] T015 [P] [US3] Rework `src/lib/components/labs/LabPromptConfig.svelte` with the same read-only contract + instructions + reset behavior against the `labInstructions` key
- [x] T016 [US3] Create `tests/e2e/prompt-contract.spec.ts`: open the settings affordance for quiz and lab prompts, assert the full effective prompt is viewable, assert the contract section offers no edit path (only the instructions textarea accepts input), attach custom instructions and assert they persist and a subsequent generation succeeds (SC-007)

**Checkpoint**: US3 ships the one product change — contract uneditable via any UI path, instructions attachable, generation and the deck still green (I4 holds under US2's specs)

---

## Phase 6: User Story 4 — Logic-layer depth (Priority: P4)

**Goal**: Non-browser Vitest coverage at the `LanguageModel`/`generateText` stub seam: assembly invariants, parse→persist from fixtures, every grading bucket, failure paths (research.md D8)

**Independent Test**: `pnpm test` green with the new/extended suites; each covered failure path fails when its handling regresses

### Implementation for User Story 4

- [x] T017 [P] [US4] Extend `src/lib/ai/generate/generate-quiz.test.ts` (and the lab counterpart `src/lib/ai/generate/generate.test.ts`) with prompt-assembly coverage: contract bytes immutable under adversarial instructions (I1), contract-only when no instructions (I2), one-time idempotent legacy migration of `quizPrompt`/`labPrompt` (I3), markers present under any instructions (I4)
- [x] T018 [P] [US4] Extend `src/lib/stores/quizzes.svelte.test.ts` with grading-bucket coverage on pglite via `runShortGrading` with the SDK stub returning correct/incorrect/error: `isCorrect` true and false persist per fixture rubric; `GradeError` path leaves `isCorrect: null` with `aiFeedback` and `regrade()` recovery; attempt `finishIfComplete` score counts `isCorrect === true` only (data-model.md buckets)
- [x] T019 [US4] Extend failure-path coverage in `src/lib/ai/generate/generate-quiz.test.ts`, `src/lib/ai/generate/quiz.test.ts`, `src/lib/ai/generate/generate.test.ts`, and `src/lib/stores/labs.svelte.test.ts`: malformed and truncated fixture-shaped payloads → `ObjectToolError` schema_mismatch → corrective retries exhausted → `QuizGenerationError` (typed error state) and lab → `LabGenerationError` → `rawOffer` → `saveRaw` persists markdown with empty checklist; keep fixture payloads aligned with `tests/fixtures/mock-llm/*.mjs` (T003/T004) as the shared shapes

**Checkpoint**: US4 closes the depth gap — every grading bucket and failure path asserted without a browser

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, gates, and determinism proof across all stories

- [x] T020 Update `docs/how-to/building.qmd` "Browser E2E tests" section with the quiz/labs deck: what it covers, the isolated `mayon-e2e` variant command, and a pointer to the guardrail in `tests/fixtures/mock-llm/README.md`
- [x] T021 Run the full quality gate: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` — all green (constitution Quality Gates)
- [x] T022 Prove determinism per SC-004: run `pnpm test:e2e` and `pnpm test` repeatedly (≥10 consecutive e2e runs) on identical code with identical outcomes, then execute `specs/020-rc-ui-verification/quickstart.md` Scenarios 1–5 end to end (including fault injection in Scenario 4) as the final validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first (baseline green); T002 parallel with it
- **Foundational (Phase 2)**: depends on T001 (needs the stack to sanity-check fixtures against schemas); blocks all user stories
- **US1 (Phase 3)**: depends on Phase 2 (T005 markers, T003/T004 fixtures)
- **US2 (Phase 4)**: depends on US1 (the deck is blocked without request-kind discrimination)
- **US3 (Phase 5)**: independent of US1/US2 at the code level, but keep the D1 classification markers stable (I4) — if sequenced after US2, re-run the deck; if before, US2 validates I4
- **US4 (Phase 6)**: fully independent (pglite + SDK stub; no mock, no browser) — can run in parallel with any story after Phase 2
- **Polish (Phase 7)**: depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Foundational only — no cross-story dependencies
- **US2 (P2)**: US1 complete (mock discriminates kinds)
- **US3 (P3)**: none (coordinate with US1 on marker stability, I4)
- **US4 (P4)**: none

### Within Each User Story

- Fixtures/constants before dispatchers before reply shapes
- Mock capability before the specs that exercise it
- Product assembly change (T013) before its components (T014/T015) before its spec (T016)
- Each story ends at its checkpoint with the relevant suite green

### Parallel Opportunities

- Setup: T002 alongside T001
- Foundational: T003, T004, T005 all parallel (disjoint files)
- US1: T006–T009 are sequential edits to the same file (`server.mjs`); T010 after them
- US2: T011 and T012 parallel (disjoint spec files) once US1 lands
- US3: T014 and T015 parallel (disjoint components) after T013; T016 after
- US4: T017 and T018 parallel (disjoint test files); T019 after T003/T004 alignment (any time after Phase 2)
- Cross-story: US4 can proceed in parallel with US1→US2; US3 likewise (marker-stability caveat above)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline + guardrail)
2. Complete Phase 2: Foundational (fixtures + constants)
3. Complete Phase 3: US1 — the mock discriminates kinds; `mock-classification.spec.ts` green, existing specs untouched-green
4. **STOP and VALIDATE**: US1 is the blocker removed; quiz/labs verification is now *possible*

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → mock speaks quiz/lab/grading dialects (MVP)
3. US2 → the manual RC pass is replaceable end to end (headline value)
4. US3 → the contract is locked and user-safe (product change; keep I4 green)
5. US4 → logic-layer depth lands in parallel at any point after Phase 2
6. Polish → docs, full gates, determinism soak, quickstart sign-off → RC gate active (SC-002)

### Parallel Team Strategy

With multiple agents/developers after Foundational:

- Agent A: US1 → US2 (mock then deck)
- Agent B: US3 (product change, keeping D1 markers stable)
- Agent C: US4 (logic suites)

Stories integrate independently; only US3↔US1 share the marker-stability invariant (I4), verified by both suites.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Zero `page.route` in `tests/` at every checkpoint (FR-005; `tests/fixtures/mock-llm/README.md` is the written rule)
- No drizzle schema changes, no new runtime dependencies anywhere in this feature
- Commit after each task or logical group; stop at checkpoints to validate stories independently
- Avoid: cross-story edits to `server.mjs` markers without re-running the deck (I4)
