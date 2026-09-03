---
description: "Task list for feature implementation"
---

# Tasks: Diátaxis Documentation Website

**Input**: Design documents from `/specs/019-diataxis-docs-website/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/docs-site.md, quickstart.md

**Tests**: No test tasks — spec requests validation via quickstart scenarios (V1–V6), executed in-line as verification tasks.

**Organization**: Tasks grouped by user story; each story is an independently verifiable increment. All phases merge as ONE cutover change (the site is only coherent once filing + config + links land together).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the target tree before anything moves into it.

- [x] T001 Create section directories `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`, `docs/dev-notes/` (`docs/history/` already exists and stays)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The website shell every story files into. MUST be complete before any user story work.

- [x] T002 Flip `docs/_quarto.yml` from `book` to `website`: set `project.type: website`, replace `book.chapters` with a single `website.sidebar` whose contents are grouped by the six section directories in contract order (tutorials, how-to, reference, explanation, dev-notes, history), keep navbar/bread-crumbs/search (`sidebar.search: true`), drop book page-pagination (research R2)
- [x] T003 Rewrite `docs/index.qmd` as an intent-based landing page: six section entries, each with a one-line intent description linking into the section (FR-006)

**Checkpoint**: Site renders as a website with six empty/placeholder sections; user story filing can begin.

---

## Phase 3: User Story 1 — Find a task answer by intent (Priority: P1) 🎯 MVP

**Goal**: Task-focused pages reachable by intent from How-to guides navigation.

**Independent Test**: quickstart V2 — five representative tasks each reachable in ≤ 2 clicks, pages lead with steps not theory.

### Implementation for User Story 1

- [x] T004 [P] [US1] `git mv docs/guide/providers.qmd docs/how-to/providers.qmd`; add `aliases` frontmatter for its previous public URL
- [x] T005 [P] [US1] `git mv docs/guide/data-and-privacy.qmd docs/how-to/data-and-privacy.qmd`; add alias for previous URL
- [x] T006 [P] [US1] `git mv docs/guide/labs.qmd docs/how-to/labs.qmd`; add alias for previous URL
- [x] T007 [P] [US1] `git mv docs/guide/quizzes.qmd docs/how-to/quizzes.qmd`; add alias for previous URL
- [x] T008 [P] [US1] `git mv docs/dev/building.qmd docs/how-to/building.qmd`; add alias for previous URL
- [x] T009 [P] [US1] `git mv docs/contributing.qmd docs/how-to/contributing.qmd`; add alias for previous URL
- [x] T010 [US1] Audit the six moved pages for substantial task/reference mixing; split interleaved reference tables into new pages under `docs/reference/` and re-link (3/4-strict rule: split only substantial interleaving); extend affected aliases

**Checkpoint**: How-to quadrant populated and task-first (V2 passes for how-to tasks).

---

## Phase 4: User Story 2 — Learn the app from zero (Priority: P2)

**Goal**: A guided tutorial path a new user can follow end-to-end.

**Independent Test**: quickstart V3 — following Tutorials in order reaches a working install and the core workflow.

### Implementation for User Story 2

- [x] T011 [P] [US2] `git mv docs/getting-started.qmd docs/tutorials/getting-started.qmd`; add alias for previous URL; ensure it leads install → first workflow
- [x] T012 [P] [US2] `git mv docs/guide/chat-and-branching.qmd docs/tutorials/chat-and-branching.qmd`; add alias for previous URL (filed as learning-oriented core-usage walkthrough per plan)
- [x] T013 [US2] Order `docs/tutorials/` contents in `docs/_quarto.yml` sidebar as a learning path (getting-started → chat-and-branching)

**Checkpoint**: Tutorials quadrant delivers onboarding alone (V3 passes).

---

## Phase 5: User Story 3 — Look up a fact (Priority: P3)

**Goal**: Reference and explanation material reachable and scannable without narrative reading.

**Independent Test**: quickstart V4 — one fact per former dev doc found via navigation or search.

### Implementation for User Story 3

- [x] T014 [P] [US3] `git mv docs/dev/seams.qmd docs/reference/seams.qmd`; add alias for previous URL; receive any reference tables split out by T010
- [x] T015 [P] [US3] `git mv docs/dev/architecture.qmd docs/explanation/architecture.qmd`; add alias for previous URL
- [x] T016 [US3] Verify search indexes reference/explanation pages and spot-check scannability (headings/tables) per quickstart V4; fix sidebar entries if pages are missing

**Checkpoint**: Reference + explanation quadrants live; fact-lookup exercise passes (V4).

---

## Phase 6: User Story 4 — Browse the project's history on its own shelf (Priority: P4)

**Goal**: Development notes and decision history in dedicated non-Diátaxis sections.

**Independent Test**: quickstart V1 (shelf half) — all dev-notes/history pages reachable from their sections, none inside a quadrant.

### Implementation for User Story 4

- [x] T017 [P] [US4] `git mv docs/developer_notes docs/dev-notes` (index.qmd, foundation-phases.qmd, postgres-migration.qmd); add aliases for their previous public URLs
- [x] T018 [US4] Verify `docs/history/index.qmd` still renders `docs/history/appendices/*.md` (8 files) under the website type; adjust include mechanism if the book→website flip broke it

**Checkpoint**: Both shelves browsable; no chronicle content inside quadrants.

---

## Phase 7: User Story 5 — Follow an existing link through the cutover (Priority: P5)

**Goal**: Zero broken internal links; old public URLs redirect; repo pointers updated.

**Independent Test**: quickstart V5 + V6 — `lychee build/docs --offline` reports zero broken links; 3 old URLs redirect; deploy workflow untouched.

### Implementation for User Story 5

- [x] T019 [US5] Update doc-path references in `AGENTS.md` (architecture/seams/building/developer_notes paths, "Quarto docs site" wording, Where-to-look section)
- [x] T020 [US5] Update doc-path references in `CONTRIBUTING.md` and `README.md` where they point at moved pages
- [x] T021 [US5] Amend `.specify/memory/constitution.md`: update the two `docs/dev/*.qmd` references to new paths, prepend a Sync Impact Report (PATCH clarification, no principle change), bump version 1.0.0 → 1.0.1
- [x] T022 [US5] Run `quarto render docs/` then `lychee build/docs --offline`; fix every broken internal link until zero remain (SC-003)
- [x] T023 [US5] Spot-check 3 pre-cutover public URLs (e.g., old providers/seams/getting-started paths) redirect to new locations via emitted alias pages
- [x] T024 [US5] Confirm `.github/workflows/deploy-pages.yml` is byte-identical to pre-cutover (`git diff --stat` shows no change) (FR-008)

**Checkpoint**: Link continuity proven; cutover is externally invisible except better structure.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final sweep and validation across all stories.

- [x] T025 Remove emptied legacy directories (`docs/guide/`, `docs/dev/`, any `docs/developer_notes/` residue); confirm `quarto render docs/` is clean with no orphan-page warnings
- [x] T026 Run the full `specs/019-diataxis-docs-website/quickstart.md` validation (V1–V6) and record results in the PR description
- [x] T027 Optional hardening: add a `lychee` link-check job to `.github/workflows/deploy-pages.yml` guarding SC-003 on every publish (skip if unwanted — FR-008 keeps the current workflow valid)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories (pages file into the website shell).
- **User Stories (Phases 3–7)**: Depend on Phase 2 only. US1–US4 are independent of each other (different directories); US5 depends on ALL earlier stories (link repair needs final paths).
- **Polish (Phase 8)**: Depends on all stories; T027 optional.

### User Story Dependencies

- **US1 (P1)**: after Phase 2 — no story dependencies.
- **US2 (P2)**: after Phase 2 — independent.
- **US3 (P3)**: after Phase 2 — receives split reference tables from T010 (coordinate, not block).
- **US4 (P4)**: after Phase 2 — independent.
- **US5 (P5)**: after US1–US4 complete (pointers, aliases audit, link check need final tree).

### Within Each User Story

- Moves before audits; sidebar/order tweaks after the files exist; verification tasks last.

### Parallel Opportunities

- T004–T009 (six independent `git mv` + alias tasks, different files)
- T011 + T012 parallel; T014 + T015 parallel; T017 parallel with any US1–US3 task
- T019, T020, T021 parallel (different files) once all moves are done

---

## Parallel Example: User Story 1

```bash
# Launch all US1 moves together (different files, no dependencies):
Task: "git mv docs/guide/providers.qmd docs/how-to/providers.qmd + alias"
Task: "git mv docs/guide/data-and-privacy.qmd docs/how-to/data-and-privacy.qmd + alias"
Task: "git mv docs/guide/labs.qmd docs/how-to/labs.qmd + alias"
Task: "git mv docs/guide/quizzes.qmd docs/how-to/quizzes.qmd + alias"
Task: "git mv docs/dev/building.qmd docs/how-to/building.qmd + alias"
Task: "git mv docs/contributing.qmd docs/how-to/contributing.qmd + alias"
# Then the mixing audit (T010) after all six land.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (dirs + website shell + landing)
2. Phase 3 (US1: how-to quadrant)
3. **STOP and VALIDATE**: V2 on the rendered site
4. Demo-able: intent navigation for tasks works end-to-end

### Incremental Delivery

1. Foundation → US1 (MVP) → validate V2
2. US2 → validate V3; US3 → validate V4; US4 → validate V1
3. US5 (link continuity + pointers + amendment) → validate V5/V6
4. Polish → full quickstart pass → single cutover PR to `main` publishes via existing GH Pages flow

### Notes

- All phases ship as ONE cutover change — the tree is only coherent once config, filing, and links land together.
- Aliases are added per-move; US5 audits them.
- The constitution amendment (T021) is mechanical but MUST land in the same PR (plan's Constitution Check).

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] labels map to spec.md user stories
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
