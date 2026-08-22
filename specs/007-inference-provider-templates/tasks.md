---
description: 'Task list for feature implementation'
---

# Tasks: First-Class Inference Provider Templates

**Input**: Design documents from `/specs/007-inference-provider-templates/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included — the project constitution mandates tests for new behavior in `src/lib/` (Testing Standards II). Test-first within each story: write story tests, watch them fail, implement, watch them pass.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project: `src/` at repository root (per plan.md structure — this feature touches only `src/lib/ai/`, `src/lib/agent/`, and `README.md`).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Environment baseline — no new code

- [x] T001 Verify dev baseline: `pnpm install`, build `@mayon/shared` (tsup → `packages/shared/dist`, required before type resolution), then confirm `pnpm check` and `pnpm test` are green before any edits

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Test scaffolding every story builds on — MUST be complete before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Create `src/lib/ai/registry.test.ts` with a catalog-integrity suite (data-model.md validation rule 1): unique labels, non-empty descriptions, `defaultModel` ∈ `models`, `requiresKey: true` except Ollama, HTTPS baseUrls with the Ollama localhost exemption. Suite must pass against the CURRENT catalog (no new entries yet)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Add DeepSeek as first-class provider (Priority: P1) 🎯 MVP

**Goal**: DeepSeek appears first in the Add provider picker; key-only setup; live discovery; tools on by default (spec User Story 1, FR-001–FR-004)

**Independent Test**: With a valid DeepSeek key, complete a chat (incl. a tool turn) via Settings → Add provider → DeepSeek in under 2 minutes, typing no endpoint address

### Implementation for User Story 1

- [x] T003 [P] [US1] Add the DeepSeek `ProviderTemplate` as the FIRST entry of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `kind: 'openai-compatible'`, `label: 'DeepSeek'`, `baseUrl: 'https://api.deepseek.com'`, `defaultModel: 'deepseek-chat'`, `models: ['deepseek-chat', 'deepseek-reasoner']` (verified — research 003), `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`, with a one-line description
- [x] T004 [P] [US1] Add `https://api.deepseek.com` and the documented alias `https://api.deepseek.com/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` (research D4)
- [x] T005 [US1] Add tests: DeepSeek shape test (kind/baseUrl/requiresKey/discoverable/models per data-model.md rule 2) in `src/lib/ai/registry.test.ts`, and capability tests asserting `resolveToolCapability` is `true` for both DeepSeek base URLs in `src/lib/agent/capability.test.ts` (depends T003, T004)

