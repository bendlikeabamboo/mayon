---

description: "Task list for feature 028-mermaid-error-repair"

---

# Tasks: Mermaid Diagram Error Repair & Containment

**Input**: Design documents from `/specs/028-mermaid-error-repair/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/render-pipeline.md, contracts/fix-affordance.md, quickstart.md

**Tests**: Included — the project constitution mandates regression tests for bug fixes (the containment defect) and tests for all new `src/lib/` logic. Test tasks are written FIRST and must fail before implementation.

**Organization**: Tasks grouped by user story (US1 containment, US2 auto-repair, US3 fix affordance) per spec.md priorities.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths in every task

## Path Conventions

Single project: `src/` at repository root (SvelteKit SPA). No server/, packages/, or schema changes in this feature.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Worktree bootstrap only — the app itself needs no initialization.

- [X] T001 Bootstrap the worktree per AGENTS.md: run `pnpm install` then `pnpm --filter @mayon/shared build` (consumers resolve `@mayon/shared` types from gitignored `dist/`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Put the render seam on the contract shape every story builds on.

- [X] T002 Refactor `renderMermaidBlock` in src/lib/markdown/mermaid.ts to resolve the contract result `{ svg, theme, repaired: false }` (contracts/render-pipeline.md) and reject with the underlying mermaid error message; mechanically update both call sites in src/lib/components/chat/Markdown.svelte (initial onMount pass ~L94-119, theme pass `rerenderStaleMermaid` ~L42-63) with NO behavior change yet — red-`<p>` fallbacks stay until US1; verify `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: Seam contract in place — user story work can begin.

---

## Phase 3: User Story 1 - A broken diagram never breaks the page (Priority: P1) 🎯 MVP

**Goal**: Failed renders stop corrupting the page (no mermaid error banner, no page-level scroll) and failures present as a contained, styled block with notice + on-demand reason + formatted source; expound alignment on failed messages stops degrading.

