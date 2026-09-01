---

description: "Task list for Section Peek Strip (017)"
---

# Tasks: Section Peek Strip

**Input**: Design documents from `/specs/017-section-peek-strip/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/section-strip.md, quickstart.md — all present.

**Tests**: INCLUDED. The project constitution (`.specify/memory/constitution.md`, §II Testing Standards) mandates tests for all new behavior in `src/lib/`; pure modules get unit tests, injected-DOM integration gets source-contract tests, and `selection.test.ts` gains regression fixtures. Test tasks are numbered before their implementation (RED → GREEN).

**Organization**: Tasks are grouped by user story (US1 strip+jump, US2 dwell preview, US3 toggle) so each story is independently implementable and testable.

**Execution convention (owner ruling)**: When implementing this file, group tasks into waves of at most 6 tasks and dispatch each wave to a separate subagent. The waves below are already sized for that.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every description carries exact file path(s)

## Path Conventions

Single SvelteKit project: all paths under `src/`. Tests are colocated beside sources as `*.test.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a green baseline before any feature code lands.

- [x] T001 [P] Verify toolchain baseline: run `pnpm install`, then `pnpm check`, `pnpm lint`, `pnpm test` in repo root and confirm all green before any edits (records the pre-feature state the perf comparison in T021 needs)

**Checkpoint**: Gates green on the untouched branch.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Section extraction and selection-safety — required by ALL user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Write failing unit tests for section extraction in src/lib/markdown/sections.test.ts per contracts §1: heading walk in document order; exclusions (headings inside fenced/indented code, blockquote/admonition bodies, tables, math, HTML are NOT sections); setext headings count; `start`/`end` offsets tile from first heading to end of input; `length === end - start`; excerpt is plain text (no markdown syntax), whitespace-collapsed, capped (~240 chars); empty title allowed for bare `##`; memoization returns identical output for repeated input; `isStripCandidate` true at ≥3 sections, false below
- [x] T003 [P] Implement src/lib/markdown/sections.ts per contracts §1 to make T002 green: `Section` interface, `extractSections(raw)` (remarkParse + remarkGfm walk, Last-Value memoization, wrapped in `mark('strip:extract', …)`), `isStripCandidate`, `clearSectionsCache` (test hook); no DOM access, no render.ts dependence
- [x] T004 [P] Register strip selectors in src/lib/chat/selection.ts: append `'.section-strip'` and `'.section-strip-preview'` to `EXCLUDED_CHROME_SELECTORS` (contracts §7)
- [x] T005 Extend src/lib/chat/selection.test.ts with strip/preview fixtures (depends T004): a reply body containing rendered `.section-strip`/`.section-strip-preview` markup — alignment of real reply text is unchanged, and a selection touching preview text still fails safely with `reason: 'generated'`
- [x] T006 Run gates `pnpm check && pnpm lint && pnpm test` and confirm green (foundational complete)

**Checkpoint**: Extraction + selection safety ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Glanceable strip + click-to-jump (Priority: P1) 🎯 MVP

**Goal**: Long replies (≥3 sections, taller than the viewport, finished streaming) show a hairline bar strip along the reply's edge; hovering fattens the bars; clicking a bar smooth-scrolls the transcript to that section.

**Independent Test**: With `pnpm dev`, open a reply with ≥3 headings several screens tall → hairline strip appears; hover fattens bars with no layout shift; click a bar → smooth scroll lands the section heading at the viewport top with a brief flash; short/single-section replies show no strip; touch tap jumps directly (no preview exists yet).

### Tests for User Story 1 (constitution-mandated)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [P] [US1] Write failing source-contract tests in src/lib/components/chat/strip/SectionStrip.contract.test.ts asserting the SectionStrip.svelte source: `role="navigation"` + `aria-label="Reply sections"`; no `scrollIntoView`/`scrollTop`/`history`/`location` in source; no wheel/touch event handlers attached; `pointer-events-none` wrapper with `pointer-events-auto` interactive children; `motion-reduce:transition-none` on transitions; `incRender('SectionStrip')` present; touch handling via `matchMedia('(hover: none), (pointer: coarse)')` with listener cleanup
- [x] T008 [P] [US1] Write failing source-contract tests in src/lib/components/chat/rows/AssistantMessage.strip.test.ts asserting the AssistantMessage.svelte source: strip renders only for durable entries (gated on the `live` prop — never on the streaming live tail); eligibility wiring present (sections ≥3 via `isStripCandidate` + height-vs-viewport measurement); `onJumpToSection` prop threaded; ResizeObserver disconnected on unmount

### Implementation for User Story 1

