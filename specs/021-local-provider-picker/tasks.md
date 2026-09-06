# Tasks: Local-First Grouped Provider Picker

**Input**: Design documents from `/specs/021-local-provider-picker/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/provider-registry.md](./contracts/provider-registry.md), [contracts/connection-test.md](./contracts/connection-test.md), [contracts/picker-ui.md](./contracts/picker-ui.md), [quickstart.md](./quickstart.md)

**Tests**: Included — the constitution (`.specify/memory/constitution.md` II) requires tests for all new `src/lib/` behavior, and the contracts carry binding test obligations. Test tasks are written first within each story and must FAIL before their implementation task runs.

**Organization**: Tasks are grouped by user story. Phases are intentionally kept at ≤6 tasks so `/speckit.implement` can dispatch each phase as one sub-agent sub-group (project constraint).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4 per spec.md)
- Exact file paths included in every description

## Path Conventions

Single SvelteKit repo: app code in `src/lib/`, UI in `src/lib/components/ai/`, unit tests co-located (`*.test.ts`), browser tests in `tests/e2e/`. The server package is untouched by this feature.

---

## Phase 1: Setup

**Purpose**: Worktree bootstrap and green baseline

- [x] T001 Bootstrap the worktree: run `pnpm install` and `pnpm --filter @mayon/shared build` (fresh worktrees resolve `@mayon/shared` types from its gitignored `dist/` — see AGENTS.md "Worktrees")
- [x] T002 [P] Establish green baseline: run `pnpm check`, `pnpm lint`, `pnpm test` and record results; fix nothing — if red before any change, stop and report
  - Result: green after baseline repair — 4 pre-existing unformatted markdown files in `ideas/009-provider-discovery/` prettier-fixed (formatting only, no content change); svelte-check first-run error was transient (0 errors on re-run); 123 test files / 1908 tests pass

**Checkpoint**: Toolchain ready, gates green before any edit.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data-layer changes every user story depends on: group taxonomy, config normalization, key-requirement field, loopback routing. **No user story work begins until this phase is complete.**

- [x] T003 Add `type ProviderGroup = 'local' | 'cloud' | 'gateway' | 'custom'`, add optional `group?: ProviderGroup` and `requiresKey?: boolean` to `ProviderConfig`, and narrow `toolCapability` to `'on' | 'off'` in the type declarations in `src/lib/ai/types.ts` (per contracts/provider-registry.md §3; keep reading stored `'auto'` tolerable at the type boundary — normalization lands in T006)
- [x] T004 Add required `group: ProviderGroup` to `ProviderTemplate`, assign groups to all 18 existing templates (taxonomy table in data-model.md), and add the two discovery-first Local templates — LM Studio (`openai-compatible`, `http://localhost:1234/v1`, keyless, `models: []`, `defaultModel: ''`) and vLLM (`http://localhost:8000/v1`) — all with `toolCapability: 'on'`, in `src/lib/ai/registry.ts` (depends T003)
- [x] T005 [P] Extract the legacy tool default into `legacyToolDefault(config)` in `src/lib/agent/capability.ts` (move `KNOWN_GATEWAY_BASEURLS` + kind table there unchanged; export it; leave `resolveToolCapability` behavior untouched in this task) and add additive normalization-table tests to `src/lib/agent/capability.test.ts` (depends T003; parallel with T004)
- [x] T006 Wire read-time normalization into `listProviders()` in `src/lib/ai/client.ts`: every returned config gets `toolCapability` normalized via `legacyToolDefault` (from T005), effective `group` via template `kind`+normalized-baseUrl match with `custom` fallback, and `requiresKey` defaulted by `kind !== 'ollama'`; change `kindRequiresKey` to `config.requiresKey ?? (config.kind !== 'ollama')` (per contracts/provider-registry.md §3; depends T004, T005)
- [x] T007 [P] Create `isLoopbackUrl()` in new `src/lib/ai/llm-target.ts` (loopback hosts: `localhost`, `127.0.0.1`, `[::1]`) and change `getLlmFetch()` → `getLlmFetch(url)` in `src/lib/services/llm-proxy-fetch.ts` to return browser `fetch` for loopback targets even when `llm-proxy` is advertised; update the three call sites (`src/lib/ai/sdk-fetch.ts`, `src/lib/ai/http-transport.ts`, `src/lib/ai/copilot-fetch.ts`) and extend `src/lib/services/llm-proxy-fetch.test.ts` with loopback-bypass and remote-still-proxied cases (per contracts/provider-registry.md §5)
- [x] T008 [P] Update `src/lib/ai/registry.test.ts`: per-group ordering invariants (Local → Cloud → Gateways order preserved within groups), every template has a `group` and `toolCapability === 'on'`, discovery-first relaxation (`models` may be empty / `defaultModel` may be `''` when `discoverable`), and exact `baseUrl` assertions for the two new templates (depends T004)

