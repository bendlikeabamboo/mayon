# Tasks: GitHub Copilot Support

**Input**: Design documents from `/specs/016-github-copilot-support/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included by governance — Mayon Constitution Principle II mandates tests for all new behavior in `src/lib/` and `server/src/`. Test tasks are written first within each story and must FAIL before their implementation task is marked complete.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Monorepo: `src/` (SvelteKit SPA), `server/src/` (Fastify server), `packages/shared/src/` (shared protocol). Paths below follow plan.md's Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract types every later task consumes

- [x] T001 Add Copilot endpoint request/response types (`CopilotAuthStartRequest/Response`, `CopilotAuthPollRequest/Response`, `CopilotTokenRequest/Response` per contracts/copilot-server-api.md) to packages/shared/src/protocol.ts and rebuild shared (`pnpm --filter @mayon/shared build`) so consumers resolve types

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Kind registration that must compile before any user story work

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Add `'github-copilot'` to the `ProviderKind` union in src/lib/ai/types.ts (breaks exhaustive structures intentionally — next tasks fix them)
- [x] T003 [P] Register the kind in src/lib/ai/dialects.ts: `KIND_BASELINES` and `KIND_DESCRIPTIONS` entries mirroring openai-compatible semantics, `EXTRA_BODY_ALLOWLISTS` entry (empty set), `namespaceFor` → `'github-copilot'`; extend fixtures in src/lib/ai/dialects.test.ts
- [x] T004 [P] Add `defaultForKind('github-copilot') → true` in src/lib/agent/capability.ts and a covering case in src/lib/agent/capability.test.ts
- [x] T005 Add `CopilotAuthRequiredError` (carries `providerId`) and `CopilotSubscriptionError` classes in src/lib/ai/types.ts, user-facing formatting in src/lib/ai/errors.ts (`formatProviderError`), and pass-through mapping in src/lib/ai/sdk-errors.ts; extend src/lib/ai/errors.test.ts

**Checkpoint**: `pnpm check` green — kind exists end-to-end but no template/adapter yet

---

## Phase 3: User Story 1 — Add GitHub Copilot as a provider and chat with it (Priority: P1) 🎯 MVP

**Goal**: A user adds the GitHub Copilot provider, authorizes via the server-run GitHub device flow, and receives a streamed chat reply

**Independent Test**: Add provider via Settings → connect GitHub → send a message → streamed reply. Verify per quickstart.md Scenario 1.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [x] T006 [P] [US1] Contract tests for device flow in server/src/copilot-auth.test.ts: `POST /api/llm/copilot/auth/start` returns `{flowId, userCode, verificationUri, expiresAt, interval}` with device_code never leaving the server; `/auth/poll` returns `pending` → `complete {githubToken, user.login}` → flow dropped, `slowDownAfter` on slow_down, `404 unknown_flow`, `expired`/`denied` statuses (stub GitHub upstream with `vi.stubGlobal('fetch')`, pattern from server/src/llm-proxy.test.ts)
- [x] T007 [P] [US1] Extend src/lib/ai/registry.test.ts: "GitHub Copilot" template at expected index, catalog length 17→18, invariants hold (https baseUrl, `defaultModel ∈ models`, requiresKey)

### Implementation for User Story 1

- [x] T008 [US1] Add the "GitHub Copilot" `ProviderTemplate` (kind `'github-copilot'`, baseUrl `https://api.githubcopilot.com`, curated fallback models per research D5, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`) to PROVIDER_TEMPLATES in src/lib/ai/registry.ts and to `listProviderKinds()` — makes T007 pass
- [x] T009 [US1] Create server/src/copilot-auth.ts: device-flow routes `POST /api/llm/copilot/auth/start` and `POST /api/llm/copilot/auth/poll` with in-memory flow store (data-model.md `CopilotAuthFlow`), constants module section (client_id `Iv1.b507a08c87ecfe98`, scope `read:user`, GitHub endpoints), `registerCopilotAuth(app)` registered in server/src/server.ts — makes T006 pass
- [x] T010 [US1] Add `POST /api/llm/copilot/token` to server/src/copilot-auth.ts: exchange grant → `{token, expiresAt, endpoint, refreshInSeconds}` from `api.github.com/copilot_internal/v2/token`, with a naive memo (per-grant, reuse until 60s before expiry) and error mapping 401→`grant_invalid`, 403→`not_entitled`, 404/network→`502 upstream` (contracts/copilot-server-api.md); extend server/src/copilot-auth.test.ts
- [x] T011 [US1] Create src/lib/ai/copilot-session.ts: browser-side per-provider session descriptor cache `{token, expiresAt, endpoint}` that calls `/api/llm/copilot/token` when missing/stale and invalidates on `grant_invalid`
- [x] T012 [US1] Create src/lib/ai/copilot-fetch.ts (session-aware fetch: read grant from KeyStore via `get(config.id)` → `MissingKeyError` if absent; ensure session via copilot-session; inject header set `Authorization: Bearer`, `Copilot-Integration-Id: vscode-chat`, `Editor-Version: vscode/1.98.0`, `Editor-Plugin-Version: copilot-chat/0.35.0`, `User-Agent: GitHubCopilotChat/0.35.0`, `x-github-api-version: 2025-05-01`; endpoint = cached endpoint or `config.baseUrl`; delegate to `getLlmFetch()`) and add the `'github-copilot'` branch to `buildSdkModel` in src/lib/ai/sdk-factory.ts using `createOpenAICompatible` with this fetch (research D3)
- [x] T013 [P] [US1] Update src/lib/components/ai/ProviderConfig.svelte: for kind `'github-copilot'` render the device-flow connector (Connect button + status line) in place of the password key input (`:670-693` block), keep `kindRequiresKey` pre-flight and list badges working
- [x] T014 [P] [US1] Create src/lib/components/ai/copilot-auth-dialog.svelte: show `userCode` with copy affordance + `verificationUri` link, poll `/api/llm/copilot/auth/poll` at server-given interval honoring `slowDownAfter`, handle `expired`/`denied`/`unknown_flow` inline; on `complete` call `setProviderKey(providerId, githubToken)` and trigger model discovery refresh (mirror `saveKey()` flow); mount it from the connector in ProviderConfig.svelte
- [x] T015 [US1] Wire unauthorized chat path: with no KeyStore grant, chat throws `MissingKeyError` → verify chat store surfaces "add/connect" guidance (src/lib/stores/chat.svelte.ts via existing `formatProviderError`) and the provider card shows the Connect affordance; no generic stack-trace errors
- [ ] T016 [US1] Manual smoke of quickstart.md Scenario 1 on `pnpm dev` (add → connect → streamed reply); record result in the task