**Checkpoint**: User Story 1 fully functional — MVP deliverable (DeepSeek = #1 usage provider)

---

## Phase 4: User Story 2 - Add xAI (Grok) as first-class provider (Priority: P1)

**Goal**: One-click xAI setup with live model list and tools on by default (spec User Story 2)

**Independent Test**: With a valid xAI key, complete a tool-using chat against a Grok model using only the Add Provider dialog

### Implementation for User Story 2

- [x] T006 [P] [US2] Snapshot the current xAI catalog (`GET https://api.x.ai/v1/models` with a key, else console.x.ai docs) and add the xAI template in SECOND position of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `label: 'xAI (Grok)'`, `baseUrl: 'https://api.x.ai/v1'`, `defaultModel: 'grok-4.6'`, `models: ['grok-4.6', <1 cheaper tier from snapshot>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'` (research D5)
- [x] T007 [P] [US2] Add `https://api.x.ai/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts`
- [x] T008 [US2] Add xAI shape test in `src/lib/ai/registry.test.ts` and xAI capability test in `src/lib/agent/capability.test.ts` (depends T006, T007)

**Checkpoint**: User Stories 1 AND 2 independently functional

---

## Phase 5: User Story 3 - Add Moonshot Kimi as first-class provider (Priority: P1)

**Goal**: One-click Kimi setup with international endpoint default; China regional URL stays tools-on after user edit (spec User Story 3, FR-004)

**Independent Test**: With a valid Kimi key, chat with tools via the dialog; then edit the base URL to `https://api.moonshot.cn/v1` and re-verify discovery + tools

### Implementation for User Story 3

- [x] T009 [P] [US3] Snapshot the Kimi catalog (`GET https://api.moonshot.ai/v1/models` with a key, else platform.kimi.ai docs) and add the Kimi template in THIRD position of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `label: 'Moonshot Kimi'`, `baseUrl: 'https://api.moonshot.ai/v1'`, `defaultModel: <K3 flagship from snapshot>`, `models: [<K3 flagship>, <one K2 tier>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`
- [x] T010 [P] [US3] Add BOTH `https://api.moonshot.ai/v1` and `https://api.moonshot.cn/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts` (regional coverage, FR-004)
- [x] T011 [US3] Add Kimi shape test in `src/lib/ai/registry.test.ts` and capability tests for BOTH regional base URLs in `src/lib/agent/capability.test.ts` (depends T009, T010)

**Checkpoint**: User Stories 1–3 (all P1) independently functional

---

## Phase 6: User Story 4 - Add Qwen / DashScope as first-class provider (Priority: P2)

**Goal**: One-click Qwen setup; discovery present iff the compatible-mode `/models` endpoint works (spec User Story 4, FR-003 both outcomes)

**Independent Test**: With a valid DashScope key, chat against a Qwen model via the dialog with tools on; regional CN URL edit keeps tools on

### Implementation for User Story 4

- [x] T012 [US4] Resolve research D6: probe `GET https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models` with a Bearer key; record the outcome (`discoverable` true/false + snapshot list source) as a short addendum in `specs/007-inference-provider-templates/research.md`. If no key is available, ship `discoverable: false` with a docs-curated fallback list and note the deferral
- [x] T013 [P] [US4] Add the Qwen template in FOURTH position of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `label: 'Qwen (DashScope)'`, `baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'`, `defaultModel: 'qwen3-coder'` (or snapshot flagship), `models: [<coder tier>, <general tier>]` per T012, `requiresKey: true`, `discoverable` per T012, `toolCapability: 'auto'` (depends T012)
- [x] T014 [P] [US4] Add BOTH `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` and `https://dashscope.aliyuncs.com/compatible-mode/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts`
- [x] T015 [US4] Add Qwen shape test (pinning whichever `discoverable` shipped) in `src/lib/ai/registry.test.ts` and capability tests for both regional URLs in `src/lib/agent/capability.test.ts` (depends T013, T014)

**Checkpoint**: User Stories 1–4 independently functional

---

## Phase 7: User Story 5 - Add Groq as first-class provider (Priority: P2)

**Goal**: Zero-cost onboarding path; works browser-direct with no server; discovery-first due to catalog churn (spec User Story 5, FR-005)

**Independent Test**: With a valid Groq key and the Mayon server STOPPED, complete a chat against a Groq-hosted model via the dialog

### Implementation for User Story 5

- [x] T016 [P] [US5] Snapshot the current Groq catalog (`GET https://api.groq.com/openai/v1/models`, no-key-browser-friendly but snapshot needs a key; else console.groq.com docs) and add the Groq template in FIFTH position of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `label: 'Groq'`, `baseUrl: 'https://api.groq.com/openai/v1'`, `defaultModel: <current flagship from snapshot>`, `models: [<2–3 current IDs>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`
- [x] T017 [P] [US5] Add `https://api.groq.com/openai/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts`
- [x] T018 [US5] Add Groq shape test in `src/lib/ai/registry.test.ts` and Groq capability test in `src/lib/agent/capability.test.ts` (depends T016, T017)

**Checkpoint**: User Stories 1–5 independently functional

---

## Phase 8: User Story 6 - Add Mistral as first-class provider (Priority: P2)

**Goal**: One-click Mistral setup for the EU-residency audience (spec User Story 6)

**Independent Test**: With a valid Mistral key, complete a tool-using chat against a Mistral model via the dialog

### Implementation for User Story 6

- [x] T019 [P] [US6] Add the Mistral template in SIXTH position of `PROVIDER_TEMPLATES` in `src/lib/ai/registry.ts`: `label: 'Mistral'`, `baseUrl: 'https://api.mistral.ai/v1'`, `defaultModel: 'mistral-large-latest'`, `models: ['mistral-large-latest', <magistral or devstral tier from console.mistral.ai docs snapshot>]`, `requiresKey: true`, `discoverable: true`, `toolCapability: 'auto'`
- [x] T020 [P] [US6] Add `https://api.mistral.ai/v1` to `KNOWN_GATEWAY_BASEURLS` in `src/lib/agent/capability.ts`
- [x] T021 [US6] Add Mistral shape test in `src/lib/ai/registry.test.ts` and Mistral capability test in `src/lib/agent/capability.test.ts` (depends T019, T020)

**Checkpoint**: All six providers (User Stories 1–6) independently functional

---

## Phase 9: User Story 7 - Document the provider long tail (Priority: P3)

**Goal**: README names all six providers and points Tier-2 users at the custom-endpoint path (spec User Story 7, FR-008)

**Independent Test**: README provider line lists DeepSeek, xAI, Moonshot Kimi, Qwen, Groq, Mistral and explains the OpenAI-compatible custom-endpoint path

### Implementation for User Story 7

- [x] T022 [US7] Update the provider list line in `README.md` (currently lines 22–23, "Provider-agnostic AI" bullet) to name all six new first-class providers and keep the "and more" pointer for custom OpenAI-compatible endpoints (research D8)

**Checkpoint**: All user stories complete

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Global guarantees spanning all stories

- [x] T023 Add the final catalog-order assertion to `src/lib/ai/registry.test.ts` (data-model.md rule 3): first seven positions are exactly `[DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, Z.AI (GLM)]` (FR-007). Deferred to polish so each story's phase stays independently green
- [x] T024 Run full quality gates: `pnpm check`, `pnpm lint`, `pnpm test` — all green (constitution gate III)
- [x] T025 Execute the manual validation scenarios in `specs/007-inference-provider-templates/quickstart.md` on the dev stack (`pnpm dev`): catalog presence/order, one-click setup, tools-on-default, regional URL switch, Groq no-server, CORS proxy fallback, DeepSeek reasoning inertness; record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–9)**: Depend on Foundational; implement SEQUENTIALLY in priority order — `src/lib/ai/registry.ts` and `src/lib/agent/capability.ts` are single shared files, so cross-story parallelization by different developers would create merge conflicts. (The only intra-story ordering freedom: the two [P] implementation tasks touch different files.)
- **Polish (Phase 10)**: Depends on all user stories (T023 especially needs the final catalog)

