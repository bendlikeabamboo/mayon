# Tasks: Micro-Thought Streams (Interleaved Reasoning)

**Input**: Design documents from `/specs/029-micro-thoughts/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/ (all present)

**Tests**: Included — the project constitution mandates tests for new behavior in `src/lib/` and a regression test for the flattening defect.

**Organization**: Tasks grouped by user story (US1 live display, US2 persistence/history, US3 no-regression) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths in descriptions

## Path Conventions

Single project: `src/`, `tests/` at repository root (SvelteKit SPA + `server/` + `packages/shared/`; this feature touches only `src/lib/`, `tests/fixtures/mock-llm/`, and docs).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Worktree bootstrap and green baseline before any change.

- [X] T001 Baseline bootstrap: run `pnpm install` and `pnpm --filter @mayon/shared build` (worktree starts without deps and without built shared types — AGENTS.md "Worktrees"), then confirm the gates are green: `pnpm check && pnpm lint && pnpm test`. Record any pre-existing failures before touching code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The segment machinery every story needs: segment-aware stream consumption, the live block store state, the `anchored` metadata flag, and the mock-LLM reasoning frames used to validate everything offline.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 [P] Add `anchored?: true` to `ReasoningMeta` in `src/lib/chat/kinds.ts` (additive; no other consumer changes — `parseMetadata` callers unaffected). Contract: `specs/029-micro-thoughts/contracts/persistence-and-display.md`.
- [ ] T003 Segment-aware `consumeStream` in `src/lib/agent/loop.ts`: implement the part state machine from `specs/029-micro-thoughts/contracts/stream-segments.md` — every `reasoning-start` opens a NEW segment (ignore SDK `id`; openai-compatible reuses `"reasoning-0"`), close on `reasoning-end`/`text-start`/`tool-call`/`finish`/`error`/abort, defensive implicit open on orphan `reasoning-delta`, `text-start` records a text-split boundary; extend `AgentTurnDeps` with `onReasoningSegmentStart?()` and `onTextSegmentStart?(startOffset: number)` while keeping existing callback signatures (incl. `updateReasoningBuffer` reinterpreted per contract as active-block text). Provider-agnostic: only SDK part types, no wire fields.
- [ ] T004 LiveBlock live state in `src/lib/stores/chat.svelte.ts`: replace the single `reasoningBuffer` string with the ordered `liveBlocks` model from `specs/029-micro-thoughts/data-model.md` §3 (`{kind:'reasoning'; text; open}` blocks + `{kind:'text'; start; open}` offsets into the unchanged concatenated `streamBuffer`); wire the new loop callbacks inside `send()`; keep `streamBuffer` + pacer path byte-identical; clear blocks at turn start and in the `finally` teardown (replaces `reasoningBuffer` resets at `chat.svelte.ts:502-511, 825-834`). Depends on T003 (callback contract).
- [ ] T005 [P] Mock LLM reasoning frames in `tests/fixtures/mock-llm/server.mjs`: implement the `[[interleaved-thoughts]]` marker trigger per `specs/029-micro-thoughts/contracts/mock-llm-reasoning.md` — interleaved `delta.reasoning_content` frames around content frames (reasoning → text → reasoning → text → trailing thought), plain-`stop` terminal; zero behavior change without the marker. Update `tests/fixtures/mock-llm/README.md` and `docs/history/appendices/020-mock-llm-protocol.md` with the marker + frame order.

**Checkpoint**: Foundation ready — segment assembly, live block state, anchored flag, and mock frames in place. User story implementation can now begin (US1 and US2 share hot files `loop.ts`/`chat.svelte.ts` — see Dependencies).

---

## Phase 3: User Story 1 - See micro-thoughts live, in arrival positions (Priority: P1) 🎯 MVP

**Goal**: Interleaved reasoning bursts render live as separate collapsible "Thought process" entries at their arrival positions, while answer text keeps its paced reveal (spec FR-001/002/003, SC-001, SC-004).

**Independent Test**: With the mock LLM (`node tests/fixtures/mock-llm/server.mjs`, endpoint `http://localhost:9999/v1`, model `mock-sink`, Thinking ON), send `[[interleaved-thoughts]] What is 2+2?` — the live transcript shows thought → text → thought → text → trailing thought in order, text cadence unchanged, no merged blocks (quickstart Scenario 1).

### Tests for User Story 1 (write first; segment/live assertions FAIL until T007–T009)