**Checkpoint**: User Story 1 fully functional and independently testable — MVP demo-able

---

## Phase 4: User Story 2 — Access keeps working across sessions without manual re-auth (Priority: P2)

**Goal**: Expired sessions renew transparently; revoked grants surface a one-action reconnect; subscription errors are distinct

**Independent Test**: Restart the server (cold cache) → next message succeeds silently. Revoke the grant at GitHub → message shows "needs reconnect" → one Reconnect action restores chat. Per quickstart.md Scenarios 2–3.

### Tests for User Story 2 (write FIRST, ensure they FAIL)

- [x] T017 [P] [US2] Extend server/src/copilot-auth.test.ts for the token route: cache hit avoids second upstream exchange, eager refresh within 120s of expiry, single-flight under concurrent requests, `grant_invalid`/`not_entitled`/`upstream` mappings; add src/lib/ai tests for client-side staleness (120s buffer) and invalidation in src/lib/ai/copilot-session.test.ts (fake timers, mocked `/api/llm/copilot/token`)

### Implementation for User Story 2

- [x] T018 [US2] Upgrade the token route memo in server/src/copilot-auth.ts to the full session cache (data-model.md `CopilotSession`): key by grant hash, eager refresh at `expiresAt − 120s` (fallbacks `refresh_in`, 1500s), single-flight per key, honor `endpoints.api` as authoritative — makes the server half of T017 pass
- [x] T019 [US2] Harden src/lib/ai/copilot-session.ts + src/lib/ai/copilot-fetch.ts: treat descriptor stale within 120s of `expiresAt`, invalidate on `grant_invalid`, map `/token` errors → `CopilotAuthRequiredError` / `CopilotSubscriptionError` / `NetworkError` per research D4, and map inference 429 (+`Retry-After`) onto `RateLimitError` with `retryAfter` in src/lib/ai/sdk-errors.ts — makes the client half of T017 pass
- [x] T020 [US2] Add the `needs-reconnect` state in src/lib/components/ai/ProviderConfig.svelte: catch `CopilotAuthRequiredError` surfaced through chat (`src/lib/stores/chat.svelte.ts`) to badge the provider card and offer one-action "Reconnect GitHub" (reuses copilot-auth-dialog.svelte, overwrites the KeyStore grant); render `CopilotSubscriptionError` as a distinct no-reauth-loop message (FR-008)
- [x] T021 [US2] Verify end-to-end error propagation for the new error classes through src/lib/ai/sdk-errors.ts `mapSdkError` into chat/labs/quizzes stores (pass-through unchanged) and extend src/lib/ai/sdk-errors.test.ts with `MockAPICallError` cases
- [ ] T022 [US2] Manual smoke of quickstart.md Scenarios 2–3 (server restart renewal; GitHub revoke → reconnect in one action)

