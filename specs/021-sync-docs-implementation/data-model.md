# Data Model: Sync Docs With Current Implementation

**Feature**: specs/021-sync-docs-implementation | **Date**: 2026-09-06

This feature changes no application data. Its "data" is the audit bookkeeping that turns
the spec's requirements into trackable work. Persistence is the feature's own markdown
artifacts and the project's decision history — not the app database.

## Entities

### Documentation Page

A living user- or contributor-facing document that must describe the current product.

| Field | Type | Notes |
|---|---|---|
| path | string | repo path, e.g. `docs/how-to/providers.qmd` |
| audience | enum | `beginner` (tutorials, index), `everyday` (product how-tos, README), `contributor` (building, contributing, architecture, seams, CONTRIBUTING.md) |
| priority | enum | `P1` (beginner), `P2` (everyday), `P3` (contributor) — derived from audience per owner input |
| status | enum | `unverified` → `drifted` or `current` → `corrected` → `verified` |
| primary_for | string, optional | topic this page is the designated primary source for (FR-008), e.g. "installing", "provider setup" |

**Status transitions**: `unverified` → (`drifted` | `current`) on audit; `drifted` →
`corrected` when edits land; `corrected`/`current` → `verified` only after the page's
steps were performed against the running product (D6).

**In scope**: the 14 pages listed in plan.md. **Out of scope**: `docs/dev-notes/*`,
`docs/history/*` (historical records, D5).

### Discrepancy

One place where a page and the implementation disagree.

| Field | Type | Notes |
|---|---|---|
| page | reference → Documentation Page | |
| doc_claim | string | what the page says today |
| actual | string | what the product does, with code evidence (`file:line`) |
| kind | enum | `stale-label`, `stale-behavior`, `missing-capability` (undocumented but user-visible), `wrong-fact` (commands, URLs, counts), `internal-contradiction` (two pages disagree) |
| status | enum | `open` → `doc-fixed` | `defect-recorded` | `wontfix` (with written justification) |

**Validation rules** (from spec):

- Every `open` discrepancy must resolve to exactly one terminal status before the feature
  is done (SC-003).
- `doc-fixed` requires the fix to be verified by performing the documented step (FR-004,
  FR-005, D6).
- `defect-recorded` requires an entry in the project's decision history (FR-010); the doc
  is NOT edited to match the broken behavior (D2).
- `wontfix` requires explicit justification (e.g., deliberate omission for audience
  reasons).

### Product Defect

A disagreement where the implementation, not the documentation, is wrong.

| Field | Type | Notes |
|---|---|---|
| description | string | intended behavior per docs vs actual behavior |
| evidence | string | doc citation + reproduction |
| recorded_in | reference | decision-history entry (FR-010) |

**Rule**: A product defect never resolves a discrepancy as `doc-fixed`. Defect fixing is
out of scope for this feature; only the recording is.

## Relationships

- A Documentation Page has zero or more Discrepancies.
- A Discrepancy resolves to at most one Product Defect.
- Pages sharing a topic (FR-008 overlaps: install instructions, contributor conventions,
  provider enumeration) must agree; the page marked `primary_for` the topic wins and the
  others reference it.

## Known discrepancies at plan time

Seeded from research.md (tasks.md will enumerate each as a discrete task):

- providers.qmd: template table 7 vs 18 shipped; GitHub Copilot kind absent; "default
  template" claim; Ollama URL missing `/api`. (P2, highest impact)
- labs.qmd: SQLite/no-server storage claim (P2; also an internal contradiction with
  data-and-privacy.qmd); "Generate Lab" casing; missing lab-prompt setting.
- chat-and-branching.qmd: branch labels; provider/model switcher claim; sidebar tree vs
  /tree page. (P1)
- getting-started.qmd: DB badge label; first-run dashboard landing. (P1)
- contributing.qmd ↔ CONTRIBUTING.md: branch prefix and commit-convention contradiction.
  (P3)
- architecture.qmd: route list, schema tables, provider list, product summary gaps. (P3)
- index.qmd / README.md: install one-liner placement; Copilot omission. (P2)
