---
description: 'Task list for feature 009: provider request settings'
---

# Tasks: Provider Request Settings

**Input**: Design documents from `/specs/009-provider-request-settings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/request-settings-resolution.md, contracts/dialect-catalog.md, contracts/settings-advanced-ui.md, quickstart.md

**Tests**: Included — the constitution (§II) mandates tests for new `src/lib/` behavior, and spec AC-6/SC-007 requires replacing `sdk-factory` reasoning tests with dialect-resolver tests.

**Organization**: Tasks grouped by user story (spec.md): US1 dialect resolver keystone (P1), US2 sampling defaults (P1), US3 capability-aware Settings UI (P2), US4 extra-body passthrough (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project (SvelteKit SPA): `src/` at repository root. All AI-request code under `src/lib/ai/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a green baseline before any changes (established repo — no project initialization, no new dependencies).

- [x] T001 Verify baseline gates are green on a clean checkout: `pnpm check`, `pnpm lint`, `pnpm test` (report results before touching code)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type surface every user story consumes.

- [x] T002 Extend provider types in `src/lib/ai/types.ts`: add `requestDefaults?: SamplingRequestDefaults` and `extraBody?: Record<string, JSONValue>` to `ProviderConfig` (src/lib/ai/types.ts:64); add `SamplingRequestDefaults` (7 optional fields with ranges per specs/009-provider-request-settings/data-model.md §2), `ResolvedRequestSettings`, `HazardId`, and a local `JSONValue` type (none exists in repo — verify with search before defining). Both new `ProviderConfig` fields optional so existing settings rows load unchanged.

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 1 - Correct reasoning behavior on every provider (Priority: P1) 🎯 MVP

**Goal**: Static dialect catalog + pure layered resolver in `src/lib/ai/dialects.ts` replacing `providerOptionsForReasoning`/`supportsReasoningEffort`; all four call sites (chat, critic, lab/quiz, title) resolve through it; fixes the namespace-key case defect (research.md R1) and the Gemini `generationConfig` nesting defect (R5).

**Independent Test**: With a router-prefixed model (`z-ai/glm-5.2` on OpenRouter/Kilo) and effort on, the request trace shows `reasoning_effort` under the correct namespace; Anthropic effort-on shows adaptive thinking with no `budget_tokens` (spec US1 acceptance scenarios 1–8).

### Implementation for User Story 1

Tasks T003–T008 all touch `src/lib/ai/dialects.ts` (new file) — inherently sequential.

- [x] T003 [US1] Create `src/lib/ai/dialects.ts` module foundation: catalog type definitions (`EndpointDialect`, `ModelOverlay`, `ProviderOptionsFragment`, metadata fields per contracts/dialect-catalog.md), `namespaceKeyFor(config)` mirroring the SDK rule `config.name.split('.')[0].trim()` case-preserved (research.md R1), and the last-path-segment model matcher (`modelId.split('/').pop()`, lower-cased)
- [x] T004 [US1] Add kind baselines (anthropic adaptive thinking + effort — never `budget_tokens`; gemini via overlays; ollama `think`; openai-compatible emits NOTHING per research.md R2) and the six endpoint dialect entries (zai, deepseek, groq, mistral, moonshot, dashscope) with baseUrl regexes, exact off/on/deep fragments, and `source`+`checked: '2026-08-22'` stamps per contracts/dialect-catalog.md
- [x] T005 [US1] Add all model overlay entries (glm-5.3, glm-5.x, kimi-k2.6, kimi-k3, deepseek-v4, groq-gpt-oss, groq-qwen3, mistral-reasoning, dashscope-thinking-only, gemini-3, gemini-2.5-pro, gemini-2.5) with endpoint scoping, `null`-key suppression, and capability metadata (`locksSampling`, `effortLevels`, `hazards`) per contracts/dialect-catalog.md; Gemini overlays emit root-level `thinkingConfig` under the fixed `'google'` namespace (regression vs current `generationConfig` nesting — research.md R5)
- [x] T006 [US1] Implement `resolveRequestSettings(config, modelId, effort)` in `src/lib/ai/dialects.ts`: layered per-key shallow merge (kind baseline → endpoint dialect → model overlay), `callSettings: {}` placeholder (Tier A layer 4 is US2), `droppedExtraKeys: []` placeholder (Tier C layer 5 is US4), omit-empty semantics per contracts/request-settings-resolution.md
- [x] T007 [US1] Implement `describeDialect(config, modelId)` in `src/lib/ai/dialects.ts` returning `{ locksSampling, effortLevels, hazards } | null` from matched overlay/kind defaults (contracts/request-settings-resolution.md)
- [x] T008 [US1] Write `src/lib/ai/dialects.test.ts` (constitution II): namespace-key regression tests ("Z.AI"→"Z", case preservation, dot truncation, trim — must fail against the old lowercase behavior), layer precedence (overlay overrides endpoint; `null` suppression), router prefixes (`z-ai/glm-5.2`, `deepseek/deepseek-chat`, `moonshotai/kimi-k3`, `anthropic/claude-sonnet-4.5` via router), every catalog entry's off/on/deep fragments verbatim from contracts/dialect-catalog.md, generic-baseline-emits-nothing (R2), Gemini root-level thinkingConfig regression, `describeDialect` metadata (locksSampling on kimi-k3/k2.6, effortLevels hides deep for ollama/generic, hazards)

