# Implementation Plan: Sync Docs With Current Implementation

**Branch**: `021-sync-docs-implementation` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-sync-docs-implementation/spec.md`

## Summary

Audit every living documentation page against the actual implementation and correct all
drift, prioritizing beginner- and everyday-user documentation over contributor
documentation. Research (Phase 0) already produced a page-by-page drift survey with code
evidence: 6 of 13 surveyed pages are drifted (one materially — providers), with
cross-cutting themes of an expanded provider catalog, a stale pre-Postgres storage
narrative, UI label renames, and contributor docs that contradict each other. Corrections
are doc-side edits only; disagreements that reveal product bugs are recorded as defects,
not documented away. All rewritten content uses normal, complete prose aimed at
non-developers.

## Technical Context

**Language/Version**: Markdown / Quarto `.qmd` documents (docs website); no application
code changes in scope.

**Primary Dependencies**: Quarto CLI (docs site build, available locally); pnpm 10 /
Node 22 toolchain for repo quality gates.

**Storage**: N/A (documentation-only; no schema or data changes).

**Testing**: Manual verification — every documented step performed against the running
product (`pnpm dev` stack / prod compose), every documented command executed as written,
plus repo gates (`pnpm check`, `pnpm lint`, `pnpm test`) to confirm nothing else broke.

**Target Platform**: The rendered Quarto docs website and repository root documents
(README.md, CONTRIBUTING.md).

**Project Type**: Documentation-only change.

**Performance Goals**: N/A — no bundle or runtime impact.

**Constraints**: Docs must describe shipped behavior only (no unreleased features
presented as available); product defects are recorded, never papered over; overlapping
pages must agree with one primary source; all content in normal prose for
non-developers.

**Scale/Scope**: 13 living docs pages + README.md + CONTRIBUTING.md; no new docs pages
unless a drifted page cannot absorb the missing content.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | PASS | No app code changes. Docs edits only; merge gates (`pnpm check`, `pnpm lint`) still run before merge. |
| II. Testing Standards | PASS | No `src/lib/` or `server/src/` behavior changes ⇒ no new unit tests required. Every fix is verified by performing the documented steps (manual smoke verification per constitution's UI-change rule). |
| III. User Experience Consistency | PASS | The whole point: docs will use the product's exact current names (verified against component code). No UI changes. |
| IV. Performance Requirements | PASS | No SPA bundle impact; no dependency additions. |
| Quality Gates | PASS | `pnpm check`/`lint`/`test` re-run before merge; no migrations; no release impact. |
| Seam deviation rule | PASS | We update docs to match the system. If the audit had found docs describing intended behavior the code lacks, that becomes a recorded product defect — not a silent doc rewrite or seam deviation. |

**Post-design re-check**: PASS — design artifacts (contracts, quickstart) add no code and
no complexity beyond the documented seam set.

## Project Structure

### Documentation (this feature)

```text
specs/021-sync-docs-implementation/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output: drift survey + decisions
├── data-model.md        # Phase 1 output: page/discrepancy/defect entities
├── quickstart.md        # Phase 1 output: validation walkthrough guide
├── contracts/           # Phase 1 output: per-page factual accuracy contract
│   └── docs-accuracy-contract.md
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)

```text
docs/
├── _quarto.yml               # nav/sidebar (verified current; touch only if pages change)
├── index.qmd
├── tutorials/                # P1: getting-started.qmd, chat-and-branching.qmd
├── how-to/                   # P2: providers.qmd, labs.qmd, quizzes.qmd,
│                             #    data-and-privacy.qmd; P3: building.qmd, contributing.qmd
├── reference/seams.qmd       # P3 (verified current; keep in sync if neighbors change)
├── explanation/architecture.qmd  # P3: route list, schema tables, provider list
└── dev-notes/, history/      # OUT OF SCOPE (historical records; no corrections)

README.md                     # P2: provider enumeration gap
CONTRIBUTING.md               # P3: must agree with docs/how-to/contributing.qmd
```

**Structure Decision**: Documentation-only feature — no source tree is added or
rearranged. Edits target existing docs files listed above; the spec/plan artifacts live
in `specs/021-sync-docs-implementation/`. No new docs pages unless a drifted page cannot
absorb the correction.

## Complexity Tracking

> Not needed — no constitution violations to justify.
