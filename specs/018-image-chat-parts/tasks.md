---

description: "Task list for 018-image-chat-parts"
---

# Tasks: Image-First Chat (Multimodal-Ready)

**Input**: Design documents from `/specs/018-image-chat-parts/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution (§II Testing Standards) requires tests for new behavior
in `src/lib/` and `server/src/`, plus a regression test guarding the `search_vec` invariant —
so test tasks appear in every story phase (write first, confirm they fail, then implement).

**Organization**: Tasks are grouped by user story (US1 paste-and-read loop, US2 vision gating,
US3 durability/search/backup, US4 graceful big screenshots). Design shorthand: "parts" =
`MessagePart[]` per `data-model.md`; "downsize" = the D3 pipeline (1568 px / JPEG q0.85 /
≤500 KB target); "vision flag" = `ProviderConfig.vision` per `contracts/provider-vision-flag.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Every task names exact file paths

## Path Conventions

Existing pnpm workspace (no new top-level dirs): SPA app in `src/`, server in `server/src/`,
shared schema referenced from `src/lib/db/schema.ts`, generated migrations in `drizzle/`,
spec/design docs in `specs/018-image-chat-parts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm clean baseline before any feature work

- [X] T001 [P] Verify baseline gates are green on branch `018-image-chat-parts` before changes: run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test` and record results (fix environment, not code, if red)

**Checkpoint**: Baseline green — feature work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Storage + transport infrastructure that MUST be complete before ANY user story.
All parts encoding follows `contracts/message-parts.md`; schema change per `data-model.md`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Define the `MessagePart` union (`TextPart`, `ImagePart` per `data-model.md` §Entity: MessagePart) plus derivation helpers `partsOf(message)` and `textOf(message)` (null/malformed `parts` ⇒ derive `[{type:'text', text: content}]`; unknown kinds preserved) in `src/lib/chat/kinds.ts`
- [X] T003 Add nullable `parts` text column to the `messages` table in `src/lib/db/schema.ts`, then run `pnpm db:generate` to create the additive migration in `drizzle/` (no data backfill; verify journal updated and pglite test DB migrates cleanly)
- [X] T004 Extend `messagesRepo.append()` in `src/lib/db/repositories/messages.ts` with an optional `parts?: MessagePart[]` opt per `contracts/message-parts.md` §2: validate (≥1 part, ≤8 image parts, text-parts concatenation === `content`), serialize to JSON, store in the SAME INSERT as `content`; rows without `parts` write NULL exactly as today
- [X] T005 [P] Register `POST /api/db/query` with `bodyLimit: 16 * 1024 * 1024` in `server/src/pg.ts` (route schema/handler/503-restoring behavior unchanged, per `contracts/http-limits.md`)
- [X] T006 [P] Register `POST /api/llm/proxy` with `bodyLimit: 16 * 1024 * 1024` in `server/src/llm-proxy.ts` (envelope and byte-pipe passthrough unchanged)
- [X] T007 Add server tests proving bodies just over the old 1 MiB default now succeed: a `params` INSERT carrying a >1 MiB base64 string through the query handler in `server/src/pg.test.ts`, and a >1 MiB opaque `body` through the proxy in `server/src/llm-proxy.test.ts`

**Checkpoint**: Foundation ready — parts can be stored/retrieved atomically and multi-MiB payloads clear both routes. User story implementation can now begin.

---

## Phase 3: User Story 1 — Paste a screenshot and the model reads it (Priority: P1) 🎯 MVP

**Goal**: A user pastes/attaches an image with a vision-capable model, sends with text, the model
answers about the image, and the sent message shows text + image thumbnail.

**Independent Test**: Paste a screenshot into the composer of a vision-capable chat, send a
question about it, verify the reply reflects the image contents and the image renders in the
conversation (quickstart.md Scenario 1).

### Tests for User Story 1 ⚠️

> Write first; confirm FAIL against the unimplemented tree (they will fail to compile/run until
> T002–T004 and the US1 implementation land).