After T008, the call-site rewiring touches different files and can proceed in parallel:

- [x] T009 [P] [US1] Extend trace surface in `src/lib/agent/trace.ts`: add optional `callSettings` to the `'request'` trace event (src/lib/agent/trace.ts:11-16) and optional `providerOptions`/`callSettings` to `buildObjectTrace` request payload (trace.ts:101-112) — additive JSON fields only, no storage change
- [x] T010 [US1] Rewire chat and critic passes in `src/lib/agent/loop.ts`: chat site (loop.ts:298-326) calls `resolveRequestSettings(deps.config, deps.config.defaultModel, deps.effort)` for providerOptions + traces callSettings; critic site (loop.ts:217-222) gains the same resolver output (it currently sends none) using ambient effort; update `src/lib/agent/loop.test.ts` mocks (loop.test.ts:108,140-141) from `providerOptionsForReasoning` to the resolver
- [x] T011 [P] [US1] Add `getAmbientEffort()` helper in `src/lib/ai/client.ts`: reads the persisted `'reasoningEffort'` settings KV (same key the Composer persists, src/lib/components/chat/Composer.svelte:68-84), defaults to `'on'` (research.md R7)
- [x] T012 [P] [US1] Thread optional precomputed `requestSettings` through structured generation: `src/lib/ai/generate/object-tool.ts` (apply `providerOptions` at the generateText call, object-tool.ts:145-158, and trace via T009 fields), `src/lib/ai/generate/generate.ts` and `src/lib/ai/generate/generate-quiz.ts` (pass-through option)
- [x] T013 [P] [US1] Wire title generation: `src/lib/ai/generate/generate-title.ts` accepts optional `requestSettings`; caller `src/lib/stores/chat.svelte.ts` (chat.svelte.ts:702) resolves via `resolveRequestSettings(config, config.defaultModel, 'off')` — effort pinned off (spec FR-010)
- [x] T014 [P] [US1] Wire lab/quiz stores: `src/lib/stores/labs.svelte.ts` (labs.svelte.ts:97) and `src/lib/stores/quizzes.svelte.ts` (quizzes.svelte.ts:178) resolve `resolveRequestSettings(config, config.defaultModel, await getAmbientEffort())` and pass the result into the generate wrappers
- [x] T015 [P] [US1] Replace deep-visibility source in `src/routes/chat/[id]/+page.svelte` (+page.svelte:69-70): `supportsReasoningEffort(activeModelId)` → `describeDialect(config, activeModelId)?.effortLevels.includes('deep') ?? false` (effort toggle UI itself unchanged per spec FR-009)
- [x] T016 [US1] Delete `providerOptionsForReasoning` and `supportsReasoningEffort` from `src/lib/ai/sdk-factory.ts` (sdk-factory.ts:67-123) and remove the superseded reasoning describes from `src/lib/ai/sdk-factory.test.ts` (keep model-construction coverage) — spec SC-007; run `rg providerOptionsForReasoning|supportsReasoningEffort src/` to prove zero references remain

**Checkpoint**: All four call paths resolve reasoning through one pure resolver; every dialect maps correctly; old mapping fully removed; `pnpm check && pnpm lint && pnpm test` green

---

## Phase 4: User Story 2 - Per-provider sampling defaults (Priority: P1)

**Goal**: Tier A `requestDefaults` reach the wire at all four call paths with omit-empty semantics.

**Independent Test**: Set `temperature`/`maxOutputTokens` on a provider (temporarily via settings JSON or after US3 UI): traces at chat, critic, lab/quiz, and title paths show both values; clear them → fields absent (spec US2 scenarios 1–4, quickstart.md §2).

### Implementation for User Story 2

- [x] T017 [US2] Implement layer 4 in `resolveRequestSettings` (`src/lib/ai/dialects.ts`): copy `config.requestDefaults` into `callSettings` with omit-empty semantics (only defined keys; never `key: undefined`); extend `src/lib/ai/dialects.test.ts` with unset⇒absent, partial⇒only-set-keys, and full-set cases
- [x] T018 [US2] Apply `callSettings` as top-level `streamText` params at the chat and critic sites in `src/lib/agent/loop.ts` (SDK maps them for all four provider kinds — no per-kind branching)
- [x] T019 [US2] Apply `callSettings` as top-level `generateText` params in `src/lib/ai/generate/object-tool.ts` and `src/lib/ai/generate/generate-title.ts` (lab/quiz flow automatically — stores pass the whole resolved object since T014)