- [x] T009 [US1] Implement src/lib/components/chat/strip/SectionStrip.svelte (makes T007 green) per contracts §4: props `{ msgId, sections, onJump }`; hairline rest state (`bg-border` ticks, ≤2px) on a `pointer-events-none` wrapper absolutely positioned along the reply's right edge; one `<button>` per section in document order with visual height proportional to `section.length` (CSS min visual size for tiny sections), ≥24px effective hit target via padding; hover fattens bars (Tailwind group-hover, `z-10`, `motion-reduce:transition-none`); `aria-label` per bar from `section.title` (fallback "Section N"); coarse-pointer tap = `onJump(index)` directly (no dwell — preview arrives in US2); emits `incRender('SectionStrip')` (depends T003)
- [x] T010 [US1] Integrate strip into src/lib/components/chat/rows/AssistantMessage.svelte (makes T008 green) and thread the callback through src/lib/components/chat/MessageList.svelte: derive `sections = extractSections(message.content)` for durable entries only; eligibility = `isStripCandidate(sections)` ∧ body `offsetHeight` > scroller `clientHeight` (scroller via `closest('.overflow-y-auto')`, one-shot mount check + ResizeObserver on the message body, disconnected on unmount, NOT scroll-tied); add optional `onJumpToSection?: (msgId, index) => void` prop to AssistantMessage and pass it through MessageList from the chat page; message wrapper gains `relative` for the strip gutter (depends T008, T009)
- [x] T011 [US1] Implement `handleSectionJump(msgId, index)` in src/routes/chat/[id]/+page.svelte per contracts §6: resolve nth `h1–h6` under `#msg-<msgId>`'s `.markdown-body` with rAF retry ≤5 (LazyMount); set the stick-suppression flag (role of `scrolledToHash`) before scrolling; `scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })` using `prefersReducedMotion` from src/lib/motion/stagger.ts; `.section-flash` emphasis on the landing heading (existing app.css keyframes); idempotent under repeated clicks; no history/URL writes; wire it as the page's `onJumpToSection` (depends T010)
- [ ] T012 [US1] Manual smoke on `pnpm dev` per quickstart Scenarios 1, 4, and 5.2–5.3: strip presence/proportionality; threshold exclusion (short and <3-section replies show nothing); hover fatten without layout shift; jump lands correctly in a two-long-reply conversation and on duplicate headings; touch emulation tap-to-jump; wheel/drag over the strip scrolls the transcript normally; reduced-motion jump is instant (depends T011)

**Checkpoint**: User Story 1 fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 — Dwell preview before jumping (Priority: P2)

**Goal**: A deliberate ~400 ms pause on a bar pops a plain-text preview card (heading + opening lines); sweeping never fires it; it dismisses promptly; clicking preview or bar jumps.

**Independent Test**: Hover a bar and hold → preview appears with the right title/excerpt; sweep across the strip → nothing fires; pointer leaves → preview gone immediately; click preview → same jump as a bar click; after regenerate, previews show the new sections' text.

### Tests for User Story 2 (constitution-mandated)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T013 [P] [US2] Write failing unit tests for the dwell state machine in src/lib/chat/strip/dwell.test.ts per contracts §3: `enter-bar` arms a 400 ms timer; `leave-bar`, `enter-other-bar`, and `leave-strip` each cancel the timer AND close any open preview (sweep immunity + prompt dismissal); re-entering re-arms; opening a preview for index N then `leave-strip` yields `openPreview: null`; no timers inside the module (pure transition function only)
- [ ] T014 [P] [US2] Implement src/lib/chat/strip/dwell.ts to make T013 green: `DWELL_MS = 400`, `DwellState`/`DwellInput`/`dwellTransition` exactly per contracts §3 — no DOM, no timers (depends T013)

### Implementation for User Story 2

- [ ] T015 [US2] Add the preview card to src/lib/components/chat/strip/SectionStrip.svelte: wire `dwellTransition` to real pointer events (timer id held in component `$state`, desktop pointers only — touch never arms a dwell per FR-011); card anchored `absolute right-full` of the strip, popover surface (`bg-popover text-popover-foreground border-border shadow-md rounded-md max-w-xs`), shows `section.title` + `section.excerpt` as plain text; click on card = `onJump(previewIndex)`; prompt dismissal on pointer leave of strip+preview region; class `section-strip-preview` on the card (already excluded in selection.ts from T004) (depends T014, T009)
- [ ] T016 [US2] Manual smoke per quickstart Scenario 2: dwell opens preview; sweep immunity; prompt dismiss; preview click jumps; regenerate produces fresh preview text (never stale) (depends T015)

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 — Persisted on/off setting (Priority: P3)

**Goal**: A settings toggle turns the strip off entirely (no bars/hover/previews anywhere); the preference persists across reloads; toggling back on restores strips.

**Independent Test**: Toggle off in `/settings` → every strip disappears immediately; reload → still off; toggle on → strips return on qualifying replies with working jumps.

