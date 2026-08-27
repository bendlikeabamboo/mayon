---
description: "Task list for 012-ui-visual-articulation"
---

# Tasks: UI Visual Articulation Pass

**Input**: Design documents from `/specs/012-ui-visual-articulation/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅ (design-tokens, settings-keys, composer-launchers), quickstart.md ✅

**Tests**: Included selectively. Pure styling stories (US1, US2, US7) verify via `pnpm check` + manual smoke per constitution III/UI convention. New `src/lib/` logic (uiState.ts, starters.ts) MUST have Vitest units (constitution II); components follow the repo's colocation source-text assertion convention.

**Organization**: Grouped by user story from spec.md (US1–US9 map to spec Stories 1–9 in priority order P1→P3). File-conflict note: US1, US2, and US7 all edit the token blocks in `src/app.css` — land them in order; do NOT parallelize across those stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to ([US1] … [US9])
- Exact file paths in every description

## Path Conventions

Existing monorepo (no structural change): SPA code in `src/` (routes under `src/routes/`, components `src/lib/components/`, logic `src/lib/{chat,stores,services}/`, tokens `src/app.css`). Tests colocated next to subjects. Server/shared packages untouched.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish pre-change evidence and confirm healthy gates before any edits

- [x] T001 Confirm clean starting gates: run `pnpm check`, `pnpm lint`, `pnpm test` — all green on `feat/ui_overhaul` before first edit
- [x] T002 Capture pre-change baseline evidence required later by US9/SC-7: enable perf probe (`window.__MAYON_PERF__ = 1`), record `[mayon-perf]` summary while traversing home/chat/tree/list routes, and save before-screenshots of both themes (light + dark) of shell, composer, home, lists, tree, sidebar footer — store under `specs/012-ui-visual-articulation/evidence/baseline/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Token recipes needed by multiple stories, plus motion guardrails — inert until stories adopt them

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add `--shadow-card` custom property (soft diffuse value tuned separately in `:root` and `.dark`) and a `surface-card` elevation utility recipe (`rounded-lg border border-border bg-card shadow-[var(--shadow-card)]` semantics) to `src/app.css` near the existing `@theme inline`/component layers per `specs/012-ui-visual-articulation/contracts/design-tokens.md` §2 — do not yet apply anywhere
- [x] T004 Extend the `prefers-reduced-motion: reduce` block in `src/app.css` (currently at ~lines 434–449 covering spinner/expound-flash) to also suppress the future motion hooks added by US5/US9: entry-stagger animations and caret transform rotation (declare coverage comments; refine exact selectors as those stories land)

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 1 — One accent teaches clickability (Priority: P1) 🎯 MVP start

**Goal**: Exactly one warm amber/terracotta accent governs actionable emphasis everywhere, both themes; status greens remain status-only

**Independent Test**: Walk every screen in both themes per quickstart "Story 1 + 2": accent appears precisely on primary buttons/links/active-nav/focus rings/composer focus; nothing inert carries it; greens untouched

### Implementation for User Story 1

> Sequential within file: T005 → T006 (same token blocks)

- [x] T005 Define accent values for `--primary`, `--primary-foreground`, `--ring` in BOTH `:root` and `.dark` blocks of `src/app.css`: warm amber/terracotta family anchored to existing `--highlight #a54d27` (hue research R-1), light value button-suitable solid, dark variant same perceptual family at dark-appropriate lightness; leave `--highlight` itself untouched
- [x] T006 Align actionable-emphasis call sites to the retinted slots (must NOT introduce any new color literals): active nav item emphasis in `src/lib/components/Sidebar.svelte`, primary "All Chats" button in `src/routes/+page.svelte`, Send control emphasis in `src/lib/components/chat/Composer.svelte`, suggested-choice pills in `src/lib/components/chat/rows/ChoicesOffer.svelte`; verify text-link styling picks up accent ring/underline intent; CONFIRM emerald status pills in `src/lib/components/DbStatus.svelte` + `src/lib/components/ServerStatus.svelte` remain green (excluded from accent)
- [x] T007 Focus-ring verification pass: Tab-traverse every interactive element on shell/chat/lists/tree/home/composer in both themes asserting visible accent `focus-visible` ring (FR-3), fix any element hard-coding non-accent ring colors found during traversal