**Checkpoint**: Sampling defaults apply identically at all four call paths; byte-identical requests when unset

---

## Phase 5: User Story 3 - Capability-aware Settings UI with resolved-request preview (Priority: P2)

**Goal**: Per-provider "Advanced" section in Settings with capability-gated sampling inputs and a live resolved-request preview driven by the real resolver.

**Independent Test**: Open Advanced settings for a Kimi provider with kimi-k3: sampling inputs disabled with hazard copy; preview shows no sampling fields. Switch model: inputs enable, preview updates (spec US3 scenarios 1–4; quickstart.md §4).

### Implementation for User Story 3

All three tasks touch `src/lib/components/ai/ProviderConfig.svelte` — sequential. Use existing `Collapsible` (`$lib/components/ui/collapsible`) and the page's raw `<input>` + shared `inputClass` conventions (ProviderConfig.svelte:43-44) — no new dependencies (constitution III; contracts/settings-advanced-ui.md Part A).

- [x] T020 [US3] Add the Advanced `Collapsible` section inside each provider `<li>` (after tool capability/models, before API key) in `src/lib/components/ai/ProviderConfig.svelte`: seven sampling inputs bound to `config.requestDefaults` with field-level range validation (data-model.md §2), empty⇒unset semantics, invalid values never persisted (existing `updateField`/`commit` flow)
- [x] T021 [US3] Capability gating in the Advanced section: `describeDialect(config, defaultModel)` → disable/hide sampling inputs when `locksSampling` with hazard copy; render warning lines for `thinking-ignores-sampling`, `thinking-rejects-sampling`, `cannot-disable-thinking`, `reasoning-eats-token-cap` (hazard strings from contracts/dialect-catalog.md; fields remain editable for non-lock hazards)
- [x] T022 [US3] Resolved-request preview in the Advanced section: off/on/deep selector + read-only JSON render of `resolveRequestSettings(currentFormState, defaultModel, selectedEffort)` showing `callSettings` and `providerOptions` plus hazard chips — pure live computation, updates as fields/effort change, exactly what the live path would send (spec FR-015/FR-016)

**Checkpoint**: Settings honestly reflects model capabilities; preview matches live resolution

---

## Phase 6: User Story 4 - Raw extra-body passthrough with guardrails (Priority: P2)

**Goal**: Tier C `extraBody` validated, merged last (user wins), visible in trace and preview, with total dropped-key transparency.

**Independent Test**: Enter `{"top_k": 40}` → reaches the request body and trace, overriding colliding dialect keys; `{"api_key": "..."}` rejected with UI error; on Anthropic, `{"top_k": 40, "speed": "fast"}` warns about dropped `top_k` while `speed` applies (spec US4 scenarios 1–5; quickstart.md §5).

### Implementation for User Story 4

- [x] T023 [P] [US4] Implement `validateExtraBody(input)` in `src/lib/ai/dialects.ts` per data-model.md §4 (JSON object only, ≤16 KiB serialized, reject secret-like keys `/^(authorization|api[-_]?key|x-api-key|apikey|headers?|cookies?|token|secret|password|bearer)/i`, reject `__proto__`/`constructor`/`prototype`) returning `{ok, value|errors}`; unit tests in `src/lib/ai/dialects.test.ts` covering the full accept/reject matrix
- [x] T024 [US4] Implement layer 5 merge in `resolveRequestSettings` (`src/lib/ai/dialects.ts`): openai-compatible — every extraBody key set into `providerOptions[nsKey]` verbatim, overriding dialect collisions; anthropic/gemini/ollama — allowlist merge only, non-forwardable keys collected into `droppedExtraKeys` (never silent). Re-derive allowlists from the installed SDK zod schemas at implementation time; verified 2026-08-22 snapshot in contracts/request-settings-resolution.md. Unit tests: collision override, dropped keys per kind, empty for openai-compatible
- [x] T025 [US4] Add the extra-body JSON `<textarea>` to the Advanced section in `src/lib/components/ai/ProviderConfig.svelte`: draft-string editing, inline `validateExtraBody` error list on change, save blocked while invalid, valid JSON persisted via existing flow (contracts/settings-advanced-ui.md Part A)
- [x] T026 [US4] Add dropped-keys warning UI under the extra-body editor in `src/lib/components/ai/ProviderConfig.svelte`: render `droppedExtraKeys` from the resolver output as an explicit warning (empty for openai-compatible); preview from T022 automatically reflects merged extras since it uses the real resolver