**Checkpoint**: Foundation ready — grouping, normalization, key-requirement, and loopback routing exist at the data layer; `pnpm test` green. User stories can start.

---

## Phase 3: User Story 1 — Connect a local inference runtime (Priority: P1) 🎯 MVP

**Goal**: A user picks LM Studio or vLLM in the Local group, gets prefilled defaults, runs a connection test, and chats — no API key, no manual address.

**Independent Test**: With a local runtime at its default address, go from "open provider picker" to "streamed chat reply" using only the provider setup screen; verify with `pnpm exec playwright test tests/e2e/onboard.spec.ts` plus the manual S2 scenario in quickstart.md.

### Tests for User Story 1 ⚠️ (write first, ensure FAIL)

- [x] T009 [P] [US1] Add failing unit tests for the connection-test core in new `src/lib/ai/connection-test.test.ts`: key-missing short-circuit (no network), success path returning parsed models (fake `HttpStreamTransport` per `src/lib/ai/model-discovery.test.ts` pattern), not-running vs cors-blocked disambiguation via a stubbed `no-cors` probe, and timeout → deadline expiry (matrix rows 1–4, 6, 10 of contracts/connection-test.md; loopback-specific coaching copy and remaining rows land in US4)

### Implementation for User Story 1

- [x] T010 [US1] Implement `testProviderConnection(config)` in new `src/lib/ai/connection-test.ts`: key pre-check, Probe 1 = `discoverModels` under `AbortSignal.timeout(8_000)`, Probe 2 = `fetch(baseUrl, { mode: 'no-cors' })` disambiguation on opaque failures, returning the `ConnectionTestResult` union from data-model.md with classes `key-missing` / `not-running` / `cors-blocked` / `timeout` / `http` (make T009 pass; add `TimeoutError` handling behind the existing `classifyFetchError` extension from US4 T024 — for now map deadline expiry to the `timeout` class directly; depends T009)
- [x] T011 [US1] Extend `addFromTemplate()` in `src/lib/components/ai/ProviderConfig.svelte` to copy `group`, `requiresKey`, and `toolCapability` from the template into the new `ProviderConfig`, and hide the API-key input section (and `keyFlags` handling) when `requiresKey(config)` is false (depends T006)
- [x] T012 [US1] Add the "Test connection" button + "Testing…" in-flight state to discoverable provider cards in `src/lib/components/ai/ProviderConfig.svelte`, wired to `testProviderConnection`: success → merge discovered models through the existing refresh-merge (discovered first, manual preserved), auto-select the first discovered model **only while `defaultModel` is empty**, status "Connection OK — N models found."; failure → render `failure.title` + `message` (+ `hint`) in the existing status line; skip silent background discovery in `load()` for Local-group providers (per contracts/picker-ui.md; depends T010, T011)
- [x] T013 [US1] Guard empty `defaultModel`: in the chat-start path (`src/lib/ai/client.ts` `getActiveSdkProvider()`), throw a typed, user-actionable error ("No model selected for this provider — pick one in Settings") when `defaultModel` is empty, and keep the ModelSelect rendering an explicit empty state for discovery-first configs in `src/lib/components/ai/` (depends T011)
- [x] T014 [US1] Verify/adjust `tests/e2e/onboard.spec.ts` for the new-template world: the existing LiteLLM add flow still passes and add a case adding "LM Studio (local)" (mock base URL from `tests/e2e/fixtures/kitchen-sink.ts`), asserting no key field appears and discovery populates the model list (depends T012; run with dev stack)

**Checkpoint**: User Story 1 independently functional: local entries onboardable key-free with defaults, test → models → chat reply works; gates green.

---

## Phase 4: User Story 2 — Find the right provider via groups and search (Priority: P2)

**Goal**: The add-provider catalog renders as four labeled groups with a cross-group search box.

**Independent Test**: Open Add provider with the catalog loaded: four groups in order, search filters across groups, empty state + clear restore (quickstart S1); automated via `tests/e2e/provider-picker.spec.ts`.

### Tests for User Story 2 ⚠️ (write first, ensure FAIL)

- [x] T015 [P] [US2] Create `tests/e2e/provider-picker.spec.ts` with failing scenarios for: four group headings in order (Local, Cloud APIs, Gateways, Custom), search `open` shows cross-group matches and hides empty groups, search `zzz` shows the empty state, Clear restores the full list (fixtures: reuse `tests/e2e/fixtures/onboard.ts` wipe + page navigation helpers)

