---

description: "Task list for feature implementation"
---

# Tasks: Consolidated Decision History

**Input**: Design documents from `/specs/013-consolidate-spec-history/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md — no `contracts/` (docs-only feature; no runtime interfaces).

**Tests**: Not requested by the spec in app-test terms. Validation is performed via the scripted audits defined in [quickstart.md](quickstart.md) (S1–S8); audit-execution tasks are embedded as the checkpoint/validation tasks below.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Execution honors project constraint `subagent_delegation_for_context`: consolidation drafting (US1) is dispatched to subagents in batches ≤3 archived dirs per subagent (research D7); main session assembles and gates.

**Path conventions**: Docs-only feature. Targets live under `specs/013-consolidate-spec-history/` (this feature's design docs), `docs/history/`, `docs/dev/`, `specs/` root, `AGENTS.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Working scaffolding and inputs needed before any story work begins

- [x] T001 Record archive inventory baseline: write transient checklist file specs/013-consolidate-spec-history/inventory.md listing all 12 archived dirs (001-brave-search-mcp … 012-ui-visual-articulation) with artifact classes present per dir (spec/plan/research/tasks/data-model/contracts/checklists/evidence/quickstart) and consolidation state column (pending → drafted → audited) per data-model.md Entity 6
- [x] T002 [P] Capture pre-deletion word-count baseline of all .md sources across specs/001…012 (~108,000 expected) and record it at the top of specs/013-consolidate-spec-history/quickstart.md S3 section for SC-003 measurement
- [x] T003 [P] Baseline exterior-reference scan output: run `rg -n 'specs/(00[1-9]|01[0-2])' --glob '!specs/**'` and save full hit list into specs/013-consolidate-spec-history/inventory.md (expected ≥9 known hits: architecture.qmd ~310; seams.qmd ~76,77,80,119,123,127,131,135) so US3 retargeting can be verified complete against it
- [x] T004 Create docs/history/ directory skeleton with appendices/ subdirectory (no files yet)

**Checkpoint**: Inventory baselines recorded; empty history scaffold exists.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Definitions that every drafted entry must conform to before any consolidation starts

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Finalize the entry template as a reference block appended to specs/013-consolidate-spec-history/data-model.md Entity 2: heading pattern `## NNN — <title>`, status line enum (`standing | partly-superseded | superseded → <anchor>`), four labeled blocks Goal / Why / Outcome & reversals / Learnings (bullets 1–4)
- [x] T006 [P] Compile reversal-pair source table into specs/013-consolidate-spec-history/inventory.md: for each archived feature note any known later ruling/supersession with its trigger evidence (feature id, date, or record) so reciprocal ReversalLink writing (SC-006) never relies on memory mid-drafting
- [x] T007 Draft narrative arc plan (intro scope note → arc groupings for 12 features → closing arc) as a section inside specs/013-consolidate-spec-history/plan.md Project Structure, fixing which entry lands in which arc and where connective narration goes (research D4)

**Checkpoint**: Template, reversal evidence, and arc map locked — drafting can begin.

---

## Phase 3: User Story 1 - Read decision history in one place (Priority: P1) 🎯 MVP

**Goal**: Produce docs/history/index.qmd containing a coherent narrative covering all 12 archived features — each with Goal / Why / Outcome & reversals / Learnings within budget.

**Independent Test**: quickstart S1 + S2 + S3: pick any feature, retrieve goal/rationale/status/learnings in <2 min from `docs/history/index.qmd` alone; coverage diff empty; total words ≤13,392 with per-entry ≤700.

### Implementation for User Story 1

- [x] T008 [P] [US1] Dispatch subagent batch A: read archived sources for 001-brave-search-mcp, 002-chat-timeline-kinds, 003-timeline-ux-fixes and draft D3-template entries (Goal/Why/Outcome&reversals/Learnings/status) into specs/013-consolidate-spec-history/drafts/a.md following research D7 batching rule
- [x] T009 [P] [US1] Dispatch subagent batch B: same procedure for 004-internal-area-unification, 005-shape-driven-results, 006-ai-elements-adoption into specs/013-consolidate-spec-history/drafts/b.md
- [x] T010 [P] [US1] Dispatch subagent batch C: same procedure for 007-inference-provider-templates, 008-inference-router-templates, 009-provider-request-settings into specs/013-consolidate-spec-history/drafts/c.md
- [x] T011 [P] [US1] Dispatch subagent batch D: same procedure for 010-custom-expound-instructions, 011-podman-support, 012-ui-visual-articulation into specs/013-consolidate-spec-history/drafts/d.md; batches must flag status=superseded/partly-superseded candidates explicitly
- [x] T012 [US1] Reconcile the four drafts against data-model rules: enforce per-entry ≤700 words, normalize status values, verify every Goal/Why has archival grounding (flag invented rationale), and check reciprocal reversal pairs using T006 evidence table (depends T008, T009, T010, T011)
- [x] T013 [US1] Assemble docs/history/index.qmd: YAML header + title 'Decision History', intro scope note with developer_notes cross-ref (D2), arc grouping per T007 plan, reconciled entries in numerical order with connective narration between features, arc retrospectives, closing arc ≤300 words (depends T012, T007)
- [x] T014 [US1] Update inventory.md consolidation state column to drafted for all 12 dirs (depends T013)