**Checkpoint**: Accent system live and verifiable independently (SC-1 partial walkthrough)

---

## Phase 4: User Story 2 — Surface ladder: three levels, edges not brightness (Priority: P1)

**Goal**: canvas < panel < raised card readable per theme via hairline borders + subtle shadows; sidebar quietest-light/darkest-dark; NO luminance jumps

**Independent Test**: Screenshots of representative screens rank correctly into 3 levels in both themes (SC-2); cards carry border AND shadow together

### Implementation for User Story 2

> Depends on Phase 2 recipes (T003). Edits `src/app.css` again after US1 — apply strictly after T006.

- [x] T008 Tune ladder ordering in `src/app.css`: light theme sidebar ≤ background emphasis (quietest), `.dark` sidebar darkest region (below canvas), adjacent-level OKLCH lightness deltas held ≈2–3 points (GP-1); update `--sidebar*` tokens accordingly without touching foreground text values
- [x] T009 Apply `surface-card` treatment to existing raised containers, replacing ad-hoc class strings: chat list rows in `src/routes/chat/+page.svelte`, quiz list boxes in `src/routes/quiz/+page.svelte`, lab list boxes in `src/routes/lab/+page.svelte`, brief/popover card in `src/lib/components/chat/BriefCard.svelte`, tree root-group boxes in `src/routes/tree/+page.svelte`
- [x] T010 Articulate panel bands: refine `src/lib/components/Sidebar.svelte` hairline separators (`border-sidebar-border` discipline) and confirm AppShell main-canvas transparency role in `src/lib/components/AppShell.svelte`; ChatRail host border-left alignment in `src/routes/chat/[id]/+page.svelte`
- [x] T011 Ladder verification (SC-2): side-by-side review against baseline screenshots — every sampled region ranks correctly, separation reads edge-first, no glare jump; record in `specs/012-ui-visual-articulation/evidence/us2-ladder.md`

**Checkpoint**: Depth hierarchy perceivable app-wide; user stories 3–9 inherit stable surfaces

---

## Phase 5: User Story 3 — Composer instrument card + persisted-artifact launchers (Priority: P1)

**Goal**: Rounded bordered composer card w/ docked controls; branch/quiz/lab launchers mint persistent artifacts via existing store chains

**Independent Test**: Each launcher produces an artifact surviving full reload (SC-4), bound to ensured conversation; controls contained at max-width; focus raises card with accent ring

### Implementation for User Story 3

- [x] T012 Restructure `src/lib/components/chat/Composer.svelte` into the instrument card: outer rounded-xl bordered container adopting `surface-card` (shadow uplifts on focus w/ accent `ring-ring` state per FR-4/FR-9), textarea de-boxed (`border-0 bg-transparent resize-none outline-none` retaining auto-grow cap 352px), MCP/resources/prompt/thinking/send-stop controls docked along the card's bottom edge INSIDE its footprint; preserve ⌘/Ctrl+Enter send, draft key `'draft:<chatId>'` persistence, stop behavior — no store signature changes
- [x] T013 Add three launcher affordance buttons (branch here → tree node · quiz me → quiz artifact · open lab) in `src/lib/components/chat/Composer.svelte` footer row: disabled-with-explanation tooltips when generating/offline per `contracts/composer-launchers.md` rules 4–7, immediate visible feedback per activation, keyboard-focusable with outcome-announcing labels
- [x] T014 Wire launcher orchestration through chat page props (`src/routes/chat/[id]/+page.svelte`) and stores — ensure-chat first via `chatStore.createAndNavigate()` when none open, then `chatStore.branchFromMessage()` root-level semantics (+`chatsRepo.createChild`+`branchSourcesRepo.create` via existing paths) / `quizzesStore.generate(chatId)` / `labsStore.generate(chatId)` with `saveRaw` fallback (research R-5 table); result must navigate/appear on main screen (GP-3); debounced/no-op during running generation (contract rule 5)
- [x] T015 Write component source-text assertions in `src/lib/components/chat/Composer.launchers.test.ts` (repo convention per `MessageRow.mount.test.ts` style): pin presence of the three launcher labels, docked-control composition markers, de-boxed textarea classes
- [x] T016 Containment & persistence verification: shrink window to `max-w-3xl` cap confirming controls never exit footprint (AC 3.4); keyboard-only launcher operation; activate each launcher → browser reload → artifact still present in its main-screen location (quiz in quiz views, lab in lab views, branch node on tree page) — record pass in `specs/012-ui-visual-articulation/evidence/us3-launchers.md`

