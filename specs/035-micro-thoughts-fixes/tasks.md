---
description: "Task list for feature 035-micro-thoughts-fixes"
---

# Tasks: Micro-Thoughts Follow-Up Fixes (029 defects)

**Input**: Design documents from `/specs/035-micro-thoughts-fixes/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Explicitly requested (spec FR-009 + issue #71 item 7). Fail-first: every test
task below MUST be observed failing for the stated reason BEFORE its implementation task
runs (exception: T001 baseline must PASS).

**Test runner (STRICT, fleet policy)** — SPA tests ONLY as:

```bash
systemd-run --user --scope -p MemoryMax=500M \
  --setenv=NODE_OPTIONS=--max-old-space-size=384 \
  pnpm test:low-spec <files>
```

One process at a time. Never plain `pnpm test`/vitest/watch. No Docker, no `pnpm dev`, no
git mutations.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the touched suites are green before any edit.

- [ ] T001 Baseline: run the three existing touched suites green under the capped runner — `src/lib/agent/loop.test.ts`, `src/lib/stores/chat.svelte.test.ts`, `src/lib/chat/entries.test.ts` (the fourth, `src/lib/agent/trace.test.ts`, is created by T015)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None — the repo, schema, and test seams already exist; stories are independent
slices over distinct regions of `src/lib/agent/loop.ts`, `src/lib/stores/chat.svelte.ts`,
`src/lib/chat/entries.ts`, `src/lib/agent/trace.ts`. Proceed directly to user stories.

**Checkpoint**: N/A — start Phase 3 immediately after T001.

---

## Phase 3: User Story 1 - Self-corrected replies keep their micro-thoughts (Priority: P1) 🎯 MVP

**Goal**: A critic correction persists the original stream's anchored reasoning rows before
the corrected text row; no-correction turns persist reasoning exactly once.

**Independent Test**: quickstart V1 (capped: `src/lib/agent/loop.test.ts src/lib/stores/chat.svelte.test.ts`).

### Tests for User Story 1 ⚠️ FAIL FIRST

- [ ] T002 [P] [US1] Add fail-first loop test in `src/lib/agent/loop.test.ts`: original stream `[reasoning-start/delta "thinking…", text-delta broken-mermaid, finish]` + mocked `validateTurn` (1 issue, then none) + corrected re-stream → expect `appendReasoning('thinking…', 0)` ordered BEFORE `appendAssistantText(corrected, {final:true})` (use the `orderOf` helper; today `appendReasoning` is never called on this path — that is the failure); plus a no-correction case asserting `appendReasoning` exactly once
- [ ] T003 [P] [US1] Add fail-first store round-trip test in `src/lib/stores/chat.svelte.test.ts`: same two-stream script through the real loop → `repos.messages.listByChat` yields `[reasoning(anchored), assistant(corrected)]`, identical after a fresh `chatStore.load()`; today the reasoning row is missing (that is the failure)

### Implementation for User Story 1

- [ ] T004 [US1] In `src/lib/agent/loop.ts` finalize branch (current anchors: lines 729–767, ternary 743–751): on the `finalBuf !== buf` (corrected) arm, first flush the original iteration's reasoning blocks — for each `blocks` entry of `kind 'reasoning'` with non-whitespace `text`, `await deps.appendReasoning(text, i)` in arrival order, then set `blocks = []` — immediately BEFORE the corrected `appendAssistantText`; leave the `finalBuf === buf` arm (walkPersist) and the tool-budget path (972–990) untouched (contracts/corrected-persist.md)

**Checkpoint**: US1 fully functional and independently testable (capped V1 run: both new tests green, T002's sibling `loop.test.ts:2139` still green).

---

## Phase 4: User Story 2 - Each live thought appears once and stops pulsing (Priority: P2)

**Goal**: Live blocks close and clear at iteration boundaries; completed bursts carry
`streaming: false` and stop pulsing.

**Independent Test**: quickstart V2 (capped: `src/lib/agent/loop.test.ts src/lib/stores/chat.svelte.test.ts`).

### Tests for User Story 2 ⚠️ FAIL FIRST

- [ ] T005 [P] [US2] Add fail-first loop test in `src/lib/agent/loop.test.ts`: two-iteration script (iter 1: reasoning + text + tool-call → finish 'tool-calls'; iter 2: text → finish 'stop', `mockedToolsRun` resolves ok) with `onIterationBoundary: vi.fn()` → expect one call after the interim persist and one at finalize (today the dep does not exist — that is the failure)
- [ ] T006 [P] [US2] Add fail-first store tests in `src/lib/stores/chat.svelte.test.ts` (extend the `029 live blocks (T010)` describe): (a) same two-iteration script — after iteration 1's rows persist, while iteration 2's reasoning streams, `liveItems` holds exactly ONE `live_reasoning` entry and no empty-buffer stale `live_text` entry (today iteration 1's reasoning block remains — that is the failure); (b) within one iteration, after `onTextSegmentStart`, the earlier reasoning block is `open === false` and its `liveItems` entry has `streaming: false`; (c) turn teardown still clears everything

### Implementation for User Story 2

- [ ] T007 [US2] Iteration boundary: add optional `onIterationBoundary?: () => void` to `AgentTurnDeps` (`src/lib/agent/loop.ts:33–84`); fire it after the interim persist (after lines 775–783), after the finalize persist before `return {aborted:false}` (around 758–766), before the budget-path return (before 990), and inside `runCriticPhase` once `initialIssues` is non-empty, before the first re-stream (366–453); wire the store dep in `src/lib/stores/chat.svelte.ts` `runAgentTurn` call (near 685–886) to `this.liveBlocks = []` (contracts/iteration-boundary.md — NEVER fire before a persist)
- [ ] T008 [US2] Streaming flag: in `src/lib/stores/chat.svelte.ts` close ALL open blocks in `onReasoningSegmentStart` (719–721) and extend `onTextSegmentStart`'s close-loop (722–727) from text-only to all open blocks; `liveItems` reasoning push (356–359) gains `streaming: b.open`; add `streaming: boolean` to `LiveReasoningEntry` in `src/lib/chat/entries.ts` (72–76); pass `streaming={item.streaming}` in `src/lib/components/chat/MessageList.svelte:164`; gate the pulsing dot (34–36) on it in `src/lib/components/chat/rows/ReasoningEntry.svelte` live props (8–9)

**Checkpoint**: US1 + US2 independently testable; existing 029 live-block tests stay green.

---

## Phase 5: User Story 3 - Regenerate replaces the whole interleaved turn (Priority: P2)

**Goal**: Gate accepts trailing anchored reasoning; delete removes every row of the turn
back to the previous user message.

**Independent Test**: quickstart V3 (capped: `src/lib/chat/entries.test.ts src/lib/stores/chat.svelte.test.ts`).

### Tests for User Story 3 ⚠️ FAIL FIRST

- [ ] T009 [P] [US3] Add fail-first tests in `src/lib/chat/entries.test.ts` for new export `lastRegeneratableAssistantId(timeline)`: (a) `[user, reasoning(anchored), assistant_message, reasoning(anchored trailing)]` → the assistant id (today impossible — helper absent, that is the failure); (b) trailing UNanchored reasoning → `null`; (c) text-last single row → id (today's behavior preserved)
- [ ] T010 [P] [US3] Add fail-first store test in `src/lib/stores/chat.svelte.test.ts`: seed `[user("hi"), reasoning(anchored), assistant("ans"), reasoning(anchored, trailing)]` durably; `chatStore.deleteLastAssistantTurn(assistantRowId)` deletes all three non-user rows, keeps the user row, and returns `{userText: "hi", attachments: []}` (method absent today — that is the failure)

### Implementation for User Story 3

- [ ] T011 [US3] Export `lastRegeneratableAssistantId(timeline: TimelineItem[]): string | null` from `src/lib/chat/entries.ts` (skip trailing durable `reasoning` items with `metadata.anchored === true` from the end; require the next item to be a durable `assistant_message`; reuse `isAnchoredReasoning` at 303–305); delegate `lastAssistantId` in `src/lib/components/chat/MessageList.svelte:79–83` to it (contracts/regenerate-scope.md)
- [ ] T012 [US3] Add `deleteLastAssistantTurn(assistantRowId)` to `ChatState` in `src/lib/stores/chat.svelte.ts` (walk back to the previous `user` row capturing `content` + `attachmentsOf(row)`; delete every message strictly after it via `repos.messages.delete`; update `this.messages`; return the resend payload or `null`); rewrite `onRegenerate` in `src/routes/chat/[id]/+page.svelte:579–597` to delegate and re-send

**Checkpoint**: US3 independently testable; single-row regenerate behavior byte-identical to today.

---

## Phase 6: User Story 4 - Paced presets drain once per turn (Priority: P3)

**Goal**: The deferred drain runs only for a finalize append with unflushed buffer; no
per-block deadline stalls.

**Independent Test**: quickstart V4 (capped: `src/lib/stores/chat.svelte.test.ts`).

### Tests for User Story 4 ⚠️ FAIL FIRST

- [ ] T013 [P] [US4] Add fail-first test in `src/lib/stores/chat.svelte.test.ts` paced-streaming describe (fake timers, 3327+): paced preset + interleaved two-text-block script (`text-start/delta/end` ×2 with reasoning between, via `mockedStreamText` fullStream) → after the first durable assistant row lands, the second row must appear WITHOUT advancing timers by `DRAIN_DEADLINE_MS` (1200 ms) (today the second append stalls ~1.2 s — that is the failure); assert the existing single-block deferral test ('defers finalize until the drain completes') still passes unchanged

### Implementation for User Story 4

- [ ] T014 [US4] In `src/lib/stores/chat.svelte.ts` `appendAssistantText` drain gate (current anchors 740–744): add `opts?.final === true &&` and `this.streamBuffer !== '' &&` to the condition (contracts/drain-once.md; keep `content`/`!aborted`/preset/pacer terms)

**Checkpoint**: US4 independently testable; standard-preset and single-block paced tests unchanged.

---

## Phase 7: User Story 5 - Trace shows no phantom reasoning segment (Priority: P3)

**Goal**: A whitespace-only trailing reasoning segment is pruned at close/finish; real
trailing thoughts survive.

**Independent Test**: quickstart V5 (capped: `src/lib/agent/trace.test.ts`).

### Tests for User Story 5 ⚠️ FAIL FIRST

- [ ] T015 [P] [US5] Create `src/lib/agent/trace.test.ts` (no `+` prefix) with fail-first `TraceBuilder` tests: (a) `[request, reasoning-start, reasoning-delta "  ", reasoning-end, finish]` → `reasoningSegments === []` (today `['  ']` survives — that is the failure); (b) same without `reasoning-end` (closed by `finish`) → `[]`; (c) `[request, reasoning-start, reasoning-delta " done thinking.", finish]` → segment kept

### Implementation for User Story 5

- [ ] T016 [US5] In `src/lib/agent/trace.ts`: extract the pop-if-trailing-whitespace step (currently inline at 186–188) into a private prune on `this.current`; call it on `reasoning-start` (existing), on a new `reasoning-end` branch of the `part` handler, and at `finish` alongside the finishReason capture (198–199); prune condition strictly `!segment.trim()` (research D6)

**Checkpoint**: US5 independently testable; loop-driven trace tests unaffected.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story regression, optional maintainer e2e, changelog, full verification.

- [ ] T017 Add the interleaved-mock-shape fast-tier regression test in `src/lib/stores/chat.svelte.test.ts`: replay `chat_interleaved`'s frame order (mirror `tests/fixtures/mock-llm/server.mjs:187–205`: reasoning×2 → content×2 → reasoning×2 → content×2 → trailing reasoning) as a scripted fullStream through the real loop+store → durable rows `[reasoning, text, reasoning, text, reasoning(trailing, anchored)]`, each live thought emitted once, `lastRegeneratableAssistantId` resolves on the turn (quickstart V6; fails before Phases 3–5 land, must pass after)
- [ ] T018 [P] OPTIONAL — maintainer-verifiable only (requires Docker dev stack; implementer tier MUST skip execution, may write the spec): Playwright e2e driving `[[interleaved-thoughts]]` against `pnpm dev` (extend `tests/e2e/render.spec.ts`): live interleaved blocks render once each, reload preserves row order, regenerate replaces the whole turn. Mark `test.skip` is NOT wanted — leave runnable for the maintainer and note the Docker requirement in the spec body
- [ ] T019 [P] Add the fix entry inside `## [0.10.0]` (NOT `## [Unreleased]`) of `CHANGELOG.md` under a `### Fixed` subsection: micro-thoughts follow-up fixes (critic-corrected replies keep original reasoning; live thoughts no longer duplicate across iterations and stop pulsing when finished; regenerate handles multi-row turns; paced presets drain once per turn; trace prunes phantom whitespace segments) — match existing entry style; must satisfy `pnpm lint` (Prettier wraps `CHANGELOG.md`)
- [ ] T020 Final verification under the fleet policy (one process at a time): capped `pnpm test:low-spec src/lib/agent/loop.test.ts src/lib/agent/trace.test.ts src/lib/chat/entries.test.ts`, then capped `pnpm test:low-spec src/lib/stores/chat.svelte.test.ts`, then `pnpm check`, then `pnpm lint`; fix any fallout

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first — confirms the baseline the fail-first tasks measure against.
- **Foundational (Phase 2)**: none (intentionally empty).
- **User Stories (Phases 3–7)**: US1 → US2 share `src/lib/agent/loop.ts` (different regions); US2 → US3 share `src/lib/stores/chat.svelte.ts` / `entries.ts` (different regions) — sequential execution in ID order avoids conflicts; US4/US5 are file-disjoint from each other.
- **Polish (Phase 8)**: T017 depends on Phases 3–6 (it asserts their outcomes); T018–T019 are [P]; T020 last.

