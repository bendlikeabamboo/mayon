---
description: 'Task list for feature implementation'
---

# Tasks: Internal Area Unification

**Input**: Design documents from `/specs/004-internal-area-unification/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: INCLUDED — mandated by constitution §II (every bug fix ships a failing-first regression) and research D9. Write each test first, confirm it FAILS on current code, then implement.

**Organization**: Tasks grouped by user story (US1–US5) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Exact file paths in every description

## Path Conventions

Single-repo SvelteKit SPA: `src/lib/…` (app code), colocated `*.test.ts`. No backend/frontend split.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline verification and regression fixtures

- [x] T001 Verify clean baseline and prepare fixtures: run `pnpm install`, ensure `@mayon/shared` is built (fresh-checkout build order), then confirm `pnpm check`, `pnpm lint`, and `pnpm test` are green before any change. On the dev stack (`pnpm dev`), keep the reported brave-search MCP chat and a gated-curriculum chat as manual regression fixtures — both must render correctly after the feature with **no data change** (per quickstart.md prerequisites)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Additive data plumbing shared by US2 (failed status) and US5 (trace) — no schema migration

- [x] T002 [P] Add failing-first regression in `src/lib/db/repositories/repositories.test.ts`: `appendToolResult` round-trips `ok` into metadata JSON (`{ …detail, ok: false }` when provided, unchanged metadata when omitted). Then implement: add `ok?: boolean` to `ToolResultMeta` in `src/lib/chat/kinds.ts` and an `ok?: boolean` option on `appendToolResult` in `src/lib/db/repositories/messages.ts`, merged into the metadata JSON at write time. New rows only — no backfill, no migration (FR-009)
- [x] T003 Extend `src/lib/agent/loop.ts` appendToolResult call site (the `results` flush loop, ~line 558) to pass `ok: entry.result.ok`, and add the assertion to `src/lib/agent/loop.test.ts` that a failed tool result persists `ok: false` (fails before T002's repo change is wired through). Depends on T002

**Checkpoint**: Data layer carries `ok`; user story implementation can begin

---

## Phase 3: User Story 1 - One authoritative copy of each assistant text segment (Priority: P1) 🎯 MVP

**Goal**: The pre-tool text segment renders exactly once — during streaming, at the tool-call boundary, through the approval wait, and after completion (FR-001, research D1/RC1, contract timeline-assembly.md R1)

**Independent Test**: Trigger a text→high-risk-tool turn and freeze on the approval ask: the sentence appears exactly once; still once after the turn completes (quickstart.md US1)

### Tests for User Story 1

- [x] T004 [P] [US1] Failing-first regression in `src/lib/stores/chat.svelte.test.ts`: after `appendAssistantText` persists a segment (boundary persist via a tool-carrying turn fixture), `streamBuffer` AND `streamBufferRender` are empty while `streaming` is still true — fails today (buffers keep the stale text)
- [x] T005 [P] [US1] Failing-first regression in `src/lib/chat/entries.test.ts`: a boundary-persisted `assistant_message` row plus live items `[live_text(buffer: '')]` (the post-fix store state) renders exactly one text copy and the quiet pending live bubble; include the pre-fix store-state fixture (`live_text(buffer: <same text>)`) asserting it is NOT produced by the store contract. Fixtures use distinct `id`/`toolCallId` (003 lesson)

### Implementation for User Story 1

- [x] T006 [US1] Implement D1 in `src/lib/stores/chat.svelte.ts` `appendAssistantText` (~line 418): after appending the row and updating `this.messages`, clear `this.streamBuffer` and `this.streamBufferRender`. No `assembleTimeline` dedup (contract R1 — the invariant lives in the store). Verify the abort path in `send`'s `finally` still behaves (persisted content guards the empty re-append)

**Checkpoint**: US1 independently testable — no duplicate text during approval waits

---

## Phase 4: User Story 2 - Tool calls awaiting a decision read as pending (Priority: P1)

**Goal**: Derived status vocabulary (awaiting/running/declined/failed/succeeded + kept 003 genuine-gap/terminal) with honest presentation (FR-002/FR-003, research D3/D4/RC3+RC7, contracts timeline-assembly.md R3 + tool-activity-status.md)

**Independent Test**: Freeze on an approval ask: waiting presentation, no red X, no "No result recorded"; declined is distinct; genuine-gap and failed fixtures keep their marks (quickstart.md US2)

### Tests for User Story 2

- [x] T007 [P] [US2] Failing-first regressions in `src/lib/chat/entries.test.ts` for derivation contract R3: (a) approval row with `outcome: null` or `decision: 'undecided'` → `awaitingDecision`; (b) live `pendingApprovals` toolCallId → `awaitingDecision`; (c) `decision: 'declined'` → `declined` (with `aborted: true` folded); (d) unpaired non-terminal + streaming → `running`, not streaming → genuine gap (003 marker kept); (e) paired result `ok: false` → failed; legacy row without `ok` → succeeded; (f) unpaired terminal stays neutral
- [x] T008 [P] [US2] Failing-first component regression in `src/lib/components/chat/rows/ToolActivity.status.test.ts` (new file, follow the source-inspection style of `ToolActivity.terminal.test.ts` plus presentation-mapped assertions): awaiting → waiting cue with NO failure icon and NO "No result recorded"; declined distinct from failed; running neutral; classification sourced only from `$lib/agent/registry` (no UI-side tool-name list)

### Implementation for User Story 2

- [x] T009 [US2] Implement the derivation in `src/lib/chat/entries.ts`: pre-scan `kind: 'approval'` rows by `toolCallId` (undecided/declined/aborted map per data-model §2), union live pending-approval toolCallIds, add additive `awaitingDecision`/`declined`/`running` fields to `ToolGroup`, accept a `streaming` boolean argument, and have `src/lib/components/chat/MessageList.svelte` pass its existing `streaming` prop through. Precedence order per contract R3; 003 genuine-gap/terminal rules untouched
- [x] T010 [US2] Implement status-driven presentation in `src/lib/components/chat/rows/ToolActivity.svelte` per the contract table: awaiting (amber hourglass/pulse + "Waiting for your approval", never gap marker), running (muted pulsing, no marker), declined/aborted (muted struck + label), failed (red X via `ok === false` on new rows), succeeded (green check); lucide icons + existing quiet-row vocabulary only. Depends on T009

**Checkpoint**: US2 independently testable — pending never reads as failed

---

## Phase 5: User Story 3 - Tool results compact and collapsed by default (Priority: P1)

**Goal**: One truncated summary line + collapsed-by-default bounded expander for large payloads, presentation-only (FR-004/FR-005, research D5/RC4, contract tool-activity-status.md)

**Independent Test**: Open the reported brave-search chat: one-line truncated summaries, bounded expandable payloads, zero data change (quickstart.md US3)

### Tests for User Story 3

- [x] T011 [P] [US3] Failing-first regression in `src/lib/components/chat/rows/ToolActivity.collapse.test.ts` (new file): an 8KB payload fixture renders a single truncated line (CSS `truncate` applied) with a "Show result" expander, collapsed by default; expanded content sits in a bounded scrollable container (`max-h-* overflow-y-auto`); a short deterministic summary renders unchanged with no expander; threshold ≈160 chars

### Implementation for User Story 3

- [x] T012 [US3] Implement in `src/lib/components/chat/rows/ToolActivity.svelte`: clamp the summary line with Tailwind `truncate` (single line, ellipsis — no content mutation); render the "Show result" expander when content length exceeds the threshold or structured detail exists; expanded view shows full content (and detail JSON when present) inside the existing bounded `<pre class="max-h-60 overflow-y-auto …">` pattern, collapsible again. Stored content and provider context untouched. Same file as T010 — run after it

**Checkpoint**: US3 independently testable — no more walls of text

---

## Phase 6: User Story 4 - Assistant-initiated interaction lives only in the internal area (Priority: P2)

**Goal**: Tappable choices offers in the timeline, asks at their chronological position, compose area input-only (FR-006/FR-007, research D2/D6/D7/RC2+RC6, contracts interactive-surfaces.md + timeline-assembly.md R2)

**Independent Test**: Run the pacing flow end-to-end from the timeline offer; compose shows no chips/progress in any state; taken choice survives reload (quickstart.md US4)

### Tests for User Story 4

- [x] T013 [P] [US4] Failing-first regression in `src/lib/chat/entries.test.ts` for merge contract R2: a durable ask row with a matching `live_ask` (`payload.rowId === row.id`) emits the live item AT the row's position and suppresses both the durable entry and the tail append; non-matching asks and `live_text`/`live_reasoning` behave as today — exactly one ask surface per pending ask
- [x] T014 [P] [US4] Failing-first store/component regression (extend `src/lib/stores/chat.svelte.test.ts` or a `MessageList`-level test): active-gate offer (entry id === `findGateFromMessages` hit, `!streaming`) is tappable and tapping calls `chatStore.send(option, { choicesEntryId: entry.id })`; a taken choice deactivates the gate; while `streaming` no offer is tappable; `src/lib/components/chat/Composer.svelte` source contains no suggestion-chip rendering (source-inspection assertion)

### Implementation for User Story 4

- [x] T015 [US4] Implement the live-ask merge in `src/lib/chat/entries.ts` per contract R2: when emitting a durable `approval|sampling|elicitation` row, substitute its matching live item at the row's chronological position and drop it from the tail append; all other live items still append at the tail. Depends on T009 (same file, later section)
- [x] T016 [US4] Wire the active gate in `src/lib/components/chat/MessageList.svelte`: derive `activeGate = !streaming ? findGateFromMessages(messages) : null` (import from `$lib/ai/generate/generate-gate`), pass an `onSelect` callback to `ChoicesOffer` when `item.entry.id === activeGate.entryId`
- [x] T017 [US4] Implement interactive mode in `src/lib/components/chat/rows/ChoicesOffer.svelte` per the state machine in data-model §6: options as tappable buttons (chip styling, focus/hover) when active; `onSelect(option)` → `chatStore.send(option, { choicesEntryId: entry.id })`; read-only with taken option marked otherwise. Depends on T016's prop contract
- [x] T018 [US4] Strip the compose area in `src/lib/components/chat/Composer.svelte` (remove `suggestedReplies` prop, chip row, `sendChip`, gate `progress` prop/meta) and `src/routes/chat/[id]/+page.svelte` (remove `gate`/`suggestedReplies` derivations and prop wiring; `onSend` keeps its `choicesEntryId` source from the offer path). Artifact nav chips stay (out of scope)

**Checkpoint**: US4 independently testable — one place, one way to respond

---

## Phase 7: User Story 5 - The request trace reflects what was actually sent (Priority: P3)

**Goal**: Trace the projected wire payload — system once, tool identity preserved (FR-008, research D8/RC5, contract request-trace.md)

**Independent Test**: Capture a trace with a choices offer + tool call: system once, choices row identified as tool interaction, sequence matches the projection (quickstart.md US5)

### Tests for User Story 5

- [x] T019 [P] [US5] Failing-first regression in `src/lib/agent/loop.test.ts`: for a fixture turn containing a choices row and a tool call, the `request` trace event's `messages` contain zero `role: 'system'` entries; the system string appears exactly once in the event; the choices row carries `kind`/`toolName` annotations (not a bare assistant text); the message sequence equals `projectEntries(ctx)` for the same fixture

### Implementation for User Story 5

- [x] T020 [US5] Widen `src/lib/agent/trace.ts` additively: `TracedRequestMessage { role; content; toolCallId?; toolName?; kind? }` on `TraceEvent['request'].messages` and `IterationState.request.messages` — old traces stay valid
- [x] T021 [US5] Switch the `request` emission in `src/lib/agent/loop.ts` (~line 260) to trace the already-computed `messages` from `projectEntries(ctx)` (line 244), mapping each projected message to `{ role, content, toolCallId?, toolName?, kind? }` from its source row. `system` stays the single system-prompt source. Depends on T020; same file as T003 — run after it

**Checkpoint**: US5 independently testable — diagnostics stop lying

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Gates, manual validation, perf evidence, documentation

- [x] T022 Run all quality gates: `pnpm check`, `pnpm lint`, `pnpm test` (golden equivalence tests pass UNMODIFIED — any golden failure means provider-visible context changed and must be fixed before merge), and `pnpm --filter @mayon/server test`
- [ ] T023 Execute the full `specs/004-internal-area-unification/quickstart.md` walkthrough on the dev stack across all five stories, including the legacy-chat checks (no data change) and reload-mid-approval check
- [ ] T024 Measure with the perf probe (`window.__MAYON_PERF__ = 1`, `localStorage.mayon_perf_scenario = 'mcp-approval'`) before/after on the brave-search chat: frame timing, longtasks, `TimelineRow` render counts during the approval wait and result render; record the numbers in the PR (constitution IV — no unmeasured perf claims)
- [x] T025 [P] Document the new contracts in `docs/dev/seams.qmd`: compose-area input-only rule, tool-activity status vocabulary + derivation source, ask merge rule, trace-fidelity rule — pointing at `specs/004-internal-area-unification/contracts/` for detail

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: after Setup; T003 depends on T002
- **User Stories (Phases 3–7)**: after Foundational; independently testable, but note the same-file chains below
- **Polish (Phase 8)**: after all desired stories complete

### User Story Dependencies

- **US1 (P1)**: store-only (`chat.svelte.ts`) — no story dependencies. **MVP**
- **US2 (P1)**: consumes Foundational `ok` (T002/T003); touches `entries.ts` + `MessageList.svelte` + `ToolActivity.svelte`
- **US3 (P1)**: touches `ToolActivity.svelte` — run after US2's T010 (same file)
- **US4 (P2)**: touches `entries.ts` — run after US2's T009 (same file); benefits from US1–US3 for a coherent lane (spec notes this)
- **US5 (P3)**: touches `loop.ts` — run after Foundational T003 (same file); otherwise independent

### Within Each User Story

- Tests written first and FAILING before implementation (constitution II)
- Derivation/pure functions before components that consume them
- Golden tests are never modified

### Parallel Opportunities

- Test authoring across different files: T004 ∥ T005 ∥ T007 ∥ T008 ∥ T011 ∥ T013 ∥ T014 ∥ T019 (all [P])
- T002 ∥ any US1 task (different files)
- US1 ∥ US5 after Foundational (disjoint files)
- T016 ∥ T018 after T015 (MessageList+ChoicesOffer chain vs Composer+page strip — different files)
- T025 ∥ T022–T024

---

## Parallel Example: User Story 2

```bash
# Launch the failing-first tests together (different files):
Task: "T007 entries derivation regressions in src/lib/chat/entries.test.ts"
Task: "T008 status presentation regressions in src/lib/components/chat/rows/ToolActivity.status.test.ts"

