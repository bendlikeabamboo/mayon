---
description: "Task list for 022-smooth-streaming (steady cadence + soft blur edge)"
---

# Tasks: Smooth Streaming — Steady Cadence with a Soft Blur Edge

**Input**: Design documents from `/specs/022-smooth-streaming/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The constitution (`.specify/memory/constitution.md`, Principle II) REQUIRES tests for new behavior in `src/lib/`; UI-only presentation tasks are verified via `pnpm check` + manual smoke + source-contract tests (existing repo convention). Test tasks are written FIRST and must FAIL before their implementation task completes.

**Organization**: Tasks are grouped by user story (spec.md: US1 cadence P1, US2 edge P2, US3 preset setting P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task

## Path Conventions

Single existing SvelteKit SPA repo — all work is client-side under `src/`; no new packages, routes, or server code (per plan.md Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Worktree bootstrap and baseline verification

- [x] T001 Bootstrap the worktree: `pnpm install && pnpm --filter @mayon/shared build` (fresh worktrees have no node_modules and no built `@mayon/shared`; rebuild dev images with `pnpm dev:build` not needed — no dep/config/shared changes)
- [x] T002 Verify baseline gates are green before any changes: `pnpm check && pnpm lint && pnpm test` (record result — constitution requires before/after comparison for perf-sensitive changes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The preset type/accessor and its store field — every user story reads the preset, so this blocks all stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 [P] Create the preset accessor module `src/lib/chat/streaming/pref.ts` exactly per contracts/stream-preset-setting.md: `type StreamPreset = 'calm' | 'standard' | 'expressive'`, `STREAM_PRESET_KEY = 'streamPreset'`, `STREAM_PRESET_OPTIONS`, `STREAM_PRESET_LABELS`, `getStreamPreset()` (defensive read: miss/corrupt JSON/unknown value → `'standard'`, pattern `src/lib/chat/strip/pref.ts` + `src/lib/ai/client.ts:43-46`), `setStreamPreset()` (sole writer via `repos.settings`)
- [x] T004 [P] Create `src/lib/chat/streaming/pref.test.ts` (write first, mirror `src/lib/chat/strip/pref.test.ts`): key-name stability, default-on-miss, corrupt-JSON fallback, wrong-type/unknown-value fallback, set/get round-trip
- [x] T005 Add `streamPreset` `$state<StreamPreset>('standard')` + setter to `ChatState` in `src/lib/stores/chat.svelte.ts`, and load it on mount via `getStreamPreset()` in `src/routes/chat/[id]/+page.svelte` (follow the `stripEnabled` pattern at `+page.svelte:492`)

**Checkpoint**: Foundation ready — preset resolvable from store and settings KV; user story implementation can begin

---

## Phase 3: User Story 1 — Steady, calm streaming cadence (Priority: P1) 🎯 MVP

**Goal**: Incoming reply text is released to the renderer at a steady, word-safe, adaptive cadence with an eased final drain; abort/error flushes instantly; Standard preset is byte-for-byte today's behavior.

**Independent Test**: With `streamPreset` temporarily set to `'expressive'` via console (`repos.settings.set('streamPreset','expressive')` — the settings UI arrives in US3), stream a long mixed reply: text grows in small regular increments, no word ever appears split, fast models complete visibly within ~1 s of stream end, Stop shows everything instantly. Unit + store suites verify the same with fake timers.

### Tests for User Story 1 (write FIRST, must FAIL before implementation) ⚠️

- [x] T006 [P] [US1] Create `src/lib/chat/streaming/pacer.test.ts` with fake timers (`vi.useFakeTimers()`, pattern `src/lib/stores/toasts.svelte.test.ts`) asserting timing BANDS (convention `src/lib/motion/stagger.test.ts:42-50`): word-safety (released prefix never ends mid-word, snap lookback ≤ 12 chars), adaptive catch-up (all-at-once arrival drains within the ~0.5 s lag window; trickle shows nothing held back), eased drain (buffer empty ≤ ~1 s after `onStreamEnd`, no single-tick dump), abort fast-path (next tick = full length from any mode), reset/shrink tolerance (critic-phase buffer clear resets to 0), empty/whitespace deltas cause no stutter — all per contracts/pacer-api.md behavioral rules

### Implementation for User Story 1

- [x] T007 [US1] Implement `createPacer()` in `src/lib/chat/streaming/pacer.ts` per contracts/pacer-api.md: `PacerMode` ('idle' | 'streaming' | 'draining' | 'flushed'), `PacerConfig` with initial constants (`tickMs: 80`, `baseCps: 90`, `catchupPerSec: 3.0`, `snapLookback: 12`, `drainRampMs: 120`, `drainBudgetMs: 900`, injectable `now`), API `onArrived/onStreamEnd/onAbort/reset/tick/raw-length-safe mode getter` (depends T006)
- [x] T008 [US1] Wire the pacer into the store flush in `src/lib/stores/chat.svelte.ts`: the 80 ms rAF flush (`startRenderFlush`, `RENDER_INTERVAL_MS`) consults the pacer when `streamPreset !== 'standard'` and writes `streamBuffer.slice(0, released)` to `streamBufferRender` (standard = verbatim copy, unchanged); call `onArrived` from the `updateStreamBuffer` dep, `onStreamEnd` at normal finish, `onAbort` on abort/error; expose `streamPhase: $state<PacerMode-like>` for US2; raw `streamBuffer` NEVER paced or mutated (depends T005, T007)
- [x] T009 [US1] Implement deferred finalization in `src/lib/stores/chat.svelte.ts`: on normal finish, hold `appendAssistantText(rawBuffer)` + buffer teardown until the pacer reaches `'flushed'` (bounded ≤ ~1 s, research.md D3); abort/error path keeps today's immediate full flush + `interrupted: true` persist (`chat.svelte.ts:645-655` semantics) (depends T008)
- [x] T010 [US1] Add perf instrumentation to the paced flush path via `src/lib/perf/mark.ts` (`mark('pacing:flush', …)` / `incRender`), plus source-contract test `src/lib/chat/streaming/pacer.contract.test.ts` asserting the instrumentation exists in source (pattern `src/lib/components/chat/SectionStrip.contract.test.ts`) (depends T008)
- [x] T011 [US1] Extend `src/lib/stores/chat.svelte.test.ts` (pattern `mockStreamReply` at `:91-103` + fake timers): paced streaming increments are steady and word-safe; `standard` passthrough produces byte-identical render-copy behavior as pre-feature (existing streaming tests pass unchanged with preset unset); deferred finalize fires after drain; abort persists raw buffer immediately with `interrupted: true`; critic-reset clears release position (depends T008, T009)

**Checkpoint**: User Story 1 fully functional and independently testable (cadence with console-set preset; all gates green)

---

## Phase 4: User Story 2 — Soft blur edge at the growth point (Priority: P2)

**Goal**: With Expressive active, the newest text emerges through a soft blur/fade pinned to the growing edge; suppressed on code blocks/tables, softened on lists; lifts in step with drain completion; never blocks selection; durable DOM untouched.

**Independent Test**: With preset `'expressive'` (console-set), stream prose → code block → list → table → prose: blur edge visible on prose, absent on code/table, softened on list, lifts smoothly at completion, text selection works mid-stream. Existing `selection.test.ts` / `sourcemap.test.ts` / render E2E pass unchanged.

### Tests for User Story 2 (write FIRST, must FAIL before implementation) ⚠️

- [x] T012 [P] [US2] Create `src/lib/chat/streaming/edge-target.test.ts` (jsdom, pattern `src/lib/chat/selection.test.ts:26-29`): given a rendered markdown container, the edge-target helper returns the trailing-text rect descriptor and the correct effect class — `normal` for prose tails, `suppressed` for `pre`/`table` tails, `soften` for list-item tails; null/hidden when no text target exists (depends nothing; helper contract from contracts/growth-edge-overlay.md)
- [x] T013 [P] [US2] Create `src/lib/components/chat/GrowthEdge.contract.test.ts` (source-contract, pattern `SectionStrip.contract.test.ts`): asserts `pointer-events: none` present, `z-10` rung used, reduced-motion handling (`motion-reduce:transition-none` / stagger-style gate), `incRender('GrowthEdge')` instrumented, and that `AssistantMessage.svelte` mounts it ONLY in the `live` branch

### Implementation for User Story 2

- [x] T014 [US2] Implement the pure helper `src/lib/chat/streaming/edge-target.ts`: locate the trailing text of the last block in a rendered markdown container, return target rect + effect classification per T012 (depends T012)
- [x] T015 [US2] Implement `src/lib/components/chat/GrowthEdge.svelte` (blur-fade variant) per contracts/growth-edge-overlay.md: props `{ variant, buffer, lifting }`; rAF-coalesced re-measure on `buffer` change using `edge-target.ts`; `backdrop-filter: blur()` + linear-gradient mask over the measured rect; suppress/soften per classification; `lifting` runs a short (~200 ms) un-blur transition; `pointer-events: none`, `z-10`, zero text nodes; `incRender('GrowthEdge')` via `src/lib/perf/mark.ts` (depends T013, T014)
- [x] T016 [US2] Mount `GrowthEdge` in `src/lib/components/chat/rows/AssistantMessage.svelte` live branch only: `position: relative` wrapper around `<Markdown live>` (the `live={true}` path at `:146`), `variant` from `chatStore.streamPreset` (`'expressive'` only — hidden for `standard`, caret arrives in US3), `lifting={chatStore.streamPhase === 'draining'}`; never mounted for durable rows (depends T008, T015)
- [x] T017 [US2] Append overlay styles/keyframes to `src/app.css` (bottom-of-file precedent `.expound-flash` at `:510-555`): blur-fade tokens using existing oklch vars (`--background`, `--card`, `color-mix`), lift-transition keyframes, reduced-motion suppressions per the `src/lib/motion/stagger.ts:57-78` gating convention (depends T015)

**Checkpoint**: User Stories 1 AND 2 both work independently (Expressive = cadence + edge); DOM-invariant suites (`selection`, `sourcemap`, `wrap-range`, render E2E) green

---

## Phase 5: User Story 3 — One preset-shaped appearance setting (Priority: P3)

**Goal**: Users pick Calm / Standard / Expressive in the appearance settings; choice persists, applies without reload; default Standard shows today's behavior; Calm = cadence + plain caret (no blur); the shape accepts future presets without new toggles.

**Independent Test**: Open Settings → Chat section, switch presets, stream under each: Expressive = cadence + blur edge; Calm = cadence + plain caret, no blur; Standard = pre-feature behavior; reload retains the choice (console-verify `repos.settings.get('streamPreset')` round-trips).

### Tests for User Story 3 (write FIRST, must FAIL before implementation) ⚠️

- [x] T018 [P] [US3] Create `src/lib/components/settings/ChatDisplayConfig.render.test.ts` (source-contract, pattern `src/lib/components/settings/MobileSectionJump.render.test.ts`): asserts a labeled select bound to `STREAM_PRESET_OPTIONS` with `STREAM_PRESET_LABELS`, optimistic save via `setStreamPreset`, and error-revert present in source

### Implementation for User Story 3

- [x] T019 [US3] Add the streaming-look select to `src/lib/components/settings/ChatDisplayConfig.svelte`: labeled native `<select bind:value>` over `STREAM_PRESET_OPTIONS`/`STREAM_PRESET_LABELS` (markup pattern `src/lib/components/chat/LearnerProfileConfig.svelte:130-137`), optimistic save + revert-on-error (pattern `ChatDisplayConfig.svelte:14-22`), helper text mapping each preset to its behavior (depends T003, T018)
- [x] T020 [US3] Add the `caret` variant to `src/lib/components/chat/GrowthEdge.svelte` for the Calm preset: thin blinking bar at the measured edge using the same `edge-target` measure/suppression machinery, its own keyframes in `src/app.css`; Calm gates cadence-on + caret, no blur (variant already flows from `chatStore.streamPreset` via T016) (depends T015, T016, T017)
- [x] T021 [US3] Add `'streaming'` and `'appearance'` aliases to the `chat` section entry in `src/lib/settings/sections.ts:13` so settings search/jump finds the control (depends T019)

**Checkpoint**: All three user stories independently functional; presets fully usable end-to-end from the UI

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Constitution obligations and whole-feature validation

> Status: T001–T021 complete (2020/2020 tests, `pnpm check` 0 errors, `pnpm lint` clean).
> T022 deferred per plan; T023–T024 need a dev-stack session with a configured LLM provider
> (browser: perf probe + manual matrix M1–M12).

- [ ] T022 [P] Optional E2E prep (deferred by plan.md/research.md D6): make `CHUNK_INTERVAL_MS` / `BLOCKS_PER_CHUNK` env-tunable in `tests/fixtures/mock-llm/server.mjs` (constants at `:19-20`) and note it in `tests/fixtures/mock-llm/README.md` — preserves the no-`page.route`-interception guardrail; only if E2E pacing asserts are wanted
- [ ] T023 Capture the mandatory perf before/after per quickstart.md §3: probe run (`window.__MAYON_PERF__ = 1`, scenario `smooth-streaming`) comparing Standard vs Expressive — fps p95, CLS, `pacing:flush` + `markdown:render` marks, `GrowthEdge` render count; attach evidence to the PR (constitution IV)
- [ ] T024 Run the full quickstart.md manual matrix M1–M12 on the dev stack and all gates (`pnpm check`, `pnpm lint`, `pnpm test`); fix or file follow-ups for anything that fails

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories (T003→T004→T005 chain; T003/T004 parallelizable as a tests-first pair)
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational + US1's T008 (consumes `streamPhase` and the pacer wiring); everything else in US2 is internal
- **US3 (Phase 5)**: depends on Foundational (T003) + US2's T015–T017 for the caret variant; the settings select (T019) itself only needs T003 and can be built in parallel with US2 if desired
- **Polish (Phase 6)**: depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Foundational only → independently shippable (cadence via console-set key)
- **US2 (P2)**: US1 store wiring (T008) → independently testable after US1
- **US3 (P3)**: US1 (cadence gate) + US2 (caret variant reuses overlay) for full behavior; the select control alone depends only on T003

### Within Each User Story

- Tests first (T006 before T007; T012/T013 before T014–T017; T018 before T019)
- Pure module before store wiring (T007 → T008 → T009/T010/T011)
- Helper before component (T014 → T015 → T016 → T017)
- Commit after each task or logical group; stop at every Checkpoint to validate the story independently

### Parallel Opportunities

- Foundational: T003 ∥ T004 (tests-first pair)
- US1: T006 (tests) parallel with nothing else until T007; T010 ∥ T011 after T009
- US2: T012 ∥ T013 (independent test files)
- US3: T018 ∥ T019-prep; T019 can start as soon as T003 lands (crosses phases by design)
- Team fan-out (respecting the ≤ 6-tasks-per-subgroup convention for parallel agents): Subgroup A = T003–T005; Subgroup B = T006–T011; Subgroup C = T012–T017; Subgroup D = T018–T021; Subgroup E = T022–T024

---

## Parallel Example: User Story 1

```bash
# After T005 lands, launch the tests-first pair, then the implementation chain:
Task: "Create pacer.test.ts with fake-timer band assertions in src/lib/chat/streaming/pacer.test.ts"   # T006
# then:
Task: "Implement createPacer in src/lib/chat/streaming/pacer.ts"                                        # T007
# then in parallel once T009 is done:
Task: "Perf marks + contract test (T010)"
Task: "Store integration tests in chat.svelte.test.ts (T011)"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational)
2. Complete Phase 3 (US1: pacing) → **STOP and VALIDATE** (console-set preset, stream, watch cadence)
3. This alone kills the burstiness — the core pain (spec P1). Shipping-ready slice for users = US1 + US3 (the setting that turns it on without devtools).

### Incremental Delivery

1. Foundation → US1 (calm streaming) → validate → US2 (visual identity) → validate → US3 (user-facing control) → validate
2. Polish: perf evidence + full matrix M1–M12
3. Each story preserves the previous ones: Standard passthrough and DOM-invariant suites are the regression tripwires

### Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks
- Test tasks are authored first and must FAIL before the implementation task completes
- Timing constants are initial values (research.md D2); tune by editing `PacerConfig` only — tests assert bands, not exact curves
- Never pace or mutate `streamBuffer` (raw, persistence contract); only the render copy is paced
- Avoid: any DOM inside the Highlighter container, anything appended inside `<pre>`, per-frame layout reads outside the flush cadence
