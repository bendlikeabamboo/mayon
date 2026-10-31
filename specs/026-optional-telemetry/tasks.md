# Tasks: Optional User-Defined Telemetry (Langfuse First)

**Input**: Design documents from `/specs/026-optional-telemetry/` (spec.md, plan.md, research.md, data-model.md, contracts/telemetry-api.md, contracts/langfuse-ingestion.md, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — the constitution (II. Testing Standards) requires tests for new behavior in `src/lib/` and `server/src/`, and quickstart.md specifies the automated scenarios. Test tasks come first per story (write → fail → implement → green).

**Organization**: Tasks grouped by user story; each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 mapping to spec.md user stories
- Exact file paths in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and dev environment wiring every story depends on

- [X] T001 Define telemetry types in `packages/shared/src/protocol.ts` (TelemetryConfig, TelemetryConfigInput, TelemetryEventRecord with kind/chatId/model/provider/usage/outcome/content fields, TelemetryStatus, events request body) per `specs/026-optional-telemetry/data-model.md` and `contracts/telemetry-api.md`; run `pnpm --filter @mayon/shared build`
- [X] T002 [P] Add `MAYON_LANGFUSE_SECRET_KEY` passthrough to the server service environment in `docker-compose.dev.yml` (unset by default; document the opt-in in the file comment)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server module scaffold all stories build on

- [X] T003 Create `server/src/telemetry.ts` exporting `registerTelemetry(app)` (empty route set), wire it into `buildApp` in `server/src/server.ts` per the `registerX` pattern, and implement the config read helper (settings KV `telemetry` row, absent ⇒ disabled, 5s TTL cache — `getSecurityMode` precedent in `server/src/server.ts:55-84`)

**Checkpoint**: Foundation ready — user story work can begin

---

## Phase 3: User Story 1 — Strictly opt-in, provably silent when off (Priority: P1) 🎯

**Goal**: Off-by-default telemetry with a network-verifiable zero-emission guarantee, a working enable/disable toggle, and immediate disable that discards pending work (spec FR-001/FR-002/FR-003)

**Independent Test**: quickstart V0 — fresh stack chats normally with zero telemetry-related outbound requests; disabling mid-session stops everything immediately

### Tests for User Story 1

- [X] T004 [P] [US1] Server route tests in `server/src/telemetry.test.ts`: `PUT /api/telemetry/config` shape validation (400), absent settings row ⇒ disabled, enable persists row, disable triggers pipeline reset (buildApp + app.inject pattern from `server/src/llm-proxy.test.ts`)
- [X] T005 [P] [US1] Web tests in `src/lib/telemetry/telemetry.test.ts`: telemetry state boot-initializes from settings KV and defaults to disabled; `emitTelemetry` no-ops synchronously when disabled (pglite `useFileTestDb()` pattern)

### Implementation for User Story 1

- [X] T006 [US1] Implement `PUT /api/telemetry/config` in `server/src/telemetry.ts`: shape validation, server-side settings-row write with `updatedAt`, synchronous queue-drop hook on disable (stub `reset()` until Phase 4 wires the real pipeline)
- [X] T007 [US1] Implement `src/lib/telemetry/state.svelte.ts` (reactive singleton: enabled/host/publicKey/captureMode, boot init via `repos.settings`, update on config change) and `src/lib/telemetry/capture.ts` with the gated `emitTelemetry(record)` entry point (immediate return when disabled)
- [X] T008 [US1] Create the settings section: `src/lib/components/settings/TelemetrySection.svelte` (enable toggle, host/publicKey fields, capture-mode select, plain-language disclosure of what is sent where), register it in `src/lib/settings/sections.ts` (cap: null) and mount it in `src/routes/settings/+page.svelte`; writes go through `PUT /api/telemetry/config` via `serverClient`
- [X] T009 [US1] E2E V0 in `tests/e2e/telemetry.spec.ts`: onboarded session chats via the mock-llm fixture while a Playwright request listener asserts zero requests matching `/api/telemetry/` or the configured host

**Checkpoint**: US1 fully testable alone — off-state guarantee, toggle machinery, immediate disable

---

## Phase 4: User Story 2 — LLM interactions become structured traces in Langfuse (Priority: P2)

**Goal**: Every LLM interaction (chat turns, side generators, MCP sampling) captured at the trace seam, relayed same-origin, and delivered by the server pipeline to the owner's Langfuse with session grouping (spec FR-006/FR-007/FR-011/FR-012)

**Independent Test**: quickstart V2/V3 — multi-turn conversation appears in Langfuse as per-turn traces grouped under one session with model/input/output/usage/duration; error and abort turns arrive as errored records

### Tests for User Story 2

- [X] T010 [P] [US2] Pipeline tests in `server/src/telemetry-ingest.test.ts`: queue bound 500 + drop-oldest, flush cadence, backoff cap 60s, `reset()` drops queue (FR-003 regression), Langfuse client probe classification and trace-create/observation-create mapping per `contracts/langfuse-ingestion.md` (via `vi.stubGlobal('fetch', ...)` pattern from `server/src/llm-proxy.test.ts`)
- [X] T011 [P] [US2] Web capture/relay tests appended to `src/lib/telemetry/telemetry.test.ts`: chat-turn record assembly from the trace seam (input/output/usage/duration/outcome/chatId), 128 KiB field caps with truncation marker, relay buffer bound 50 / 5s drop-oldest, discard on disable (`vi.mock('ai')` pattern from `src/lib/stores/chat.svelte.test.ts`)

### Implementation for User Story 2

- [X] T012 [US2] Implement `server/src/telemetry-ingest.ts`: bounded queue, interval flush (≤5s / ≤20 records), exponential backoff ≤60s, best-effort shutdown flush, status projection (queueDepth/lastDeliveredAt/lastError), `reset()`, and the Langfuse client (probe + batched `POST /api/public/ingestion`, Basic auth from `MAYON_LANGFUSE_SECRET_KEY`, client-generated event ids for idempotency) per `contracts/langfuse-ingestion.md`
- [X] T013 [US2] Implement `POST /api/telemetry/events` in `server/src/telemetry.ts`: batch validation (≤50 records, ≤2 MiB bodyLimit), 409 when disabled/unconfigured, enqueue into the pipeline; wire the real `reset()` into the US1 disable path (T006)
- [X] T014 [US2] Implement chat-turn capture at the trace seam in `src/lib/telemetry/capture.ts` fed from `src/lib/agent/loop.ts` (turn completion/error/abort, modelId, usage from the `finish` part) and `src/lib/stores/chat.svelte.ts` (chatId, duration, persisted final text) per research D1/D7; applies content caps and hands records to the relay
- [X] T015 [US2] Implement `src/lib/telemetry/relay.ts`: bounded in-memory buffer (≤50 records / ≤5s window), drop-oldest, fire-and-forget `POST /api/telemetry/events` via `serverClient` (never blocks or throws into the chat path), full discard on disable
- [X] T016 [P] [US2] Emit records from the side generators and MCP sampling: tap `src/lib/ai/generate-title.ts` (title), the brief generator call site in `src/lib/stores/chat.svelte.ts`, `src/lib/stores/quizzes.svelte.ts` (quiz + grading), `src/lib/stores/labs.svelte.ts` (lab), `src/lib/ai/generate-branch-artifact-summary.ts` (branch-summary), and `src/lib/mcp/sampling.ts` (mcp-sampling) — each emitting a `TelemetryEventRecord` with its kind and chatId via the unified trace shape in `src/lib/agent/trace.ts`
- [X] T017 [US2] Add the stub Langfuse receiver fixture (serves `GET /api/public/projects` and records `POST /api/public/ingestion` batches) under `tests/fixtures/` and extend `tests/e2e/telemetry.spec.ts` with V2 (session grouping, model/usage mapping) and V3 (error/abort records) scenarios against it

**Checkpoint**: With telemetry on, full conversations land in Langfuse; chat latency and fault behavior unchanged

---

## Phase 5: User Story 3 — Owner controls what content leaves (Priority: P3)

**Goal**: Capture modes — full content vs metadata-only — enforced at assembly time in the browser, with plain-language consequences at selection and immediate effect on switch (spec FR-008/FR-009)

**Independent Test**: quickstart V4 — metadata-mode conversations contain a distinctive passphrase that appears nowhere in the destination while structure (model/usage/timing/session) stays intact

### Tests for User Story 3

- [X] T018 [P] [US3] Tests: metadata-mode stripping unit cases in `src/lib/telemetry/telemetry.test.ts` (input/output keys absent, not empty), defense-in-depth inject case in `server/src/telemetry.test.ts` (record with content fields under mode=metadata ⇒ 400, not enqueued), V4 e2e passphrase-absence assertion in `tests/e2e/telemetry.spec.ts`

### Implementation for User Story 3

- [X] T019 [US3] Implement mode-based stripping in `src/lib/telemetry/capture.ts`: metadata mode omits input/output at assembly (mode read per record from `state.svelte.ts`, so a switch applies to the next record without restart), truncation marker preserved
- [X] T020 [US3] Add the server-side second gate to `POST /api/telemetry/events` in `server/src/telemetry.ts`: reject records carrying content fields while active config says metadata (400 `{ error: 'content in metadata mode' }`)
- [X] T021 [US3] Present capture-mode consequences at the point of choice in `src/lib/components/settings/TelemetrySection.svelte` (per-field what-leaves/what-stays copy per FR-008) and make switching immediate (no restart)

**Checkpoint**: Modes work end-to-end; US1 + US2 unaffected in content mode

---

## Phase 6: User Story 4 — Connection setup and delivery health visible (Priority: P4)

**Goal**: Validated, guided destination setup (probe on save with specific failure classes) and a persistent delivery-health status (spec FR-004/FR-005/FR-010)

**Independent Test**: quickstart V1/V6 — wrong key and unreachable host each report their specific failure; taking the destination offline leaves chats unaffected while status shows the failure, then recovers on restore

### Tests for User Story 4

- [X] T022 [P] [US4] Tests in `server/src/telemetry.test.ts`: probe outcomes on enable (unreachable vs rejected vs missing `MAYON_LANGFUSE_SECRET_KEY`, previous active config retained on failure), `GET /api/telemetry/status` payload truthfulness against simulated pipeline state

### Implementation for User Story 4

- [X] T023 [US4] Implement the destination probe in `PUT /api/telemetry/config` in `server/src/telemetry.ts`: authenticated `GET {host}/api/public/projects` (5s timeout, server-side so the secret never transits the browser), classified 409 responses per `contracts/telemetry-api.md`, run before persisting any enable/destination change
- [X] T024 [US4] Implement `GET /api/telemetry/status` in `server/src/telemetry.ts` returning `TelemetryStatus` (configured/enabled/captureMode/secretPresent/queueDepth/lastDeliveredAt/lastError) projected from the config cache and pipeline state
- [X] T025 [US4] Wire validation feedback and delivery health into `src/lib/components/settings/TelemetrySection.svelte`: per-case failure messaging from the probe, status line (last delivery time / persistent failure) polled via `serverClient` only while the section is mounted, and a `secretPresent: false` hint naming `MAYON_LANGFUSE_SECRET_KEY`

**Checkpoint**: All four stories independently functional; full spec surface delivered

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T026 [P] Document the telemetry seam in `docs/reference/seams.qmd` (capture tap → same-origin relay → outbound Langfuse client, secret handling via env) and add the user-facing how-to snippet for enabling telemetry
- [X] T027 Measure capture/relay overhead with the perf probe (`window.__MAYON_PERF__ = 1`, before/after scenarios) per constitution IV and record the results in the feature PR description
- [X] T028 Run the full `specs/026-optional-telemetry/quickstart.md` V0–V7 pass and the complete gate set green: `pnpm --filter @mayon/shared build`, `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate; T002 parallel with T001
- **Foundational (Phase 2)**: after T001; blocks all stories
- **User Stories**: US1 → US2 → {US3 ∥ US4} → Polish. US2 builds on US1's state/capture-gate and config route; US3 builds on US2's capture/relay; US4's status projection builds on US2's pipeline. US3 and US4 are mutually independent and can run in parallel.
- **Polish**: after all implemented stories

### Within Each User Story

- Tests first (they must fail against the un-implemented behavior)
- Server pipeline before the routes that feed it (T012 → T013); capture assembly before relay consumption (T014 → T015)
- Story checkpoint before moving on

### Parallel Opportunities

- T001 ∥ T002 (Phase 1)
- T004 ∥ T005 (US1 tests, different packages)
- T010 ∥ T011 (US2 tests, different packages); T016 parallel with T014/T015 (different files, both depend only on the capture module's record type)
- US3 ∥ US4 (Phases 5 and 6) once US2 lands
- T026 ∥ T027 (Polish)

## Parallel Example: User Story 2

```bash
# After T012–T015 land, dispatch in parallel:
Task: "T016 side-generator taps (title/brief/quiz/grading/lab/branch-summary/mcp-sampling)"
# And in parallel (test files):
Task: "T010 server pipeline tests (telemetry-ingest.test.ts)"
Task: "T011 web capture/relay tests (telemetry.test.ts)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (types, env, scaffold)
2. Phase 3 (US1): off-by-default + toggle + zero-emission proof
3. **STOP and VALIDATE**: quickstart V0 independently
4. First user-visible value ships with US2 (traces in Langfuse); US1 alone is the trust precondition

### Incremental Delivery

1. US1 → validate (V0) → 2. US2 → validate (V2/V3) → 3. US3 ∥ US4 → validate (V4 / V1+V6) → 4. Polish (T026–T028)

### Sub-agent Grouping (repo constraint)

When implementing via `/speckit.implement`: split tasks into subgroups of **no more than 6 tasks each** and launch parallel-capable subgroups (marked above) in parallel agents, respecting the dependency graph.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks
- Every task carries its normative reference: contracts/telemetry-api.md, contracts/langfuse-ingestion.md, data-model.md, research.md decisions D1–D9, quickstart.md scenarios
- Verify tests fail before implementing; regression coverage for FR-003 (disable drops queue) is constitution-mandatory
- No drizzle migration in this feature — the `telemetry` settings KV row needs no schema change; do not run `pnpm db:generate`
- `@mayon/shared` must be rebuilt after T001 and before any consumer work
