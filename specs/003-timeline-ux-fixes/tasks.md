---
description: 'Task list for feature implementation'
---

# Tasks: Timeline UX Fixes

**Input**: Design documents from `/specs/003-timeline-ux-fixes/`

**Prerequisites**: plan.md, spec.md, research.md (verified root causes RC1–RC4b, decisions D1–D7), data-model.md, contracts/timeline-presentation.md, quickstart.md

**Tests**: REQUIRED for this feature — constitution §II ("every bug fix MUST ship with a regression test that fails without the fix") and contracts/timeline-presentation.md §Regression Bars mandate one regression per defect. Tests are written FIRST within each story and must FAIL on the 002 code.

**Organization**: Tasks grouped by user story (US1–US4 per spec.md priorities) so each story is independently implementable and testable. All work is presentation-layer + persist-order in the loop: no schema, no migration, no stored-row rewrites, no new dependencies, no `+` filenames.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths included; line numbers are anchors from research.md (verified 2026-08-20)

## Path Conventions

Single project (SvelteKit SPA + server). All edits are in existing files delivered by `specs/002-chat-timeline-kinds`, plus colocated test files (no `+` prefix, following `src/lib/components/chat/MessageRow.mount.test.ts` precedent for component source-contract tests).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Environment ready and manual regression corpus captured before any edit.

- [x] T001 Verify feature branch `003-timeline-ux-fixes` with clean tree; run `pnpm install`; ensure `@mayon/shared` is built (tsup → `packages/shared/dist/`) so `pnpm check`/`pnpm test` resolve its types (build-order constraint)
- [x] T002 Capture (or keep) the manual regression corpus on the `pnpm dev` stack per specs/003-timeline-ux-fixes/quickstart.md: one pre-fix symptom chat (reply before reasoning, PRESENT_CHOICES as failed tool call, spinner on completed replies) and one session with an MCP server connect+disconnect — these must look correct after the fix with zero data change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the green baseline every story's regressions are measured against.

- [x] T003 Record baseline gates on the branch: `pnpm check` (expect ONLY the 10 pre-existing `src/lib/mcp/server-stdio.test.ts` errors), `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test` — all green/at known baseline before any source edit; note the exact pre-existing error list for the final diff

**Checkpoint**: Baseline recorded — user story implementation can now begin (US1/US2/US3 in parallel if staffed; US4 after US3)

---

## Phase 3: User Story 1 — Diagnostics duplicate-key crash fixed (Priority: P1) 🎯 MVP

**Goal**: The diagnostics panel renders any captured log — including repeated lifecycle events for the same server — without crashing, unblocking chat navigation and diagnostics sharing.

**Independent Test**: Open the diagnostics panel for a session whose log contains two lifecycle events for the same server (connect then disconnect, T002 corpus): the panel opens, both events render as separate rows, no `each_key_duplicate` error, chats open normally.

### Tests for User Story 1 (write FIRST — must fail on current code)

- [x] T004 [P] [US1] Add regression test in `src/lib/components/diagnostics/DiagnosticsPanel.keys.test.ts` (new file, no `+` prefix) asserting the MCP-events `{#each}` key expression guarantees uniqueness for repeated identical `(kind, serverId)` events — source-contract pattern per `src/lib/components/chat/MessageRow.mount.test.ts` (current key `ev.kind + ev.serverId` at DiagnosticsPanel.svelte:534 fails the assertion)

### Implementation for User Story 1

- [x] T005 [US1] Fix the MCP events each-key in `src/lib/components/diagnostics/DiagnosticsPanel.svelte:534` to include the loop position — `(ev.kind + ev.serverId + '@' + i)` — mirroring the neighboring tool-results loop's existing `${tr.toolCallId}@${tri}` pattern (line 516)
- [x] T006 [US1] Audit every other keyed `{#each}` loop in `src/lib/components/diagnostics/DiagnosticsPanel.svelte` for the same duplicate-key class; qualify any key that can repeat for identical entries (stable semantic parts first, position suffix last) per contracts/timeline-presentation.md §Diagnostics rows contract