- [ ] T006 [P] [US1] Scripted-stream segment tests in `src/lib/agent/loop.test.ts` (extend the `(t) reasoning` describe, `scriptedFullStream` pattern): interleaved `[reasoning-start/delta/end → text-delta → reasoning-start/delta/end → text-delta]` asserts the segment callback sequence and per-segment buffer updates; single-segment stream asserts today's callback shape; whitespace-only segment dropped; abort closes the open segment.
- [ ] T010 [P] [US1] Live block list tests in `src/lib/stores/chat.svelte.test.ts` (extend `chatStore reasoning buffer` describe): interleaved mocked turn produces ordered `liveBlocks` (reasoning/text/text-open flags), blocks cleared on teardown, no `open:true` block after error/abort.

### Implementation for User Story 1

- [ ] T007 [US1] Per-block `liveItems` emission in `src/lib/stores/chat.svelte.ts` (replaces the hard-coded `[live_reasoning, live_text]` pair at the `liveItems` getter): one timeline entry per block in list order — reasoning blocks → `LiveReasoningEntry` per block; text blocks → `LiveTextEntry` whose buffer is the block's slice of the paced visible prefix (`flushRender` path), `pending: true` only on the last open text block. Depends on T004.
- [ ] T008 [US1] Render ordered live blocks in `src/lib/components/chat/MessageList.svelte`: extend `itemId()` for per-block unique live keys (e.g. `live-reasoning-<blockIndex>`), route each block to the existing `ReasoningEntry` live variant / `AssistantMessage` live; append-only rendering so already-visible entries never jump (FR-011). Depends on T007.
- [ ] T009 [US1] Stream lifecycle closure in `src/lib/agent/loop.ts` + `src/lib/stores/chat.svelte.ts`: on `finish`/`error`/abort, close open segments/blocks so no perpetual live "thinking" entry survives (CopilotKit lifecycle rule, research.md F7); rapid successive bursts stay distinct entries.

**Checkpoint**: US1 functional — live interleaved display works against the mock (quickstart Scenario 1, live half). US2 (persistence) not yet wired: interleaved turns still persist flattened; that is expected at this checkpoint.

---

## Phase 4: User Story 2 - Conversation history reproduces the interleaved structure (Priority: P2)

**Goal**: Arrival-ordered persistence and order-faithful reload: reasoning rows marked `anchored`, text split into multiple `assistant_message` rows only on true interleaves, single-segment turns byte-identical to today (spec FR-004/005/008, SC-002/SC-003).

**Independent Test**: Complete the US1 mock turn, reload the page, reopen the conversation — identical segment count/content/order (quickstart Scenario 1, reload half; Scenario 4 abort keeps received blocks).

### Tests for User Story 2 (write first; persistence assertions FAIL until T012–T014)

- [ ] T011 [P] [US2] Persist-walk tests in `src/lib/agent/loop.test.ts` (extend `(w) persist order (003 US3)` describe): interleaved stream persists rows in order `[reasoning, text, reasoning, text]` with `metadata.anchored === true` on reasoning rows and per-block `appendAssistantText` calls whose concatenated content equals the buffer; single-segment stream persists exactly today's `[reasoning?, assistant_message]` row shapes; abort mid-interleave persists received blocks in order.
- [ ] T015 [P] [US2] Canonical-order tests in `src/lib/chat/entries.test.ts` (extend `canonical order pass (003 US3)` describe): anchored reasoning rows after an assistant row are NOT hoisted by `reorderTurn`; legacy (unanchored) rows still repaired to pre-answer; tool rows and user boundaries never crossed; multi-row interleaved turn assembles in stored ord order.
- [ ] T017 [P] [US2] Reload-fidelity test in `src/lib/stores/chat.svelte.test.ts` (pglite): run an interleaved turn end-to-end (mocked loop with segment callbacks), reload via `load()`, assert stored timeline reproduces the live block sequence exactly.

### Implementation for User Story 2