**Checkpoint**: Composer usable as study-control desk; artifacts provably persistent

---

## Phase 6: User Story 4 — Home invites instead of shrugging (Priority: P2)

**Goal**: Greeting + hero composer OR resume card + starter chips lead; recents demoted below

**Independent Test**: Three home states (empty/history/in-progress) each reach start-or-resume in ≤2 interactions (SC-3); resume card opens exactly the referenced chat

### Implementation for User Story 4

- [x] T017 Create `src/lib/chat/starters.ts`: derive starter-chip suggestions preferring curriculum/brief context from recent activity (reuse brief/persona imports patterns from `src/lib/chat/brief.ts`), falling back to a small generic study-seed set for fresh instances (spec A-3); export typed `deriveStarters(context)` API
- [x] T018 Write unit tests `src/lib/chat/starters.test.ts`: generic-fallback correctness on empty context, curriculum-context preference ordering, output shape stability, no duplicate seeds
- [x] T019 Rebuild `src/routes/+page.svelte` composition: centered greeting heading → hero slot rendering either redesigned new-chat composer-lite instance (reusing Composer.svelte in a size-appropriate invocation) OR prominent "continue learning" resume card (when latest root chat qualifies as in-progress per T020 heuristic) → starter chips from `starters.ts` activating the composer/send flow visibly (never silent writes) → recent chats / in-progress labs / recent quizzes demoted beneath in quieter typography (full RowCard upgrade deferred to US8)
- [x] T020 Implement resume qualification in `src/routes/+page.svelte` from existing chat fields (latest `updatedAt` activity + unfinished signal; completed chats excluded) — activation navigates EXACTLY that conversation; gracefully hidden in zero-history state; restyle loading / no-provider / no-content states coherently with new ladder (BootGate untouched structurally)
- [x] T021 Home verification per quickstart Story 4: state A (fresh install) shows greeting+chips without broken recents prominence; state B shows featured resume card reopening correct chat; interactions-to-start ≤2 measured in all three states — record in `evidence/us4-home.md`

**Checkpoint**: Home delivers the confidence moment independently

---

## Phase 7: User Story 5 — Hidden powers become discoverable (Priority: P2)

**Goal**: Hover/tap message actions (copy·branch·regenerate); row hover tints; tree carets rotate + connector lines encode ancestry

**Independent Test**: First-time viewer finds copy ≤30s, branch/regenerate ≤60s (SC-5); tree parent-child readable from lines+caret alone; tints track pointer sweep

### Implementation for User Story 5

- [x] T022 Consolidate assistant message actions into hover-revealed row in `src/lib/components/chat/rows/AssistantMessage.svelte`: copy · branch · regenerate grouped (replacing always-visible Branch button and interrupted-only Regenerate placement while REUSING existing handlers `onCopy`/`onBranchWhole`/`onRegenerate` passed from `src/routes/chat/[id]/+page.svelte`); reveal via opacity transition driven by `group-hover/message:` + `focus-within:` (keyboard reachable), positioned absolutely/margined so message layout NEVER shifts
- [x] T023 Touch parity + layering safety: add `@media (pointer: coarse)` steady-visible override for the action row; verify no z-order collision with the floating selection pill in `src/lib/components/chat/Highlighter.svelte` and right-click menu in `src/lib/components/chat/ContextMenu.svelte` (text-selection gesture must not fight revealed buttons); motion transitions honor T004 reduced-motion block
- [x] T024 Standardize hover tints across interactive list rows (chat `src/routes/chat/+page.svelte`, quiz `src/routes/quiz/+page.svelte`, lab `src/routes/lab/+page.svelte`, home mini-rows `src/routes/+page.svelte`, pagination `src/lib/components/Pagination.svelte`) using existing `hover:bg-accent` idiom matched to Sidebar nav intensity (FR-16)
- [x] T025 Tree ancestry visualization in `src/routes/tree/+page.svelte` recursive `row(node, depth)` snippet: replace ChevronRight/ChevronDown swap with single chevron rotated by transform transition (snaps under reduced motion); add connector guide rail for children containers (left border segment + elbow-tick pseudo-element toward each child row) making subordination spatially readable alongside indentation; PRESERVE the `SvelteSet<string>` collapsed session memory and `buildSubtreeModel` usage untouched (spec A-4)
- [x] T026 Write source-text assertions `src/lib/components/chat/rows/AssistantMessage.actions.test.ts`: pin the three action affordances, `group-hover/message` + `focus-within` reveal classes, and coarse-pointer override presence

