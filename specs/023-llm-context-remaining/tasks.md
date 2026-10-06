# Tasks: LLM Context-Remaining Indicator

**Input**: Design documents from `/specs/023-llm-context-remaining/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/context-gauge.md, quickstart.md

**Tests**: Included — the project constitution mandates tests for new behavior in `src/lib/` (gate 6) and quickstart.md enumerates the suites.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root (SvelteKit SPA; `src/lib` application layer, `src/routes` routes)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Worktree bootstrap only — the project itself already exists; no initialization needed.

- [x] T001 Prepare the worktree for implementation per AGENTS.md: `pnpm install`, then `pnpm --filter @mayon/shared build` (consumers resolve `@mayon/shared` types from its gitignored `dist/`; verify with `pnpm check` on untouched tree)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data foundation shared by every user story: persisting usage, typing it, fixing limit resolution, and declaring windows. **No schema migration** — all persisted fields already exist.

- [x] T002 [P] Add the typed usage anchor field `usage?: { promptTokens: number; completionTokens: number; totalTokens: number; modelId: string }` to `SharedMetadata` in `src/lib/chat/kinds.ts` (leave the existing unused `tokens?: number` declaration untouched; partial-tolerant types per data-model.md)
- [x] T003 [P] Implement `recordUsage(messageId, usage)` in `src/lib/db/repositories/messages.ts`: kind-guarded (assistant_message only) single-row UPDATE writing `messages.tokens = totalTokens` and merged `metadata.usage`; extend `src/lib/db/repositories/messages.test.ts` with pglite cases (writes both fields, kind guard rejects other kinds, no-op on missing row)
- [x] T004 [P] Fix `estimateContextLimit` in `src/lib/ai/model-limits.ts` to strip router prefixes by matching on the last `/` segment (mirror `src/lib/ai/dialects.ts:349-351`); add router-prefixed cases (`z-ai/glm-5.2`, `openai/gpt-4o`) to `src/lib/ai/model-limits.test.ts`
- [x] T005 [P] Add optional `contextWindow?: number` to `ProviderConfig` in `src/lib/ai/types.ts` and normalize it (positive integer, invalid dropped not clamped) in `normalizeProviderConfig` in `src/lib/ai/registry.ts`
- [x] T006 Capture the final agent-loop usage event in `chatStore.send()` and persist it in the `finally` block via `repos.messages.recordUsage(builder.assistantMessageId, usage)` in `src/lib/stores/chat.svelte.ts` — main chat turns only, nothing written when no usage event or no final assistant row

**Checkpoint**: Usage survives reload; window resolution inputs exist. User story implementation can begin.

---

## Phase 3: User Story 1 - Glanceable context-remaining indicator (Priority: P1) 🎯 MVP

**Goal**: A compact indicator in the Composer status row showing consumed vs. remaining context for the active chat, refreshed after each exchange and on chat/branch/model switch.

**Independent Test**: Open a chat with a completed exchange (mock LLM provider with declared context window); the indicator appears next to `provider · model`, reflects the reported usage, updates after the next reply, after a model switch, and after switching chats/branches (quickstart.md scenario A).

### Implementation for User Story 1

- [x] T007 [P] [US1] Implement the pure derivation `deriveContextGauge(input)` plus exported `LOW_REMAINING = 0.25` / `CRITICAL_REMAINING = 0.10` in `src/lib/chat/context-usage.ts` per contracts/context-gauge.md: backward anchor scan over active-path candidates, window chain (declared → router-fixed catalog → null), chars/4 estimation fallback, provenance, model-mismatch degradation, `remainingPct`, state
- [x] T008 [P] [US1] Unit-test `deriveContextGauge` in `src/lib/chat/context-usage.test.ts`: anchor selection, window precedence (declared > catalog > unknown), router-prefixed ids, estimate fallback for empty chat, threshold boundaries (25%/10%), partial usage, mismatch → estimated
- [x] T009 [P] [US1] Create the presentational indicator `src/lib/components/chat/ContextGauge.svelte`: compact used/limit display in the `text-[11px] text-muted-foreground` idiom, renders nothing without a model id (hero composer)
- [x] T010 [US1] Expose gauge inputs from `src/lib/stores/chat.svelte.ts`: a getter for the last assembled provider-context character length (from the `reassembleContext` path) plus the candidate-row scan over `messages`; recompute triggers are turn completion (`streaming` → false) and `load()` — never per keystroke or stream chunk
- [x] T011 [US1] Mount `ContextGauge` right-aligned in the existing status row of `src/lib/components/chat/Composer.svelte` (lines ~366-370); thread `activeModelId`, `activeConfig` (`contextWindow`), and chatStore inputs from `src/routes/chat/[id]/+page.svelte`
- [x] T012 [P] [US1] Add the "Context window (tokens)" input to the provider card in `src/lib/components/ai/ProviderConfig.svelte` (optional numeric field, saved through the existing settings path)
- [x] T013 [P] [US1] Source-contract test `src/lib/components/chat/ContextGauge.contract.test.ts` (readFileSync pattern per `Composer.launchers.test.ts`): gauge present in the Composer status row, absent when no model id

**Checkpoint**: Story 1 delivers standalone value — the indicator works end-to-end with reported usage and declared/catalog windows.

---

## Phase 4: User Story 2 - Trustworthy numbers (Priority: P2)

**Goal**: Reported values win and are shown as fact; approximations are visibly marked; unknown windows show consumption without an invented denominator; estimates snap to reported figures.

**Independent Test**: Fresh chat shows an `~`/`est.`-marked value that loses the marking after the first reported exchange; provider without any window knowledge shows "window unknown"; reload keeps reported values (quickstart.md scenarios C and D).

### Implementation for User Story 2

- [x] T014 [US2] Add provenance and no-limit markings to `src/lib/components/chat/ContextGauge.svelte`: `~`/`est.` marking on estimated values, "window unknown" treatment when `limit` is null with a pointer to the provider-card field
- [x] T015 [US2] Extend `src/lib/chat/context-usage.test.ts` with US2 cases: partial-usage tolerance (falls back to `tokens`), estimate replaced by reported anchor without drift, provenance flips after model switch back and forth
- [x] T016 [US2] Extend `src/lib/stores/chat.svelte.test.ts`: a mock-LLM turn persists usage onto the final assistant row (`tokens` + `metadata.usage`); an aborted turn without a usage event writes nothing

**Checkpoint**: Stories 1 and 2 both function independently; numbers are honest.

---

## Phase 5: User Story 3 - Low-context warning states (Priority: P3)

**Goal**: The indicator escalates normal → low → near-exhaustion with escalating visual treatment and brief guidance at critical.

**Independent Test**: Set the mock provider's declared window to `2` (mock reports 2 tokens/turn → 100% used): indicator renders in the critical tone with guidance; window `8` → low tone; large window or new chat → normal (quickstart.md scenario B).

### Implementation for User Story 3

- [x] T017 [US3] Add escalation presentation to `src/lib/components/chat/ContextGauge.svelte`: amber tone at `low`, destructive tone at `critical`, brief guidance copy at critical ("start a new chat or branch to free context") surfaced via the `.tip` hover affordance (`src/app.css:567-593`) and an aria/status text; never blocks composing/sending
- [x] T018 [P] [US3] Extend `src/lib/components/chat/ContextGauge.contract.test.ts` (tone classes per state) and `src/lib/chat/context-usage.test.ts` (state field at exact boundaries)

**Checkpoint**: Warnings appear before requests fail; guidance is nameable.

---

## Phase 6: User Story 4 - On-demand breakdown (Priority: P4)

**Goal**: A detail popover from the indicator itemizing consumption with per-figure provenance.

**Independent Test**: Open the gauge's detail in a chat with history: it lists latest exchange vs. history+fixed instructions consistent with the displayed total, the window size and its source, and marks each approximation (quickstart.md scenario E context).

### Implementation for User Story 4

- [x] T019 [US4] Add the detail popover to `src/lib/components/chat/ContextGauge.svelte` using `src/lib/components/ui/popover/` + `.tip` label: breakdown rows (latest exchange = completionTokens, history + fixed instructions = promptTokens), window size + `limitSource`, per-figure provenance markings per contracts/context-gauge.md
- [x] T020 [P] [US4] Extend `src/lib/components/chat/ContextGauge.contract.test.ts` for popover content and markings

**Checkpoint**: All user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T021 Run the manual validation scenarios A–E from `specs/023-llm-context-remaining/quickstart.md` against `pnpm dev` and record outcomes in the PR description — **executed in-session via sub-agent** (dev stack + mock-LLM container + Playwright); outcomes and evidence in `specs/023-llm-context-remaining/quickstart-results.md` (+7 screenshots in `checklists/`). All five scenarios PASS after three post-validation fixes (usage merge in loop.ts, no-limit popover hint, quickstart B-3 doc correction).
- [x] T022 Run all quality gates: `pnpm check`, `pnpm lint`, `pnpm test` (schema untouched — verify no new file appeared in `drizzle/`)
- [x] T023 [P] Update docs: describe the context gauge and the provider `contextWindow` field in `docs/explanation/architecture.qmd` (provider/AI layer); add a `recordUsage` note to `docs/reference/seams.qmd` only if the repository write warrants seam documentation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001; **blocks all user stories** (T002–T005 are mutually parallel; T006 depends on T002 + T003)
- **User Stories (Phases 3–6)**: All depend on Phase 2. Recommended order US1 → US2 → US3 → US4; US2/US3/US4 each depend on US1's component existing but are mutually independent
- **Polish (Phase 7)**: Depends on all implemented stories

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies (MVP)
- **US2 (P2)**: After US1 (extends the same component/tests); independently testable against US1
- **US3 (P3)**: After US1; independent of US2
- **US4 (P4)**: After US1; independent of US2/US3

### Within Each User Story

- Derivation and tests (T007/T008) are parallel; store/component wiring follows the modules it consumes
- Story complete → checkpoint validation before moving on

### Parallel Opportunities

- Phase 2: T002, T003, T004, T005 all touch different files — run as one parallel group
- US1: T007+T008 (module+tests), T009, T012, T013 form a parallel group; T010/T011 are sequential wiring
- US3 test task (T018) and US4 test task (T020) parallel their implementation tasks' files only after those land — keep sequential per story ordering
- Different user stories can be parallelized by different agents once US1 lands (US2, US3, US4 all extend different concerns)

---

## Parallel Example: User Story 1

```bash
# Launch after Phase 2 (different files, no cross-dependencies):
Task: "T007 deriveContextGauge in src/lib/chat/context-usage.ts"
Task: "T008 unit tests for src/lib/chat/context-usage.ts"
Task: "T009 ContextGauge.svelte presentational component"
Task: "T012 provider card context-window field in src/lib/components/ai/ProviderConfig.svelte"
Task: "T013 source-contract test"