- [ ] T012 [US2] Iteration-end block-walk persistence in `src/lib/agent/loop.ts` (`inner()` persist site, replaces the single `appendReasoning(reasoningBuf, i)` at the stream-end path) + `src/lib/stores/chat.svelte.ts` (`appendReasoning` writes `metadata: {iteration, anchored: true}`; `appendAssistantText` called once per text block when >1 text block, full buffer otherwise): anchors (`builder.assistantMessageId`, usage) bind to the LAST text row; empty/whitespace segments produce no rows. Contract: `specs/029-micro-thoughts/contracts/persistence-and-display.md` rules 1–6. Depends on T003/T004 (foundational).
- [ ] T013 [US2] Abort-path persistence in `src/lib/agent/loop.ts` (abort site at the `AbortError` handler) + `src/lib/stores/chat.svelte.ts` (`finally` block): persist received blocks in arrival order (partial reasoning + partial text) BEFORE the interrupted-text row handling; no rows after the stop point (FR-008). Depends on T012.
- [ ] T014 [US2] `reorderTurn` v2 in `src/lib/chat/entries.ts`: parse `ReasoningMeta`; `anchored === true` ⇒ position authoritative (never spliced); absent ⇒ legacy repair exactly as today (`entries.ts:279-300`); stop-at-tool/user-boundary semantics unchanged. Depends on T002.
- [ ] T016 [US2] Consumer audit for multi-row turns (read-and-verify, fix only if broken): branch/backprop `builder.assistantMessageId` consumers, `present_choices` turn-scoping in `appendAssistantToolCall` (`src/lib/stores/chat.svelte.ts:653-679`), `self_corrected` `finalTextLength`, Dev strategy lint, expound per-row source maps (`src/lib/markdown/sourcemap.ts` — rows are self-contained), projection merge of consecutive `assistant_message` rows (`src/lib/chat/projection.ts:258-272`). Document verdicts in the PR description per `data-model.md` §Consumer audit. Depends on T012.

**Checkpoint**: US1 + US2 both work: live display, persistence, reload fidelity, abort.

---

## Phase 5: User Story 3 - Existing single-block reasoning providers unaffected (Priority: P3)

**Goal**: Zero regression for today's shapes: single pre-answer block, no-reasoning models, reasoning-disabled, critic corrections, projection exclusion (spec FR-005/006/010, SC-003).

**Independent Test**: Mock plain prompt (no marker) + scripted single-block streams render exactly as pre-029 (quickstart Scenario 2); full `pnpm test` green including all pre-existing reasoning tests unmodified.

### Tests for User Story 3 (write first; regression guards FAIL only if US1/US2 broke parity)

