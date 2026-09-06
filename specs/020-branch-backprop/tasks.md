# Tasks: Branch Back-Propagation (Anchored Context Artifacts)

**Input**: Design documents from `/specs/020-branch-backprop/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/kind-adoption.md, contracts/propagation-flow.md, quickstart.md

**Tests**: Included. The constitution (`.specify/memory/constitution.md`, Principle II) mandates tests for all new behavior in `src/lib/`, and spec SC-001 requires testable steer verification. UI-only collapse rendering is verified via `pnpm check` + manual smoke per the same principle.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1–US4 per spec.md)
- **Subgroup rule**: when dispatching implementation, run tasks in subgroups of no more than 6; launch parallel-capable subgroups on parallel agents

## Path Conventions

SvelteKit single app at repo root: app code in `src/lib/` + `src/routes/`, server in `server/src/`, migrations in `drizzle/`, tests colocated `*.test.ts` next to the code they cover (repo convention).

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before any feature work

- [x] T001 Run `pnpm install`, then confirm baseline gates pass before changes: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test` (fix nothing feature-related; record any pre-existing failures)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `branch_artifact` kind and the anchored-insert seam MUST exist before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add `'branch_artifact'` to the `messages.kind` drizzle enum and change `ord` from `integer` to `doublePrecision` in `src/lib/db/schema.ts`; generate the migration with `pnpm db:generate` (expect `drizzle/0004_*.sql` with `ALTER TABLE "messages" ALTER COLUMN "ord" TYPE double precision`; never hand-edit the generated SQL)
- [x] T003 [P] Add `'branch_artifact'` to `EntryKind` and `ALL_KINDS`, add the `laneOf` case (`→ 'internal'`), and add the `BranchArtifactMetadata` interface (`mode`, `sourceChatId`, `sourceChatTitle`, `branchPointMessageId`, `anchor`, `summaryTraceId`, `regeneratedAt`) in `src/lib/chat/kinds.ts`; extend the exhaustive `ALL_KINDS` table in `src/lib/chat/kinds.test.ts`
- [x] T004 [P] Implement `messagesRepo.insertAnchored(chatId, entry, placement)` (placement rules: `'start'` → `minOrd − 1`; `beforeOrd: null` → `afterOrd + 1`; otherwise `(afterOrd + beforeOrd) / 2`) and `messagesRepo.updateArtifactContent(id, content, metadataPatch)` (kind-guarded to `branch_artifact` only) in `src/lib/db/repositories/messages.ts`; no other row may be rewritten by either function
- [x] T005 Add repo tests in `src/lib/db/repositories/messages.test.ts` (pglite driver): midpoint/before-null/start placement math, fractional `ord` persists and `listByChat`/`listUpToOrd` order correctly, `append` still allocates `max(ord) + 1`, `updateArtifactContent` refuses non-artifact rows, and the `0004` migration applies on a fresh test database

**Checkpoint**: Foundation ready — artifact rows can be inserted mid-thread and read back in anchored order

---

## Phase 3: User Story 1 — Propagate a branch outcome into the parent chat (Priority: P1) 🎯 MVP

**Goal**: From a branch with divergence, the user triggers back-propagation and chooses Raw delta or Summary; the payload lands in the parent as a persisted, collapsible `branch_artifact` anchored at the branch point; nothing existing is modified.

**Independent Test**: Branch a chat, complete an exchange on the branch, propagate with each mode, and verify the artifact appears in the parent between the branch-point message and the next message with expected content, while every pre-existing parent/branch row is byte-identical (spec US1 acceptance scenarios).

### US1 · core logic (subgroup of ≤ 6)

- [x] T006 [US1] Implement raw-delta builder + anchor resolution in `src/lib/chat/propagation.ts`: delta = branch rows in `ord` order rendered as `[user]`/`[assistant]`/`[tool: <toolName>]` verbatim lines, with `[excerpt]…[/excerpt]` section from `branchSourcesRepo.getByBranchChat` (fallback: parent message content at `branch_point_message_id`; omitted if neither); anchor rules per `specs/020-branch-backprop/data-model.md` — recorded (`branchPointMessageId`), derived (last parent row with `createdAt ≤ branch.createdAt`, labeled `'derived'`), or start-of-thread
- [x] T007 [US1] Add `src/lib/chat/propagation.test.ts`: delta format (role prefixes, tool turns, excerpt inclusion/omission, no truncation), all three anchor rules, and placement derivation (midpoint vs `afterOrd + 1`)
- [x] T008 [P] [US1] Implement one-shot summary generation in `src/lib/ai/generate/generate-branch-artifact-summary.ts`: `generateText` via the active SDK provider, system = summary prompt ("what happened on this branch since it diverged"), input = `splitContextForGeneration(assembleContext(branchChatId), …)`, `maxRetries: 0`, trace persisted to `agent_traces` with kind `'branch_artifact_summary'`; throw on failure so nothing is inserted (FR-013)
- [x] T009 [US1] Implement `chatStore.propagateToParent(mode)` in `src/lib/stores/chat.svelte.ts`: gate on `chats.parentId !== null` and branch `ownMessageCount > 0` (FR-010); raw mode → build delta then single `insertAnchored`; summary mode → generate first, insert only on success; expose in-progress/success/error states for the control; success surfaces the parent chat id for the confirmation link
- [x] T010 [US1] Add store test in `src/lib/stores/chat.svelte.test.ts`: raw propagation inserts exactly one `branch_artifact` row at the midpoint; summary failure inserts nothing; all pre-existing parent and branch rows keep identical `ord`/`content` (FR-005, FR-011, SC-003)

