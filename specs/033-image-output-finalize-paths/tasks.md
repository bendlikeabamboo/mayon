# Tasks: Image Output Finalize & Follow-Up Paths

**Input**: Design documents from `/specs/033-image-output-finalize-paths/` (plan.md, research.md, data-model.md, contracts/, quickstart.md; issue #70)

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included — the spec's FR-008 and the repo constitution (II) mandate a fail-first regression test for every bug fix. Tests marked FAIL-FIRST must be written and shown to fail before their implementation task runs.

**Organization**: Tasks grouped by user story (spec §User Scenarios). All seven stories fix the same finalize/persist path; phases are ordered so shared seams land first and each story's tests run against the real loop/store code (no `runAgentTurn` re-mocks on abort paths — FR-008).

## Phase 1: Setup

**Purpose**: Align the living 030 contracts with the 033 refinements before code cites them.

- [ ] T001 Amend the two 030 contract files in place per specs/033-image-output-finalize-paths/contracts/: `specs/030-image-generation/contracts/message-parts.md` §5 (assistant wire shape → provider file part) and `specs/030-image-generation/contracts/stream-image-parts.md` §2 (arrival offsets + recognized-count signal), §3 (arrival-order composition, caps with drop notices, image-only rows), §4 (abort persists all completed turn images incl. current iteration). Cross-reference feature 033.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared recognition→finalize seam changes that four stories depend on. No behavior change yet beyond the seam itself.

- [ ] T002 Extend `consumeStream` in `src/lib/agent/loop.ts` (~:202-311): new `imageSink: ImageCandidate[]` parameter (recognition at the `collectStreamImages` site ~:278-279 pushes into the sink, stamping each candidate with `offset` = current text length via the existing `textLength()` callback), plus optional `onImageRecognized` callback invoked at recognition; the returned `images` array is the sink at normal completion. Update the loop's call site to pass `turnImages`-backed arrays.
- [ ] T003 Extend the finalize-handoff types in `src/lib/agent/loop.ts` (`AgentTurnDeps.appendAssistantText` opts ~:41-44): `images` entries become `ImageCandidate & { offset?: number }`, add `final?: boolean`; mirror the extension in the store's deps wiring in `src/lib/stores/chat.svelte.ts` (~:694-701) without behavior change. `pnpm check` must pass after this task.

**Checkpoint**: Seam compiles; no story code yet.

---

## Phase 3: User Story 1 — Follow-up turns after an image reply (P1) 🎯 MVP

**Goal**: A follow-up turn in an image-bearing chat reaches the provider (FR-001); permanent "Network error" breakage eliminated.
**Independent Test**: quickstart V1 — `projection.test.ts` + cross-seam loop test under the capped runner.

### Tests for User Story 1 (FAIL-FIRST)

- [ ] T004 [US1] FAIL-FIRST tests in `src/lib/chat/projection.test.ts` (assistant parts describe ~:151): (a) vision-capable assistant row with `[text, image]` parts projects to `[{type:'text'}, {type:'file', mediaType:'image/png', data:'<base64 without data: prefix>'}]`; (b) every emitted part `type` is a member of the SDK `AssistantContent` union (assert against the literal set from `@ai-sdk/provider-utils`); (c) `visionCapable: false`/absent stays text-only; (d) user branch keeps the `{type:'image', image}` shape byte-identically.

### Implementation for User Story 1

- [ ] T005 [US1] Implement in `src/lib/chat/projection.ts`: `wireContent` gains an assistant mode (or the assistant branch maps parts itself) emitting `{ type: 'file', mediaType: p.mimeType, data: <p.data after the first comma> }` for image parts; user branch unchanged; vision gate unchanged (research D1, contracts/assistant-projection.md).

**Checkpoint**: Follow-up turns are SDK-shape-valid; MVP shippable.

---

## Phase 4: User Story 2 — Image-only replies persist (P1)

**Goal**: An images-with-no-text reply becomes a durable row (FR-002).
**Independent Test**: quickstart V2 — image-only stream produces one `content: ''` row with image parts that survives reload.

### Tests for User Story 2 (FAIL-FIRST)

- [ ] T006 [US2] FAIL-FIRST test in `src/lib/agent/loop.test.ts` (030 recognition describe ~:2206): a scripted stream of only a `file` part (no text deltas, `finishReason: 'stop'`) results in exactly one `appendAssistantText('', { images: [...], final: true })` call (today: zero calls).
- [ ] T007 [US2] FAIL-FIRST store test in `src/lib/stores/chat.svelte.test.ts`: same stream through the REAL loop (base implementation, as the attachments describe does) persists one assistant row with `content: ''`, non-null `parts` containing only image parts, and the row is present after `chatStore.load()` reload.

### Implementation for User Story 2

- [ ] T008 [US2] Implement the image-only fallback in `src/lib/agent/loop.ts` finalize path (~:622-647): when `walkPersist` returns null and the turn carries images, call `appendAssistantText('', { images, final: true })` (research D2); verify `composeAssistantParts` in `src/lib/stores/chat.svelte.ts` already omits the empty text part (fix if not) and that the persisted trace event and `builder.empty` semantics stay correct.

**Checkpoint**: Image-only replies persist and render.

---

## Phase 5: User Story 3 — Abort keeps completed images, interrupted (P2)

**Goal**: Stopping mid-reply persists completed images with `metadata.interrupted: true` (FR-003), exercising the real abort paths.
**Independent Test**: quickstart V3 — abort after image arrival yields an interrupted image-bearing row.

### Tests for User Story 3 (FAIL-FIRST)

- [ ] T009 [US3] FAIL-FIRST tests in `src/lib/agent/loop.test.ts` driving the real `consumeStream` abort: (a) stream yields a `file` part + a text delta, then hangs; abort resolves; assert the persist call received the recognized image candidates together with the partial text; (b) abort between iterations (first iteration completes with images + tool-calls, second aborts at once) — images from the first iteration persist; (c) abort with image only (no text) persists an image-only row (depends on T008).
- [ ] T010 [US3] FAIL-FIRST store test in `src/lib/stores/chat.svelte.test.ts` using the REAL loop (not the mocked turn at ~:2167): scripted image stream → `chatStore.stop()` mid-stream → reloaded chat shows the assistant row with image parts and `metadata.interrupted: true`. Update/replace the mocked "(b) abort after an image arrives" test to keep its intent via the real path.

### Implementation for User Story 3

- [ ] T011 [US3] Implement in `src/lib/agent/loop.ts`: hoist the `turnImages.push(...iterationImages)` merge so both abort paths — the consumeStream AbortError catch (~:583) and the between-iterations check (~:617) — persist with the full turn image set; pass images through `walkPersist` on both abort paths plus the defensive abort branches (~:461-468, ~:515-522); route abort persists through the same image-only fallback as T008; mark abort-path finalize appends `final: true` (research D3, contracts/finalize-composition.md §3).

**Checkpoint**: Abort no longer discards completed images.

---

## Phase 6: User Story 4 — Eight-image cap with drop notice (P2)

**Goal**: Nine-image replies keep the first eight plus a notice instead of failing the append (FR-004).
**Independent Test**: quickstart V4.

### Tests for User Story 4 (FAIL-FIRST)

- [ ] T012 [US4] FAIL-FIRST store test in `src/lib/stores/chat.svelte.test.ts`: finalize with nine base64 candidates → one row with exactly 8 image parts and a bracketed notice naming the dropped count; no throw (today: `validateParts` rejects the append and the turn is lost).

### Implementation for User Story 4

- [ ] T013 [US4] Implement the count cap in `composeAssistantParts` in `src/lib/stores/chat.svelte.ts` (~:1017-1050): slice materialized candidates to `MAX_IMAGES_PER_MESSAGE` (import from `src/lib/chat/images.ts`) before decode; append the drop notice via the existing notices mechanism (research D4).

**Checkpoint**: Over-cap replies degrade gracefully.

---

## Phase 7: User Story 5 — Text/image arrival order survives (P2)

**Goal**: `text → image → text` persists parts in arrival order and renders in that order after reload (FR-005; 030 FR-003/SC-001).
**Independent Test**: quickstart V5.

### Tests for User Story 5 (FAIL-FIRST)

- [ ] T014 [US5] FAIL-FIRST tests in `src/lib/agent/loop.test.ts`: (a) an image recognized after a first text stretch carries `offset` equal to the buffer length at arrival; (b) in a two-text-block iteration, an image whose offset falls inside the first block's slice is handed to the FIRST row's append (today: all images ride the last text row).
- [ ] T015 [US5] FAIL-FIRST store test in `src/lib/stores/chat.svelte.test.ts`: `text → image → text` stream persists ONE row with parts `[text-a, image, text-b]` (text parts concatenate to `content`), and reload reproduces that parts order (data-level assertion; the renderer already interleaves).

### Implementation for User Story 5

- [ ] T016 [US5] Implement in `src/lib/agent/loop.ts` + `src/lib/stores/chat.svelte.ts`: `walkPersist` assigns each image to the text row whose slice contains its offset (last row absorbs overflow; no-text → image-only row from T008); `composeAssistantParts` splits the row text at clamped, stable-sorted offsets and interleaves image parts (critic-replacement re-emit appends images after the corrected text — documented best-effort) (research D5, contracts/finalize-composition.md §2).

**Checkpoint**: Ordering fidelity restored.

---

## Phase 8: User Story 6 — Corrupt/oversize bytes contained (P2)

**Goal**: Per-image containment: invalid or un-shrinkable images drop with a notice; text and sibling images always survive (FR-006).
**Independent Test**: quickstart V6.

### Tests for User Story 6 (FAIL-FIRST)

- [ ] T017 [P] [US6] FAIL-FIRST tests in `src/lib/chat/images.test.ts` (`applyOutputBudget` describe ~:331): (a) an ops stub whose `decode` rejects makes `applyOutputBudget` return a `{ images, dropped }`-shaped result (never throw) with the failing image dropped and in-budget siblings untouched; (b) all-in-budget input keeps the existing passthrough result (update call-site expectations for the new return shape).
- [ ] T018 [P] [US6] FAIL-FIRST store test in `src/lib/stores/chat.svelte.test.ts`: one valid candidate + one garbage-base64 candidate + trailing text → row persists with the valid image, the text, and a bracketed per-image notice (today: broken image silently, or finalize rejects and loses everything).

### Implementation for User Story 6

- [ ] T019 [US6] Implement in `src/lib/chat/images.ts` + `src/lib/stores/chat.svelte.ts`: export a sniff-gate helper (`sniffImageMime` over the data-URL bytes — decoder-independent); `applyOutputBudget` wraps `reencodeOutputImage` per image in try/catch and returns `{ images, dropped }`; `composeAssistantParts` validates candidates with the sniff gate before decode, aggregates all drop notices (sniff / cap / budget) through the existing bracketed-notice path; leave `candidateToImagePart`'s 0×0 best-effort probe and 032's `fetchImageCandidate` untouched (research D6).

**Checkpoint**: Damage is contained per image.

---

## Phase 9: User Story 7 — Notices fire when claimed (P3)

**Goal**: Recognition-count-driven failure refinement + zero-image notice on image-expecting successful turns (FR-007; refurbishes 030 FR-007).
**Independent Test**: quickstart V7.

### Tests for User Story 7 (FAIL-FIRST)

- [ ] T020 [US7] FAIL-FIRST test in `src/lib/agent/loop.test.ts`: the `onImageRecognized` dep is invoked once per recognized stream image, before any finalize call.
- [ ] T021 [US7] FAIL-FIRST store tests in `src/lib/stores/chat.svelte.test.ts`: (a) a turn whose stream recognized an image and then failed with a `ProviderHttpError` 4xx surfaces the typed "No image produced" notice (title/message/hint family), not the raw provider error and not "Network error" (today unreachable — `pendingImages` is empty at catch time); (b) a successful text-only turn against an image-output-expected model (stub `supportsImageOutput` true via config `imageOutput: 'on'`) carries the bracketed no-image notice on the final row; (c) the same turn against a non-expected model carries no notice.

### Implementation for User Story 7

- [ ] T022 [US7] Implement in `src/lib/stores/chat.svelte.ts` (+ wire the dep in `src/lib/agent/loop.ts` call path): turn-scoped `streamRecognizedImages` counter incremented by `onImageRecognized`, reset at send start; catch-time refinement (~:875-878) rekeys from `pendingImages.length` to the counter; zero-image notice appended to the row content when a `final` append (T003 marker) completes `!aborted`, `content.trim() !== ''`, counter === 0, and `supportsImageOutput(config, config.defaultModel)` (import from `src/lib/ai/image-output-capability.ts`) — advisory only, never blocks (research D7, contracts/finalize-composition.md §4).

**Checkpoint**: All acceptance bullets of issue #70 hold.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T023 Update load-bearing code comments that cite 030 contract sections whose wording T001 amended (`src/lib/chat/projection.ts` §5 cites, `src/lib/agent/loop.ts` 030 §3/§4 cites, `src/lib/stores/chat.svelte.ts` finalize comments) so citations match the amended contracts; no behavior change.
- [ ] T024 Run the full validation loop under the capped wrapper (quickstart.md): the four touched suites (`projection.test.ts`, `loop.test.ts`, `images.test.ts`, `chat.svelte.test.ts`) one process at a time, then `pnpm check` and `pnpm lint`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: none. T001 first so code comments and contract citations stay truthful.
- **Phase 2 (Foundational)**: after T001; T002 → T003. BLOCKS all stories (the handoff shape and recognition seam are shared).
- **Phase 3+ (Stories)**: strictly ordered US1 → US2 → US3 → US4 → US5 → US6 → US7 because they edit the same three files and later stories build on earlier mechanisms:
  - US2's image-only fallback (T008) is reused by US3's abort paths (T011) and US5's no-text case (T016).
  - US5's per-row offset assignment (T016) must precede US6 (compose changes compound) and US7 (`final` marker consumers) — US4 (T012/T013) may land before or after US5 but is listed first per spec priority; it touches only `composeAssistantParts`.
- **Polish**: after all stories.

### Within Each User Story

- FAIL-FIRST test task runs and is shown failing (run its file under the capped wrapper) BEFORE the implementation task in the same phase.
- Implementation tasks touch the files named in the task; no task spans unrelated files.

### Parallel Opportunities

- T004/T005 (US1, projection) are parallel-safe with T002/T003 leftovers in `loop.ts` (different files) once types exist — but with a single implementer, keep sequential.
- T017 (images.test.ts) is [P]-eligible against T018 (chat.svelte.test.ts) — different files, both test-only.
- All capped test runs are strictly one process at a time (fleet rule overrides any parallelism).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 → T002 → T003 → T004 → T005. STOP and VALIDATE via quickstart V1.
   The chat-unbreaking fix (item 1) is independently shippable here.

### Incremental Delivery

2. US2 (T006-T008) → validate V2. 3. US3 (T009-T011) → validate V3. 4. US4 (T012-T013) → V4.
5. US5 (T014-T016) → V5. 6. US6 (T017-T019) → V6. 7. US7 (T020-T022) → V7.
8. Polish (T023, T024) → full quickstart sweep + `pnpm check` + `pnpm lint`.

---

## Notes

- [P] markers are used sparingly: same-file test→impl pairs are inherently sequential.
- Every FAIL-FIRST task names the exact regression it pins (issue item numbers are mapped in plan.md/research.md).
- Never run plain `pnpm test` / watch mode; always the systemd-run memory-capped wrapper, one process at a time (AGENTS.md fleet rule).
- Do not commit unless the orchestrator instructs; worktree branch discipline per AGENTS.md.
