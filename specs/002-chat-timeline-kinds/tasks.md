---
description: 'Task list for feature implementation'
---

# Tasks: Chat Timeline Kind Model

**Input**: Design documents from `/specs/002-chat-timeline-kinds/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included inline per constitution §II (new behavior in `src/lib` and `server/src` MUST ship with tests; FR-019) — colocated `.test.ts` files, matching repo convention. Do not use `+` filename prefixes (SvelteKit reserved).

**Organization**: Tasks grouped by user story (spec.md P1–P5). Shared pre-story work is in Setup/Foundational; the schema migration opens US2 because US1 is deliberately DB-change-free.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Pre-rewrite baselines that must be captured before any assembly/render change

- [ ] T001 [P] Capture perf baseline on a tool-heavy legacy chat with the perf probe (`window.__MAYON_PERF__ = 1`, `localStorage.mayon_perf_scenario = 'tool-heavy-timeline'`) and record the `[mayon-perf]` summary in specs/002-chat-timeline-kinds/notes/perf-baseline.md (constitution IV)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Golden fixtures proving provider-context equivalence — MUST be captured against the CURRENT `toCoreMessages` before any change touches context assembly (research D7)

- [x] T002 Build the golden fixture corpus and capture the current output: create fixture entries + expected `ModelMessage[]` snapshots in src/lib/chat/golden/ covering plain turns, tool call + JSON result, tool call + text result, legacy `present_choices` pair + tapped chip, hidden prompt, branch-walk ordering, and adjacent-same-role merge shapes; add a capture test in src/lib/chat/projection.test.ts that asserts current `toCoreMessages` (src/lib/chat/context.ts) reproduces every fixture (to be retargeted to `projectEntries` in US3)

**Checkpoint**: Baselines locked (perf + golden). User story work can begin.

---

## Phase 3: User Story 1 - Uniform, readable tool activity (Priority: P1) 🎯 MVP

**Goal**: Entry-kind model, TimelineItem assembly, and the single kind→presentation registry; `MessageRow`'s role ladder deleted. Kinds temporarily DERIVED from legacy columns — no DB change.

**Independent Test**: Open a pre-existing tool-heavy chat: grouped tool units (header + summary + collapsed-by-default detail), no blank rows, no muted walls, registry is the only presentation path (quickstart §2).

### Implementation for User Story 1

- [x] T003 [P] [US1] Create src/lib/chat/kinds.ts: `EntryKind` union (10 kinds), `laneOf(kind)` derivation, `deriveKind(message)` implementing the D10 legacy case table (contracts/entry-kinds.md § Backfill), and `kindOf(message)` resolver (derivation-only until US2 flips it)
- [x] T004 [P] [US1] Create src/lib/chat/kinds.test.ts: every D10 rule, edge rows (empty tool-call bookkeeping, `present_choices` pair, hidden user row, `role='system'`), lane mapping for all 10 kinds
- [x] T005 [P] [US1] Create src/lib/chat/entries.ts: `TimelineItem` union (`DurableEntry | ToolGroup | LiveEntry` per data-model.md), `assembleTimeline(messages)` pairing `tool_call`+`tool_result` by `toolCallId`, hide rules (hidden user rows, choices-paired results, empty standalone tool calls)
- [x] T006 [P] [US1] Create src/lib/chat/entries.test.ts: pairing, unpaired call ("no result recorded"), orphan result, hide rules, ord ordering
- [x] T007 [P] [US1] Create src/lib/chat/presentation.ts: the kind→presentation registry exactly per contracts/presentation-registry.md (lane, collapsible, collapsedByDefault, renderer id)
- [x] T008 [P] [US1] Create src/lib/chat/presentation.test.ts: registry completeness (all 10 kinds + live variants + ToolGroup), no presentation attribute stored per row (type-level)
- [x] T009 [P] [US1] Create src/lib/components/chat/rows/UserMessage.svelte and src/lib/components/chat/rows/AssistantMessage.svelte (Markdown + Highlighter + branch/regenerate affordances, legacy `metadata.reasoning` decoration toggle, `live` prop stub for US4)
- [x] T010 [P] [US1] Create src/lib/components/chat/rows/ReasoningEntry.svelte and src/lib/components/chat/rows/SelfCorrected.svelte (internal lane, quiet, collapsible, `live` prop stub)
- [x] T011 [P] [US1] Create src/lib/components/chat/rows/ToolActivity.svelte: grouped unit — header (tool name, ok/fail), one-line summary, structured detail from `metadata.detail` collapsible and collapsed by default (fixes the wall of text)
- [x] T012 [P] [US1] Create src/lib/components/chat/rows/AskEntry.svelte (render-only outcome states: pending/approved/declined/allowed/denied/answered/undecided) and src/lib/components/chat/rows/ChoicesOffer.svelte (read-only option chips, taken option marked when linked reply exists)
- [x] T013 [US1] Rewrite src/lib/components/chat/MessageList.svelte: assemble via `assembleTimeline` and dispatch through the presentation registry (depends on T003–T012; keep `LazyMount` virtualization and `incRender` counters; move `isHidden` filtering into entries hide rules)
- [x] T014 [US1] Delete src/lib/components/chat/MessageRow.svelte once unreferenced (verify with grep for imports; remove its role ladder and `bubbleClass` map for good)

**Checkpoint**: US1 done — legacy chats render entirely through the registry; `pnpm check`/`pnpm lint`/`pnpm test` green; manual smoke per quickstart §2. MVP deliverable.

---

## Phase 4: User Story 2 - Honest history that survives reload (Priority: P2)

**Goal**: `kind` column + stamped v1→v2 backfill migration (derivation flipped off), then durable asks/sampling/elicitations with outcomes, per-iteration reasoning, and single-entry `choices` offers with linked chip replies.

**Independent Test**: Turn with approval (approve), choice offer (tap chip), multi-iteration reasoning → reload → outcomes/selection/attribution all visible (quickstart §3); migration backfills 100% of legacy rows with zero ID changes (quickstart §1).

### Implementation for User Story 2

- [x] T015 [US2] Add the `kind` column: extend `messages` in src/lib/db/schema.ts (`text` enum of the 10 kinds, nullable at add time) and generate the ALTER via `pnpm db:generate` into drizzle/ (generated filename; no hand-edited SQL — constitution Gates)
- [x] T016 [US2] Implement the v1→v2 migration in server/src/schema-migrations.ts: bump `SCHEMA_VERSION` to 2 in packages/shared/src/schema-version.ts, register the additive descriptor `{from:1, to:2, hasMigrate:true}`, and write `migrate(client)` per contracts/migration-v2.md — ordered backfill UPDATEs from the D10 case table guarded by `WHERE kind IS NULL`, completeness assertion (`count(kind IS NULL) = 0` else throw), then `SET NOT NULL`; rebuild `@mayon/shared`
- [x] T017 [P] [US2] Create server/src/schema-migrations.test.ts: fixture rows for all 7 D10 rules, unclassifiable-row failure (loud, transactional), idempotent re-run (no-op), NOT NULL enforced, `content`/`ord`/`id` untouched (search_vec stability)
- [x] T018 [US2] Add the boot-time data-migration runner in server/src/server.ts (research D2): after `runPgMigrations` + FTS bootstrap and BEFORE the stamp, read `settings.schemaVersion`; if it lags, run pending `SCHEMA_MIGRATIONS` entries (each in its own transaction; failure → pg not ready + loud log), then stamp; cover in server/src/server.test.ts
- [x] T019 [US2] Flip derivation and make writes kind-aware: `kindOf` in src/lib/chat/kinds.ts prefers stored `kind`; extend src/lib/db/repositories/messages.ts so `append`/`appendToolResult` persist explicit kinds (incl. role-authoring rules from contracts/entry-kinds.md) and add `updateOutcome(id, outcome)`; update src/lib/db/repositories/repositories.test.ts
- [x] T020 [P] [US2] Add the kind filter to message search in src/lib/db/repositories/search.ts (`kind IN ('user_message','assistant_message')` — research D9) and update src/lib/db/repositories/search.test.ts
- [x] T021 [US2] Per-iteration reasoning in src/lib/agent/loop.ts: reset the reasoning buffer at each iteration boundary, add `appendReasoning(iteration, text)` to `AgentTurnDeps`, persist a `reasoning` entry (metadata `{iteration, model?}`) at iteration end, stop writing `metadata.reasoning` onto assistant rows; update src/lib/agent/loop.test.ts
- [x] T022 [US2] Durable asks in src/lib/stores/chat.svelte.ts: persist `approval`/`sampling`/`elicitation` rows when cards are shown (outcome `null`), call `updateOutcome` on decision, sweep pending asks to `undecided` in `stop()`; add reload-honesty tests to src/lib/stores/chat.svelte.test.ts (outcome shown after reload, undecided on abort, never an interactive card after reload)
- [x] T023 [US2] Single-entry `choices` (research D4): intercept the `present_choices` persistence path in src/lib/stores/chat.svelte.ts so new turns write one `choices` entry (no tool-call/tool-result pair); thread the tapped chip as a `user_message` with `metadata.choicesEntryId` through src/routes/chat/[id]/+page.svelte and src/lib/components/chat/Composer.svelte into `chatStore.send`
- [x] T024 [P] [US2] Make gate lookup kind-first in src/lib/ai/generate/generate-gate.ts: `findGateFromMessages` matches `kind === 'choices'` (returning the entry id for the link) with the legacy `toolName` probe as fallback for unmigrated rows; update src/lib/ai/generate/generate-gate.test.ts
- [x] T025 [US2] Tactical provider guard in src/lib/chat/context.ts: `toCoreMessages` excludes rows whose kind is `reasoning`/`approval`/`sampling`/`elicitation`/`self_corrected` (legacy rows never carry these kinds, so golden fixtures from T002 stay green); superseded by the projection in US3

**Checkpoint**: US2 done — migration backfills on boot and restore; reload shows outcomes, taken chips, per-iteration reasoning (quickstart §1 + §3); all gates green.

---

## Phase 5: User Story 3 - Provider context as a faithful projection (Priority: P3)

**Goal**: Replace `toCoreMessages` intent-guessing with the pure `projectEntries` seam; golden equivalence proven.

**Independent Test**: `pnpm test` — golden fixtures deep-equal `projectEntries` output with zero diffs; new-shape tests prove the single `choices` entry yields the same provider sequence as the legacy pair (quickstart §4).

### Implementation for User Story 3

- [x] T026 [P] [US3] Create src/lib/chat/projection.ts: pure `projectEntries(entries): ModelMessage[]` per contracts/projection.md — per-kind visibility table (internal kinds excluded; `choices` synthesizes the tool-call + tool-result pair; legacy stored pairs project via the normal rules) and the adjacent-same-role parts merge carried over byte-for-byte
- [x] T027 [P] [US3] Retarget src/lib/chat/projection.test.ts: golden fixtures from T002 now assert `projectEntries` deep-equality (zero diffs) plus new-shape tests (single `choices` entry ≡ legacy pair; ask/reasoning/self-corrected kinds produce nothing)
- [x] T028 [US3] Rewire assembly: src/lib/chat/context.ts delegates to `projectEntries`, delete `toCoreMessages` and the T025 guard, switch the critic path import in src/lib/agent/loop.ts, port src/lib/chat/context.test.ts expectations

**Checkpoint**: US3 done — one projection seam; provider context unchanged for existing chats.

---

## Phase 6: User Story 4 - Live and persisted output share one presentation (Priority: P4)

**Goal**: `LiveEntry` items (streaming text, streaming reasoning, pending asks) flow through the same registry; the duplicated streaming block and bottom-pane ask cards are deleted.

**Independent Test**: Stream a turn with reasoning and a permission ask — live items render in timeline position; on completion/persist no visual jump; grep confirms no duplicated streaming markup (quickstart §5).

### Implementation for User Story 4

- [x] T029 [US4] LiveEntry plumbing in src/lib/stores/chat.svelte.ts: expose `live_text` (stream buffer), `live_reasoning`, and `live_ask` items (bound to the durable ask rows from T022) so `assembleTimeline` merges them after durable entries
- [x] T030 [US4] Delete the duplicated streaming block in src/lib/components/chat/MessageList.svelte: live items dispatch through the registry to `AssistantMessage live` / `ReasoningEntry live` (same renderers, `live` prop from T009/T010)
- [x] T031 [US4] Move pending ask cards into the timeline: render `AskEntry` in interactive `live_ask` mode and remove the bottom-pane card duplication in src/routes/chat/[id]/+page.svelte (keep resolve-callback wiring through the store)

**Checkpoint**: US4 done — one presentation path total; continuity on persist verified by smoke.

---

## Phase 7: User Story 5 - Auditable self-correction (Priority: P5)

**Goal**: Critic passes persist a `self_corrected` entry (issues, attempts, succeeded); correction exchange stays in-memory (research D11 — provider context must not drift).

**Independent Test**: Trigger a turn whose draft fails validation → after completion + reload, an internal `self_corrected` note shows issues/attempts; clean turns produce none.

### Implementation for User Story 5

- [x] T032 [P] [US5] Extend src/lib/agent/loop.ts `runCriticPhase` to return `{ text, issues, attempts, succeeded }`, add `appendSelfCorrected(report)` to `AgentTurnDeps`, persist the entry only when `attempts ≥ 1`; update src/lib/agent/loop.test.ts (including "no entry when clean")
- [x] T033 [P] [US5] Wire `appendSelfCorrected` in src/lib/stores/chat.svelte.ts to the kind-aware append path with metadata `{issues, attempts, succeeded}` (renderer `SelfCorrected.svelte` exists from US1 — verify with a fixture smoke)

**Checkpoint**: US5 done — full kind enumeration live end-to-end.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T034 [P] Update docs/dev/architecture.qmd: entry-kind model, lane derivation, presentation registry, live/durable unification (spec FR-018)
- [x] T035 [P] Update docs/dev/seams.qmd: projection seam, presentation registry boundary, boot-time migration runner extension of the stamped-version seam
- [x] T036 SC-001 audit: grep the render path for role-based ladders and metadata-sniffing branches (`role ===`, `toolName ===` presentation checks) — remove leftovers so only the registry decides presentation
- [x] T037 Re-run the perf probe (same scenario as T001) and compare against specs/002-chat-timeline-kinds/notes/perf-baseline.md — render counts and longtasks not worse; record results in notes/perf-after.md
- [x] T038 Run full gates and the quickstart end-to-end: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`, then quickstart.md §1–§7 (migration, presentation, reload honesty, golden, live unification, restore gate, perf)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (T001 must precede any render-path change).
- **Foundational (Phase 2)**: T002 must precede ANY change touching context assembly (T021, T025, T026–T028).
- **User Stories**:
  - **US1** — after Phase 2; no story dependencies (MVP).
  - **US2** — depends on US1 (registry/renderers/kindOf). The migration tasks T015–T018 additionally unblock US3 and US5.
  - **US3** — depends on T002 (golden), T015–T016 (stored kind on legacy rows), T026/T027 precede T028.
  - **US4** — depends on US1 (registry + `live` prop stubs) and T022 (durable ask rows for `live_ask` binding).
  - **US5** — depends on T019 (kind-aware append) and T010 (renderer); otherwise independent — can run any time after US2's migration slice.