### Implementation for User Story 2

- [x] T016 [US2] Rebuild the template grid in `src/lib/components/ai/ProviderConfig.svelte` as four labeled sections (headings + one-line descriptions per contracts/picker-ui.md), registry order within each group, and a "no key required" badge on `requiresKey: false` entries (extract a `ProviderTemplatePicker.svelte` component under `src/lib/components/ai/` if the file grows past maintainability; depends T015)
- [x] T017 [US2] Add the search input above the groups in the same picker: case-insensitive substring filter over `label` + `description` across all groups, hide empty groups while searching, "No providers match '<query>'" empty state with Clear action, full restore on clear; search must not filter configured-provider cards nor discard unsaved card edits (per contracts/picker-ui.md; depends T016)

**Checkpoint**: User Stories 1 AND 2 work independently; `tests/e2e/provider-picker.spec.ts` (part 1) green.

---

## Phase 5: User Story 3 — Assert tool capability per endpoint (Priority: P2)

**Goal**: `'auto'` is gone: explicit per-endpoint tools toggle, default Enabled, legacy behavior preserved, one code path in the agent loop.

**Independent Test**: Toggle a provider's Tool capability off and on and observe agent runs sending/not sending tools, with the state persisted across reloads (quickstart S5).

### Tests for User Story 3 ⚠️ (write first, ensure FAIL)

- [x] T018 [P] [US3] Rewrite the resolution cases in `src/lib/agent/capability.test.ts`: `resolveToolCapability` is explicit-only (`'on'` → true, `'off'` → false, session latch composes; no URL consulted anywhere in resolution); keep the T005 normalization-table tests intact as the FR-013 regression lock (failing until T019/T020 land)

### Implementation for User Story 3

- [x] T019 [US3] Simplify `resolveToolCapability(config)` in `src/lib/agent/capability.ts` to `config.toolCapability !== 'off' && !sessionToolsDisabled` with no kind/URL branch; `legacyToolDefault` remains only for read-time normalization (make T018 pass; depends T018)
- [x] T020 [US3] (DONE-EARLY in Phase 2, required by T006 normalization) Change `src/lib/agent/loop.ts` tool gating (lines ~281-282) to read the normalized `toolCapability` via `resolveToolCapability(deps.config)` instead of the raw tri-state field, keeping the `firstTurn` factor and the retry-text-only safety net unchanged (depends T019)
- [x] T021 [US3] Replace the Tool capability select in `src/lib/components/ai/ProviderConfig.svelte` with two explicit options **Enabled / Disabled** (default Enabled; plain-language label per contracts/picker-ui.md), persisting through the existing save path (depends T019; coordinate file ownership with US2 tasks — sequential, not parallel)
- [x] T022 [P] [US3] Add the tools-toggle scenario to `tests/e2e/provider-picker.spec.ts` using the mock-LLM fixtures: tool call observed with Enabled, absent with Disabled, state persisted across reload, and a legacy `"auto"`-injected config renders Disabled (non-allowlisted custom URL) as explicit state (depends T021)

**Checkpoint**: User Stories 1–3 independently functional; SC-005 observable end-to-end.

---

## Phase 6: User Story 4 — Recover from connection failures with guidance (Priority: P3)

**Goal**: Every failed connection test shows a classified, coached message; LM Studio's CORS-off default gets its guided fix.

**Independent Test**: Put a local runtime into each failure state (stopped / CORS-off / wrong address) and run Test connection — distinct actionable messages per state (quickstart S4).

### Tests for User Story 4 ⚠️ (write first, ensure FAIL)

- [x] T023 [P] [US4] Extend `src/lib/ai/connection-test.test.ts` to the full 10-row matrix of contracts/connection-test.md (loopback vs remote `cors-blocked` coaching variants, `insecure-blocked`, `not-found` 404, `rate-limited` 429, `auth` 401/403, generic `http`) and add `TimeoutError` cases to `src/lib/ai/errors.test.ts` (`classifyFetchError` maps `DOMException(name='TimeoutError')` → `TimeoutError`; user `AbortError` still passes through; `formatProviderError` coaching copy) (failing until T024/T025)

### Implementation for User Story 4

