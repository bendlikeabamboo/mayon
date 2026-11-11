---
description: "Task list for feature 037 (issue #73)"
---

# Tasks: Back-propagation tool integrity fixes (037)

**Input**: Design documents from `/specs/037-backprop-tool-integrity/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/payload-parity.md, contracts/decline-surface.md

**Tests**: Explicitly requested — the constitution requires every bug fix to ship a fail-first regression test; test tasks below MUST be written first and observed failing before their implementation task runs.

**Test execution policy (fleet)**: SPA tests ONLY as
`systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384 pnpm test:low-spec <files>`;
one process at a time.

**Organization**: Tasks grouped by user story (US1–US7 from spec.md); every story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependencies on incomplete tasks
- **[Story]**: maps to spec.md user stories

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Establish green baseline before any edit: run `pnpm check`, then the capped runner over the eight affected test files — `src/lib/chat/propagation.test.ts`, `src/lib/agent/deterministic-tools.test.ts`, `src/lib/stores/chat.svelte.test.ts`, `src/lib/chat/brief.test.ts`, `src/lib/db/repositories/messages.test.ts`, `src/lib/components/chat/PropagatedArtifact.test.ts`, `src/lib/agent/loop.test.ts`, `src/lib/chat/context.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

None — every fix lands in existing modules; no shared infrastructure precedes the stories.

---

## Phase 3: User Story 1 — Tool-built artifact payload fidelity (Priority: P1) 🎯 MVP

**Goal**: Propagation payloads (both paths) exclude the propagation tool's own chrome rows; tool and manual payloads are byte-identical for the same content.

**Independent Test**: Seed a branch with content + propagation chrome rows; tool artifact content equals the manual payload of a content-only twin branch (string equality).

### Tests for User Story 1 ⚠️ write first, verify FAIL

- [ ] T002 [P] [US1] Fail-first chrome-exclusion test in `src/lib/chat/propagation.test.ts`: `buildRawPayload`/`renderRawTurns` omit rows with `toolName === 'propagate_to_parent'` (tool_call row shape from `appendAssistantToolCall` — role `assistant`, content `''`; approval row `kind: 'approval'`; tool_result row role `tool`) while other tools' rows render verbatim; chrome images are not collected
- [ ] T003 [P] [US1] Fail-first parity test in `src/lib/agent/deterministic-tools.test.ts`: run `propagate_to_parent` on a branch seeded with content + chrome rows; assert the landed artifact `content` is byte-identical to `buildRawDelta` of a content-only twin branch and to the manual-path payload for the same content
- [ ] T005 [P] [US1] Fail-first store test in `src/lib/stores/chat.svelte.test.ts`: manual `propagateToParent('raw')` on a branch carrying a declined propagation attempt's rows produces the same payload as the content-only twin (manual-side parity, incl. declined chrome)

### Implementation for User Story 1

- [ ] T004 [US1] Implement the chrome predicate and apply it in `src/lib/chat/propagation.ts` — filter rows in `buildRawPayload` (lines 98-107) and `collectPropagatedImages` (lines 119-122); export nothing new beyond what tests import (predicate or filtered builder)

**Checkpoint**: Tool and manual artifacts are chrome-free and byte-identical; T002/T003/T005 green.

---

## Phase 4: User Story 2 — No false success toast on latched propagation (Priority: P1)

**Goal**: A latch-refused propagation never leaves a prior run's success record observable.

**Independent Test**: After a successful propagation, a latch-refused second call returns with `lastPropagation === null`; genuine success still sets it.

### Tests for User Story 2 ⚠️ write first, verify FAIL

- [ ] T006 [P] [US2] Fail-first latch-refusal test in `src/lib/stores/chat.svelte.test.ts`: complete one propagation (record set), hold the latch via `acquirePropagationLatch()`, call `propagateToParent` again → on return `lastPropagation === null` (stale record cleared); latch-free success still sets the record

### Implementation for User Story 2

- [ ] T007 [US2] Clear the stale record on the latch-refusal early return in `src/lib/stores/chat.svelte.ts` `propagateToParent` (line 1787): set `this.lastPropagation = null` before returning; leave `propagationStatus`/`propagationError` untouched

**Checkpoint**: Second-run toast cannot fire; first-run toast unaffected.