**Checkpoint**: Discoverability upgraded without touching branching/expound seams

---

## Phase 8: User Story 6 — Chrome quiets down without disappearing (Priority: P2)

**Goal**: Two status rows → one compact popover indicator (all facts retained); header chips merge into per-chat-memory summary chip

**Independent Test**: Every previously shown status fact reachable ≤2 actions (GP-4); chip expansion restores per chat across reloads while sibling chats keep their own states

### Implementation for User Story 6

- [x] T027 [P] [US6] Create shadcn-svelte Popover wrapper module at `src/lib/components/ui/popover/index.ts` (+ sibling `PopoverContent` conventions matching existing `src/lib/components/ui/dialog|dropdown-menu` wrapper style) over the already-present bits-ui v2 popover primitive — no new npm dependencies
- [x] T028 Build `src/lib/components/StatusIndicator.svelte`: single compact row (icon-dot whose color aggregates exhaustively per `contracts/design-tokens.md` §5: green ready / amber self-check / red error / gray server-off-unknown) + concise label (`server v{x} · db {state}`); clicking or keyboard-activating opens popover body rendering the union of legacy facts — db readiness/runtime label, server version, full capability list (`stdio-mcp`,`llm-proxy`,`sandbox-db`,`backup`,`pg`), restoring flag, self-check result — sourced from `src/lib/services/status.svelte.ts` and `src/lib/stores/db.svelte.ts` unchanged
- [x] T029 Refactor consumers: mount StatusIndicator as THE footer indicator in `src/lib/components/Sidebar.svelte` (replacing two side-by-side rows) and in `src/lib/components/AppShell.svelte` mobile drawer; convert `src/lib/components/DbStatus.svelte` + `src/lib/components/ServerStatus.svelte` into readout content fragments rendered inside the popover body (keep their error/reload affordances functional in place) — zero fact loss
- [x] T030 [P] [US6] Create `src/lib/chat/uiState.ts`: typed helpers over `repos.settings.get/set` implementing `ui-state:<chatId>:briefExpanded` per `contracts/settings-keys.md` — defensive JSON parsing, absent-key default resolution (untitled→expanded, titled→collapsed given title input), sole authorized writer for the namespace facet
- [x] T031 [P] [US6] Write unit tests `src/lib/chat/uiState.test.ts` (pglite driver): round-trip set/get boolean, default-when-absent for titled vs untitled inputs, corrupt/wrong-type value fallback, literal `"ui-state:"` + `":briefExpanded"` key composition assertion
- [x] T032 Merge header chips in `src/routes/chat/[id]/+page.svelte` (~lines 593–629) into ONE summary chip displaying `summarizeBrief(rootBrief)` · persona name (subsumes level/mode summary per research R-9 reconciliation) with chevron; chevron expands/collapses the existing inline BriefCard detail area on the main screen (never modal); default rule applied via `uiState` (untitled→expanded, titled→collapsed once title generated); every toggle persists per chat through T030 helpers and rehydrates on mount (dep T030, T031 passing)
- [x] T033 Chrome verification per quickstart Story 6: enumerate pre-change status facts from baseline screenshots and confirm each reachable ≤2 actions post-change; expand chip in titled chat → navigate away → return → restored expanded while another titled chat retains ITS remembered state after full reloads — record in `evidence/us6-chrome.md`

**Checkpoint**: Status/chip information density fully preserved at compressed footprint

---

## Phase 9: User Story 7 — Night mode warms up (Priority: P3)

**Goal**: Dark theme becomes warm charcoal variant of paper palette; text softness byte-equivalent

