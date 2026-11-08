# Tasks: Conversational Back-Propagation Tool

**Input**: Design documents from `/specs/027-backprop-tool/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/propagate-tool.md, quickstart.md (V0–V6)

**Tests**: Included — the constitution (`.specify/memory/constitution.md` II) mandates tests for new behavior in `src/lib/`. Test-first where a regression is being prevented (latch, failure ordering); test-with where new behavior is defined.

**Organization**: Tasks grouped by user story (spec.md US1 P1, US2 P2, US3 P3) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- **[Story]**: user story the task belongs to
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: Worktree bootstrap — this is a git worktree where `node_modules/` and `@mayon/shared`'s `dist/` are not committed (AGENTS.md "Worktrees").

- [X] T001 Bootstrap the worktree: run `pnpm install` and `pnpm --filter @mayon/shared build`, then confirm `pnpm check` is green before any edits

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared in-flight latch (research D5) — both the tool (US1) and the store adoption (US3) depend on it.

- [X] T002 Implement the single-slot propagation latch (synchronous try-acquire, release-on-every-exit, plain refusal reason when busy) in `src/lib/chat/propagation.ts` per specs/027-backprop-tool/data-model.md, with unit tests in `src/lib/chat/propagation.test.ts` covering acquire → second-acquire fails → release → re-acquire succeeds, and release-on-throw

**Checkpoint**: Latch lands green; user story implementation can begin.

---

## Phase 3: User Story 1 — Back-propagation executed in-conversation on explicit request (Priority: P1) 🎯 MVP

**Goal**: The `propagate_to_parent` tool exists, is offered exactly where valid, executes raw/summary propagation identical to the manual control, and the assistant confirms briefly.

**Independent Test**: quickstart V0/V1/V2 unit scenarios + V6 e2e round-trip — in a branch chat, an explicit conversational request lands a parent artifact by end of turn, identical in behavior to a manual one; on a root chat the tool is never offered.

### Tests for User Story 1 (write first; must fail)

- [X] T003 [P] [US1] Write the tool unit suite in `src/lib/agent/deterministic-tools.test.ts` from specs/027-backprop-tool/contracts/propagate-tool.md and quickstart V0–V2: refusal shapes (not-a-branch, empty branch, busy latch, bad mode), raw happy path (exactly one `branch_artifact` row in the parent anchored per `resolveAnchor`, metadata `mode:'raw'`, verbatim delta content, result names parent + mode), summary happy path (mocked generator, `summaryTraceId` set) — assert against the 020 test fixtures in `src/lib/stores/chat.svelte.test.ts` for artifact shape parity

### Implementation for User Story 1

- [X] T004 [US1] Register the `propagate_to_parent` tool in `src/lib/agent/deterministic-tools.ts` per specs/027-backprop-tool/contracts/propagate-tool.md: `risk:'high'`, `generative:true`, optional `mode` enum (`raw|summary`, omitted → `raw`); `run` = latch acquire (T002) → repo-revalidated gates → raw via `buildRawDelta`/summary via `generateBranchArtifactSummary` (generate-first ordering) → single `repos.messages.insertAnchored` with `resolveAnchor` + `branchArtifactMetadata`; contract result summaries; no chat-store import (depends on T002, T003)
- [X] T005 [P] [US1] Add availability gating in `src/lib/stores/chat.svelte.ts` turn assembly (`disabledToolIds`, mirroring `canPropagate`): include `propagate_to_parent` when the active chat is not a branch or has no messages; add V4 assertions to `src/lib/stores/chat.svelte.test.ts` (depends on T004)
- [X] T006 [P] [US1] Add the `Back-propagating to parent…` generative status label for the tool to the label ternary in `src/lib/agent/loop.ts` (research D3; depends on T004)
- [X] T007 [P] [US1] Add the request-side capabilities-preamble lines to `buildCapabilitiesPreamble()` in `src/lib/chat/brief.ts` (tool exists on branched chats; call only on explicit request; confirm in 1–2 sentences naming parent + mode; never reproduce propagated content as chat text; manual control is the fallback when the tool is absent) with assertions in `src/lib/chat/brief.test.ts` (depends on T004)
- [X] T008 [US1] Add a marker-based `propagate_to_parent` tool-call dispatch mode to the mock-LLM fixture server in `tests/fixtures/mock-llm/server.mjs` (follow the existing classification pattern; document the marker in `tests/fixtures/mock-llm/README.md`) (depends on T004)
- [X] T009 [US1] Create `tests/e2e/backprop-tool.spec.ts` — quickstart V6: explicit-request round-trip (tool call → approval → parent shows the identical anchored artifact, branch timeline shows tool rows, short confirmation, no toast) and root-chat control (tool never offered; reply points at the manual control) (depends on T008)

**Checkpoint**: US1 fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 — Offered (never forced) on natural completion signals (Priority: P2)

**Goal**: On a completion signal without an explicit request, the assistant offers once in plain terms and never propagates without agreement.

**Independent Test**: quickstart V5 preamble assertions + e2e offer/decline scenarios — offer appears at most once; "yes" executes (US1 path); decline/ignore propagates nothing and drops the subject.

- [X] T010 [US2] Add the offer-once preamble lines to `buildCapabilitiesPreamble()` in `src/lib/chat/brief.ts` (completion signal → at most one plain-language offer; never propagate unprompted; declined or ignored → dropped, no re-request) with V5 assertions in `src/lib/chat/brief.test.ts` (same file as T007 — run after it)
- [X] T011 [US2] Extend `tests/e2e/backprop-tool.spec.ts` with offer-once scenarios: completion signal → single offer and no propagation; agreement → propagation executes; decline → no propagation, no re-request (depends on T009, T010)

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Gated where invalid, safe when it fails (Priority: P3)

**Goal**: Cross-path concurrency refusal, failure atomicity, and repeat semantics identical to the manual control.

**Independent Test**: quickstart V2-throw/V3/V4 cross-path cases — zero partial or duplicated writes; every recoverable case succeeds on retry; manual path refuses while the tool runs and vice versa.

- [X] T012 [P] [US3] Adopt the shared latch in `chatStore.propagateToParent` in `src/lib/stores/chat.svelte.ts` (keep reactive `propagationStatus` for UI) and add cross-path concurrency tests to `src/lib/stores/chat.svelte.test.ts`: manual running → tool refused; tool running → manual refused (depends on T002, T004)
- [X] T013 [P] [US3] Add failure-atomicity and repeat-semantics tests to `src/lib/agent/deterministic-tools.test.ts` (research D8, quickstart V2/V3): summary generator throws → `{ok:false}` and zero parent writes; approval declined → `'user declined'`, no latch acquired; aborted mid-run → no insert, latch released; two sequential tool propagations land two artifacts (repeat = manual repeat); verify the tool performs no regeneration (depends on T004)

**Checkpoint**: All stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation parity and full-gate validation.

- [X] T014 [P] Update `docs/reference/tool-map.qmd` (Deterministic inventory row, behavioral notes, availability-gate 4 entry, generative label) and `docs/reference/agent-map.qmd` if it lists tool placement — same change as the tool code per the tool-map header rule
- [X] T015 Run the full gates — `pnpm check`, `pnpm lint`, `pnpm test`, Playwright e2e — and the quickstart.md V0–V6 pass; manual smoke on `pnpm dev`: approval modal, decline-is-final, and the manual back-propagate button unchanged (FR-011)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: after Setup — **blocks all stories** (the latch is the tool's first runtime step)
- **US1 (Phase 3)**: after Phase 2 (T004 depends on T002; T003 is test-first and parallel)
- **US2 (Phase 4)**: after US1 (T010 shares `brief.ts` with T007; T011 extends T009's spec)
- **US3 (Phase 5)**: after Phase 2 + T004 only — independent of US2, can run parallel with Phase 4
- **Polish (Phase 6)**: after all stories (T014's docs describe the finished tool)

### User Story Dependencies

- **US1 (P1)**: after Foundational — no story dependencies
- **US2 (P2)**: after US1 (shares preamble file and e2e spec; no other coupling)
- **US3 (P3)**: after Foundational + T004 — independent of US2 (different files)

### Within Each User Story

- Tests before implementation (T003 → T004)
- Tool core before its periphery (T004 → T005/T006/T007/T008)
- Fixture before e2e (T008 → T009)

### Parallel Opportunities

- T002 alone; then T003 can start immediately (test-first) while T004 waits on T002
- After T004: T005, T006, T007, T008 all touch different files — fully parallel
- After T004: Phase 4 (T010–T011) and Phase 5 (T012–T013) can proceed in parallel — disjoint files
- T012 and T013 are parallel (different test files, both only need T004)

---

## Parallel Example: User Story 1

```bash
# After T002 (latch) — write tests while the tool lands:
Task: "Tool unit suite in src/lib/agent/deterministic-tools.test.ts"          # T003
# After T004 (tool registered) — launch together (different files):
Task: "Availability gating in src/lib/stores/chat.svelte.ts"                  # T005
Task: "Generative status label in src/lib/agent/loop.ts"                      # T006
Task: "Request-side preamble lines in src/lib/chat/brief.ts"                  # T007
Task: "Mock-LLM fixture mode in tests/fixtures/mock-llm/server.mjs"           # T008
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) → Phase 2 (T002)
2. Phase 3 (T003–T009) — the tool, gating, preamble request rules, fixture + e2e
3. **STOP and VALIDATE**: quickstart V0–V4 + V6; manual smoke on `pnpm dev`
4. Deployable demo: "backpropagate this" in a branch chat just works

### Incremental Delivery

1. Foundation (latch) → US1 (tool MVP) → validate
2. US2 (offer-once etiquette) → validate V5 + e2e offer scenarios
3. US3 (cross-path safety + repeat semantics) → validate full failure battery
4. Polish (tool-map/agent-map docs + full gates + quickstart pass)

### Parallel Team Strategy

- One agent: Phase 2 → T003/T004 → T009 (critical path)
- Second agent (after T004): T005 + T006 + T007 + T008, then T012/T013
- Third agent (after T007/T009): T010/T011, then T014

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task
- Per AGENTS.md spec-kit rule: implementation dispatches in subgroups of ≤ 6 tasks to parallel sub-agents where the graph allows, with the ponytail and caveman skill bodies inlined into each sub-agent prompt
- No new dependencies, no schema changes, no new UI components — deviations from that mean scope creep; re-check the plan
- The tool MUST NOT import the chat store (research D4); the artifact-identical guarantee comes from reusing the 020 helpers, never from reimplementation
- Commit after each task or logical group; worktree branch discipline per AGENTS.md (no merging into main from this worktree)
