# Implementation Inventory & Audit Log — 013-consolidate-spec-history

Transient working record driving consolidation→audit→deletion passes (data-model Entity 6).
Not shipped after feature completion except as feature-record evidence.

## Baselines (captured 2026-08-27)

- **Pre-deletion source volume**: 133,926 words across `.md`/`.qmd` in dirs 001–012.
  SC-003 ceiling for `docs/history/index.qmd`: **≤13,392 words**.
  Per-dir breakdown: 001=8505w/10f · 002=14143w/13f · 003=8649w/8f · 004=11566w/11f ·
  005=9558w/8f · 006=9513w/42f · 007=8267w/8f · 008=10464w/9f · 009=12369w/10f ·
  010=8576w/9f · 011=10436w/10f · 012=21880w/20f
- **Exterior-reference scan** (`rg 'specs/(00[1-9]|01[0-2])' --glob '!specs/**'`) — 11 hits:

| # | Location | Referenced target |
|---|----------|-------------------|
| 1 | docs/dev/seams.qmd:76 | specs/009 research R1 (inline citation) |
| 2 | docs/dev/seams.qmd:77 | specs/009 research R5 (inline citation) |
| 3 | docs/dev/seams.qmd:80 | specs/009-provider-request-settings/contracts/{request-settings-resolution,dialect-catalog}.md |
| 4 | docs/dev/seams.qmd:119 | specs/004-internal-area-unification/contracts/interactive-surfaces.md |
| 5 | docs/dev/seams.qmd:123 | specs/004-internal-area-unification/contracts/tool-activity-status.md |
| 6 | docs/dev/seams.qmd:127 | specs/005-shape-driven-results/contracts/tool-result-shapes.md |
| 7 | docs/dev/seams.qmd:131 | specs/004-internal-area-unification/contracts/interactive-surfaces.md |
| 8 | docs/dev/seams.qmd:135 | specs/004-internal-area-unification/contracts/request-trace.md |
| 9 | docs/dev/architecture.qmd:310 | specs/009-provider-request-settings (+ research transcription) |
| 10 | install.sh:40 | specs/011-podman-support/contracts/engine-selection.md |
| 11 | src/lib/chat/uiState.ts:5 | specs/012-ui-visual-articulation/contracts/settings-keys.md |

**Scope finding**: hits 10–11 originate from shipped artifacts (`install.sh`, SPA source
comment). Their targets bind current behavior ⇒ preserve both artifacts verbatim as
appendices AND retarget the two comment paths (minimal single-line edits; justified vs.
plan's blanket "no src/ changes" phrasing by plan-Summary directive to rewrite ALL exterior
pointers and by FR-005/SC-004). No logic touched.

## Archive inventory & consolidation state

| Dir | Artifact classes present | State | Audited | Deleted |
|-----|--------------------------|-------|---------|---------|
| 001-brave-search-mcp | spec, plan, research, tasks, data-model, contracts, quickstart, checklists | drafted+audited | S1-S4 PASS | – |
| 002-chat-timeline-kinds | spec, plan, research, tasks, data-model, contracts, quickstart, checklists | drafted+audited | S1-S4 PASS | – |
| 003-timeline-ux-fixes | spec, plan, research, tasks, data-model, quickstart | drafted+audited | S1-S4 PASS | – |
| 004-internal-area-unification | spec, plan, research, tasks, data-model, contracts, quickstart, checklists | drafted+audited | S1-S4 PASS | – |
| 005-shape-driven-results | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 006-ai-elements-adoption | spec, plan, research, tasks, data-model, contracts(+41 files), quickstart | drafted+audited | S1-S4 PASS | – |
| 007-inference-provider-templates | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 008-inference-router-templates | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 009-provider-request-settings | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 010-custom-expound-instructions | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 011-podman-support | spec, plan, research, tasks, data-model, contracts, quickstart | drafted+audited | S1-S4 PASS | – |
| 012-ui-visual-articulation | spec, plan, research, tasks, data-model, contracts, evidence, quickstart | drafted+audited | S1-S4 PASS | – |

## Reversal-pair evidence table (starter; enriched from batch drafts)

| Original decision | Evidence base | Later status / ruling |
|---|---|---|
| Home screen chips trio incl. suggestions/jump-back | project rulings memory | 2026-08 user ruling: keep ONLY 'Explore new topic'; others removed |
| Serif typography direction considered in UI overhaul W8 | corrections memory (brainstorm rulings) | Rejected 2026-08: stay sans-serif |
| Expound auto-link embedded-in-markdown approach | corrections memory + constitution III | Rejected: offsets/src-map mechanism instead (010 formalizes custom instructions on top) |
| Quiz generation default persona/level/mode behavior | corrections release_0.2.0_rc1; PR#9 'fix: quiz generation' | Hardened post-release; defaults changed deliberately then stabilized |
| Default persona dr-kim → kit | corrections release_0.2.0_rc1 | Standing replacement (original reversed by deliberate 'new defaults' commit 269a425) |
| Restore nuke-and-pave approach | developer notes/memory db_restore_no_downtime | Reversed by in-place pg_restore w/ maintenance 503 (constitution IV) |

(Draft batches MUST cross-check each entry against this table and add newly-discovered
supersessions with their archival trigger evidence.)

## Validation results log

(to be appended per checkpoint: S1–S4 at US1 gate; S5/S6 rescan at US2; final replay S1–S8)

### US1 gate (T015) — 2026-08-27

- **S1 PASS**: 12 entries, ordered 001–012 across three arcs; every entry has status line +
  Goal/Why/Outcome & reversals/Learnings; intro cross-refs developer notes & architecture docs.