**Independent Test**: Dark panels discernibly warm vs neutral-gray references; extended-reading comfort unchanged (owner sign-off gate SC-7)

### Implementation for User Story 7

> Strictly after US1/US2 landed in `src/app.css` (sequential file ownership)

- [x] T034 Retune `.dark` neutral tokens in `src/app.css` toward warm charcoal: shift achromatic/near-neutral backgrounds to low-chroma OKLCH hues in the ~50–70 range keeping CURRENT lightness levels per element constant (GP-1 forbids brightening); sweep coherence of `--hljs-*` code palette, scrollbar colors, and the SVG noise overlay (`body::before` opacity blend) for warm undertone; verify `dark:bg-primary` user-bubble legibility survives (known ripple list)
- [ ] T035 Owner gate SC-7: assemble side-by-side baseline vs new dark-theme captures (`evidence/baseline/` vs fresh), confirm warmth present AND text-comfort unchanged; obtain and RECORD explicit owner sign-off note in `evidence/us7-warm-charcoal.md` — blocking per spec Success Criteria

**Checkpoint**: Theming pass complete without glare regression

---

## Phase 10: User Story 8 — One grammar for every list row (Priority: P3)

**Goal**: Chat/quiz/lab lists share a single RowCard anatomy: title · timestamp · progress meta, hover, raised-card edge treatment

**Independent Test**: Lists side-by-side exhibit indistinguishable row structure apart from meta values (AC 8.1)

### Implementation for User Story 8

- [x] T036 [P] [US8] Create shared `src/lib/components/RowCard.svelte`: anchor-capable row card composing `surface-card` recipe + standardized hover tint + slots for leading emphasis, title (truncation rules), trailing timestamp (`timeAgo`), optional progress-meta badge row, trailing hover-revealed destructive action (preserving existing `group-hover` delete pattern)
- [x] T037 [US8] Adopt RowCard in `src/routes/chat/+page.svelte` list (title + `timeAgo(updatedAt)` + hover-delete preserved), removing hand-rolled markup (dep T036)
- [x] T038 [P] [US8] Adopt RowCard in `src/routes/quiz/+page.svelte`: progress-meta slot shows question count shipped-baseline; IF last-attempt score is cheaply derivable from already-fetched attempts data add it, else defer silently per data-model decision note (dep T036)
- [x] T039 [P] [US8] Adopt RowCard in `src/routes/lab/+page.svelte` and home mini-row variant usages in `src/routes/+page.svelte` recents stacks (compact prop sizing) (dep T036)
- [x] T040 Write anatomy assertions `src/lib/components/RowCard.anatomy.test.ts`: pin title/timestamp/meta slot markers, `surface-card` class usage, hover/destructive-slot classes

**Checkpoint**: Unified library-card grammar across all inventory surfaces

---

## Phase 11: User Story 9 — Motion reassures, loading tells the truth (Priority: P3)

**Goal**: Subtle reduced-motion-aware route-entry stagger-fade; placeholders only where loads measure >~300ms (none expected)

**Independent Test**: Traversal entries animate <500ms total; fast loads flash nothing; OS reduce-motion suppresses all; perf probe shows no regression vs T002 baseline

### Implementation for User Story 9

- [x] T041 Apply route-entry stagger-fade using `svelte/transition` (`fade`, slight `fly` y-offset) `in:` directives on content roots/children of `src/routes/+page.svelte`, `src/routes/chat/+page.svelte`, `src/routes/chat/[id]/+page.svelte`, `src/routes/quiz/+page.svelte`, `src/routes/lab/+page.svelte`, `src/routes/tree/+page.svelte` — per-child delay ≈40–60ms capped at <500ms total; gate transforms behind the T004 reduced-motion block + Tailwind `motion-reduce:` utilities (FR-22/SC-9)
- [x] T042 Loading-honesty audit: measure representative loads (boot lists, chat open, tree pagination) with devtools timing; CONFIRM no load exceeds ~300ms requiring a skeleton — ADD PLACEHOLDER ONLY IF MEASURED >300ms (expected outcome: zero skeletons shipped); document measurements in `evidence/us9-loading.md`
- [x] T043 Close the perf loop (constitution IV): rerun `window.__MAYON_PERF__ = 1` scenario traversal from T002 and compare frame timing/longtasks/layout shifts/input latency vs baseline — attach after-summary to `evidence/us9-loading.md`; investigate/regress-fix any degradation introduced by hover/motion work