- [X] T008 [P] [US1] Repository round-trip test: `append` with `parts` stores content = text-parts concat and parts JSON atomically; legacy NULL-parts rows derive `[{type:'text'}]` via `partsOf`; >8 image parts rejected — in `src/lib/db/repositories/repositories.test.ts`
- [X] T009 [P] [US1] Projection test: a user row with parts projects to `ModelMessage` content `[{type:'text'},{type:'image',image:<dataURL>},…]`; image-less rows produce output byte-identical to today's snapshots — in `src/lib/chat/projection.test.ts`
- [X] T010 [P] [US1] Store test: `send(text, { effort, attachments })` persists ONE user row carrying parts before the LLM call; a failed send leaves no row and retry restores text + attachments — extend `src/lib/stores/chat.svelte.test.ts`

### Implementation for User Story 1

- [X] T011 [US1] Create image intake module `src/lib/chat/images.ts` per research.md D3/D9: accept `File`/`Blob` → magic-byte mime sniff (PNG/JPEG/WebP/GIF), reject others and >20 MB inputs with clear messages, ≤8-per-message cap enforcement, downsize via `createImageBitmap`+canvas (long edge ≤1568 px, JPEG q0.85, flat white background for alpha, target ≤~500 KB), pass through small sources (≤~300 KB and ≤1568 px) untouched, animated GIF → first frame, emit `ImagePart` (data-URL, mimeType, width, height, bytes, optional name)
- [X] T012 [P] [US1] Add optional `parts?: MessagePart[]` to `ChatMessage` in `src/lib/ai/types.ts` and carry message parts through `assembleContext` in `src/lib/chat/context.ts` (string `content` unchanged for all existing consumers)
- [X] T013 [US1] Project parts-bearing user rows to text + image `ModelMessage` parts in `src/lib/chat/projection.ts` (reuse existing parts-array merging; image part `image` = data-URL string; rows without parts unchanged) — depends on T002, T012
- [X] T014 [US1] Wire attachments through the send flow: `chatStore.send(prompt, { effort, attachments })` → `repos.messages.append(chatId, 'user', textContent, { parts })` in `src/lib/stores/chat.svelte.ts`, and extend the route's `onSend` invocation in `src/routes/chat/[id]/+page.svelte`; failure/retry state (`lastFailedPrompt`) carries attachments — depends on T004, T011
- [X] T015 [US1] Composer attachments UI in `src/lib/components/chat/Composer.svelte`: paste handler capturing image clipboard items (non-image pastes keep existing behavior), paperclip file input, thumbnail strip with per-item remove, sending `ComposerAttachment[]` via `onSend` — depends on T011
- [X] T016 [US1] Render image parts in the user bubble in `src/lib/components/chat/rows/UserMessage.svelte`: thumbnails from `partsOf()` rendered as sibling elements OUTSIDE the Markdown pipeline (no sanitize-schema change), click to expand full image; switch any content-string trim consumers (`src/lib/components/chat/MessageList.svelte`) to `textOf()` — depends on T002
- [X] T017 [US1] Verify User Story 1 independently: T008–T010 green, `pnpm check`/`pnpm lint` green, then manual quickstart.md Scenario 1 (paste screenshot → model reads it) on `pnpm dev`

**Checkpoint**: MVP — paste/attach → send → model reads image → renders in history. Demoable and valuable on its own.

---

## Phase 4: User Story 2 — The attach affordance respects the connected model (Priority: P2)

**Goal**: Paperclip appears only for vision-advertised models (`auto` allowlist / `on` / `off`);
image sends to unadvertised models fail with a clear typed error, permissive posture preserved.

**Independent Test**: Connect a vision-capable model (paperclip visible) vs non-vision model
(paperclip hidden; forced image send yields the dedicated "doesn't accept images" error with
working Retry) — quickstart.md Scenario 3.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] Resolver table test for `supportsVision(config, modelId)`: `'on'`→true, `'off'`→false, absent/`'auto'`→allowlist prefix match (vision families from research.md D5), case-insensitive — in new `src/lib/ai/vision-capability.test.ts`
- [X] T019 [P] [US2] Error classification test: an image-bearing send failing with a provider 4xx (image-rejection body) maps to the dedicated image-unsupported error shape `{title, message, hint}` — in `src/lib/ai/errors.test.ts`

### Implementation for User Story 2