# Then implement sequentially (derivation feeds presentation):
Task: "T009 derivation in src/lib/chat/entries.ts + MessageList streaming arg"
Task: "T010 status presentation in src/lib/components/chat/rows/ToolActivity.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T003)
3. Complete Phase 3: US1 (T004–T006)
4. **STOP and VALIDATE**: duplicate-text regression green; quickstart US1 walkthrough passes
5. Ship/demo if desired — the most visible dishonesty is fixed

### Incremental Delivery

1. Setup + Foundational → data layer carries `ok`
2. +US1 → duplicate text gone (MVP!)
3. +US2 → pending reads as pending
4. +US3 → walls of text collapsed
5. +US4 → interaction unified in the internal lane
6. +US5 → honest diagnostics; then Polish (gates, perf numbers, docs)

### Parallel Team Strategy

- Dev A: US1 → US5 (store, then agent/trace files)
- Dev B: US2 → US3 (entries → ToolActivity chain)
- Dev C: US4 after US2's entries change lands (merge + offer + composer strip)

---

## Notes

- [P] = different files, no dependencies; same-file chains called out explicitly (T003→T021, T009→T015, T010→T012)
- Every bug fix ships its failing-first regression (constitution II); fixtures always use distinct `id`/`toolCallId` (003 fixture-bias lesson)
- Stored rows, provider context, and golden tests are frozen (FR-009) — any golden failure is a stop-the-line defect
- Commit after each task or logical group; stop at any checkpoint to validate independently