- **Polish (Phase 8)**: after all delivered stories (T036–T038 need everything; T034/T035 can start after US3).

### Within Each User Story

- Pure modules + tests before components; components before wiring (T013 needs T003–T012).
- Migration order is strict: T015 → T016 → T017/T018 (tests/runner) → T019 (flip).
- T016 lands SCHEMA_VERSION bump + registry entry together (never bump without the migration — a stamp without backfill is the bug D2 closes).

### Parallel Opportunities

- T001 ∥ T002 (setup/foundational).
- US1: T003–T008 (pure modules + tests) all parallel; T009–T012 (renderer files) all parallel after the registry exists; then T013 → T014.
- US2: T017 ∥ T020 ∥ T024 (different files) once T016/T019 shapes are known; T021 ∥ T022 ∥ T023 (loop vs store slices) after T019.
- US3: T026 ∥ T027, then T028.
- US5: T032 ∥ T033 coordination via the `AgentTurnDeps` interface.
- Polish: T034 ∥ T035.

---

## Parallel Example: User Story 1

```bash
# Pure model layer (all independent files):
Task: "T003 kinds.ts" ; Task: "T005 entries.ts" ; Task: "T007 presentation.ts"
# Then their tests in parallel:
Task: "T004 kinds.test.ts" ; Task: "T006 entries.test.ts" ; Task: "T008 presentation.test.ts"
# Then renderer components in parallel:
Task: "T009 UserMessage+AssistantMessage" ; Task: "T010 ReasoningEntry+SelfCorrected" ; Task: "T011 ToolActivity" ; Task: "T012 AskEntry+ChoicesOffer"
# Finally sequential wiring: T013 MessageList rewrite → T014 delete MessageRow
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001) + Phase 2 (T002).
2. Complete Phase 3 (US1: T003–T014).
3. **STOP and VALIDATE**: legacy chats render through the registry, tool detail collapsed by default; gates green. Shippable with zero schema change.

### Incremental Delivery

1. Baselines (T001–T002) → MVP US1 (T003–T014) → demo.
2. US2 (T015–T025): migration first (boot + restore paths), then persistence — reload-honest chats. Validate quickstart §1/§3.
3. US3 (T026–T028): projection seam behind golden equivalence. Validate §4.
4. US4 (T029–T031): single live/durable presentation. Validate §5.
5. US5 (T032–T033) any time after step 2's migration slice.
6. Polish (T034–T038): docs, audits, perf, full validation.

### Parallel Team Strategy

- Dev A: US1 → US4 (presentation track).
- Dev B: US2 migration slice (T015–T020) → US3 (projection track; needs T002 fixtures).
- Dev C: US2 persistence slice (T021–T025, after T019) → US5.
- Merge order: US1 first, then migration slice before anything depending on stored kinds.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- Tests are colocated `.test.ts` files (repo convention); never name files with a `+` prefix.
- Migration SQL lives ONLY in the registry `migrate(client)` (stamped-version seam); drizzle files come from `pnpm db:generate` untouched.
- Never write to `search_vec`; search filtering is query-level (T020).
- `@mayon/shared` changes (T016) require a rebuild + `pnpm dev:build` in the Docker dev stack.
- Existing user/assistant row IDs are immutable everywhere (T015–T017 assert it).
- Commit after each task or logical group; stop at any checkpoint to validate independently.
