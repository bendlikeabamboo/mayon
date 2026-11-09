---
description: "Task list for feature 030 implementation"
---

# Tasks: Model-Generated Images in Chat (030)

**Input**: Design documents from `/specs/030-image-generation/` (plan.md, spec.md, research.md R-1…R-12, data-model.md, contracts/, quickstart.md)

**Prerequisites**: `pnpm install` + `pnpm --filter @mayon/shared build` (fresh worktree); dev stack via `pnpm dev` for e2e/manual scenarios.

**Tests**: Included per constitution II (new behavior in `src/lib/` MUST ship with tests). Test tasks are written first and must fail before implementation.

**Organization**: Tasks grouped by user story (spec.md): US1 images arrive/render/persist (P1), US2 capability indication (P2), US3 durability/portability (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on incomplete tasks
- **[Story]**: user story this task belongs to
- File paths are exact; all repo-relative

---

## Phase 1: Setup

**Purpose**: Resolve the one genuine unknown before recognition code is written (research R-2).

- [x] T001 Spike: determine how AI SDK v7 surfaces assistant-emitted images in `fullStream` — inspect installed typings/sources (`node_modules/ai`, `node_modules/@ai-sdk/google`, `node_modules/@ai-sdk/openai-compatible`) for image-bearing part types (e.g. `file` parts with `image/*` media type) and what wire shapes each dialect maps; decide whether a per-dialect normalization shim (OpenRouter-style `choices[].message.images[]`, Gemini `inlineData`) is needed. Record the outcome as an R-2 addendum in specs/030-image-generation/research.md (exact part type names + shim list). No product code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The bounded output-side image budget shared by every path that stores a generated image (contracts/stream-image-parts.md §3).

- [x] T002 [P] Implement output-side image budget in src/lib/chat/images.ts: cap constants sized so a persisted row fits the 16 MiB `/api/db/query` envelope (per-image decoded cap, per-message base64 total), plus a re-encode-down helper reusing the existing canvas pipeline (oversized images are re-encoded, never rejected; NO default downsizing of in-budget images). Extend src/lib/chat/images.test.ts with budget tests (over-cap → re-encoded; in-budget → passthrough).

**Checkpoint**: Image budget utility ready; user story work can begin.

---

## Phase 3: User Story 1 — The model's generated image appears in the chat (Priority: P1) 🎯 MVP

**Goal**: Assistant replies carrying images render inline in order, persist atomically with their text, and redisplay after reload without provider contact (spec US1, FR-001/002/003/004/007/008; contracts/stream-image-parts.md, contracts/message-parts.md).

**Independent Test**: quickstart S1–S3 — scripted image parts reach the finalized append; an image reply persists as ONE assistant row with ordered parts; reload redisplays; interrupted replies keep complete images; repo invariants (≤8, concat, image-only `content:''`) hold on assistant rows.

### Tests for User Story 1 (write first, must fail)

- [x] T003 [P] [US1] Recognition tests in src/lib/agent/loop.test.ts: extend `scriptedFullStream` with image-bearing parts; assert recognized images hand off at finalize, survive the critic consumer, and that image-less streams behave byte-identically (pattern: existing ~40 scripted tests).
- [x] T004 [P] [US1] Store tests in src/lib/stores/chat.svelte.test.ts: image reply persists parts atomically with text on the assistant row (pattern: the "T010 — US1" attachment block at 1571–1810); abort after an image keeps it with `metadata.interrupted:true`; retry/regenerate unaffected.
- [x] T005 [P] [US1] Repo tests in src/lib/db/repositories/repositories.test.ts: exercise parts invariants on `assistant` rows through `messagesRepo.append` (ordered text+images, ≤8 images, text parts concatenate to `content`, image-only row with `content:''`).

### Implementation for User Story 1

- [ ] T006 [US1] Recognition in src/lib/agent/loop.ts: `consumeStream` recognizes image-bearing parts per the T001 spike outcome (plus dialect shim in src/lib/ai/dialects.ts if the spike says one is needed); images accumulate atomically per turn; critic-phase consumer (loop.ts:262-271) carries them; finalize handoff exposes them to the store (depends on T001, T003).
- [x] T007 [P] [US1] Generated-image labeling in src/lib/chat/kinds.ts: synthesize `name`/alt for generated images (model-provided label when present, else `Generated image N`).
- [ ] T008 [US1] Turn plumbing in src/lib/stores/chat.svelte.ts: per-turn `pendingImages` state; bounded live placeholder (no base64, no partial frames) while non-empty; `appendAssistantText` composes ordered parts (text part(s) + images) and persists `repos.messages.append(chatId, 'assistant', content, { model, parts })` in one atomic append; abort path persists `pendingImages` with the interrupted row; apply the T002 budget before append (depends on T002, T006, T007, T004).
- [ ] T009 [US1] Remote-URL materialization: helper in src/lib/chat/images.ts fetching URL-delivered images through the existing keychain/proxy fetch (src/lib/ai/sdk-fetch.ts → src/lib/services/llm-proxy-fetch.ts) at finalize; wire into the T008 finalize; un-fetchable link → contained plain-language notice inside the reply record, never a broken frame or dropped message (depends on T008).
- [ ] T010 [US1] Rendering in src/lib/components/chat/: extract the fullscreen overlay from src/lib/components/chat/rows/UserMessage.svelte into a shared lightbox component; src/lib/components/chat/rows/AssistantMessage.svelte renders ordered parts as segmented markdown blocks (one `Markdown` render per contiguous text run) with thumbnail grids between, outside the Markdown pipeline; image-less replies render exactly as today; live placeholder in the live view; keep expound/selection sound per research R-5 — offsets derived from the concatenation invariant, or selection-menu disable for multi-segment messages only (never substring heuristics) (depends on T008).
- [x] T011 [US1] Mock fixture: add an image-reply kind to tests/fixtures/mock-llm/server.mjs (`classifyRequest` at 275-329 must learn it or it 400s; extend `streamReply` with the T001-spike wire shape); all requests must keep riding the real browser → `/api/llm/proxy` → mock path (depends on T001).
- [ ] T012 [US1] E2E round trip in tests/e2e/: streamed image reply delivers text marker (`#msg-live-text`) then placeholder, then the durable assistant message renders the image after finalize; reload redisplays it with zero provider requests (depends on T010, T011).

**Checkpoint**: US1 fully functional and independently testable (quickstart S1–S5).

---

## Phase 4: User Story 2 — The user can tell whether their model can generate images (Priority: P2)

**Goal**: Advisory `imageOutput` capability flag with static allowlist, UI indication, and clear contained failures (spec US2, FR-006/007; contracts/image-output-capability.md).

**Independent Test**: quickstart S4 — resolver unit tests (`on`/`off` force, `auto` allowlist, pure, never touches payloads) + gate wiring test + visible select/badge/indicator.

### Tests for User Story 2 (write first, must fail)

- [x] T013 [P] [US2] Resolver tests in src/lib/ai/image-output-capability.test.ts (pattern: vision-capability tests) + gate wiring test in src/routes/chat/[id]/ (pattern: vision-gate.test.ts).

### Implementation for User Story 2

- [x] T014 [P] [US2] Create src/lib/ai/image-output-capability.ts: `IMAGE_OUTPUT_MODEL_PREFIXES` static allowlist + pure `supportsImageOutput(config, modelId)` resolver mirroring src/lib/ai/vision-capability.ts; add `imageOutput?: 'auto'|'on'|'off'` to `ProviderConfig` in src/lib/ai/types.ts (sibling of `vision`); advisory only — never gates/rewrites payloads (depends on T013).
- [x] T015 [P] [US2] Provider settings UI: "Image output" tri-state select next to "Images (vision)" in src/lib/components/ai/ProviderConfig.svelte (depends on T014).
- [x] T016 [P] [US2] Model badge: image-output chip in model-select rows next to the context-window badge in src/lib/components/ai/model-select/ (depends on T014).
- [x] T017 [US2] Chat-surface indication: derive `supportsImageOutput` in src/routes/chat/[id]/+page.svelte following the `supportsVisionModel` wiring and surface it at the Composer (depends on T014).
- [ ] T018 [US2] Typed failure refinement in src/lib/ai/errors.ts (`asImageOutputError` pattern after `asImageUnsupported`) + wire the store catch in src/lib/stores/chat.svelte.ts so a failed image turn yields a contained plain-language notice naming the capability toggle — never a raw provider dump (depends on T008; touches chat.svelte.ts, run after US1).

**Checkpoint**: US1 and US2 both independently functional.

---

## Phase 5: User Story 3 — Generated images are durable, portable conversation content (Priority: P3)

**Goal**: Full-size view + download, backup/branch round-trips, continuation context, and untouched search/selection (spec US3, FR-005/009/010/011; contracts/message-parts.md §4-5).

**Independent Test**: quickstart S6 — open full-size and download in ≤2 actions; branch + propagate keeps the image with `[image]` markers; search finds text and never image data; backup/restore survives; continuation sends images to vision-capable models only.

### Implementation for User Story 3

- [x] T019 [P] [US3] Extend `insertAnchored` to accept optional `parts` in src/lib/db/repositories/messages.ts (≤8 images as everywhere) + tests in src/lib/db/repositories/messages.test.ts.
- [x] T020 [P] [US3] Continuation projection: assistant branch in src/lib/chat/projection.ts emits image parts on the wire only when the active model is vision-capable (mirror the user branch at 221-247; silent text-only degradation otherwise) + tests in src/lib/chat/projection.test.ts (pattern: T013 user-parts block).
- [ ] T021 [US3] Backprop round-trip: positioned `[image]` markers in raw payload in src/lib/chat/propagation.ts; artifact rows carry propagated image parts via the T019 `insertAnchored` (propagation callers in src/lib/stores/chat.svelte.ts and src/lib/agent/deterministic-tools.ts); render artifact parts with the shared image presentation in src/lib/components/chat/rows/PropagatedArtifact.svelte; tests in src/lib/chat/propagation.test.ts (depends on T019, T010).
- [ ] T022 [US3] Download affordance in the shared lightbox (native `<a download>`, filename from the part's `name`): shared component from T010 + reuse in UserMessage.svelte; full-size and download each ≤2 actions from the thumbnail (depends on T010).
- [ ] T023 [US3] Portability verification: extend src/lib/db/repositories/search.test.ts with assistant image-row invariants (text findable, base64 never matches); run the S6 regression pass (selection/anchoring on segmented messages, backup/restore round trip incl. artifact parts).

**Checkpoint**: All stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T024 [P] Repoint the four dangling `contracts/message-parts.md` code comments to specs/030-image-generation/contracts/message-parts.md: src/lib/stores/chat.svelte.ts:159,479; src/lib/chat/projection.ts:230; src/lib/chat/projection.test.ts:115.
- [ ] T025 [P] Perf probe measurement (constitution IV): streaming render with and without pending images via `window.__MAYON_PERF__` + `localStorage.mayon_perf_scenario`; record before/after numbers; confirm no user-perceptible regression for image-less replies.
- [ ] T026 Full gates + validation: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`, then the full quickstart.md S1–S6 pass (incl. manual S6 smoke on the dev stack).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: no deps; BLOCKS T006 and T011.
- **Phase 2 (T002)**: no deps; BLOCKS T008/T009.
- **US1 (Phase 3)**: depends on T001 + T002.
- **US2 (Phase 4)**: T013–T017 depend only on Phase 2 (parallelizable with US1 — different files); T018 depends on T008 (chat.svelte.ts is US1's file; run T018 after US1).
- **US3 (Phase 5)**: T019/T020 are file-independent (may start after Phase 2); T021/T022 depend on T010 (shared rendering); T023 last.
- **Polish (Phase 6)**: after all stories.

### User Story Dependencies

- **US1**: after T001 + T002 — no story deps.
- **US2**: independently implementable except T018 (needs US1's turn plumbing).
- **US3**: depends on US1's rendering (T010) and persisted assistant parts; T019/T020 have no US1 code dep.

### Parallel Opportunities (respecting the ≤6-tasks-per-subgroup convention)

- After Phases 1–2: T003, T004, T005, T007, T011, T013, T019, T020 are all [P] and file-disjoint.
- US1 implementation core (T006 → T008 → T009 → T010 → T012) is sequential (same turn pipeline).
- US2: T015/T016/T017 run in parallel after T014.
- US3: T019, T020 parallel; then T021, T022 parallel; T023 last.

### Parallel Example: immediately after T001 + T002

```text
Subgroup A (tests + labels):  T003, T004, T005, T007
Subgroup B (fixture):         T011
Subgroup C (US2 start):       T013 → T014 → T015/T016/T017
Subgroup D (US3 repo/proj):   T019, T020
Then sequential core:         T006 → T008 → T009 → T010 → T012 → T018 → T021 → T022 → T023 → T024/T025 → T026
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 (spike) → T002 (budget) → US1 test trio (T003–T005) → core pipeline (T006 → T008 → T009 → T010) → fixture + e2e (T011, T012).
2. **STOP and VALIDATE**: quickstart S1–S5 pass — images arrive, render, persist, reload, and e2e rides the real proxy path.

### Incremental Delivery

US1 (MVP) → US2 (indication + typed failures) → US3 (download, backprop, continuation, portability verification) → Polish (T024–T026).

### Parallel Team Strategy

One agent on the sequential US1 pipeline while others take US2 (T013–T017) and US3's T019/T020; converge on T018, T021–T023, then Polish.

---

## Notes

- [P] = different files, no dependency on incomplete tasks; keep subgroups ≤6 tasks when dispatching parallel agents.
- Test tasks fail first (constitution II); every story's regression coverage lives with the story.
- No new dependencies, no schema migration, no server changes (research R-1, R-4).
- Commit after each task or logical group; worktree branch `030-image-generation` — do not merge to `main`.