**Checkpoint**: Stories 1 AND 2 independently functional — daily-driver ready

---

## Phase 5: User Story 3 — Model list reflects what the workplace Copilot actually offers (Priority: P3)

**Goal**: Live model catalog from the session-authenticated `/models` endpoint with policy filtering; curated fallback when unreachable; graceful missing-model handling

**Independent Test**: After connect, refresh models → list matches the account's picker-visible models; block the fetch → fallback list still allows chat. Per quickstart.md Scenario 4.

### Tests for User Story 3 (write FIRST, ensure they FAIL)

- [x] T023 [P] [US3] Extend src/lib/ai/model-discovery.test.ts (pattern: `vi.fn()` fetch + fake `BrowserKeyStore` via `setHttpTransport`): for kind `'github-copilot'` discovery resolves a session descriptor first and sends the mandatory header set; parser keeps `object === 'model'` && `capabilities.type === 'chat'`, drops `policy.state === 'disabled'`, ignores `model_picker_enabled`, filters embeddings/internal routers

### Implementation for User Story 3

- [x] T024 [US3] Update src/lib/ai/model-discovery.ts: replace the inline Bearer auth descriptor (`:41-46`) with a per-kind auth/header resolution (for `'github-copilot'` use copilot-session + the header set from src/lib/ai/copilot-fetch.ts), and add the policy/chat filtering to `parseModelIds` without regressing existing openai-compatible parsing — makes T023 pass
- [x] T025 [US3] Update src/lib/components/ai/ProviderConfig.svelte discovery flows: run discovery after successful connect (T014 already triggers), keep fallback list on failure (existing best-effort semantics), and add a status hint + easy re-selection when the persisted `defaultModel` is absent from the refreshed catalog (FR-011)
- [ ] T026 [US3] Manual smoke of quickstart.md Scenario 4 (live refresh, persistence across reload, fallback with server stopped, optional policy-restricted model attempt)

**Checkpoint**: All user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, gates, end-to-end validation

- [x] T027 [P] Document the provider integration in research/003-inference-providers.md (kind summary, header-set constants, client_id/ToS risk note from research.md D2, endpoints-derived host rule)
- [x] T028 Run all quality gates: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test` — fix anything red
- [ ] T029 Run the full quickstart.md validation pass (Scenarios 1–5 + perf smoke) and record outcomes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first — protocol types are imported by server routes and client session code
- **Foundational (Phase 2)**: T002 → T003/T004/T005 (T002 and T005 both touch types.ts: run T002 before T005; T003/T004 are [P] against each other and T005)
- **US1 (Phase 3)**: needs Phase 2 complete; order T006/T007 (tests) → T008 → T009 → T010 → T011 → T012 → T013/T014 ([P], different files) → T015 → T016
- **US2 (Phase 4)**: builds on US1 files (session cache, fetch wrapper, dialog); T017 → T018 → T019 → T020 → T021 → T022
- **US3 (Phase 5)**: needs US1's session/fetch machinery; independent of US2 in principle but shares src/lib/ai files — run after US2 to avoid conflicts: T023 → T024 → T025 → T026
- **Polish (Phase 6)**: after all stories

### User Story Dependencies

- **US1**: no story dependencies — the MVP
- **US2**: extends US1's session machinery (same files) — sequential after US1
- **US3**: extends US1's discovery/fetch seams — after US2 (file-conflict avoidance)

### Within Each Story

Tests first (must fail) → server side → client side → UI → wiring → manual smoke. Models/services before endpoints, endpoints before UI integration.

### Parallel Opportunities

- T003 + T004 (with T005 sequenced after T002) in Foundational
- T006 + T007 (test files) at US1 start
- T013 + T014 (different UI files) mid-US1
- T017 + T023 could overlap if US2/US3 were staffed in parallel, but share no files until implementation — safe as test-only parallelism
- T027 docs anytime after Phase 2

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T005) — foundation compiles
2. Phase 3 (T006–T016) — connect + chat works
3. **STOP and VALIDATE**: quickstart Scenario 1 — a user can use Mayon with Copilot at work

### Incremental Delivery

- +US2 → renewal/revocation hardening (daily-driver reliability)
- +US3 → accurate model catalog
- Polish → docs + full gates + end-to-end pass

## Notes

- Tests are constitution-mandated (Principle II) — each story's test tasks precede implementation and must fail first
- Server session/flow state is memory-only by design (data-model.md) — server restart scenarios in quickstart are features, not bugs
- Header-set and client_id constants live in exactly one place each (server/src/copilot-auth.ts constants section; src/lib/ai/copilot-fetch.ts) — risk containment per research.md D2
- Verify tests fail before implementing; commit after each task or logical group