**Checkpoint**: Motion/honesty polish delivered measurably

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Ripple cleanup, hygiene, final gates

- [x] T044 [P] Font hygiene (optional, research R-13): remove unused serif `@font-face` declarations (Newsreader/Fraunces) from `src/app.css` and the `@fontsource/newsreader` import from `src/routes/+layout.svelte` ONLY after grep-verifying zero consumer references; bundle-size win noted in PR description; SKIP if entangled — does not block acceptance
- [x] T045 Known-ripple review sweep (quickstart checklist): user-message bubble under retinted dark `--primary` (`src/lib/components/chat/rows/UserMessage.svelte`), tree current-node fill legibility, suggested-choice pill accent consistency, BootGate + no-provider/no-content home states coherent with ladder/accent
- [x] T046 Full quality-gate run: `pnpm check && pnpm lint && pnpm test` all green; additionally confirm `pnpm --filter @mayon/server test` remains green (expect zero server impact)
- [x] T047 Execute `specs/012-ui-visual-articulation/quickstart.md` end-to-end validation walkthrough covering Stories 1–9, checking off SC-1…SC-10 evidence links (`evidence/*` files); final completion requires SC-7 owner sign-off recorded at T035 — SC table in `evidence/sc-verdicts.md`; **SC-7 awaiting owner** (see `evidence/us7-warm-charcoal.md`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → no deps; baselines REQUIRED before any visual change (they feed T011/T035/T043 comparisons)
- **Foundational (2)** → depends on Setup; BLOCKS all stories (recipes + motion guardrails)
- **US1 (3)** → after Phase 2; owns `src/app.css` accent blocks FIRST
- **US2 (4)** → after US1 (same file sequencing); unblocks US3/US5/US8 visual vocabulary
- **US3 (5)** → after US2 (needs surface-card recipe + accent ring); independent of US4+
- **US4 (6)** → after US2 ideally (hero uses Composer from US3 for full effect, but can ship with restyled legacy composer); depends on T017 before T019
- **US5 (7)** → after US2 (tint/hover idioms); independent of US6
- **US6 (8)** → independent of US3–US5 after Phase 2; T027∥T030∥T031 parallel cluster → T028 → T029; T032 needs T030
- **US7 (9)** → LAST story-phase editor of `src/app.css`; after US1+US2 firmly
- **US8 (10)** → after US2 + US5 (adopts their hover/card idioms); T036 → T037/T038/T039 ∥
- **US9 (11)** → after US4 (home rebuilt) and ideally US8 (lists settled) to animate final structures
- **Polish (12)** → after all desired stories; T044 optional; T047 closes the feature

### Parallel Opportunities

- Within-story clusters: T017∥T018 · T027∥T030∥T031 · T037∥T038∥T039 · T024 standalone ∥ US5 tree work
- Cross-story when staffed (different files, Phase 2 done): US3 (chat/composer files) ∥ US4-routes ∥ US5-tree ∥ US6-components — EXCEPT anything touching `src/app.css` token blocks, which is strictly serialized US1→US2→(stories consuming)→US7
- US4+US5+US6 could run concurrently as three agents if `app.css` chores are frozen

---

## Implementation Strategy

### MVP First (Stories 1–3 = brand-defining core)

1. Phases 1–2 (baseline + recipes)
2. US1 accent → validate SC-1 walk
3. US2 ladder → validate SC-2
4. US3 composer+launchers → validate SC-4 persistence
5. **STOP**: app-wide clickability+depth+centerpiece live; demo-ready increment

### Incremental Delivery

- +US4 confident home → +US5 discoverability → +US6 quiet chrome → +US7 warm night → +US8 unified rows → +US9 motion honesty → Polish gates
- Each story passes its own Independent Test before next priority begins

### Notes

- `src/app.css` is a contested single resource: enforce the serial token-block lane above
- Zero migrations, zero new dependencies, zero server changes expected — flag instantly if a task discovers otherwise and amend contracts/data-model in the same change
- Commit after each task or logical group; every story checkpoint runs `pnpm check && pnpm lint && pnpm test`