### User Story Dependencies

- **US1 (P1)**: none — MVP slice.
- **US2 (P2)**: edits `loop.ts` after US1 (distinct regions); independently testable.
- **US3 (P2)**: none on US1/US2 behavior (pure helper + store method + route).
- **US4 (P3)**: none (store drain gate region only).
- **US5 (P3)**: none (`trace.ts` + new test file).

### Within Each User Story

- Tests MUST be written and observed FAILING before implementation runs.
- Implementation tasks follow their test tasks (T002/T003 → T004; T005/T006 → T007/T008; T009/T010 → T011/T012; T013 → T014; T015 → T016).

### Parallel Opportunities

- Within a story: T002 ∥ T003, T005 ∥ T006, T009 ∥ T010 (different files).
- Cross-story: US5 (T015/T016) is fully disjoint — can proceed any time after T001.
- T018 ∥ T019 in Phase 8.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 baseline → 2. T002/T003 fail-first → 3. T004 → capped V1 green.
   US1 alone already removes the highest-severity data loss (issue item 1).

### Incremental Delivery

1. US1 (data loss) → 2. US2 (live duplication/pulsing) → 3. US3 (regenerate) → 4. US4 (drain stalls) → 5. US5 (trace) → 6. Phase 8 regression + changelog + full gates.

### Parallel Team Strategy

Single-implementer sequential in ID order is safest (shared files across adjacent stories);
if parallelizing: one worker owns US1+US2 (`loop.ts` + store), another owns US3+US5
(`entries.ts`/`trace.ts`/route), US4 folded with either store owner last.

---

## Notes

- Re-anchored current line numbers are in each task and in `research.md` D1–D7; the issue's
  original numbers (loop.ts:629-637 etc.) have drifted post-#70/033.
- T018 is the ONLY Docker-dependent task and is maintainer-verifiable by design.
- CHANGELOG placement inside `## [0.10.0]` follows feature 034's release-train decision.