**Independent Test**: quickstart.md Scenario 1 (containment with the spec's canonical broken diagram) + Scenario 7 (selection alignment on a failed message) — no provider needed.

### Tests for User Story 1

- [X] T003 [US1] Regression test in NEW src/lib/markdown/mermaid.test.ts: awaiting `renderMermaidBlock` on an invalid source (use the spec example `A["waking"] -->|"sad", "SAD", "sleepy", "del"| B["tring"]`) rejects with the structured error AND appends zero nodes to `document.body` (assert body child count unchanged) — must FAIL before the fix (mermaid's error SVG is injected today)

### Implementation for User Story 1

- [X] T004 [P] [US1] Set `suppressErrorRendering: true` in the `api.initialize` options in src/lib/markdown/mermaid.ts (~L44-48); keep `startOnLoad`/`securityLevel`/`theme` as-is; T003 turns green
- [X] T005 [US1] Replace BOTH red-`<p>` fallbacks in src/lib/components/chat/Markdown.svelte (initial pass ~L114-119, theme pass ~L56-60) with a contained `.mermaid-error` block built in the existing DOM-builder style: plain-language notice ("This diagram couldn't be rendered"), the failure reason available on demand (collapsed `<details>`-style reveal, not inline parser dump), and the diagram source in a readable `<pre>`; block lives only inside the message body; reuse existing markdown-body/Tailwind conventions (`.mermaid-pending` styling precedent)
- [X] T006 [P] [US1] Add the new block's selectors (`.mermaid-error` and any text-bearing children) to `EXCLUDED_CHROME_SELECTORS` in src/lib/chat/selection.ts (fixes research F3: today's failure `<p>` degrades whole-message expound alignment)
- [X] T007 [US1] Add exclusion coverage: extend the selection-exclusion test mirror in src/lib/markdown/sourcemap.test.ts (or a colocated selection test) asserting `.mermaid-error` nodes are excluded from alignment; then run dev-stack smoke of quickstart Scenarios 1 and 7 (`pnpm dev`)

**Checkpoint**: Containment works standalone — MVP deliverable (shippable strict improvement on `main`).

---

## Phase 4: User Story 2 - Flawed diagrams repair themselves (Priority: P2)

**Goal**: Common model-produced syntax faults (incl. the spec's quoted-label example) render successfully via one deterministic, idempotent repair pass at the seam; repaired diagrams are badged with original-source access; valid diagrams and theme flips are unaffected; stored messages never change.

**Independent Test**: quickstart.md Scenario 2 (canonical fault renders + badge), Scenario 3 (original source preserved, theme flip stable), Scenario 4 (valid diagrams unchanged) — no provider needed.

### Tests for User Story 2

- [X] T008 [P] [US2] Corpus test in NEW src/lib/markdown/mermaid-repair.test.ts: spec example verbatim repairs to a parseable source; `repair(repair(x)) === repair(x)` idempotence property; identity output for already-valid sources; smart-quote and unquoted-reserved-char label cases — must FAIL (module absent)

### Implementation for User Story 2

- [X] T009 [US2] Implement pure `repairMermaidSource(source: string): string` in NEW src/lib/markdown/mermaid-repair.ts covering the corpus: normalize smart quotes in labels, escape/neutralize embedded double quotes and commas inside quoted edge/node labels (e.g. entity-escape inner `"`), wrap unquoted labels containing reserved characters; no mermaid import, no DOM, no state; T008 turns green
- [X] T010 [US2] Integrate repair at the seam in src/lib/markdown/mermaid.ts per contracts/render-pipeline.md: render original → on failure apply `repairMermaidSource` ONCE → render repaired → resolve `{ svg, theme, repaired: true }` or reject (bounded, no loop, no LLM calls); stay on the existing `renderChain` serialization
- [X] T011 [US2] Repaired indication in src/lib/components/chat/Markdown.svelte (both passes): stamp `data-mermaid-repaired` on the `.mermaid-svg` wrapper when `repaired: true`, render a subtle badge whose disclosure shows the ORIGINAL source (`data-mermaid-source` stays original — theme re-render re-applies repair deterministically, FR-012); add badge/source-disclosure selectors to `EXCLUDED_CHROME_SELECTORS` in src/lib/chat/selection.ts
- [X] T012 [US2] Verify stability: dev-stack run of quickstart Scenarios 2, 3, 4 (canonical fault renders + badge; theme flip re-renders identically with no error flash; valid diagrams unchanged); `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: Containment (US1) + self-healing (US2) both functional.

---

## Phase 5: User Story 3 - An honest, actionable fallback when repair fails (Priority: P3)

**Goal**: Unrepairable diagrams get a one-action in-conversation fix: a visible canned follow-up message carrying the broken source + failure reason; the assistant's corrected reply renders as a diagram; original message untouched; action hidden where no chat context/provider exists.

**Independent Test**: quickstart.md Scenario 5 (fix flow with provider) + Scenario 6 (action absent without provider).

### Implementation for User Story 3

- [ ] T013 [P] [US3] Extract a pure prompt builder `buildMermaidFixPrompt(source: string, reason: string): string` (instruction to re-emit only a corrected mermaid fence + verbatim fenced original source + failure reason) in src/lib/markdown/mermaid-repair.ts, with unit tests in src/lib/markdown/mermaid-repair.test.ts asserting all three parts verbatim
- [ ] T014 [US3] Add an optional fix-action callback prop to src/lib/components/chat/Markdown.svelte: when a handler is provided, the `.mermaid-error` block renders a "Fix this diagram" button (existing button vocabulary) that calls `handler(buildMermaidFixPrompt(source, reason))`; no handler ⇒ no button (labs, quizzes, user messages, tool results)
- [ ] T015 [US3] Wire the callback in src/lib/components/chat/rows/AssistantMessage.svelte (durable body `<Markdown>` only, NOT the `live` streaming instance) to `chatStore.send(prompt)` per contracts/fix-affordance.md — visible message, one send per activation
- [ ] T016 [US3] Verify: dev-stack run of quickstart Scenarios 5 and 6 (fix round-trip renders corrected diagram, original message byte-identical; no-provider shows no action); `pnpm check && pnpm lint && pnpm test`

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T017 [P] Sweep docs for staleness: grep docs/ (architecture.qmd, seams.qmd, dev-notes) for mermaid render/error descriptions and update any that describe the old red-`<p>` fallback or lack containment/repair (docs/reference/tool-map.qmd unaffected — no tool changes)
- [ ] T018 Final gates: `pnpm check && pnpm lint && pnpm test` green; full quickstart.md pass (Scenarios 1–8); confirm zero new dependencies (diff package.json against base)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: after Phase 1 — BLOCKS all user stories (seam contract)
- **US1 (Phase 3)**: after Phase 2
- **US2 (Phase 4)**: after US1 — same files (src/lib/markdown/mermaid.ts, Markdown.svelte) and its presentation builds on the contained error block; do not parallelize US1/US2
- **US3 (Phase 5)**: after US1 (the error block is its substrate); independent of US2 logically, but touches the same Markdown.svelte region — run sequentially after US2
- **Polish (Phase 6)**: after all stories

### User Story Dependencies

- **US1 (P1)**: only Phase 2 — fully independent deliverable (MVP)
- **US2 (P2)**: US1 (seam + error block substrate)
- **US3 (P3)**: US1 (error block); orthogonal to US2's repair logic

### Within Each User Story

- Test task FIRST (must fail), then implementation tasks, then verification task last
- Pure module (mermaid-repair.ts) before seam integration (mermaid.ts) before UI (Markdown.svelte / AssistantMessage.svelte)

### Parallel Opportunities

- T004 ∥ T005 ∥ T006 (different files: mermaid.ts / Markdown.svelte / selection.ts) after T003 exists
- T008 (test) parallel with nothing in-phase (module absent) but is pure-file work
- T013 is pure-module work parallelizable with T014 prep
- T017 parallel with T018's test runs

---

## Parallel Example: User Story 1

```bash
# After T003 (failing regression test) is written, launch together:
Task: "Set suppressErrorRendering in src/lib/markdown/mermaid.ts"          # T004
Task: "Contained .mermaid-error block in src/lib/components/chat/Markdown.svelte"  # T005
Task: "Excluded selectors in src/lib/chat/selection.ts"                    # T006
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 bootstrap → Phase 2 seam contract → Phase 3 US1
2. **STOP and VALIDATE**: quickstart Scenarios 1, 4, 7 — containment alone is shippable
3. Continue only if time/verify window allows

### Incremental Delivery

1. Foundation (T001–T002) → 2. US1 (T003–T007) MVP → 3. US2 (T008–T012) → 4. US3 (T013–T016) → 5. Polish (T017–T018); run gates at every checkpoint; commit per task/group to the worktree branch

### Parallel Team Strategy

Not recommended across stories here (shared files); use the within-story parallels above. Sub-agent grouping (AGENTS.md, max 6 per group): [T001–T002], [T003–T007], [T008–T012], [T013–T016], [T017–T018].

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- Constitution gates: `pnpm check`, `pnpm lint`, `pnpm test` must pass before any commit lands on the worktree branch
- Every implementation sub-agent prompt MUST inline the ponytail and caveman skill bodies (global AGENTS.md rule) — keep repairs lazy: one repair pass, no LLM at render time, no new deps
- Stored message content is NEVER modified by any task (FR-004) — if a task seems to require it, stop and re-read research.md D3/D5
- Worktree workflow: commit to this worktree's own remote branch; never merge/PR into main unless the user asks
