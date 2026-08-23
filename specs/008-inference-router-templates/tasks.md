---
description: 'Task list for feature implementation'
---

# Tasks: First-Class Inference Router Templates

**Input**: Design documents from `/specs/008-inference-router-templates/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included — the project constitution mandates tests for new behavior in `src/lib/` (Testing Standards II). Test-first where behavior is new: story tests are written and watched fail (or vacuously pass for catalog-rule extensions), then implementation lands.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project: `src/` at repository root (per plan.md structure — this feature touches only `src/lib/ai/`, `src/lib/agent/`, and `README.md`).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Environment baseline — no new code

- [x] T001 Verify dev baseline: `pnpm install`, build `@mayon/shared` (tsup → `packages/shared/dist`, required before type resolution), then confirm `pnpm check`, `pnpm lint`, and `pnpm test` are green before any edits (baseline: 1270+ tests passing post-007)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Test-rule extensions every story builds on — MUST be complete before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Extend the existing suites with the 008 rules, green against the CURRENT catalog: in `src/lib/ai/registry.test.ts` add the LiteLLM integrity exemptions (label `LiteLLM (self-hosted)` may have `requiresKey: false`; `baseUrl` may be `http://localhost:4000` alongside Ollama's localhost) — vacuously passing today; in `src/lib/ai/model-discovery.test.ts` add `parseModelIds` keep-behavior tests per data-model.md rule 5 (entries with no `type` field and entries with `type: 'chat'`/`'language'` are kept, in both the `{ data }` shape and bare arrays) — passing against the current parser, pinning the baseline the US5 change must not break

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Add OpenCode Zen as first-class router (Priority: P1) 🎯 MVP

**Goal**: Zen appears at position 6 in the Add provider picker (first of the router block); key-based setup plus keyless free-model flow; live discovery; tools on by default incl. the Go variant URL (spec User Story 1, FR-001–FR-004)

**Independent Test**: With a valid OpenCode key, complete a chat (incl. a tool turn) via Settings → Add provider → OpenCode Zen in under 2 minutes, typing no endpoint address; keyless add still completes with a free model default

### Implementation for User Story 1