- [ ] T018 [P] [US3] Parity regression tests: in `src/lib/agent/loop.test.ts` — single reasoning block stream persists exactly `[reasoning, text]` with today's row shapes (byte-level metadata assertion modulo `anchored`); no-reasoning stream never calls `appendReasoning`; in `src/lib/chat/projection.test.ts` — anchored reasoning rows stay excluded from `projectEntries` output and consecutive `assistant_message` rows merge into one assistant turn; in `src/lib/chat/entries.test.ts` — reasoning-disabled/no-reasoning turn produces no thought entries.
- [ ] T019 [US3] Critic + generative-tool path tests in `src/lib/agent/loop.test.ts`: critic correction re-stream discards reasoning deltas (text-only, today's behavior — research.md D6); tool-call closes the open reasoning segment and the tool-boundary persist order (`appendReasoning < appendAssistantText < appendAssistantToolCall < appendToolResult` per iteration) is preserved.

### Implementation for User Story 3

- [ ] T020 [US3] Fix any parity breaks surfaced by T018/T019 in the owning files (`src/lib/agent/loop.ts`, `src/lib/stores/chat.svelte.ts`, `src/lib/chat/entries.ts`) — single-segment path must remain byte-identical to pre-029 row shapes and today's callback order; reasoning-disabled suppresses all thought entries (existing dialect/effort plumbing untouched). Expected outcome: usually no code change; this task is the verified parity gate.

**Checkpoint**: All user stories independently functional; full suite green.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Read-side niceties, docs, and end-to-end validation across stories.

- [ ] T021 [P] Diagnostics segments: add `reasoningSegments: string[]` to `TurnTrace.iterations[]` in `src/lib/agent/trace.ts` (keep concatenated `reasoning` for continuity; raw `reasoning-start/end` parts already flow into `partSequence`) and render per-segment entries in `src/lib/components/diagnostics/DiagnosticsPanel.svelte` (iteration `iter.reasoning` display site).
- [ ] T022 [P] Docs touch-up: verify whether `docs/explanation/architecture.qmd` / `docs/reference/seams.qmd` describe the reasoning display canonicalizer; if so, add the `anchored` ordering rule (anchored = position authoritative; legacy repair unchanged). No tool-map change (no agent/MCP tool surface).
- [ ] T023 Run full validation per `specs/029-micro-thoughts/quickstart.md`: Scenarios 1–4 on the dev stack (`pnpm dev` + mock LLM; optional Scenario 3 with a real OpenRouter GPT-6-Luna endpoint), perf spot-check with `window.__MAYON_PERF__ = 1` + `localStorage.mayon_perf_scenario = 'micro-thoughts'` (SC-004 pacing parity), then the gates: `pnpm check && pnpm lint && pnpm test`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1. BLOCKS all user stories. Within: T003 → T004 (callback contract); T002 and T005 are independent of both and of each other.
- **User Stories (Phases 3–5)**: All depend on Phase 2. US1 and US2 share the hot files `src/lib/agent/loop.ts` + `src/lib/stores/chat.svelte.ts` — run them SEQUENTIALLY (US1 → US2) to avoid same-file conflicts; their test tasks parallelize fine within each phase. US3 depends on US1 + US2 (it verifies their parity).
- **Polish (Phase 6)**: Depends on US1–US3; T021/T022 are mutually parallel.

### User Story Dependencies

- **User Story 1 (P1)**: after Phase 2 — no story dependencies.
- **User Story 2 (P2)**: after Phase 2 + US1 (shared files, sequential).
- **User Story 3 (P3)**: after US1 + US2 (regression verification of both).

### Within Each User Story

- Tests first (fail before implementation), then models/state → rendering/persistence → lifecycle/audit.
- T007 → T008 (same rendering seam); T012 → T013 → T016 (same persist seam); T014 independent of T012 (different file, needs T002).

### Parallel Opportunities

- Phase 2: T002 ∥ T005 (and both ∥ nothing else while T003→T004 run).
- US1: T006 ∥ T010 (different test files); implementation T007→T008→T009 sequential (same files).
- US2: T011 ∥ T015 ∥ T017 (different test files); T014 ∥ T012 (different files).
- US3: T018 ∥ T019 (different describes/files).
- Phase 6: T021 ∥ T022.

---

## Parallel Example: User Story 2

```bash
# Launch all US2 test tasks together (different files, fail-first):
Task: "Persist-walk tests in src/lib/agent/loop.test.ts"          # T011
Task: "Canonical-order tests in src/lib/chat/entries.test.ts"     # T015
Task: "Reload-fidelity test in src/lib/stores/chat.svelte.test.ts" # T017

# Then implementation: parallel pair (different files):
Task: "reorderTurn v2 in src/lib/chat/entries.ts"                 # T014
Task: "Block-walk persistence in src/lib/agent/loop.ts + chat.svelte.ts" # T012
# Then sequential: T013 (abort path, same files as T012) → T016 (audit)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T005) — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T006–T010)
4. **STOP and VALIDATE**: quickstart Scenario 1 (live half) against the mock; `pnpm test` green
5. Demo-ready: live interleaved micro-thoughts visible (persistence still flattened — acceptable demo state, noted at checkpoint)

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → live display (MVP)
3. US2 → persistence + reload fidelity + abort
4. US3 → verified zero regression for existing providers
5. Polish → diagnostics, docs, full quickstart validation

### Parallel Team Strategy

With multiple agents: Phase 2 is mostly sequential (T003→T004); pair one agent on T002/T005. Then a single agent owns US1→US2 (hot files), while a second agent can pre-write US2/US3 test tasks (T011/T015/T017/T018/T019) in parallel. US3 + Polish parallelize across agents.

---

## Notes

- [P] tasks = different files, no dependencies. Same-file tasks are deliberately NOT marked [P].
- Hot files this feature: `src/lib/agent/loop.ts`, `src/lib/stores/chat.svelte.ts` — nearly every story touches them; sequence within stories as listed.
- Do not modify `src/lib/chat/projection.ts` (FR-006: reasoning stays excluded; consecutive assistant rows already merge), `src/lib/chat/streaming/pacer.ts` (SC-004: pacing untouched), or the DB schema (no migration — `anchored` is additive metadata).
- Verify tests fail before implementing (fail-first within each story phase).
- Commit after each task or logical group; worktree branch `029-micro-thoughts` (worktree work is not destined for `main` unless the user asks).
- SvelteKit `+` prefix rule: no new route files involved; do not name test files with a leading `+`.