**Checkpoint**: Regression bar 6 green; panel opens on the T002 reconnected-MCP session with distinct rows

---

## Phase 4: User Story 2 — Spinner tells the truth (Priority: P1)

**Goal**: Pending/streaming indicators appear only while a reply is actually in flight; completed replies, past chats, and post-reload renders never show a spinner.

**Independent Test**: Open the completed past chat from T002 and reload — no spinner anywhere; send a new prompt — the spinner appears while streaming and disappears the moment the durable reply replaces the live one.

### Tests for User Story 2 (write FIRST — must fail on current code)

- [x] T007 [P] [US2] Add regression test in `src/lib/components/chat/rows/AssistantMessage.spinner.test.ts` (new file, colocated, no `+` prefix) asserting the orbit-spinner label row and the "Thinking…" body are guarded to live items only — durable rows (`live === false`) never render either indicator (current guard `!pending && visible` at AssistantMessage.svelte:71 fails the assertion; source-contract pattern per `src/lib/components/chat/MessageRow.mount.test.ts`)

### Implementation for User Story 2

- [x] T008 [US2] Guard the orbit spinner and "Thinking…" state in `src/lib/components/chat/rows/AssistantMessage.svelte` to render only when `live === true` (guard becomes `live && !pending && visible`; `pending` already implies live) per research.md D1 — one-token-class change restoring pre-002 semantics

**Checkpoint**: Regression bar 7 green; completed past chats and reloads show zero indicators

---

## Phase 5: User Story 3 — Deterministic turn order (Priority: P1)

**Goal**: Every turn — including chats already stored in the buggy order — renders per iteration as reasoning → assistant text → tool activity, and new turns are PERSISTED in that order so display and storage agree going forward.

**Independent Test**: Open the T002 symptom chat (reply rendered before its reasoning, offer trailing the turn): it now displays reasoning → reply → choices offer with no data rewrite; a fresh multi-iteration tool turn stores reasoning before its iteration's text (verify `ord` if convenient).

### Tests for User Story 3 (write FIRST — must fail on current code)

- [x] T009 [P] [US3] Add persist-order assertions to `src/lib/agent/loop.test.ts`: for a tool-carrying iteration, the reasoning row is appended before the text and tool-call rows (assert repo append order); cover the finish, tool-continuation, and stream-abort paths — fails on current order text → tool call → reasoning (loop.ts:396-397, :405, :578-581, :588-590)
- [x] T011 [P] [US3] Add reorder-pass regressions to `src/lib/chat/entries.test.ts`: `[text, reasoning]` becomes `[reasoning, text]` within a turn; already-canonical order is a no-op including multi-iteration turns (thinking → tool → thinking → final text stays grouped per iteration, never flattened); no item ever moves across a `user_message` boundary — fails while the pass does not exist

### Implementation for User Story 3

- [x] T010 [US3] Fix persist order in `src/lib/agent/loop.ts`: persist each iteration's reasoning immediately after `consumeStream` returns (before the finishReason branch at ~:372), keeping per-iteration `reasoningBuf`; remove the deferred `appendReasoning` sites (~:578-581 allTerminal, ~:588-590 budget — now redundant/double-persist risk); make the stream-abort path (~:363-369) persist reasoning before partial text, matching the pre-stream abort path (:228-236) — resulting storage per iteration: `[reasoning?, text?, tool_call, tool_result]` per research.md D3
- [x] T012 [US3] Implement the stable within-turn canonical reorder pass inside `assembleTimeline` in `src/lib/chat/entries.ts` per research.md D5: split at `user_message` boundaries; a `reasoning` entry positioned after an `assistant_message` with no tool activity between them moves to immediately before that assistant message; no other moves; O(n), stays inside `assembleTimeline` (no per-render recomputation — it is already called from a `$derived`)

**Checkpoint**: Regression bars 4 and 5 green; stored-before-fix chats display canonically with zero stored-row modifications

---

## Phase 6: User Story 4 — Honest terminal tool presentation (Priority: P2)