### US1 · UI + flow (subgroup of ≤ 6)

- [x] T011 [P] [US1] Create `src/lib/components/chat/PropagatedArtifact.svelte`: collapsible entry consistent with existing `ReasoningEntry`/`ToolActivity` patterns — collapsed labeled strip (source branch title, raw/summary mode badge, timestamp, "derived anchor" indicator when `metadata.anchor === 'derived'`), expands to full payload; reserve an actions region for US3
- [x] T012 [US1] Add the `branch_artifact` case to the durable-row switch in `src/lib/components/chat/MessageList.svelte` rendering `PropagatedArtifact` (today an unknown kind renders an invisible empty div)
- [ ] T013 [US1] Add the back-propagate control to `src/routes/chat/[id]/+page.svelte`: visible only on branch chats meeting the FR-010 gate, two-step flow (mode chooser: Raw delta | Summary), in-progress state for summary, confirmation with link to the parent chat, clear error surface with retry (per `specs/020-branch-backprop/contracts/propagation-flow.md`)
- [x] T014 [US1] Manual smoke on `pnpm dev` per `specs/020-branch-backprop/quickstart.md` scenario 1: raw + summary land anchored (not at thread end), pre-change/post-change row comparison shows zero modifications; verify `pnpm check` + `pnpm lint` clean

**Checkpoint**: MVP — a user can propagate raw and summary payloads that land anchored and render collapsed; US2/US3/US4 layer on top

---

## Phase 4: User Story 2 — The parent resumes with corrected context (Priority: P2)

**Goal**: The artifact steers every future composition of the parent (and only the parent), because it is real message history with a projection mapping.

**Independent Test**: Insert an artifact below a stale-assuming parent exchange (repos suffice — no UI needed), compose the parent, and verify the projected provider messages contain the framed artifact content; verify pre-existing sibling branches compose without it (spec US2 acceptance scenario 1 + FR-009).

- [x] T015 [P] [US2] Add the `branch_artifact` mapping branch in `src/lib/chat/projection.ts`: one user message = deterministic framing header from metadata (`[Back-propagated from "<sourceChatTitle>" · raw|summary · <createdAt>]`) + blank line + `content`; do NOT add the kind to `EXCLUDED_KINDS`; cover in `src/lib/chat/projection.test.ts` (mapping + merge behavior)
- [x] T016 [US2] Add steering tests in `src/lib/chat/context.test.ts`: `branch_artifact` is not in `PROVIDER_EXCLUDED_KINDS` and is emitted with its stored `role: 'user'`; parent composition includes the artifact; a pre-existing sibling branch's composition excludes it (cutoff walk, FR-009); a branch created below the anchor afterward includes it
- [x] T017 [US2] Add an end-to-end steer test (pglite): parent chat with a flawed "code" exchange, branch with a fix, propagate via repos, then `assembleContext(parentId)` → `projectEntries` and assert the corrected state is present in the provider messages without any user restatement (SC-001)

**Checkpoint**: US1 + US2 = the full product promise: landed artifact steers future parent answers

---

## Phase 5: User Story 3 — Review and manage propagated artifacts (Priority: P3)

**Goal**: Expand/collapse already ships in US1; this story adds regenerate (summary only) and delete, in place, without touching anything else.

**Independent Test**: Propagate a summary, regenerate it (content replaced, identity/anchor unchanged), delete an artifact (removed, no other row affected), and verify future composition drops it (spec US3 acceptance scenarios).

- [x] T018 [US3] Implement `chatStore.regenerateArtifact(id)` (summary-mode guard; call `generateBranchArtifactSummary` for the source branch from metadata, then `messagesRepo.updateArtifactContent` with new content + `regeneratedAt`; id/ord/anchor unchanged) and `chatStore.deleteArtifact(id)` (`messagesRepo.delete` + store removal) in `src/lib/stores/chat.svelte.ts`
- [x] T019 [US3] Extend `src/lib/stores/chat.svelte.test.ts`: regenerate replaces content in place with same `id`/`ord`; regenerate refuses raw-mode artifacts; delete removes only the artifact row and subsequent composition excludes it (FR-007)
- [x] T020 [US3] Wire Regenerate (rendered only when `metadata.mode === 'summary'`) and Delete (with confirm) in the reserved actions region of `src/lib/components/chat/PropagatedArtifact.svelte`, wired to the store actions with in-progress/error states
- [x] T021 [US3] Manual smoke per `specs/020-branch-backprop/quickstart.md` scenario 2, including the summary-failure path (revoke provider key → clear error, nothing landed, retry available)

**Checkpoint**: Users retain authority over artifacts after landing

---