### User Story Dependencies

- **US1 (DeepSeek)**: after Phase 2 only — no story dependencies (MVP)
- **US2–US6**: after Phase 2; no logical dependency on each other, only file-collision ordering
- **US7 (docs)**: after the provider set is final (US1–US6)
- Special case: **US4's T013 depends on T012** (the D6 probe decides `discoverable` and the fallback list source)

### Within Each User Story

- Implementation tasks (template entry + gateway URLs) are parallel ([P], different files)
- Test task depends on both implementation tasks of that story
- Story complete (tests green, quickstart scenario passes) before moving on

### Parallel Opportunities

- T003 ∥ T004; T006 ∥ T007; T009 ∥ T010; T013 ∥ T014; T016 ∥ T017; T019 ∥ T020 — each pair edits different files (`registry.ts` vs `capability.ts`)
- T005/T008/T011/T015/T018/T021 are parallel-safe across stories only in Git worktrees, not in one working tree

---

## Parallel Example: User Story 1

```bash
# Launch the two implementation tasks together (different files):
Task: "Add the DeepSeek ProviderTemplate to src/lib/ai/registry.ts"
Task: "Add both DeepSeek base URLs to KNOWN_GATEWAY_BASEURLS in src/lib/agent/capability.ts"

# Then the story test task (depends on both):
Task: "Add DeepSeek shape + capability tests"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002)
3. Complete Phase 3: User Story 1 — DeepSeek, the #1 usage provider
4. **STOP and VALIDATE**: quickstart.md Scenario 1 (catalog) + Scenario 2 (setup) + Scenario 3 (tools) for DeepSeek
5. Ship if needed — one promoted provider already delivers the spec's core value

### Incremental Delivery

1. Setup + Foundational → test scaffolding green
2. US1 DeepSeek → validate → MVP
3. US2 xAI → US3 Kimi → validate (P1 trio complete)
4. US4 Qwen → US5 Groq → US6 Mistral → validate
5. US7 docs → Phase 10 polish (global order test, full gates, quickstart run)

### Parallel Team Strategy

Not recommended across stories for this feature: all six stories edit the same two constant blocks (`PROVIDER_TEMPLATES`, `KNOWN_GATEWAY_BASEURLS`) plus the same two test files. Sequential priority-order delivery (one developer, ~1 day total per research 003) is the efficient path.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are constitutionally mandated here (Testing Standards II: new behavior in `src/lib/` MUST ship with tests) — written per story, expected to fail before the story's implementation
- Model-ID snapshots (T006, T009, T012, T016, T019) intentionally happen at implementation time, not from this plan — IDs go stale (research D5); discovery supersedes them anyway
- Commit after each story checkpoint
- Avoid: touching `model-discovery.ts`, `sdk-factory.ts`, `sdk-fetch.ts`, or any UI component — the contracts (contracts/provider-templates.md §3–4) forbid per-provider code in those layers (SC-006)