- [X] T020 [US2] Create resolver `src/lib/ai/vision-capability.ts` (`supportsVision`, static allowlist, pure/synchronous — no network probing) and add `vision?: 'auto' | 'on' | 'off'` to `ProviderConfig` in `src/lib/ai/types.ts`; seed sensible defaults in provider templates in `src/lib/ai/registry.ts` where `toolCapability` is already seeded — depends on T012
- [X] T021 [US2] Gate the paperclip on `supportsVision(activeConfig, activeModel)` in `src/lib/components/chat/Composer.svelte` (paste-with-image stays permissive/allowed regardless; evaluated per send) — depends on T020, T015
- [X] T022 [US2] Add the image-unsupported branch to `formatProviderError` in `src/lib/ai/errors.ts` (clear title/message/hint: remove attachment or switch models) with passthrough in `src/lib/ai/sdk-errors.ts`, triggered only when the failed request carried image parts — depends on T019
- [X] T023 [US2] Add a three-state `vision` control next to the existing tool-capability control in `src/lib/components/ai/ProviderConfig.svelte` (absent renders as `auto`) — depends on T020
- [X] T024 [US2] Verify User Story 2 independently: T018–T019 green, then manual quickstart.md Scenario 3 (gate + error + override behavior) on `pnpm dev` — depends on T021, T022, T023

**Checkpoint**: US1 + US2 both work independently; capability posture matches contracts/provider-vision-flag.md.

---

## Phase 5: User Story 3 — Images persist and ride the existing durability story (Priority: P3)

**Goal**: Images survive reloads, text search is unchanged (extracts from message text only,
never image data), and backup/restore preserves images.

**Independent Test**: Send text+image → reload (image renders) → search the text word (found,
snippet highlighted) → backup → restore → images still render (quickstart.md Scenario 5).

### Tests for User Story 3 ⚠️

- [X] T025 [US3] Search-invariant regression test (constitution-gated): a parts-bearing row (text + image) is found via the real generated `search_vec` by its text-part words with `ts_headline` snippet; image/base64 data never matches; existing search tests unaffected — extend `src/lib/db/repositories/search.test.ts` (depends on T002, T004; must FAIL before T004 lands if written first)
- [X] T026 [US3] Restore-path test: a dump containing parts-bearing rows re-imports with `parts` intact and `search_vec` recomputed (assert `search_vec IS NOT NULL` for a text-part query, mirroring the existing assertion) — extend `server/src/pg-import.test.ts` (depends on T025)

### Implementation for User Story 3

- [X] T027 [US3] Verify durability end-to-end per quickstart.md Scenario 5 on `pnpm dev`: reload persistence, search behavior, and a full backup → restore cycle with images present (no product code expected — this story is delivered by T002–T004 riding pg_dump; fix anything this surfaces) — depends on T016, T026

**Checkpoint**: All durability promises hold with images in the store; search invariant regression-proofed.

---

## Phase 6: User Story 4 — Big screenshots are handled gracefully (Priority: P4)

**Goal**: Multi-MB retina screenshots are downsized before store/send with no composer freeze;
small images pass through untouched.

**Independent Test**: Attach a ~3 MB screenshot → transmitted image is several-fold smaller,
screenshot text still model-legible; composer stays responsive (quickstart.md Scenarios 2+4).

### Tests for User Story 4 ⚠️

- [X] T028 [US4] Downsize bounds tests with small fixture images (generate tiny PNG/JPEG/GIF/WebP fixtures in-test): oversize input → JPEG output within target bounds; small PNG passthrough byte-unchanged; GIF → first frame; unsupported mime rejected — in new `src/lib/chat/images.test.ts` (depends on T011)

### Implementation for User Story 4

- [X] T029 [US4] Verify composer responsiveness per quickstart.md Scenario 4 with the perf probe (`window.__MAYON_PERF__ = 1`): attach several multi-MB screenshots, confirm no long-task freeze and ≤~2 s attach for a typical screenshot; if the canvas work blocks input, move encoding off the input path (yield between images) in `src/lib/chat/images.ts` — depends on T015, T028
- [X] T030 [US4] Verify downsizing scenarios manually per quickstart.md Scenarios 2 (network panel: stored/sent image ≤~500 KB, screenshot text legible to the model) — depends on T029

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Trace fidelity, alignment guard, final gates

