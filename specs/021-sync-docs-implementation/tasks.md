---

description: "Task list for docs-implementation sync feature"
---

# Tasks: Sync Docs With Current Implementation

**Input**: Design documents from `/specs/021-sync-docs-implementation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/docs-accuracy-contract.md, quickstart.md

**Tests**: No automated test tasks — docs-only feature; verification is perform-the-steps
validation defined in quickstart.md and inside each story.

**Organization**: Tasks grouped by user story (spec.md US1/US2/US3). Every editing task
must produce **normal, complete prose for non-developers** — never compressed or
telegraphic style (owner requirement, research D3). Ground truth for every page is
`contracts/docs-accuracy-contract.md`; if code moved since research, re-verify the line —
the product is authoritative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every description

## Path Conventions

Documentation-only feature. Edited files: `docs/**/*.qmd`, `README.md`,
`CONTRIBUTING.md`. Feature bookkeeping: `specs/021-sync-docs-implementation/audit.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Audit bookkeeping and a docs-build baseline before any page is touched

- [X] T001 Create the audit tracker at specs/021-sync-docs-implementation/audit.md from data-model.md: one row per in-scope Documentation Page (path, audience, priority, status=unverified) and one row per seeded Discrepancy from data-model.md "Known discrepancies at plan time" (page, doc_claim, actual, kind, status=open)
- [X] T002 [P] Render the docs baseline with `quarto render docs` and record current warnings/broken links in specs/021-sync-docs-implementation/audit.md so later renders are comparable

**Checkpoint**: Tracker exists; baseline render recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: A running product baseline that every story verifies against

**⚠️ CRITICAL**: No page-editing task may start until this phase is complete

- [X] T003 Start the dev stack with `pnpm dev` (Docker/Podman via MAYON_DEV_ENGINE) and confirm the app is reachable at http://localhost:5173 with the server healthy
- [X] T004 Spot-verify the contract ground truths against the running product and record evidence in specs/021-sync-docs-implementation/audit.md: Settings → Providers shows 18 templates incl. "GitHub Copilot", "Z.AI (GLM)", "Ollama (local)"; buttons "Add provider"/"Set active"/"Save key"; "Generate lab"/"Generate quiz" casing; branch menu items "Branch from this" and "Branch from this text"; DB pill reads "DB ready" with separate "Runtime:" line; /tree page exists; first run lands on the `/` dashboard. If any ground truth has moved, update contracts/docs-accuracy-contract.md BEFORE story work begins

**Checkpoint**: Ground truth confirmed — user story implementation can now begin.

---

## Phase 3: User Story 1 — Beginner Docs Match the Product (Priority: P1) 🎯 MVP

**Goal**: A first-time non-technical user can follow the tutorial pages top-to-bottom to
a working first session with zero doc-caused dead ends.

**Independent Test**: quickstart.md §2 — perform both tutorials on the dev stack as a
fresh user; every named control exists as documented and every step succeeds.

### Implementation for User Story 1

- [X] T005 [P] [US1] Rewrite docs/tutorials/getting-started.qmd per the accuracy contract: DB status pill shows "DB ready" with a separate "Runtime: …" line (not "DB ready (pg)"); first run lands on the `/` continue-learning dashboard with in-progress labs cards, not directly in a chat; boot failure shows the full-screen "Cannot reach the Mayon server." message with the `docker compose up` hint and Retry button; add short coverage of new-chat starter prompts and the Learner Profile settings section in plain prose woven into the existing flow
- [X] T006 [P] [US1] Rewrite docs/tutorials/chat-and-branching.qmd per the accuracy contract: branch actions are "Branch from this" (highlight) and "Branch from this text" (context menu) — remove "Branch from here"; delete the claim that provider/model can be switched from the chat view and instead state the active provider/model is chosen in Settings → Providers via "Set active"; describe the sidebar as flat Parents/Branches/Siblings sections and point to the dedicated /tree page for the visual tree; FIRST verify in the running UI where cross-links actually render before writing that sentence; add short prose coverage of image attach/paste in the composer, the section peek strip, and the reasoning-effort toggle
- [X] T007 [US1] Perform quickstart.md §2 walkthrough on the dev stack following ONLY the two rewritten pages as a fresh user would; fix every mismatch found in the same files (depends on T005, T006)
- [X] T008 [US1] Update specs/021-sync-docs-implementation/audit.md: set both tutorial pages to status verified (or drifted→corrected→verified), close their discrepancies to doc-fixed/defect-recorded/wontfix with justification (depends on T007)