---

## Phase 5: User Story 3 — Root-chat guidance points at a real path (Priority: P2)

**Goal**: The capabilities preamble no longer points root-chat learners at the hidden manual control.

**Independent Test**: `buildCapabilitiesPreamble()` root case mentions a child context/branching and not the manual control; the provider-without-tools case keeps the manual-control pointer.

### Tests for User Story 3 ⚠️ write first, verify FAIL

- [ ] T008 [P] [US3] Fail-first preamble test in `src/lib/chat/brief.test.ts`: root-chat fallback line references needing a child context (branch) and does not mention the manual back-propagate control for the root case; provider-without-tools-on-branch case still points at the manual control; "never imitate propagation in prose" preserved in both

### Implementation for User Story 3

- [ ] T009 [US3] Replace the single fallback line at `src/lib/chat/brief.ts:260` with the two-case split from `specs/027-backprop-tool/contracts/propagate-tool.md` preamble item 5 (already amended): root → child context/branch offer; provider-without-tools on a branch → manual control

**Checkpoint**: Root guidance is followable; branch fallback unchanged.

---

## Phase 6: User Story 4 — Clean mid-tool abort (Priority: P2)

**Goal**: An abort observed between payload generation and the artifact write persists nothing and exits cleanly.

**Independent Test**: Abort the signal after generation resolves; tool returns `{ok:false, summary:'aborted'}`, inserts nothing, latch released.

### Tests for User Story 4 ⚠️ write first, verify FAIL

- [ ] T010 [P] [US4] Fail-first mid-tool abort test in `src/lib/agent/deterministic-tools.test.ts`: summary mode — mock `generateBranchArtifactSummary` to abort the controller and still RESOLVE; raw mode — abort during the repo awaits before insert; both → `{ok:false, summary:'aborted'}`, zero `branch_artifact` rows in the parent, latch acquirable afterwards

### Implementation for User Story 4

- [ ] T011 [US4] Add the pre-write abort re-check in `src/lib/agent/deterministic-tools.ts` `propagate_to_parent.run`: `if (ctx.signal?.aborted) return { ok: false, summary: 'aborted' };` immediately before `resolveAnchor` (line 319), covering raw and summary modes; existing `finally` releases the latch

**Checkpoint**: No artifact is written after a stop; entry-abort behavior unchanged.

---

## Phase 7: User Story 5 — Duplicate images never crash the artifact view (Priority: P2)

**Goal**: Collected images dedupe by data before the cap; the artifact grid key tolerates duplicates (legacy rows).

**Independent Test**: A branch with the same image data in two rows propagates (one copy) and the grid wiring uses a composite key.

### Tests for User Story 5 ⚠️ write first, verify FAIL

- [ ] T012 [P] [US5] Fail-first dedupe tests in `src/lib/chat/propagation.test.ts`: `buildRawPayload`/`collectPropagatedImages` keep one copy per distinct `data` (first occurrence, order preserved), dedupe applies BEFORE the 8-image cap, distinct images all survive
- [ ] T013 [P] [US5] Fail-first wiring test in `src/lib/components/chat/PropagatedArtifact.test.ts`: the image-grid each-key is composite (`image.data + ':' + index`, Composer pattern) — not solely `image.data`

### Implementation for User Story 5