**Checkpoint**: Full guardrail surface: validated, merged last, traced, previewed, no silent drops

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification surfaces and documentation shared by all stories.

- [x] T027 [P] Render `providerOptions` and `callSettings` visibly in the Diagnostics panel "Assembled Request" block in `src/lib/components/diagnostics/DiagnosticsPanel.svelte` (currently Copy-payload-only, DiagnosticsPanel.svelte:367) per contracts/settings-advanced-ui.md Part C
- [x] T028 [P] Document the request-settings resolver seam in `docs/dev/architecture.qmd` and `docs/dev/seams.qmd`: dialect catalog, resolver layering, namespace-key rule, extraBody guardrails; note the two bug fixes from research.md (R1 namespace case, R5 Gemini nesting)
- [x] T029 Run full gates and validation: `pnpm check`, `pnpm lint`, `pnpm test` (all green, no server-package changes expected); execute quickstart.md scenarios §1 (automated) and walk §2–§6 (manual smoke) on `pnpm dev`; confirm spec SC-001–SC-007

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories (shared types)
- **US1 (Phase 3)**: Depends on Phase 2. Internal order: T003→T004→T005→T006→T007→T008 (same file, sequential); then T009–T015 in parallel; T016 last (requires all callers rewired)
- **US2 (Phase 4)**: Depends on US1 (resolver + call-site plumbing); T017 → T018/T019
- **US3 (Phase 5)**: Depends on US1 (`describeDialect`) and US2 (sampling inputs + preview show callSettings); T020→T021→T022 (same file)
- **US4 (Phase 6)**: Core (T023/T024) depends on US1 only; UI (T025/T026) depends on US3 (Advanced section exists). T023 ∥ T024 partially (same file — sequence T023→T024)
- **Polish (Phase 7)**: T027/T028 after their inputs exist (T027 needs trace fields from T009+T018; T028 after design settles); T029 last

### User Story Dependencies

- **US1 (P1)**: Foundation only — no story dependencies (keystone, spec: "establishes the single resolution path the other stories build on")
- **US2 (P1)**: US1 (threads callSettings through US1's plumbing)
- **US3 (P2)**: US1 (describeDialect) + US2 (binds requestDefaults)
- **US4 (P2)**: US1 core merge; US3 for the editor UI

### Parallel Opportunities

- Within US1: T009, T010, T011, T012, T013, T014, T015 all touch different files — fully parallel after T008
- US4 core (T023–T024) can proceed in parallel with US3 (different files) once US1 is done
- Polish: T027 ∥ T028

---

## Parallel Example: User Story 1

```bash
# After T008 (resolver + tests complete), launch in parallel:
Task: "T009 Extend trace surface in src/lib/agent/trace.ts"
Task: "T010 Rewire chat + critic in src/lib/agent/loop.ts"
Task: "T011 getAmbientEffort helper in src/lib/ai/client.ts"
Task: "T012 Thread requestSettings through src/lib/ai/generate/*"
Task: "T013 Title generation wiring in src/lib/stores/chat.svelte.ts"
Task: "T014 Lab/quiz store wiring in src/lib/stores/{labs,quizzes}.svelte.ts"
Task: "T015 supportsDeep swap in src/routes/chat/[id]/+page.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline green)
2. Complete Phase 2: Foundational types
3. Complete Phase 3: US1 (resolver + all four call sites + tests)
4. **STOP and VALIDATE**: quickstart.md §3 dialect scenarios via request trace — independently deliverable (fixes real bugs: GLM-via-router, Anthropic adaptive, Gemini nesting)
5. Recommended first release increment: US1 + US2 (US2 is 3 tasks; together they deliver the full Tier A+B surface)

### Incremental Delivery

1. Foundation → US1 (resolver correctness) → validate §3
2. - US2 (sampling at all paths) → validate §2
3. - US3 (capability UI + preview) → validate §4
4. - US4 (extraBody guardrails) → validate §5
5. Polish (trace rendering, docs, full §6 regression pass)

### Parallel Team Strategy

- After US1: US2 (dev A) ∥ US4 core T023–T024 (dev B) ∥ US3 (dev C, needs US2's type surface only)
- US4 UI (T025–T026) follows US3's Advanced section

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- Tasks T003–T008 and T020–T022, T023–T024 are same-file sequences — do NOT parallelize despite being in the same phase
- The resolver is pure (spec FR-016) — never import storage/network code into `src/lib/ai/dialects.ts`
- No secrets in `extraBody` — validation is structural, not advisory (constitution I)
- Regression bar: providers without Advanced settings must send byte-identical requests (spec SC-006), modulo the two documented bug fixes (research.md R1/R5)
- Run `pnpm check && pnpm lint && pnpm test` after each phase; commit after each task or logical group