**Checkpoint**: A newcomer can reach a working first session using only the tutorials.

---

## Phase 4: User Story 2 — Everyday Task Guides Match the Product (Priority: P2)

**Goal**: Every product-facing how-to guide and the front doors (index, README) match the
current product; a user completes each documented task on the first attempt.

**Independent Test**: quickstart.md §3 — perform each guide's steps in the running
product using only the guide; no step fails or contradicts the UI.

### Implementation for User Story 2

- [X] T009 [P] [US2] Rewrite docs/how-to/providers.qmd per the accuracy contract: replace the 7-template table with the 18 shipped templates exactly as the picker names them (DeepSeek, xAI, Moonshot Kimi, Qwen, Groq, Mistral, OpenCode Zen, LiteLLM, Vercel AI Gateway, Requesty, Z.AI (GLM), Kilo Gateway, OpenRouter, OpenAI, Anthropic, Google Gemini, Ollama (local), GitHub Copilot); remove the "default template" claim (none exists; DeepSeek leads the list); document GitHub Copilot as server-side sign-in, not a pasted API key; correct Ollama base URL to http://localhost:11434/api; keep verified button labels "Add provider"/"Set active"/"Save key" and the "stored locally, never echoed" key story
- [X] T010 [P] [US2] Rewrite docs/how-to/labs.qmd per the accuracy contract: replace the stale "local SQLite database / no server involved" storage claim with labs persisting in the server's Postgres database like all other data, server required (must agree with data-and-privacy.qmd); button is "Generate lab"; checklist progress shows "{done}/{total} done"; document the custom "Lab generation prompt" setting; BEFORE documenting regeneration, verify in the UI what happens to checklist progress and describe only observed behavior
- [X] T011 [P] [US2] Update docs/how-to/quizzes.qmd: button casing "Generate quiz"; add the custom "Quiz generation prompt" setting; verify in the UI whether the quiz runner defaults to one-question-at-a-time or a scrollable list and describe only what it does; leave the verified payload/table sections intact
- [X] T012 [P] [US2] Update docs/index.qmd: lead with the install.sh one-liner as the fastest way to get the product (path of least resistance), then the dev-stack path; keep it in normal prose
- [X] T013 [P] [US2] Update README.md provider enumeration to include GitHub Copilot so it matches the 18-template registry; keep the install one-liner as the lead
- [X] T014 [P] [US2] Re-verify docs/how-to/data-and-privacy.qmd against the running stack (server required, keys in local storage only, data in the Postgres volume); edit only if a statement no longer holds, and confirm it now agrees with the rewritten labs.qmd (depends on T010)
- [X] T015 [US2] Perform quickstart.md §3 walkthroughs for providers, labs, quizzes, and data-and-privacy using only the guides; fix every mismatch in the same files (depends on T009, T010, T011, T012, T014)
- [X] T016 [US2] Update specs/021-sync-docs-implementation/audit.md: set the five US2 pages + README to verified, close their discrepancies to terminal status with justification (depends on T015)

**Checkpoint**: Every everyday task is completable first-try from its guide alone.

---

## Phase 5: User Story 3 — Contributor & Design Docs Match Reality (Priority: P3)

**Goal**: Every contributor command runs as written; architecture/reference/contributing
pages match the actual system and agree with each other.

**Independent Test**: quickstart.md §4 — execute every documented command from the
documented starting point; check contract rows for the contributor pages.

### Implementation for User Story 3