# Then sequentially (wiring consumes the above):
Task: "T010 chatStore gauge inputs in src/lib/stores/chat.svelte.ts"
Task: "T011 mount in Composer status row + route wiring"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (worktree bootstrap)
2. Complete Phase 2 (usage persistence + limit fixes) — CRITICAL, blocks everything
3. Complete Phase 3 (indicator visible and updating)
4. **STOP and VALIDATE**: quickstart.md scenario A end-to-end
5. Ship if desired — the indicator alone answers the original request

### Incremental Delivery

1. Setup + Foundational → data foundation
2. US1 → MVP (glanceable indicator)
3. US2 → honest numbers (markings, persistence guarantees)
4. US3 → actionable warnings (tones + guidance)
5. US4 → power-user breakdown (popover)

### Parallel Team Strategy

1. Team completes Phases 1–2 together
2. One agent takes US1 (critical path)
3. Once US1 lands: US2, US3, US4 proceed in parallel by different agents (each extends `ContextGauge.svelte` differently — if parallelized, sequence the component-touching tasks T014/T017/T019 or assign distinct files where possible)
4. Polish last

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map to spec.md user stories for traceability
- Zero new npm dependencies; zero drizzle migration — any task drifting toward either must stop and re-consult plan.md's Constitution Check
- Commit after each task or logical group; run `pnpm check` + `pnpm lint` before every commit (constitution gate 3)
- Stop at any checkpoint to validate the story independently