**Goal**: Tool pairing works in production (keyed by `toolCallId`), choices render as offers in place, unpaired calls sit at their own position, orphan results stay visible, and terminal tools never show a failure mark — while genuine gaps keep theirs.

**Independent Test**: Trigger the pacing-choices flow: the offer renders with options (taken option marked when selected), no red X, no "No result recorded"; abort a turn mid-way through a normal tool call: the failure mark remains; a normal call+result renders as ONE grouped unit at the result's position (pairing-key repair).

**Depends on**: US3 (entries.ts changes land sequentially in the same file; spec notes US4 tests are clean only after Story 3's dispatch/order fixes).

### Tests for User Story 4 (write FIRST — must fail on current code)

- [x] T013 [US4] Rewrite the fixtures in `src/lib/chat/entries.test.ts` so every tool-carrying row has DISTINCT `id` and `toolCallId` strings (current fixtures' equality masked RC4b per research.md D7) and add the production-shaped pairing regression: a `tool_call` + `tool_result` with distinct ids group as ONE `ToolGroup` at the result's position — fails on current map keyed by `msg.id` (entries.ts:115)
- [x] T014 [US4] Add dispatch regressions to `src/lib/chat/entries.test.ts`: a `kind === 'choices'` row becomes a `DurableEntry` at its stored position (never a `ToolGroup`); its legacy paired `tool_result` is suppressed; an orphan `tool_result` (no visible call) renders visibly — all fail on current routing of choices into the pairing map (entries.ts:114-117)
- [x] T017 [US4] Add the terminal-presentation regression in `src/lib/components/chat/rows/ToolActivity.terminal.test.ts` (new file) or as a presentation-mapped assertion in `src/lib/chat/entries.test.ts`: an unpaired call for a registry-terminal tool carries NO failure state and no "No result recorded", an unpaired non-terminal call KEEPS both, and the classification is sourced exclusively from `$lib/agent/registry` (no UI-side tool-name list) — fails on current unconditional failure presentation

### Implementation for User Story 4

- [x] T015 [US4] Repair pairing and dispatch in `src/lib/chat/entries.ts` per research.md D4.1: key the `byToolCallId` map with `msg.toolCallId` (never `msg.id`); route `kind === 'choices'` rows out of the tool path into `DurableEntry` items rendered in place by `ChoicesOffer` (the MessageList.svelte:170 branch becomes live code); track choices `toolCallId`s in a `Set` so legacy paired results fold under the offer (suppressed, not orphaned)
- [x] T016 [US4] Remove the end-of-timeline flush in `src/lib/chat/entries.ts` (:127-134) and place groups at their stored position per research.md D4.2/D4.3: an unpaired non-choices `tool_call` emits a `ToolGroup` with `result: null` at the call's own position; an orphan `tool_result` renders visibly via result-only presentation (add an optional result-only mode to `src/lib/components/chat/rows/ToolActivity.svelte` or a minimal orphan renderer, plus the matching dispatch branch in `src/lib/components/chat/MessageList.svelte`) — never invisible
- [x] T018 [US4] Implement terminal-aware status in `src/lib/components/chat/rows/ToolActivity.svelte` per research.md D6 and the contract's status table: consult `getToolDefinition(call.toolName)?.terminal === true` imported from `$lib/agent/registry`; unpaired terminal → neutral/muted tool glyph, no fail icon, no "No result recorded"; unpaired non-terminal → existing fail mark + message (genuine gap); paired results keep ok/fail marks regardless of terminality

**Checkpoint**: Regression bars 1, 2, 3 green; quickstart.md §4 scenarios all pass including legacy-chat offer rendering

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the whole feature against the constitution gates and the no-scope-creep contract.

- [ ] T019 Perform manual validation of all four fixes on the `pnpm dev` stack per specs/003-timeline-ux-fixes/quickstart.md sections 1–5, using the T002 regression corpus (pre-fix symptom chat must render correctly with zero data change)
- [x] T020 [P] Review the full `git diff` for scope invariants: no schema/migration changes, no stored-row rewrites, no new dependencies, no `+`-prefixed filenames, 002 golden projection fixtures untouched, terminal classification only from the tool registry
- [x] T021 Run all quality gates: `pnpm check` (zero NEW errors vs the T003 baseline of 10 pre-existing `server-stdio.test.ts` errors), `pnpm lint`, `pnpm test` (all regressions + 002 golden fixtures green), `pnpm --filter @mayon/server test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (baseline must be recorded)
- **User Stories (Phases 3–6)**: All depend on Phase 2. US1, US2, US3 are mutually independent (disjoint files) and can proceed in parallel; **US4 depends on US3** (same file `src/lib/chat/entries.ts` edited sequentially, and spec.md notes US4's clean test needs Story 3's dispatch/order fixes first)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: After Phase 2 — no dependencies on other stories (touches only `DiagnosticsPanel.svelte` + its test)
- **User Story 2 (P1)**: After Phase 2 — no dependencies on other stories (touches only `AssistantMessage.svelte` + its test)
- **User Story 3 (P1)**: After Phase 2 — no dependencies on other stories (touches `loop.ts`, `entries.ts`, `entries.test.ts`, `loop.test.ts`)
- **User Story 4 (P2)**: After Phase 2 **and after US3** — `entries.ts`/`entries.test.ts` are shared with US3 and edited after it

### Within Each User Story

- Tests written and FAILING before implementation (constitution §II)
- Test task before its implementation task in the same story
- US4: fixture rewrite (T013) before dispatch tests (T014); pairing/dispatch implementation (T015–T016) after both; terminal test (T017) before terminal implementation (T018)

### Parallel Opportunities

- Setup: T001 → T002 sequential (corpus needs the running dev stack)
- After Phase 2: **US1, US2, US3 can run in parallel** (disjoint files)
- Cross-story tests: T004 (`DiagnosticsPanel.keys.test.ts`), T007 (`AssistantMessage.spinner.test.ts`), T009 (`loop.test.ts`) + T011 (`entries.test.ts`) all in parallel
- Polish: T019 and T020 in parallel; T021 last

---

## Parallel Example: Post-Foundational Test Batch

```bash
# Launch the failing-first tests for three independent stories together:
Task: "T004 [P] [US1] Regression test in src/lib/components/diagnostics/DiagnosticsPanel.keys.test.ts"
Task: "T007 [P] [US2] Regression test in src/lib/components/chat/rows/AssistantMessage.spinner.test.ts"
Task: "T009 [P] [US3] Persist-order assertions in src/lib/agent/loop.test.ts"
Task: "T011 [P] [US3] Reorder-pass regressions in src/lib/chat/entries.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational baseline
3. Complete Phase 3: US1 — the hard crash that blocks opening chats and reporting the other defects
4. **STOP and VALIDATE**: diagnostics opens on the reconnect session; no `each_key_duplicate`
5. Deploy if the crash is the burning issue

### Incremental Delivery

1. Setup + Foundational → baseline recorded
2. US1 → validate independently (crash gone) — MVP
3. US2 → validate independently (spinner honest on past chats + live)
4. US3 → validate independently (canonical order, old chats unrewritten, new turns stored canonically)
5. US4 → validate independently (offers render as offers, pairing repaired, terminal tools honest)
6. Polish → quickstart end-to-end + gates green

### Parallel Team Strategy

With multiple developers after Phase 2:

- Developer A: US1 (DiagnosticsPanel.svelte)
- Developer B: US2 (AssistantMessage.svelte)
- Developer C: US3 (loop.ts + entries.ts)
- Then C (or another) picks up US4 after US3's entries.ts work lands

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map to spec.md user stories for traceability
- Line numbers reference research.md's verified anchors (2026-08-20); re-locate if drift is found
- Presentation-only for historical rendering: stored ids, `ord`, branch references, expound offsets are immutable
- Provider context untouched — 002 golden equivalence tests must pass unmodified
- No `+` filename prefixes; Svelte 5 runes style; zero new dependencies