- [X] T031 [P] Request-trace fidelity: make the trace flattening in `src/lib/agent/loop.ts` (`extractPartContent`/`toTracedRequestMessage`) emit a short `[image N×W×H]` placeholder for image parts instead of silently dropping them (traces stay text-only, no base64)
- [X] T032 [P] Expound guard verification: confirm no new markdown-injected DOM was added (images render outside the pipeline) and `src/lib/chat/selection.ts` alignment tests still pass; add selectors to the exclusion list ONLY if implementation introduced text-bearing injected elements
- [X] T033 Run the full merge gates in order and fix anything red: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`
- [ ] T034 Run the complete quickstart.md validation pass (Scenarios 1–6) on `pnpm dev` and record results — depends on T017, T024, T027, T030

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on Setup; **BLOCKS all user stories** (T002 types → T003 column → T004 repo; T005/T006 limits independent of T002–T004)
- **US1 (Phase 3)**: depends on Foundational — delivers the MVP
- **US2 (Phase 4)**: depends on US1's Composer (T015) since it gates the paperclip US1 introduced
- **US3 (Phase 5)**: test tasks depend only on Foundational (T002–T004); T027's end-to-end pass depends on US1 rendering (T016)
- **US4 (Phase 6)**: depends on US1's intake module (T011) and Composer (T015)
- **Polish (Phase 7)**: depends on the stories it polishes (T033/T034 last)

### User Story Dependencies

- **US1**: Foundation → MVP (no other story dependencies)
- **US2**: US1 (Composer) — independently testable once T015 exists
- **US3**: Foundation for tests; US1 for the manual end-to-end
- **US4**: US1 (images.ts + Composer) — tuning/verification of US1's pipeline

### Within Each User Story

- Tests first (T0xx marked as tests) → confirm FAIL → implementation → verify task last
- Types (T002/T012) before services (T011/T013) before UI wiring (T014–T016)

### Parallel Opportunities

- T002, T005, T006 (Foundation) run together — different files
- T008, T009, T010 (US1 tests) run together; likewise T018/T019 (US2 tests)
- T012 alongside T011 (different files, both depend only on Foundation)
- T031, T032 (Polish) run together
- After US1 completes, US2/US3-test tasks can proceed concurrently (different files)

## Parallel Example: Foundation + US1 kickoff

```bash
# Together (different files, no shared dependencies):
Task: "T002 MessagePart union + partsOf/textOf in src/lib/chat/kinds.ts"
Task: "T005 bodyLimit on /api/db/query in server/src/pg.ts"
Task: "T006 bodyLimit on /api/llm/proxy in server/src/llm-proxy.ts"

# Then (after T002): together
Task: "T008 repo parts round-trip test in src/lib/db/repositories/repositories.test.ts"
Task: "T009 projection test in src/lib/chat/projection.test.ts"
Task: "T010 store send test in src/lib/stores/chat.svelte.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational (T001–T007)
2. Phase 3 US1 (T008–T017)
3. **STOP and VALIDATE**: quickstart.md Scenario 1 — paste a stack-trace screenshot, model reads it
4. This alone ships the feature's demo ("week one: paste a screenshot and the model reads it")

### Incremental Delivery

1. Foundation → US1 → validate (MVP)
2. +US2 (gating + errors) → validate Scenario 3
3. +US3 (invariant + durability proofs) → validate Scenario 5
4. +US4 (perf + bounds) → validate Scenarios 2+4
5. Polish gates → feature complete

### Dispatch Note

Story phases exceed a single comfortable subagent batch; when implementing, dispatch in
subgroups of at most 6 tasks (e.g., Foundation split as T002–T004 / T005–T007; US1 as
tests T008–T010 / intake+wire T011–T014 / UI T015–T017), each subgroup run by a separate
subagent with the design docs as context.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps tasks to spec user stories for traceability
- The `search_vec` invariant test (T025) is the constitution-gated regression — never weaken it
- No new runtime dependencies anywhere (Canvas API + native file input only)
- Stop at any checkpoint to validate the story independently; commit after each task or logical group