- [ ] T014 [US5] Implement the shared dedupe helper in `src/lib/chat/propagation.ts` (used by both collection paths, before the cap) and change the grid key at `src/lib/components/chat/PropagatedArtifact.svelte:119` to `image.data + ':' + i` (same file order as T004's filter — sequence after it)

**Checkpoint**: Duplicate images render one thumbnail; legacy duplicate parts render without crashing.

---

## Phase 8: User Story 6 — Regenerated artifacts reflect current parts (Priority: P2)

**Goal**: `updateArtifactContent` can replace `parts` atomically; regeneration passes the source branch's current (deduped) images.

**Independent Test**: Regenerate a summary artifact after the source branch's images changed; stored parts equal the current collected set (or NULL when none).

### Tests for User Story 6 ⚠️ write first, verify FAIL

- [ ] T015 [P] [US6] Fail-first repo tests in `src/lib/db/repositories/messages.test.ts`: `updateArtifactContent` with a parts array validates (rejects >8 images, text≠content) and stores parts atomically with content+metadata; `null` clears the column; `undefined` leaves it untouched; non-artifact rows still refused
- [ ] T016 [P] [US6] Fail-first store test in `src/lib/stores/chat.svelte.test.ts`: `regenerateArtifact` leaves the artifact with the source branch's current collected images after an image-set change, and clears parts when the branch has none (depends on the US5 dedupe helper for "current collected" semantics)

### Implementation for User Story 6

- [ ] T017 [US6] Extend `updateArtifactContent` in `src/lib/db/repositories/messages.ts` (lines 217-239) with the optional `parts?: MessagePart[] | null` parameter (validate via the existing `validateParts`, one UPDATE for content+metadata+parts); pass `artifactParts(summary, collected) ?? null` from `regenerateArtifact` in `src/lib/stores/chat.svelte.ts` (lines 1891-1894)

**Checkpoint**: Regenerated artifacts' image sets match their source branch.

---

## Phase 9: User Story 7 — Declined tools are not re-offered (Priority: P3)

**Goal**: The declined tool result carries a durable, model-legible declined marker that survives reassembly.

**Independent Test**: Decline a high-risk call; next-turn context surfaces `declined: true` for that call; failures do not carry it.

### Tests for User Story 7 ⚠️ write first, verify FAIL

- [ ] T018 [P] [US7] Fail-first loop test in `src/lib/agent/loop.test.ts`: declined high-risk call persists a tool_result whose metadata is exactly `{"declined":true,"ok":false}` (content `'user declined'` unchanged)
- [ ] T019 [P] [US7] Fail-first context test in `src/lib/chat/context.test.ts`: reassembled `toolResult` for the declined row surfaces `declined: true` (metadata shadows content); a plain failure row's toolResult carries no `declined` key

### Implementation for User Story 7

- [ ] T020 [US7] Add `detail: { declined: true }` to the loop-synthesized declined result in `src/lib/agent/loop.ts` (line 913); leave abort/failure syntheses untouched

**Checkpoint**: Next-turn model context distinguishes declines from failures.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T021 Update `docs/reference/tool-map.qmd` in the same change: the propagate entry's byte-identical note (~line 54) gains the chrome-exclusion wording; the approval/decline flow (~line 77) documents the durable `declined` marker (`specs/037-backprop-tool-integrity/contracts/decline-surface.md`)
- [ ] T022 [P] Add CHANGELOG entries inside `## [0.10.0]` → `### Fixed` in `CHANGELOG.md`: one line per issue-#73 item (payload chrome, false toast, root brief dead end, mid-tool abort, duplicate image keys, stale parts on regeneration, declined re-offering)
- [ ] T023 Full validation per `specs/037-backprop-tool-integrity/quickstart.md`: `pnpm check`, `pnpm lint`, capped low-spec runs of quickstart scenarios V1-V7 and then the full suite

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; T001 blocks all edits (green baseline).
- **Foundational (Phase 2)**: none required.
- **User Stories (Phases 3-9)**: each story's tests precede its implementation (constitution: fail-first). Cross-story sequencing constraints:
  - T004 (US1 filter) → T014 (US5 dedupe): same file (`src/lib/chat/propagation.ts`) — sequence.
  - T014 → T016: the store regeneration test relies on the dedupe helper's collection semantics.
  - US2, US3, US4, US7 are file-disjoint from each other and can proceed in parallel once their tests exist.
- **Polish (Phase 10)**: after all stories (tool-map wording documents shipped behavior; CHANGELOG and full validation close the change).

### Parallel Opportunities

- Within each story, test tasks marked [P] target different files and run in parallel.
- T002/T003/T005 (US1 tests), T006 (US2), T008 (US3), T010 (US4), T012/T013 (US5), T015 (US6), T018/T019 (US7) are mutually file-disjoint.
- T021/T022 are documentation-only and parallel-safe (after their stories land).

### MVP Scope

User Story 1 alone (T002-T005) restores the headline parity guarantee; stories 2-7 are independent hardening on top.

---

## Implementation Strategy

MVP first (US1), then P1 sibling (US2), then the four P2 stories (any order, respecting
the two sequencing constraints above), then US7, then Polish. Each story ends at its
checkpoint with a capped test run of its files.