## Phase 6: User Story 4 — Artifacts are durable history (Priority: P3)

**Goal**: Artifacts survive reload and backup/restore like any message row, and their text is findable in search.

**Independent Test**: Propagate, reload (artifact still anchored), run backup → restore (artifact intact), and search (artifact text findable; regular-message search results unchanged) (spec US4 acceptance scenarios).

- [x] T022 [P] [US4] Extend the raw-SQL kind filter in `src/lib/db/repositories/search.ts:97` from `('user_message','assistant_message')` to include `'branch_artifact'`; add a search test asserting artifact payload text is findable and user/assistant-message queries return identical results with and without artifacts present (no `search_vec` writes, no reindex path)
- [x] T023 [US4] Add a restore round-trip test in `server/src/pg-import.test.ts` asserting `branch_artifact` rows (with fractional `ord` and JSON metadata) survive the generic truncate + data-only restore cycle; then run the manual durability checks in `specs/020-branch-backprop/quickstart.md` scenario 4 (reload anchoring, backup/restore from Settings → Data)

**Checkpoint**: All four stories independently functional and durable

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T024 [P] Update docs: add the `branch_artifact` kind to the message-kind contract in `docs/reference/seams.qmd` and a short note on back-propagation semantics (anchoring, additive-only, sibling isolation) in `docs/explanation/architecture.qmd`
- [ ] T025 [P] (requires live stack + browser — see completion report) Perf spot-check per `specs/020-branch-backprop/quickstart.md` (constitution Principle IV): with `window.__MAYON_PERF__ = 1`, propagate on a 50+ message parent and confirm no long tasks > 50 ms attributable to insert/render
- [x] T026 Run the full `specs/020-branch-backprop/quickstart.md` validation and all merge gates: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories** (T005 needs T002 + T004)
- **US1 (Phase 3)**: depends on Foundational; core-logic subgroup (T006–T010) precedes UI subgroup (T011–T014) only because T013 wires the store actions from T009
- **US2 (Phase 4)**: depends on Foundational only — T015–T017 can run in parallel with US1's UI subgroup (they need artifact rows, which repos already provide)
- **US3 (Phase 5)**: depends on US1 (T008, T009, T011) — it manages the artifacts US1 creates
- **US4 (Phase 6)**: T022 depends on Foundational (kind exists); T023 depends on US1 for realistic fixtures; either can follow US1
- **Polish (Phase 7)**: depends on all desired stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational → US1. No other story dependency. **This is the MVP.**
- **US2 (P2)**: Foundational → US2 (parallel-friendly with US1 UI)
- **US3 (P3)**: US1 → US3
- **US4 (P3)**: Foundational → US4 (verification tasks land best after US1)

### Within Each Story

- Logic/tests before wiring (builder → store → components)
- Tests accompany implementation per constitution (not strict TDD ordering, but each story's test task must fail-meaningfully before its implementation task is called done when written first)
- Component tasks before the route/control task that uses them

### Parallel Opportunities

- Phase 2: T002, T003, T004 on separate files — one parallel group
- US1: T008 (generator) and T011 (component) are file-independent — run alongside the T006–T007/T009 chain
- US2 is fully parallel with US1's UI subgroup; US4's T022 is parallel with anything after Phase 2
- Story-level: US1(core) ∥ US2 ∥ US4(T022) after Phase 2; then US1(UI) → US3

---

## Parallel Example: Foundational + US1 core

```bash
# Group A (parallel, Phase 2):
Task: "Schema kind + ord type + migration — src/lib/db/schema.ts"
Task: "Kind unions + metadata — src/lib/chat/kinds.ts"
Task: "insertAnchored + updateArtifactContent — src/lib/db/repositories/messages.ts"

# Group B (after A; T006/T009 sequential chain, T008 + T011 parallel):
Task: "Delta builder + anchor resolution — src/lib/chat/propagation.ts"
Task: "Summary generator — src/lib/ai/generate/generate-branch-artifact-summary.ts"
Task: "Artifact component — src/lib/components/chat/PropagatedArtifact.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 → Phase 2 (foundation)
2. Phase 3 (US1 core + UI)
3. **STOP and VALIDATE**: quickstart scenario 1 — propagate raw + summary, verify anchoring and zero row changes
4. This alone delivers the core loop; US2–US4 harden it

### Incremental Delivery

1. Foundation → US1 (MVP: artifacts land anchored) → validate
2. US2 (steering proven by tests T016–T017) → validate with quickstart scenario 3
3. US3 (manage) + US4 (durability) → validate scenarios 2 & 4
4. Polish → full gate run (T026)

### Subgroup Dispatch (≤ 6 tasks each)

Foundation (4) · US1-core (5) · US1-UI (4) · US2 (3) · US3 (4) · US4 (2) · Polish (3) — each subgroup is the natural unit for a parallel agent where dependencies allow.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] labels map to spec.md stories for traceability
- Hard invariants to respect in every story: propagation never rewrites existing rows (FR-005); no `ord` rebalancing path; `search_vec` never written; summary inserts only after successful generation (FR-013); kind must not be added to either provider-exclusion set (FR-008)
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