### Validation for User Story 1

- [x] T015 [US1] Run quickstart S1 (narrative completeness read-through), S2 (coverage bijection diff vs inventory list), S3 (word budget: file ≤13,392 and per-entry ≤700 via heading-slice wc), S4 (reversal reciprocity check) against docs/history/index.qmd; record pass/fail into inventory.md audit column (depends T013, T002)

**Checkpoint**: MVP history page complete and auditable without touching anything else. STOP-and-validate point per implementation strategy.

---

## Phase 4: User Story 2 - Repo reflects current truth after cleanup (Priority: P2)

**Goal**: Every still-binding rule survives (appendices), exterior links retargeted, archived dirs removed, tombstone map written — working tree clean of retired planning artifacts.

**Independent Test**: quickstart S5 + S6: exterior scan returns zero hits; tombstone lists all 12 ids + numbering marker; git log on any deleted dir proves recoverability.

### Implementation for User Story 2

- [x] T016 [P] [US2] Copy verbatim (with provenance header comment: original path @ current commit sha, copy date) the load-bearing artifacts referenced by authoritative docs into docs/history/appendices/: interactive-surfaces.md, tool-activity-status.md, request-trace.md from specs/004-internal-area-unification/contracts/ (per research D6 list) 
- [x] T017 [P] [US2] Same verbatim copy for tool-result-shapes.md from specs/005-shape-driven-results/contracts/ and request-settings-resolution.md, dialect-catalog.md from specs/009-provider-request-settings/contracts/ into docs/history/appendices/, slugified filenames `<nnn>-<source-name>.md`
- [x] T018 [US2] Verify appendix coverage: cross-check saved T003 hit list — every referenced artifact filename now exists under docs/history/appendices/ with correct provenance header (data-model V5) (depends T016, T017, T003)
- [x] T019 [US2] Retarget the 9 exterior references: update detail-links in docs/dev/seams.qmd (lines ~76, 77, 80, 119, 123, 127, 131, 135) and docs/dev/architecture.qmd (~310) to point at the corresponding docs/history/appendices/<nnn>-<slug>.md paths, keeping link text unchanged (depends T018)
- [x] T020 [US2] Register Decision History part in docs/_quarto.yml: add part titled 'Decision History' with chapter history/index.qmd after the Development Notes part (additive edit only) (depends T013)
- [x] T021 [US2] Create specs/history-map.md tombstone: one row per retired dir `NNN → slug → anchor#NNN-title → status`, explicit line `Last used feature number: 013`, one pointer sentence to docs/history/index.qmd and git-history recovery note (FR-008, anti-reset sentinel D5) (depends T015)
- [x] T022 [US2] Execute deletion pass: `git rm -r` each of the 12 consolidated archived directories specs/001… through specs/012… — ONLY after inventory.md shows all rows audited AND S1–S4 passed once AND T019 retargeting complete (deletion-order gate, FR-005→FR-006) (depends T021, T019, T015)
- [x] T023 [US2] Confirm protected paths untouched post-deletion: verify specs/013-consolidate-spec-history/, .specify/memory/constitution.md, AGENTS.md core content, docs/dev/*, docs/developer_notes/* unchanged except deliberate edits made in this feature's tasks (git diff review) (depends T022)

### Validation for User Story 2

- [x] T024 [US2] Run quickstart S5 (exterior-reference rescan zero-hit), S6 (tombstone + git-recoverability spot checks on ≥3 deleted dirs), and re-run S2/S3 unchanged vs final state; record results in inventory.md (depends T022, T023)

**Checkpoint**: Working tree clean of retired artifacts; all knowledge provably preserved and discoverable.

---

## Phase 5: User Story 3 - No binding knowledge dies in the deletion (Priority: P3)

**Goal**: Repository-wide integrity proof: every governing decision traceable to a living home, zero dead paths anywhere in repo documentation.

**Independent Test**: quickstart-derived sweep S8 + audit spot-checks: sample decisions from deleted material are findable in history/governance docs; whole-repo doc scan shows zero broken references.

### Implementation for User Story 3

- [x] T025 [US3] Whole-repo broken-path sweep across all docs: search README.md, CONTRIBUTING.md, AGENTS.md, docs/**/*.qmd, docs/**/*.md, packages/** README if present for any path that resolves post-cleanup to nothing (rg for 'specs/0(0[1-9]|1[0-2])' plus manual resolution of relative links in edited pages); fix or justify every hit in inventory.md findings section (depends T024)
- [x] T026 [P] [US3] Knowledge-locatability audit: sample ~10 still-binding decisions from deleted material (selection spanning all eras incl. wire-contract rules from 009 contracts, interactive-surfaces constraints from 004) and confirm each is findable either in docs/history/index.qmd entries or named governance doc sections; log the sample table with locations into specs/013-consolidate-spec-history/inventory.md (SC-005) (depends T025)
- [x] T027 [US3] Additive AGENTS.md pointer: add one line to the 'Where to look' table pointing at docs/history for feature decision recall ('Consolidated decision history / docs/history/index.qmd'); verify wording does not claim authority over architecture.qmd/seams.qmd (FR-009 separation) (depends T020)

### Validation for User Story 3

- [x] T028 [US3] Run quickstart S7 repository gates (`pnpm format && pnpm lint`, `pnpm check`, `pnpm test`) and S8 (Quarto nav registration verified; render locally if Quarto available else confirm CI expectation); confirm src/server untouched (`git diff --name-only` filter) and record green status in inventory.md (depends T027, T026, T024)

**Checkpoint**: Full validation suite green; feature deliverable is merge-ready.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Residual quality items across the whole delivery

- [x] T029 [P] Housekeeping of this feature's own directory specs/013-consolidate-spec-history/: remove drafts/ scratch files after assembly, keep plan/research/data-model/quickstart/tasks/inventory as feature record (own-dir protection honored — no self-cleanup beyond scratch, edge-case ruling)
- [x] T030 Final end-to-end replay: execute quickstart.md scenarios S1–S8 top-to-bottom in one session on the final tree, attach summary (all-green expected) as the last section of inventory.md, then mark feature done (depends T029, T028)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none → start immediately; T001 must precede audit-column updates but T002/T003/T004 free
- **Foundational (Phase 2)**: depends on T001 inventory existing to host the evidence tables; blocks ALL stories (template governs every draft)
- **US1 (Phase 3)**: needs Phases 1–2; internally strictly ordered drafts → reconcile → assemble → validate
- **US2 (Phase 4)**: appendices/retargeting (T016–T020) can start once US1 assembly exists for anchors (T013) BUT deletion gate (T022) requires US1 validation (T015) green + retargeting done
- **US3 (Phase 5)**: sweeps only meaningful after deletions; consumes US2 outputs
- **Polish (Phase 6)**: after everything

### User Story Dependencies

- **User Story 1 (P1)**: independent after Foundational — delivers value alone (history readable while old specs still sit in tree)
- **User Story 2 (P2)**: depends on US1 completion+validation for its deletion safety gate; its preservation half (appendices) tracks US1 content for anchor names
- **User Story 3 (P3)**: verification-only layer over both; formally independent reads, factually sequenced last

### Within Each User Story

- Preserve/copy before delete; templates before drafts; drafts before assembly; assembly before validation; validation green before destructive steps

### Parallel Opportunities

- T002+T003+T004 (setup): disjoint targets
- T005 vs T006+T007 partially; T008–T011 (four subagent batches): fully parallel — the main win
- T016+T017 (appendix copies): different sources
- T025 vs T026 sequenced not parallel (both touch inventory.md)
- T029 runs while nothing else pending

---

## Parallel Example: User Story 1

```bash
# Four consolidation batches (independent subagents, disjoint dirs):
Task: "Draft entries 001-003 from specs/001..003 sources into drafts/a.md"
Task: "Draft entries 004-006 from specs/004..006 sources into drafts/b.md"
Task: "Draft entries 007-009 from specs/007..009 sources into drafts/c.md"
Task: "Draft entries 010-012 from specs/010..012 sources into drafts/d.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phases 1–2 (baselines + template/arcs)
2. Complete Phase 3 (history page assembled + validated)
3. **STOP and VALIDATE** (quickstart S1–S4): history usable even with old specs still present
4. Ship-ready state: readers get the condensed history immediately

### Incremental Delivery

1. US1 → validated narrative (value: knowledge accessible)
2. US2 → cleanup executed safely (value: tree reflects truth, links intact)
3. US3 → integrity proven repo-wide (value: confidence, zero dead ends)
4. Polish → scratch removed, full replay recorded

### Subagent Strategy (project constraint compliance)

- Batches ≤3 dirs per subagent for all heavy reading (context sprawl control, research D7a)
- Main session owns reconciliation/assembly so cross-batch coherence + reversal detection stay centralized (D7 rejection rationale)

---

## Notes

- Deletion ordering guarantee (quickstart DoV): NO `git rm` until S1–S5+S7 have passed once on the pre-deletion tree
- Never quote secrets/API keys/tokens from research material into history text (Constitution I drafting rule)
- All Markdown/YAML output Prettier-clean (`pnpm format` before commit; gate S7)
- Commit after each checkpoint; keep commits aligned with task groups