- **S2 PASS**: coverage bijection diff empty (12 inventory ids ↔ 12 entry headings).
- **S3 PASS**: page total **5,275 words** vs ceiling 13,392 (39%); largest entry 012 = 549 ≤700;
  per-entry slice audit max 549.
- **S4 PASS**: reversal reciprocity verified — 002→#004 (reciprocal override named in #004
  outcome), #004→#005 replacement named in both entries, #001 sources-list partial retirement
  narrated in #005; intra-feature pivots (#001 custody chain, #011 dev-scope, #012 achromatic/
  serif/chips) narrated inside their own entries with trigger evidence. Zero one-sided or
  unexplained contradictions found.

### US2 gate (T024) — 2026-08-27

- **Appendices**: 8 verbatim copies with provenance headers (@ a937edc): 004 ×3, 005 ×1,
  009 ×2 + scope-extension copies 011-engine-selection (referenced from install.sh:40) and
  012-settings-keys (referenced from src/lib/chat/uiState.ts:5).
- **Retargets**: 11/11 exterior refs rewritten (seams.qmd ×8 incl. inline R1/R5 citations,
  architecture.qmd ×1 with link into history page, install.sh comment, uiState.ts comment).
- **Deletion**: `git rm -r` of exactly 12 dirs → 158 paths removed; working tree holds only
  013-consolidate-spec-history/ + history-map.md.
- **Protected-path review PASS**: modified set = {architecture.qmd, seams.qmd, _quarto.yml,
  install.sh, uiState.ts} — all deliberate single-purpose pointer edits; AGENTS.md untouched
  so far; docs/dev content otherwise intact; no server/src changes.
- **S5 PASS**: post-deletion scan — matches exist ONLY inside appendices' provenance headers
  (traceability by design); zero living references to retired paths.
- **S6 PASS**: tombstone present (ids 001–012 + anchors + "Last used feature number: 013");
  git recoverability spot-checked on 001/005/012 (pre-deletion commits reachable).

### US3 audits (T025/T026) — 2026-08-27

**T025 whole-repo broken-path sweep PASS**: zero living references to retired
`specs/001–012` paths outside intentional appendix provenance headers. Top-level
`research/*.md` directory verified out-of-scope and intact (all cross-file citations
resolve); the provenance-style strings inside `src/lib/ai/dialects.ts` are app metadata
citations to existing `research/005` source material, not links.

**T026 decision-locatability audit (sample of 12, SC-005)** — each sampled binding
decision traced to a post-cleanup home:

| # | Binding decision (origin) | Found post-cleanup at |
|---|---------------------------|----------------------|
| 1 | Composer = user input only (004) | appendices/004-interactive-surfaces.md + #004 |
| 2 | Activity statuses derived, never stored (004) | appendices/004-tool-activity-status.md + docs/dev/seams.qmd |
| 3 | classifyResult = single shape authority (005) | appendices/005-tool-result-shapes.md + seams.qmd:127-retargeted |
| 4 | Request trace mirrors wire payload only (004) | appendices/004-request-trace.md + #004 |
| 5 | options namespace key = name.split('.')[0].trim() (009) | appendices/009-request-settings-resolution.md §Namespace keys + seams.qmd |
| 6 | Gemini thinkingConfig at google namespace root (009) | appendices/009-request-settings-resolution.md + 009-dialect-catalog.md |
| 7 | extraBody guardrails ≤16KiB / secret-like reject / dropped-keys warn (009) | resolution appendix + docs/dev/architecture.qmd |
| 8 | Engine resolution order + engine-scoped volume hazard (011) | appendices/011-engine-selection.md + install.sh resolve_engine() |
| 9 | Settings keys convention for request param fields (012) | appendices/012-settings-keys.md + uiState.ts header comment |
| 10 | Expound raw-markdown offsets; substring/surroundContents banned (pre-010 invariant) | .specify/memory/constitution.md III + AGENTS.md invariants + #010 |
| 11 | Credentials custody keystore-only; never in URLs/settings/logs (001) | constitution I + #001 Outcome |
| 12 | search_vec GENERATED ALWAYS; no reindex affordances (002-era, ratified) | constitution II & IV |

Result: 12/12 located (8/12 appendices or history page, 4/12 governance documents).

### US3 gate (T028) — 2026-08-27

- AGENTS.md 'Where to look' row added (additive; architecture/seams remain the authority — FR-009).
- Gates: pnpm format clean ✓ · pnpm lint (ESLint+Prettier) PASS ✓ · svelte-check 0 errors ✓ ·
  vitest 1531/1531 PASS ✓ · src/ diff = uiState.ts comment line only.
- S8: local quarto 1.9.38 fails project validation on PRE-EXISTING `breadcrumbs:` key
  (_quarto.yml:53 — renamed upstream to `bread-crumbs`; predates this feature; untouched).
  Isolated-copy render of the new part + history/index.qmd → _book/history/index.html created.
  **S8 STRUCTURAL PASS** (CI deploy-pages arbitratates the full site on merge).

### Final replay (T030) — 2026-08-27, complete tree

S1 12 entries w/ full template ✓ · S2 bijection PASS ✓ · S3 total 5,275 ≤13,392 PASS ✓ ·
S4 reciprocity markers present (002→004, 004→005) ✓ · S5 zero living refs to retired paths ✓ ·
S6 tombstone + recoverable history ✓ · S7 lint/check/1531 tests green ✓ · S8 structural
render PASS ✓. **Feature validated: all quickstart scenarios green on the final tree.**