- [x] T003 [P] [US1] Snapshot the Zen catalog (`GET https://opencode.ai/zen/v1/models` — documented keyless; else the model/deprecation tables at opencode.ai/docs/zen) and add the OpenCode Zen `ProviderTemplate` at SIXTH position (index 6) of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`, directly after Mistral: `kind: 'openai-compatible'`, `label: 'OpenCode Zen'`, `baseUrl: 'https://opencode.ai/zen/v1'`, `defaultModel: <free-tier model from snapshot>`, `models: [<free model>, <flagship from snapshot>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`, one-line description (research D3/D5)
- [x] T004 [P] [US1] Add BOTH `https://opencode.ai/zen/v1` and the Go-variant `https://opencode.ai/zen/go/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` (research D4)
- [x] T005 [US1] Add tests: Zen shape test at `PROVIDER_TEMPLATES[6]` (kind/baseUrl/requiresKey:true/discoverable/models per data-model.md rule 2) in `src/lib/ai/registry.test.ts`, and capability tests asserting `resolveToolCapability` is `true` for both Zen base URLs in `src/lib/agent/capability.test.ts` (depends T003, T004)

**Checkpoint**: User Story 1 fully functional — MVP deliverable (Zen = highest-audience router)

---

## Phase 4: User Story 2 - Add LiteLLM (self-hosted) as first-class router (Priority: P1)

**Goal**: First keyless hosted template — setup completes without an API key; live listing shows exactly the user's configured aliases; tools on by default in both address spellings (spec User Story 2, FR-002/FR-004)

**Independent Test**: With a local LiteLLM proxy running, complete a keyless chat against a configured alias via the dialog; with a master-keyed proxy, saving the key upgrades the connection

### Implementation for User Story 2

- [x] T006 [P] [US2] Add the LiteLLM `ProviderTemplate` at SEVENTH position (index 7) of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `kind: 'openai-compatible'`, `label: 'LiteLLM (self-hosted)'`, `baseUrl: 'http://localhost:4000'` (root spelling — routes serve at both prefixes, research D3), `defaultModel` + `models: [<2 generic placeholder aliases>]` (placeholders expected-wrong-by-design; discovery is the catalog — description says so), `requiresKey: false` (first hosted keyless entry, research D6), `discoverable: true`, `toolCapability: 'auto'`
- [x] T007 [P] [US2] Add BOTH `http://localhost:4000` and `http://localhost:4000/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` (spelling coverage, research D4)
- [x] T008 [US2] Add tests: LiteLLM shape test at `PROVIDER_TEMPLATES[7]` asserting `requiresKey: false` and the localhost `baseUrl` in `src/lib/ai/registry.test.ts`, and capability tests for both spellings in `src/lib/agent/capability.test.ts` (depends T006, T007)

**Checkpoint**: User Stories 1 AND 2 (both P1) independently functional

---

## Phase 5: User Story 5 - Keep non-chat models out of the model picker (Priority: P3, executed early)

**Goal**: `parseModelIds` excludes embedding-typed entries for every discoverable provider — the generic mechanism US3's Vercel acceptance observes (spec User Story 5, FR-008; scheduled here because US3 scenario 3 depends on it)

**Independent Test**: A `/models` response with `type: 'embedding'` entries yields a picker list without them, for any discoverable provider; untyped catalogs unchanged

### Implementation for User Story 5

- [x] T009 [US5] Write the failing exclusion tests in `src/lib/ai/model-discovery.test.ts`: entries with `type: 'embedding'` are excluded in BOTH the `{ data: [...] }` shape and bare arrays; confirm they fail against the current parser (data-model.md rule 5)
- [x] T010 [US5] Implement the exclusion in `parseModelIds` in `src/lib/ai/model-discovery.ts`: skip entries whose `type` equals `'embedding'` (exact string); entries with no `type` or any other value are kept — one-value denylist per contracts/discovery-filtering.md (depends T009)

**Checkpoint**: Embedding exclusion live across all discovery — US3 can now land with clean acceptance

---

## Phase 6: User Story 3 - Add Vercel AI Gateway as first-class router (Priority: P2)

**Goal**: Zero-markup hosted router at position 8; discovery excludes embedding entries from its mixed catalog; tools on by default (spec User Story 3, FR-001/FR-008)

**Independent Test**: With a valid gateway key, complete a chat against a gateway-hosted model via the dialog and confirm no embedding IDs appear in the picker

### Implementation for User Story 3

- [x] T011 [P] [US3] Snapshot the gateway catalog (`GET https://ai-gateway.vercel.sh/v1/models` — appears pre-auth, verify; else the models list at vercel.com/docs/ai-gateway) EXCLUDING any `type: 'embedding'` entries, and add the Vercel AI Gateway `ProviderTemplate` at EIGHTH position (index 8) of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `kind: 'openai-compatible'`, `label: 'Vercel AI Gateway'`, `baseUrl: 'https://ai-gateway.vercel.sh/v1'`, `defaultModel` + `models: [<2 chat IDs from snapshot, namespaced>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'` (research D3/D5)
- [x] T012 [P] [US3] Add `https://ai-gateway.vercel.sh/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts`
- [x] T013 [US3] Add tests: Vercel shape test at `PROVIDER_TEMPLATES[8]` in `src/lib/ai/registry.test.ts` and Vercel capability test in `src/lib/agent/capability.test.ts` (depends T011, T012; embedding exclusion itself is already covered by T009/T010)

**Checkpoint**: User Stories 1–3 and 5 independently functional

---

## Phase 7: User Story 4 - Add Requesty as first-class router (Priority: P2)

**Goal**: Routing-first gateway at position 9; EU endpoint variant stays tools-on after user edit (spec User Story 4, FR-004)

**Independent Test**: With a valid Requesty key, complete a tool-using chat via the dialog; then edit the base URL to `https://router.eu.requesty.ai/v1` and re-verify discovery + tools

### Implementation for User Story 4

- [x] T014 [P] [US4] Snapshot the Requesty catalog (`GET https://router.requesty.ai/v1/models` with a key; else the model library at app.requesty.ai/model-list) and add the Requesty `ProviderTemplate` at NINTH position (index 9) of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `kind: 'openai-compatible'`, `label: 'Requesty'`, `baseUrl: 'https://router.requesty.ai/v1'`, `defaultModel` + `models: [<2 namespaced IDs from snapshot, openai/gpt-4o-style>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'` (research D3/D5)
- [x] T015 [P] [US4] Add BOTH `https://router.requesty.ai/v1` and the EU variant `https://router.eu.requesty.ai/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` (research D4)
- [x] T016 [US4] Add tests: Requesty shape test at `PROVIDER_TEMPLATES[9]` in `src/lib/ai/registry.test.ts` and capability tests for BOTH the default and EU base URLs in `src/lib/agent/capability.test.ts` (depends T014, T015)

**Checkpoint**: All four routers (User Stories 1–4) independently functional

---

## Phase 8: User Story 6 - Document the router long tail (Priority: P3)

**Goal**: README names all four routers, points Tier-2 routers at the custom-endpoint path, and covers the self-hosted container address caveat (spec User Story 6, FR-009)

**Independent Test**: README provider line lists OpenCode Zen, LiteLLM, Vercel AI Gateway, Requesty; the container address note (host.docker.internal) sits near the Ollama note; no GitHub Models reference anywhere

### Implementation for User Story 6

- [x] T017 [US6] Update the provider list line in `README.md` (currently lines 22–24, "Provider-agnostic AI" bullet) to name the four routers, and add a short self-hosted-gateway container-address note (`localhost` resolves inside Mayon's Docker server; use `host.docker.internal` or the host LAN IP) alongside the existing Ollama guidance (research D9; no GitHub Models mention — FR-010)

**Checkpoint**: All user stories complete

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Global guarantees spanning all stories

- [x] T018 Update the catalog-order assertions in `src/lib/ai/registry.test.ts` (data-model.md rule 3): first eleven positions are exactly `[DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, OpenCode Zen, LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Z.AI (GLM)]` and total length is 17 (replaces 007's first-seven/13 assertions) (FR-007 / research D2). Deferred to polish so each story's phase stays independently green
- [x] T019 Run full quality gates: `pnpm check`, `pnpm lint`, `pnpm test` — all green (constitution gate III)
- [x] T020 Execute the manual validation scenarios in `specs/008-inference-router-templates/quickstart.md` on the dev stack (`pnpm dev`): catalog presence/order, Zen one-click + keyless, LiteLLM keyless + spelling, Vercel embedding exclusion, Requesty EU variant, tools-on-default, CORS proxy fallback; record results in quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–8)**: Depend on Foundational; implement SEQUENTIALLY in phase order — `src/lib/ai/registry.ts` and `src/lib/agent/capability.ts` are single shared files, so cross-story parallelization in one working tree would create conflicts. (The only intra-story ordering freedom: each story's first two tasks touch different files.)
- **Polish (Phase 9)**: Depends on all user stories (T018 especially needs the final 17-entry catalog)

### User Story Dependencies

- **US1 (Zen)**: after Phase 2 only — no story dependencies (MVP)
- **US2 (LiteLLM)**: after Phase 2; no logical dependency on US1
- **US5 (filter, P3 executed early)**: after Phase 2; **US3 depends on US5** — Vercel's acceptance scenario 3 (embedding entries excluded) observes the filter, so US5 is deliberately scheduled ahead of its P3 rank
- **US3 (Vercel)**: after US5's mechanism (T009/T010)
- **US4 (Requesty)**: after Phase 2; independent of the others (file-collision ordering only)
- **US6 (docs)**: after the router set is final (US1–US4)

### Within Each User Story

- Implementation tasks (template entry + gateway URLs) are parallel ([P], different files)
- Test task depends on both implementation tasks of that story
- Story complete (tests green, quickstart scenario passes) before moving on

### Parallel Opportunities

- T003 ∥ T004; T006 ∥ T007; T011 ∥ T012; T014 ∥ T015 — each pair edits different files (`registry.ts` vs `capability.ts`)
- T002's two suite extensions are independent of each other (different test files)
- Cross-story test tasks are parallel-safe only in Git worktrees, not in one working tree

---

## Parallel Example: User Story 1

```bash
# Launch the two implementation tasks together (different files):
Task: "Add the OpenCode Zen ProviderTemplate to src/lib/ai/registry.ts"
Task: "Add both Zen base URLs to KNOWN_GATEWAY_BASEURLS in src/lib/agent/capability.ts"

# Then the story test task (depends on both):
Task: "Add Zen shape + capability tests"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002)
3. Complete Phase 3: User Story 1 — OpenCode Zen, the highest-audience router
4. **STOP and VALIDATE**: quickstart.md Scenarios 1 (catalog) + 2 (Zen one-click) + 3 (keyless free model) + 8 (tools)
5. Ship if needed — one promoted router already delivers the spec's core value

### Incremental Delivery

1. Setup + Foundational → test-rule scaffolding green
2. US1 Zen → validate → MVP
3. US2 LiteLLM → validate (P1 pair complete; enterprise-cloud models reachable via user's gateway)
4. US5 filter → US3 Vercel → validate (P2 pair complete with clean picker)
5. US4 Requesty → US6 docs → Phase 9 polish (global order test, full gates, quickstart run)

### Subagent Dispatch (project convention)

When implementing via subagents: dispatch groups of at most 6 tasks each, sequentially — recommended grouping: [T001–T002], [T003–T005], [T006–T008], [T009–T013], [T014–T017], [T018–T020].

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are constitutionally mandated here (Testing Standards II: new behavior in `src/lib/` MUST ship with tests) — T009 is the explicit fail-first task; T005/T008/T013/T016 are written with their story's entries
- Model-ID snapshots (T003, T011, T014) intentionally happen at implementation time, not from this plan — IDs go stale (research D5); discovery supersedes them anyway. LiteLLM ships placeholders by design (T006)
- US5 runs ahead of its P3 rank by design (US3 dependency) — see User Story Dependencies
- Do NOT touch `sdk-factory.ts`, `sdk-fetch.ts`, or any UI component — the contracts (contracts/router-templates.md §4) forbid per-router code in those layers (SC-006); the only sanctioned runtime change is `parseModelIds` (T010, contracts/discovery-filtering.md)
- Commit after each story checkpoint