- [x] T024 [US4] Add `TimeoutError` to the typed error family in `src/lib/ai/types.ts`, the `TimeoutError`-DOMException branch to `classifyFetchError` in `src/lib/ai/errors.ts` (user abort keeps pass-through), and coached `formatProviderError` entries for the new classes (per contracts/connection-test.md; depends T023)
- [x] T025 [US4] Complete classification in `src/lib/ai/connection-test.ts`: `insecure-blocked` (HTTPS page → HTTP target), `not-found` / `auth` / `rate-limited` mapping from `httpStatusToError` results, loopback-aware `cors-blocked` variant with runtime-specific hints (LM Studio Developer toggle / `lms server start --cors`; vLLM `--allowed-origins`; template match decides), switching the deadline path to `classifyFetchError` + `TimeoutError` (make T023 pass; depends T024)
- [x] T026 [P] [US4] Add the coaching scenario to `tests/e2e/provider-picker.spec.ts`: Test connection against a dead port shows "Server not running" with the start-the-server remedy (mock fixture pointed at an unused localhost port), and against the mock LLM shows "Connection OK — N models found." (depends T025)

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation truthfulness and final proof

- [x] T027 [P] Update provider-layer docs where they describe the old behavior: URL-based tool defaulting (now explicit per-endpoint assertion), the provider catalog (mention group taxonomy and the two new Local templates), and loopback proxy bypass in `docs/explanation/architecture.qmd` (Provider / AI layer section) and `docs/reference/seams.qmd` (no-secrets / provider config paragraphs) — as-is documentation only, no seam changes
- [x] T028 Run full validation per `specs/021-local-provider-picker/quickstart.md`: all automated gates (`pnpm check`, `pnpm lint`, `pnpm test`, targeted suites, Playwright `onboard.spec.ts` + `provider-picker.spec.ts`) and the manual scenarios S1–S6 as far as the environment allows; report any gaps

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories** (T003 → T004/T005 → T006; T007 and T008 parallel)
- **US1 (Phase 3)**: depends on Foundational; T009 → T010; T010+T011 → T012; T011 → T013; T012 → T014
- **US2 (Phase 4)**: depends on Foundational (independent of US1 in principle, but T016/T017 and US1's T011/T012 edit the same Svelte file — run stories sequentially or merge carefully)
- **US3 (Phase 5)**: depends on Foundational (normalization table from T005 is its regression lock); T018 → T019 → T020/T021 → T022
- **US4 (Phase 6)**: depends on US1's `connection-test.ts` skeleton (T010); T023 → T024 → T025 → T026
- **Polish (Phase 7)**: depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: starts after Foundational — no cross-story dependency
- **US2 (P2)**: starts after Foundational — shares `ProviderConfig.svelte` with US1/US3 (sequential editing)
- **US3 (P2)**: starts after Foundational — normalization table (T005) is its prerequisite artifact
- **US4 (P3)**: starts after US1 (T010) — refines the connection test it built

### Within Each User Story

Tests (marked ⚠️) are written first and must FAIL before their implementation task. Implementation order: data/pure modules → UI wiring → integration/e2e.

### Parallel Opportunities

- Phase 2: T005 ∥ T004 (after T003); T007 ∥ T008 ∥ (T004|T005 chain)
- Phase 3: T009 ∥ T011 (different files, both depend only on earlier phases); T014 after T012
- Phase 5/6: test tasks (T018, T023) run ahead of their implementations; e2e tasks (T022, T026) are single-file-per-phase
- Cross-story: US2 and US3 could overlap **except** both edit `ProviderConfig.svelte` — keep story phases sequential or coordinate that file

---

## Parallel Example: Foundational Phase

```bash
# After T003 (types) merges, launch together:
Task: "T004 registry groups + LM Studio/vLLM templates in src/lib/ai/registry.ts"
Task: "T005 legacyToolDefault extraction in src/lib/agent/capability.ts"
# Then together (different files):
Task: "T007 llm-target + proxy bypass in src/lib/ai/llm-target.ts + src/lib/services/llm-proxy-fetch.ts"
Task: "T008 registry.test.ts invariants"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (Foundational) — blocking
2. Phase 3 (US1) → **STOP and VALIDATE**: local runtime onboardable key-free with defaults, test → models → chat (quickstart S2/S3)
3. This alone ships the headline capability; the flat picker still works

### Incremental Delivery

1. Foundational → US1 (MVP: locals connectable) → US2 (findability) → US3 (tools bug-class retired) → US4 (coached failures) → Polish
2. Each story is independently demoable; US3 depends only on Foundational + US1's test module

### Notes for sub-agent dispatch (project constraint)

Each phase contains ≤6 tasks and can be handed to one implementation sub-agent per phase; respect the [P] marks and the same-file conflicts noted above (`src/lib/components/ai/ProviderConfig.svelte` is the contended file across US1/US2/US3).

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to spec.md user story (US1 P1, US2 P2, US3 P2, US4 P3)
- Verify tests fail before implementing (TDD ordering within stories)
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- Server package untouched: `pnpm --filter @mayon/server test` expected green without changes