- [X] T017 [P] [US3] Reconcile the contributor conventions: inspect recent git history to confirm the branch prefixes and commit style actually used, choose one primary source between docs/how-to/contributing.qmd and CONTRIBUTING.md, and align BOTH files to that single convention (branch prefixes and Conventional Commits vs imperative-style) so they no longer contradict each other
- [X] T018 [P] [US3] Verify docs/how-to/building.qmd by running its commands as written (`pnpm build`, `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm --filter @mayon/server test`); fix in place anything that fails or needs an unstated workaround; expected outcome is no edits (page verified current)
- [X] T019 [P] [US3] Update docs/explanation/architecture.qmd per the accuracy contract: route list gains `/` (dashboard) and `/login`; schema section gains `chats.mcp_config`, `messages.parts`, and the `agent_traces` table; provider enumeration matches the 18-template registry including the github-copilot kind; product summary mentions image chat parts, personas/Learner Profile, the section peek strip, and the custom Expound/Lab/Quiz prompt settings; add `src/lib/components/generation/` to the project-structure tree if the tree lists sibling component dirs
- [X] T020 [US3] Re-verify docs/reference/seams.qmd: confirm claims touched by neighbors' corrections (auth/gate, backup, projection) still hold; expected outcome is no edits (page verified current) (depends on T019)
- [X] T021 [US3] Perform quickstart.md §4–5 for the contributor pages and update specs/021-sync-docs-implementation/audit.md: set building/contributing/architecture/seams/CONTRIBUTING.md to verified, close their discrepancies (depends on T017, T018, T019, T020)

**Checkpoint**: Contributor docs are executable as written and mutually consistent.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Close the audit, prove nothing else broke, and record the sync outcome

- [X] T022 Walk contracts/docs-accuracy-contract.md row by row against the final docs (quickstart.md §5) and confirm every discrepancy in specs/021-sync-docs-implementation/audit.md is in a terminal status — doc-fixed, defect-recorded, or wontfix with written justification; none open
- [X] T023 [P] Re-render with `quarto render docs` and confirm no new warnings or broken links versus the T002 baseline
- [X] T024 Run the repo gates `pnpm check && pnpm lint && pnpm test` and confirm green (constitution merge blockers)
- [X] T025 Record the sync outcome in the decision history per FR-010: add a history page for this feature following the existing docs/history/ page pattern (see docs/history/index.qmd and a recent page such as 019-diataxis-docs-website.qmd), covering what was stale, what was corrected, and any product defects recorded during walkthroughs; add the row to docs/history/index.qmd and update specs/history-map.md's "Last used feature number" line only if numbering changed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **US1 → US2 → US3**: sequential by priority (recommended); files are disjoint so
  stories may run in parallel after Phase 2 if capacity allows
- **Polish (Phase 6)**: depends on all stories complete

### User Story Dependencies

- **US1 (P1)**: after Phase 2 only — no cross-story dependencies
- **US2 (P2)**: after Phase 2 only; T014 depends on T010 (labs/data-privacy agreement)
- **US3 (P3)**: after Phase 2 only; T020 depends on T019; T017–T019 are mutually
  independent (different files)

### Within Each Story

- Page edits ([P], different files) → walkthrough verification → audit update

### Parallel Opportunities

- T001/T002 (Setup), T005+T006 (US1), T009–T014 (US2 edits), T017–T019 (US3), T023
- Per the global implement convention: implement in sub-groups of ≤6 tasks with
  parallel sub-agents where dependencies allow

---

## Parallel Example: User Story 2

```text
# After Phase 2 checkpoint, launch US2 page edits together:
Task: "T009 Rewrite docs/how-to/providers.qmd per the accuracy contract"
Task: "T010 Rewrite docs/how-to/labs.qmd per the accuracy contract"
Task: "T011 Update docs/how-to/quizzes.qmd"
Task: "T012 Update docs/index.qmd"
Task: "T013 Update README.md provider enumeration"
# Then sequentially: T014 → T015 → T016
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1 → **STOP and VALIDATE** via quickstart.md §2
3. The prioritized audience (non-developers, fastest path) is already served

### Incremental Delivery

- US1 lands → beginner docs trustworthy (MVP)
- US2 lands → everyday guides + front doors trustworthy
- US3 lands → contributor docs executable and consistent
- Phase 6 closes the audit and records history

## Notes

- Docs prose is written for non-developers: complete sentences, the product's real
  names, no jargon, no compressed style (owner requirement)
- Historical pages (docs/dev-notes/, docs/history/) are never corrected — history is a
  record, not a manual (research D5)
- Disagreements that reveal product bugs are recorded as defects (audit.md → decision
  history), never documented away (research D2)
- Verify tests fail before implementing: N/A (no automated tests in this feature)
- Commit after each task or logical group; stop at any checkpoint to validate the story
