---

description: "Task list for 014-settings-navigation"
---

# Tasks: Settings Page Navigation

**Input**: Design documents from `/specs/014-settings-navigation/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/settings-navigation.md ✅, quickstart.md ✅

**Tests**: Included — the constitution (§II) requires tests for new `src/lib/` behavior; plan.md commits to unit tests for logic modules and source-assertion tests for components (repo convention: no component-mount harness).

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1 = rail+spy, US2 = search, US3 = hash/history, US4 = mobile)
- Exact file paths included in every task

## Path Conventions

Single SPA app (per plan.md): logic in `src/lib/settings/`, components in `src/lib/components/settings/`, route composition in `src/routes/settings/+page.svelte`, shell edits in `src/lib/components/ai/ProviderConfig.svelte`, styles in `src/app.css`.

**Normative references**: behavior rules live in `contracts/settings-navigation.md` (§1 history table, §2 keyboard map, §3 module APIs); entity rules in `data-model.md`; scenario steps in `quickstart.md` (S1–S5). Section inventory (order is frozen): `providers`, `mcp`, `learner-profile`, `expound-instructions`, `lab-prompt`, `quiz-prompt`, `data`, `sandbox-db` (conditional on `sandbox-db` capability).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline measurement and the one shared visual utility, before any logic lands.

- [x] T001 [P] Capture the pre-change performance baseline on `/settings` per quickstart.md §Perf probe (`window.__MAYON_PERF__ = 1`, `localStorage.mayon_perf_scenario = 'settings-nav'`; idle-scroll + manual scroll, record `[mayon-perf]` frames/longtasks/latency numbers for later comparison in T024)
- [x] T002 [P] Add the `section-flash` arrival-flash utility to `src/app.css`: brief (~1.5 s) fading emphasis on a target heading following the existing `msg-flash` pattern (`src/routes/chat/[id]/+page.svelte:348-366`); decorative only; silent under the existing `@media (prefers-reduced-motion: reduce)` block (`src/app.css:405-439`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Section registry, hash discipline, scroll-spy logic, and DOM anchors — everything every user story depends on. No user story work may begin until this phase is complete and green.

**⚠️ CRITICAL**: `pnpm test` must pass after this phase before any story phase starts.

- [x] T003 [P] Create the static section registry `src/lib/settings/sections.ts` per contracts §3: `SectionEntry` interface (`id`, `label`, `aliases`, `cap: ServerCap | null`), `SETTINGS_SECTIONS` with the 8 entries in frozen page order (labels mirror the real h2 text verbatim; `data` aliases `["backup", "restore", "export", "import"]`; `sandbox-db` aliases `["sandbox", "sqlite"]` with `cap: 'sandbox-db'`; all others `cap: null`), `visibleSections(sections, caps)` order-preserving capability filter, `matchSections(query, sections)` token-wise lowercase substring match over label + aliases returning all sections for blank query
- [x] T004 Create unit tests `src/lib/settings/sections.test.ts` (depends on T003): unique ids, labels match the rendered heading texts exactly, aliases lowercase and unique per entry, `visibleSections` drops `sandbox-db` only when the cap is absent, `matchSections` finds "backup"→data, "restore"→data, "sandbox"→sandbox-db, blank/whitespace query → all sections, no-match → empty
- [x] T005 [P] Create the hash-discipline module `src/lib/settings/hash-sync.ts` per contracts §3 and data-model state machine: `sectionIdFromHash`, `sectionHash(pathname, id)`, `HashSync` with `pushJump(id)` (pushState via SvelteKit shallow routing; returns null on duplicate-suppression when already settled at id), `replaceActive(id)` (replaceState, never history), `onExternalHash(cb)` (window `hashchange` listener that ignores this module's own writes via a settle guard; delivers id or null), `initial()`; use `page.url.pathname` (`$app/state`) so `paths.base` is honored
- [x] T006 Create unit tests `src/lib/settings/hash-sync.test.ts` (depends on T005): parse/build round-trips, push vs. replace rules, duplicate suppression, external-hash delivery and settle-guard suppression, absent-id passthrough
- [x] T007 [P] Create the scroll-spy module `src/lib/settings/scroll-spy.ts` per contracts §3: `createScrollSpy(root, onActive)` with one `IntersectionObserver` (`root` = the app shell `<main>`, top detection band via `rootMargin`), `observe/unobserve/active/destroy`, plus an exported pure reducer `resolveActive(records)` computing the active section id (topmost section whose top is at/above the band, last one crossed wins); no scroll-event listeners and no per-tick layout reads
- [x] T008 Create unit tests `src/lib/settings/scroll-spy.test.ts` (depends on T007): reducer rules over synthetic IntersectionObserverEntry lists — empty → null, single section, order precedence, content-height-change scenarios (boxes moved), re-entry at top → null above first section
- [x] T009 Add stable DOM anchor ids: `id="providers"` on the shell-owned Providers section in `src/lib/components/ai/ProviderConfig.svelte` (the section containing the `h2` "Providers" at ~line 393), and in `src/routes/settings/+page.svelte` wrap each child section component in `<div id="…">` with `class="scroll-mt-4"` using ids `mcp`, `learner-profile`, `expound-instructions`, `lab-prompt`, `quiz-prompt`, `data`, `sandbox-db` (the sandbox-db wrapper stays inside the existing `{#if serverStatus.has('sandbox-db')}` block so the anchor appears/disappears with the section)

**Checkpoint**: `pnpm test` green — registry, hash rules, and spy reducer verified; anchors present in DOM. User stories can now begin (US1 next; US2/US4 may proceed in parallel with US1 only after T009 since all mount into the same route file).

---

## Phase 3: User Story 1 — One-click jump to a known section via anchor rail (Priority: P1) 🎯 MVP

**Goal**: Desktop users reach any section in one click and see a live highlight of the current section while scrolling.

**Independent Test**: Load `/settings` at ≥1024px, click the last rail entry → smooth scroll lands at that section top with URL `#<id>`; manual scrolling moves the highlight correctly; Back afterwards does not replay scrolling (quickstart S1).

### Implementation for User Story 1

- [x] T010 [US1] Create `src/lib/components/settings/SettingsRail.svelte` per contracts §4: props `sections: SectionEntry[]`, `activeId: string | null`, `onJump: (id: string) => void`; renders `<nav aria-label="Settings sections">` with one entry per section (label = `label`), `aria-current="true"` + active styling (muted-foreground recipe, hairline/ring tokens) on the active entry, click → `onJump(id)` only (no scroll logic inside); hidden below the 1024px breakpoint
- [x] T011 [US1] Wire rail + shared jump pipeline in `src/routes/settings/+page.svelte` (depends on T003, T005, T007, T009, T010): build `visibleSections(SETTINGS_SECTIONS, serverStatus.caps)`; mount `SettingsRail` fixed alongside the centered `max-w-3xl` column, vertically positioned and hidden below `lg` (no overlap with the column at 1024–1280px); obtain the scroll container via `el.closest('main')`; `createScrollSpy(main, …)` drives `activeId` and calls `replaceActive` on at-rest changes only; implement the shared `onJump(id)` pipeline — `pushJump` (skip when duplicate-suppressed) → smooth `scrollTo` on `<main>` to the target wrapper top (behavior `'auto'` when `matchMedia('(prefers-reduced-motion: reduce)').matches`) → apply T002's `section-flash` to the target heading for ~1.5 s with timer reset on re-jump → optimistic `activeId`; while a jump scroll is in flight, spy changes highlight but do not touch the hash (mid-flight freeze per data-model state machine)
- [x] T012 [US1] Create source-assertion tests `src/lib/components/settings/SettingsRail.render.test.ts` (repo `fs.readFileSync` convention, depends on T010, T011): nav landmark + aria-label present, `aria-current` bound to activeId, entries render `sections` prop order, rail renders no scroll logic (asserts `onJump` delegation), breakpoint hiding present
- [x] T013 [US1] Verify User Story 1 independently: run quickstart S1 steps (rail order mirrors headings, one-click landing on Data, highlight follows manual scroll, no history entries from scrolling, jump still accurate after adding/removing a provider) plus `pnpm check && pnpm lint && pnpm test` (depends on T011, T012)

**Checkpoint**: US1 is the MVP — one-click reachability + live map work on desktop; rail/search-independent, no URL behavior beyond jump pushes.

---

## Phase 4: User Story 2 — Jump by name via visible search (Priority: P2)

**Goal**: Users jump by typing a section name or synonym into an always-visible field (cmd-K focuses it); hits scroll and flash the heading.

**Independent Test**: On `/settings`, click the visible field, type "restore" → Data offered; select → lands at Data with heading flash; type "zzzz" → "No matching section"; Cmd-K focuses the field and nothing else changes (quickstart S2).

### Implementation for User Story 2

- [x] T014 [US2] Create `src/lib/components/settings/SettingsSearch.svelte` per contracts §4 (depends on T003): always-visible inline `Command.Root` from the existing `src/lib/components/ui/command/` primitives (NOT `Command.Dialog`), input styled with the shared `inputClass` recipe (`src/lib/components/ai/ProviderConfig.svelte:60-61`), custom `filter` delegating to `matchSections` so aliases match, items show section `label` (with matched alias hint), `Command.Empty` renders "No matching section", selecting an item calls `onJump(id)` (flash arrives via the shared pipeline from T011), export a `focus()` binding, Escape collapses the list
- [x] T015 [US2] Add an optional `header?: Snippet` prop to `src/lib/components/ai/ProviderConfig.svelte` rendered between the intro paragraph (~line 381-384) and the Providers section, and pass `<SettingsSearch>` through it from `src/routes/settings/+page.svelte` so the field sits at the top of the page in normal flow (depends on T014)
- [x] T016 [US2] Add the settings-scoped cmd-K handler in `src/routes/settings/+page.svelte`: `<svelte:window onkeydowncapture>` — on `(metaKey || ctrlKey) && key === 'k'` call `preventDefault()` + `stopPropagation()` and invoke the search field's `focus()` binding; do not modify `src/lib/components/AppShell.svelte` (global `/` and cmd-K → `/search` must keep working on every other route) (depends on T014, T015)
- [x] T017 [US2] Create source-assertion tests `src/lib/components/settings/SettingsSearch.test.ts` (depends on T014, T016): inline `Command.Root` present (no `Command.Dialog`), `matchSections` wired as the filter, `Command.Empty` text present, `focus()` binding exported, capture-phase cmd-K handler present in `+page.svelte`, and `AppShell.svelte` keyboard handler unchanged
- [x] T018 [US2] Verify User Story 2 independently: run quickstart S2 steps (visible-field-first usage, alias hits, flash on arrival, empty state, global cmd-K regression check on `/search`) plus the three gates (depends on T015, T016, T017)

**Checkpoint**: US1 + US2 both work independently; search adds the keyboard path without touching rail behavior.

---

## Phase 5: User Story 3 — Bookmarkable, back/forward-walkable sections (Priority: P3)

**Goal**: Deep links land on sections; Back/Forward walk visited sections deterministically; absent anchors degrade gracefully.

**Independent Test**: Jump to two sections, Back twice → each land is exact; open `/settings#quiz-prompt` in a new tab → lands there; `/settings#sandbox-db` with the capability off → normal top-of-page, no error (quickstart S3).

### Implementation for User Story 3

- [x] T019 [US3] Complete the hash lifecycle in `src/routes/settings/+page.svelte` (depends on T005, T006, T011): on mount call `hashSync.initial()` and land instantly (non-animated, rAF retry ≤ 5 tries per the chat-page precedent `src/routes/chat/[id]/+page.svelte:311-346`) when the id matches a visible section; subscribe `onExternalHash` → deterministic land at the target section top overriding any browser-remembered offset (per FR-008) with no-op grace for absent/unknown ids; verify the settle guard from T005 prevents self-triggering and that scroll-spy `replaceState` writes never create history entries
- [x] T020 [US3] Verify User Story 3 independently: run quickstart S3 steps including exact history-entry accounting in DevTools (explicit jump = +1, scroll = ±0, Back/Forward = traversal; duplicate jumps to the current section add nothing) and the unsaved-edit-preservation check (start a provider edit, jump away and back, edit intact — FR-016) (depends on T019)

**Checkpoint**: All URL/history guarantees from contracts §1 hold; stories 1–3 fully functional on desktop.

---

## Phase 6: User Story 4 — Jump capability on small screens (Priority: P4)

**Goal**: Below 1024px, a floating button + compact bottom sheet give the same jump semantics in ≤ 2 taps.

**Independent Test**: At 390px width the rail is hidden, the floating button opens a section sheet, picking Data lands there in two taps with URL `#data`; dismissing the sheet changes nothing (quickstart S4).

### Implementation for User Story 4

- [x] T021 [US4] Create `src/lib/components/settings/MobileSectionJump.svelte` per contracts §4: floating button fixed bottom-right (safe-area-inset aware, above content, doesn't cover primary controls) rendered only below the 1024px breakpoint (AppShell `matchMedia('(min-width: 1024px)')` convention), opens the existing `sheet` primitive with `side="bottom"` listing `sections` in order; pick → close sheet → `onJump(id)`; dismiss → zero side effects; button has an accessible name ("Jump to section") (depends on T003)
- [x] T022 [US4] Mount `MobileSectionJump` in `src/routes/settings/+page.svelte` sharing the same `onJump` pipeline and `visibleSections` as the rail, and create source-assertion tests `src/lib/components/settings/MobileSectionJump.render.test.ts` (sheet usage with `side="bottom"`, breakpoint gating, `onJump` delegation, dismiss with no side effects) (depends on T011, T021)
- [x] T023 [US4] Verify User Story 4 independently: run quickstart S4 steps at a 390px viewport (rail absent, two-tap reach, hash parity with desktop, dismiss purity) plus the three gates (depends on T022)

**Checkpoint**: All four user stories functional; feature-complete surface on desktop and mobile.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Constitution-mandated measurement, accessibility, and final validation.

- [x] T024 Measure post-change performance against the T001 baseline per quickstart.md §Perf probe (same scenario tag `settings-nav`; compare frames/longtasks/input latency; acceptance: no regression during scroll, no long tasks attributable to jump/spy handlers; record numbers with the PR)
- [x] T025 [P] Accessibility & keyboard pass over the finished page: Tab reaches and traverses the rail in order, `aria-current` is announced correctly, cmd-K → search is reachable and operable by keyboard only (arrows/Enter/Escape via cmdk), sheet traps focus and restores it on close (bits-ui), `section-flash` is decorative and never announced, focus-visible rings (`--ring`) present on rail entries, search field, and floating button
- [x] T026 Final validation: run the complete quickstart.md — automated gates (`pnpm check`, `pnpm lint`, `pnpm test`), all manual scenarios S1–S5 including reduced-motion (S5), perf summary from T024 — and confirm every spec acceptance scenario passes before merge

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — T001 (baseline) MUST complete before any implementation task touches scroll-path code, so the comparison in T024 is valid
- **Foundational (Phase 2)**: depends on Setup; T003→T004, T005→T006, T007→T008 are module→test pairs; T009 is independent of the pairs; phase blocks all stories
- **US1 (Phase 3)**: depends on all of Phase 2 (uses registry, hash-sync, scroll-spy, anchors)
- **US2 (Phase 4)**: depends on T003 (registry/filter) and on T011 (shares the `onJump` pipeline); T015/T016 depend on T014
- **US3 (Phase 5)**: depends on T005/T006 (hash-sync) and T011 (jump pipeline exists to observe history rules)
- **US4 (Phase 6)**: depends on T003 and T011 (shared pipeline); independent of US2/US3
- **Polish (Phase 7)**: T024 depends on all stories; T025 depends on US1–US4 UI; T026 depends on everything

### User Story Dependencies

- **US1 (P1)**: starts after Phase 2 — no dependencies on other stories → **MVP**
- **US2 (P2)**: needs US1's shared `onJump` (T011) for scroll+flash, but the component (T014) can be built in parallel with US1; integration waits for T011
- **US3 (P3)**: machinery ships in Phase 2; only lifecycle wiring (T019) touches the route, after T011
- **US4 (P4)**: only shared-pipeline dependency (T011); fully parallel with US2/US3 work

### Parallel Opportunities

- Phase 1: T001 ∥ T002
- Phase 2: the three module→test pairs (T003/T004, T005/T006, T007/T008) run as parallel tracks; T009 parallel with all of them
- US2's T014 and US4's T021 can be built while US1 is in progress (different files); their mounting tasks serialize on `+page.svelte` (T011 first, then T015/T016/T019/T022 — sequence edits to the route file to avoid conflicts)
- T025 (a11y pass) is parallel with nothing else in Phase 7 only because it reviews final UI; it touches docs-free test/verify only

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 baseline → T002 flash utility
2. Phase 2 foundation (registry, hash-sync, scroll-spy, anchors) — gates green
3. Phase 3 (T010–T013): rail + scroll-spy + shared jump pipeline
4. **STOP and VALIDATE**: quickstart S1 + gates — one-click reachability (the reported pain) is solved
5. Ship or continue

### Incremental Delivery

1. MVP (US1) → validate → demo
2. + US2: keyboard/typing path → S2 validates
3. + US3: URL/history guarantees → S3 validates
4. + US4: mobile parity → S4 validates
5. Polish: measured perf (T024), a11y (T025), full validation (T026)

Each increment leaves the page fully functional; no increment unmounts sections or changes section order (FR-001).

### Route-file edit discipline

`src/routes/settings/+page.svelte` is touched by T009, T011, T015, T016, T019, T022. Implement in that ID order within/across stories; when parallelizing stories, rebase sequential route-file edits rather than editing concurrently.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to spec.md user story for traceability
- Every behavior task cites its normative rule in `contracts/settings-navigation.md` or `data-model.md` — implement from those, not from memory
- Verify tests fail-or-pass meaningfully when introduced; keep the three gates green at every checkpoint
- Commit after each task or logical group
- Stop at any story checkpoint to validate that story independently
- Avoid: editing `AppShell.svelte` (keyboard regression), adding dependencies (constitution IV), scroll-event listeners (perf contract), or history entries from scrolling (FR-005)