### Tests for User Story 3 (constitution-mandated)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T017 [P] [US3] Write failing tests for the preference module in src/lib/chat/strip/pref.test.ts (pglite driver, pattern: src/lib/chat/uiState.test.ts): round-trip `setStripEnabled(false)` → `isStripEnabled() === false`; missing key ⇒ `true`; corrupt JSON ⇒ `true`; wrong type (string/number) ⇒ `true`; key is exactly `'sectionStripEnabled'`; values written through `repos.settings` (depends on nothing)
- [ ] T018 [P] [US3] Implement src/lib/chat/strip/pref.ts to make T017 green per contracts §2: `STRIP_ENABLED_KEY = 'sectionStripEnabled'`, defensive `isStripEnabled()`, `setStripEnabled()` via `repos.settings` — the sole-writer module; no other file may touch this key (depends T017)

### Implementation for User Story 3

- [ ] T019 [US3] Add the toggle to the settings UI and gate eligibility on it: in src/routes/settings/+page.svelte (or its section component under src/lib/components/settings/ — use the section registry src/lib/settings/sections.ts to pick placement; control = state-styled Button per the McpServers.svelte enable-toggle pattern, no Switch primitive exists), label "Section strip in long replies"; read/write ONLY via src/lib/chat/strip/pref.ts; then in src/routes/chat/[id]/+page.svelte load the preference once per mount and thread it (new prop through MessageList → AssistantMessage, or fold into eligibility at the AssistantMessage call site) so `false` unmounts/prevents every strip reactively (depends T018, T010)
- [ ] T020 [US3] Manual smoke per quickstart Scenario 3: off removes all strips immediately; persists across reload (and `pnpm dev:down`/`pnpm dev` restart); on restores strips and jumps (depends T019)

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Constitution-required measurement and final validation.

- [ ] T021 [P] Performance validation per quickstart "Performance validation": `window.__MAYON_PERF__ = 1` + `localStorage.mayon_perf_scenario = 'section-strip'`, exercise Scenarios 1–2 for ~30 s, confirm no longtask spikes on hover/dwell, no layout-shift accumulation, `strip:extract` marks present and sub-millisecond on repeat renders; compare against T001's baseline (Constitution IV: measured before/after) (depends T001, T016)
- [ ] T022 Final validation: run `pnpm check && pnpm lint && pnpm test` one last time; walk quickstart.md end-to-end (all scenarios including 5.1 expound/selection/copy regression with a strip visible and preview text present); confirm all checklist-format tasks above are complete (depends T019, T020, T021)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: depends on T001; BLOCKS all user stories (T002–T006)
- **US1 (Phase 3)**: depends on Phase 2 (T003 sections feed T009; T004 exclusions must exist before the strip renders text-bearing DOM)
- **US2 (Phase 4)**: depends on US1's SectionStrip component (T009); extends it
- **US3 (Phase 5)**: depends on T010 (eligibility wiring exists) and T018; UI-wise independent of US2
- **Polish (Phase 6)**: depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: starts after Phase 2 — no dependency on other stories
- **US2 (P2)**: builds on US1's component but is independently testable once T009 exists (preview is additive)
- **US3 (P3)**: depends on US1's eligibility plumbing; independent of US2

### Within Each User Story

- Tests first (RED), then implementation (GREEN)
- Component before integration, integration before page orchestration
- Manual smoke closes each story

### Parallel Opportunities

- T002 ∥ T003 is tests-first sequential in review but file-independent; T002, T003, T004 touch disjoint files
- T007 ∥ T008 (disjoint test files)
- T013 ∥ T014 pair and T017 ∥ T018 pair are file-disjoint
- US2 (T013–T014) can start while US1's T010–T012 finish, since dwell.ts is a pure module with no dependency on the component

## Subagent Wave Plan (owner convention: ≤6 tasks per subagent)

| Wave | Tasks | Contents |
|---|---|---|
| 1 | T001–T006 | Setup + Foundational |
| 2 | T007–T012 | US1 complete (MVP) |
| 3 | T013–T016 | US2 complete |
| 4 | T017–T020 | US3 complete |
| 5 | T021–T022 | Polish + final gates |

Each wave ends at a checkpoint; do not start the next wave with red gates.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Wave 1 (Phase 1–2): baseline + extraction + selection safety
2. Wave 2 (Phase 3): strip, eligibility, jump → **STOP and VALIDATE** via T012
3. Ship-ready MVP: glance + jump already delivers the core spec value

### Incremental Delivery

- Wave 3 adds the preview (US2) — the "peek" in peek-strip
- Wave 4 adds user control (US3) — the explicit opt-out requirement
- Wave 5 measures and closes (Constitution IV + quickstart)

### Parallel Team Strategy

With capacity: after Wave 1, one agent takes US1 (Wave 2) while another pre-builds the pure dwell module (T013–T014); US3's pref module (T017–T018) is likewise pre-buildable in parallel — only its wiring (T019) waits on T010.

---

## Notes

- [P] tasks = different files, no incomplete-dependency overlap
- [Story] label maps tasks to spec stories for traceability
- Verify tests fail (RED) before the implementation that satisfies them
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- Avoid: same-file conflicts (T010 is the single choke point for AssistantMessage edits — keep T008's assertions synced with it), cross-story dependencies that break independence
