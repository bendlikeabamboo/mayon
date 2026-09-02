# Tasks: Mock-LLM Chat Test Suite

**Input**: Design documents from `/specs/017-mock-llm-chat-tests/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mock-llm-api.md, contracts/e2e-stack.md, quickstart.md

**Tests**: This feature IS a test suite — test-code tasks are the deliverable, organized by the user story each increment satisfies.

**Organization**: Grouped by user story. Phases 1–2 are shared infrastructure; US1 (P1) is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task

## Path Conventions

This feature is test-stack-only (plan.md Structure Decision). New files live in
`tests/fixtures/mock-llm/`, `tests/e2e/`, plus edits to `package.json`,
`docker-compose.dev.yml`, `.github/workflows/ci.yml`, and a new root
`playwright.config.ts`. **No files under `src/` or `server/src/` may be created or
modified** (SC-005). No file anywhere may use a leading `+` in its name (constitution I).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Playwright tooling installed and configured; lint-clean foundations.

- [ ] T001 Add `@playwright/test` as a root devDependency in `package.json` and add script `"test:e2e": "playwright test"`; run `pnpm install`. Do not touch any other dependency.
- [ ] T002 [P] Create `playwright.config.ts` at repo root: single Chromium project, `use: { baseURL: 'http://localhost:5173' }`, `retries: 0` (flake is a bug per SC-002), test dir `tests/e2e`, output dir `test-results/`, reporter `list` locally; add `test-results/` and `playwright-report/` to `.gitignore`.
- [ ] T003 [P] Verify the ESLint flat config and Prettier cover the new paths (`tests/e2e/**`, `tests/fixtures/mock-llm/**`, `playwright.config.ts`): create throwaway files only if needed, run `pnpm lint`, adjust config only if the paths are excluded, then remove throwaways. Lint must pass with zero new ignores for product code.

**Checkpoint**: `pnpm lint` passes and `pnpm exec playwright --version` works.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The mock LLM and its compose wiring — nothing user-story-specific can run without them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Author the deterministic reply document `tests/fixtures/mock-llm/kitchen-sink.md` per data-model.md KitchenSinkFixture: headings (multiple levels), ordered + unordered + task lists, a table, a blockquote, a link, inline math `$e^{i\pi}+1=0$` AND display math (`$$…$$`), one ` ```mermaid ` fenced flowchart, ≥2 code blocks in different languages (non-trivial, multi-line), and 2+ plain-prose paragraphs (3+ sentences each) as alignment targets. No raw HTML; content must survive the sanitize schema (see research.md D6 for the pipeline).
- [ ] T005 Implement the mock server `tests/fixtures/mock-llm/server.mjs`: dependency-free `node:http`, port from `MOCK_LLM_PORT` (default `9999`), loading `kitchen-sink.md` at startup, implementing `contracts/mock-llm-api.md` exactly — `POST /v1/chat/completions` branching on `stream` (SSE with ≥2 content chunks + REQUIRED terminal `finish_reason:"stop"` chunk vs single JSON), `GET /v1/models` → `{"data":[{"id":"mock-sink","object":"model"}]}`, ignores `Authorization`, tolerates `tools`, handles concurrent requests, `404` other paths, `400` malformed JSON, no artificial latency.
- [ ] T006 Add the `mock-llm` service to `docker-compose.dev.yml` per contracts/e2e-stack.md: image `node:22-alpine`, read-only bind mount of `./tests/fixtures/mock-llm`, command `node server.mjs` with `MOCK_LLM_PORT=9999`, `expose: 9999` (NO host port mapping), TCP healthcheck on 9999, no `networks:` key, nothing depends on it. Verify with `pnpm dev:up` then `docker compose -p mayon-dev exec server wget -qO- http://mock-llm:9999/v1/models` returns the models JSON (research.md D2/D5).

**Checkpoint**: Stack up; model list fetchable from inside the `server` container; `pnpm dev` users observe no difference.

---

## Phase 3: User Story 1 — First deterministic chat round trip (Priority: P1) 🎯 MVP

**Goal**: One green automated flow: onboard the mock provider through the real UI → send → reply streams back through the proxy → kitchen-sink reply renders.

**Independent Test**: Fresh dev stack + `pnpm test:e2e` running only `onboard.spec.ts` passes in under 5 minutes with no external network.

### Implementation for User Story 1

- [ ] T007 [US1] Create the onboarding Playwright fixture `tests/e2e/fixtures/onboard.ts`: a `test.extend` fixture that (1) waits for BootGate resolution before any interaction (`src/routes/+layout.svelte` boot states — wait for the home/composer UI, not a fixed timeout), (2) opens `/settings#providers`, clicks "Add provider", picks the "LiteLLM (self-hosted)" template (research.md D3), (3) fills Base URL `http://mock-llm:9999/v1` and Default model `mock-sink` in the provider card (inputs per `src/lib/components/ai/ProviderConfig.svelte`), (4) types placeholder key `e2e-placeholder-key` into the API-key input and clicks "Save key", (5) clicks "Set active", (6) creates a new chat from Home and exposes `{ providerCard, chatPage }` to tests. Use role/label-based locators matching the real UI text; no data-testid may be added to product code.
- [ ] T008 [US1] Write `tests/e2e/onboard.spec.ts` using the fixture: assert the provider card shows base URL/model as set; assert model discovery resolved (the LiteLLM template auto-fetches `/models` on add and on key save — the card's model select should offer `mock-sink`); send one message via the composer; assert the assistant reply streams (multiple progressive renders before completion) and the final rendered text contains known kitchen-sink phrases (e.g. a known heading and a known prose sentence); assert no error banner appears. One focused test for the full flow, one asserting discovery, kept independent so a discovery failure doesn't mask the round trip.
- [ ] T009 [US1] Run `pnpm exec playwright test tests/e2e/onboard.spec.ts` against the running stack; iterate until green in under 5 minutes; confirm in browser devtools/network tab or proxy logs that the only outbound calls are same-origin `/api/*` (proxy path per research.md D5) — no direct browser→mock traffic (FR-003).

**Checkpoint**: US1 = MVP. Onboard → send → receive → render is automated, deterministic, network-isolated.

---

## Phase 4: User Story 2 — Deep rendering coverage from one deterministic reply (Priority: P2)

**Goal**: Every covered rendering capability has a stable assertion that fails when that capability regresses, using known content at known offsets.

**Independent Test**: `pnpm exec playwright test tests/e2e/render.spec.ts` passes on a healthy stack; intentionally breaking one renderer capability fails exactly its test.

### Implementation for User Story 2

- [ ] T010 [US2] Create rendering-assertion helpers `tests/e2e/fixtures/render.ts`: locators/assertions for (1) markdown structure — heading levels, `ul`/`ol`/task-list checkboxes, `table` rows, `blockquote`, link with correct href; (2) math — KaTeX output present for the inline and display expressions (`.katex` elements; injected chrome is excluded from alignment per `src/lib/chat/selection.ts:27-36`); (3) mermaid — the fence renders as diagram (`.mermaid-svg` or equivalent product output, NOT raw `code.language-mermaid` text); (4) copy affordance — every `pre` has an `.md-copy-btn` and clicking one writes the code text to the clipboard (grant clipboard permissions in the context).
- [ ] T011 [US2] Write `tests/e2e/render.spec.ts` using the onboarded fixture (T007) + helpers (T010): one test per capability group (structure, math, mermaid, copy buttons) asserting against known kitchen-sink content, plus a source-alignment test that drives the product's expound/selection path (`Highlighter` → `src/lib/chat/selection.ts`) and asserts resolved offsets match the fixture's known raw-markdown offsets for a chosen prose span (contract III: no substring heuristics — assert through the real machinery).
- [ ] T012 [US2] Localization check: temporarily break ONE covered capability (e.g. disable the copy-button injection in `src/lib/components/chat/Markdown.svelte`), run `render.spec.ts`, confirm ONLY the corresponding test fails with a capability-localized message, then revert the product change (working tree must end clean under `src/` — SC-005).

**Checkpoint**: US1 + US2 both green independently; rendering regressions are caught with localized failures.

---

## Phase 5: User Story 3 — The suite runs on every change with zero cost or flake (Priority: P3)

**Goal**: The suite runs in CI on every PR — no secrets, no external network, deterministic verdicts — and locally with one command.

**Independent Test**: The new CI job is green on the PR; two consecutive local runs of the full suite produce identical verdicts.

### Implementation for User Story 3

- [ ] T013 [US3] Add the `e2e` job to `.github/workflows/ci.yml` per contracts/e2e-stack.md: `ubuntu-latest`, same checkout/pnpm/Node-22 setup as the `web` job, `pnpm install --frozen-lockfile`, `pnpm --filter @mayon/shared build`, `pnpm exec playwright install --with-deps chromium`, `pnpm dev:up`, wait for readiness (web :5173 + `mock-llm` healthcheck green), `pnpm test:e2e`, upload `playwright-report/` and `test-results/` as artifacts on failure. Keep the existing `web` job unchanged.
- [ ] T014 [US3] Determinism validation: run `pnpm test:e2e` twice consecutively locally and record identical outcomes in the PR description; if any run differs on identical code, treat it as a bug and fix the test/mock (SC-002) — do not add retries.
- [ ] T015 [US3] Validate the CI run on the PR: `e2e` job green, no secrets present in the workflow or environment, total job wall time under 10 minutes (SC-001/SC-003), and only image pulls leave the runner.

**Checkpoint**: All three user stories independently functional — full E2E chat coverage on every PR at zero marginal cost.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, gates, and constraint verification.

- [ ] T016 [P] Document local usage in `docs/dev/building.qmd`: a short "Browser E2E tests" section — prerequisites (`pnpm exec playwright install --with-deps chromium`), `pnpm dev:up`, `pnpm test:e2e`, what the suite covers, and where reports land. Keep it consistent with the existing doc voice; no product behavior claims.
- [ ] T017 Run full quickstart.md validation: all three scenarios pass; then run the merge gates `pnpm check`, `pnpm lint`, `pnpm test` (and `pnpm --filter @mayon/server test`) — all must be green and unaffected by this feature.
- [ ] T018 Verify constraint SC-005: `git diff --stat main...HEAD` shows changes ONLY under `tests/`, `playwright.config.ts`, `package.json`, `pnpm-lock.yaml`, `docker-compose.dev.yml`, `.github/workflows/ci.yml`, `.gitignore`, `docs/`, and `specs/` — zero changes under `src/` or `server/src/`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Phase 1 (T004–T006 need playwright only for later phases; mock work can start after T001) — **BLOCKS all user stories**
- **US1 (Phase 3)**: depends on Phase 2 (mock + compose)
- **US2 (Phase 4)**: depends on US1's onboarding fixture (T007) and a working round trip
- **US3 (Phase 5)**: depends on the full suite existing (US1 + US2) — CI runs everything
- **Polish (Phase 6)**: depends on all user stories being complete

### User Story Dependencies

- **US1**: Foundational only — no other story dependencies (MVP)
- **US2**: Reuses US1's `onboard.ts` fixture; independently testable once US1 is green
- **US3**: Packaging/CI of US1+US2; adds no new product interaction

### Within Each Story

- Fixtures/helpers before specs; specs before run-and-iterate; localization/constraint checks last
- No story may create or modify files under `src/`/`server/src/` (T012's temporary break must be reverted)

### Parallel Opportunities

- Phase 1: T002 ∥ T003 (after T001)
- Phase 2: T004 ∥ T005 (independent files; T006 needs both)
- US2 helpers (T010) can be drafted while US1 iteration (T009) runs, but US2 specs need US1 green
- Polish: T016 ∥ T017 ∥ T018

---

## Parallel Example: Phase 2

```bash
# Launch mock-fixture work together (independent files):
Task: "Author kitchen-sink.md in tests/fixtures/mock-llm/kitchen-sink.md"
Task: "Implement server.mjs in tests/fixtures/mock-llm/server.mjs"
# Then wire compose (T006) and verify from the server container.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 → Phase 2 (mock + compose)
2. Phase 3: onboard fixture, round-trip spec, run to green
3. **STOP and VALIDATE**: US1 alone already delivers the decision's core promise — the request path is covered

### Incremental Delivery

- +US2 → rendering depth with localized failure signals
- +US3 → every PR regression-checked; zero-flake policy enforced
- Each increment keeps prior specs green; commit after each task or logical group

### Notes

- All protocol/selector facts needed are in research.md (file:line verified) and contracts/ — implement against those, not against memory
- Fixture drift is accepted maintenance (extend `kitchen-sink.md` when new renderer capabilities ship); new injected chrome must keep `EXCLUDED_CHROME_SELECTORS` current
- If in-app auth ships before this lands, add a login step to `onboard.ts` — a fixture change, not a redesign (contracts/e2e-stack.md out-of-scope note)
