# Phase 1 Data Model: Consolidated Decision History

**Feature**: 013-consolidate-spec-history | **Date**: 2026-08-27
**Input**: [spec.md](spec.md) entities → concretized as documentation structures.
No runtime persistence: git working tree + Quarto pages only.

## Entity 1 — Consolidated History (`docs/history/index.qmd`)

The aggregate document. Single `.qmd` page, YAML metadata header matching existing docs
(`title`, optional `jupyter`/weight-free plain book chapter).

| Part | Content | Rules |
|---|---|---|
| Header block | Title "Decision History"; 2-sentence scope note; cross-ref to `developer_notes/` (D2) | ≤500 words combined intro |
| Entry sequence | N× [History Entry] (Entity 2) in feature-number order, grouped into narrative arcs (D4) | Each entry passes schema validation below |
| Arc retrospectives | One short paragraph per arc closing learnings forward (D4) | ≤150 words each |
| Closing arc | Project-level learnings trajectory ending at the present | ≤300 words |
| Whole-file budget | Total words | ≤13,392 (SC-003 measured vs. 133,926-word measured baseline) |

**Validation rules**:

- V1 (coverage bijection): count(entries with `id` ∈ retired range) == count(inventory dirs
  consolidated); every inventory dir maps to exactly one entry id (FR-001, SC-002).
- V2 (budget): per-entry word count ≤700; file total ≤13,392 (SC-003). Check via
  `wc -w`-based script in quickstart.

## Entity 2 — History Entry

A fixed-template section inside Entity 1. Identifiable by heading anchor
`## <NNN> — <Feature title>` and attributes line.

### Fields (per D3 template)

| Field | Type | Requirement |
|---|---|---|
| `id` | `NNN` (3-digit feature number) | Unique across file; matches tombstone map key (Entity 5) |
| `title` | string | Human feature name from its spec heading |
| `status` | enum `standing \| partly-superseded \| superseded` | Mandatory on every entry; `superseded` requires successor anchor |
| Goal | prose | What was being built, one paragraph |
| Why | prose | Trigger/rationale, one paragraph |
| Outcome & reversals | prose | Shipped outcome; explicit reversal statements both directions (see ReversalLink V-r rule) |
| Learnings | bullet list, 1–4 items | Durable lessons; governance-resident rules referenced not restated (FR-009) |

**Validation rules**:

- V3: all seven fields present for every entry (FR-002 — mechanical template check).
- V4: `status=superseded` ⇒ exactly one outgoing ReversalLink to an existing anchor;
  `partly-superseded` ⇒ ≥1; standing entries may still carry incoming links ("later
  reused" notes).

### Canonical entry template (T005 — locked reference for all drafts)

```markdown
## NNN — <Feature title>

> **Status:** standing | partly-superseded → <anchor(s)> | superseded → <anchor>
> (one clause of trigger evidence: feature id / date / record)

**Goal.** <One paragraph: what was being built, in outcome terms, not implementation
terms.>

**Why.** <One paragraph: the friction or ambition that triggered it; who wanted it and
what would break without it.>

**Outcome & reversals.** <One paragraph: what shipped; how it still behaves today.
Explicitly narrate any reversal — what later undid it and by which decision/feature —
and cite the successor anchor. No silent contradictions.>

**Learnings.**
- <1–4 durable lessons; rules that live in governance docs are referenced, not restated.>
```

Rules: heading id = 3-digit number matching tombstone key; status line mandatory on every
entry; Goal/Why grounded in archived sources (no invented rationale); Learnings bullets
concrete and forward-looking; total ≤700 words per entry (target 450–550).

## Entity 3 — Appendix (`docs/history/appendices/<nnn>-<slug>.md`)

Verbatim preservation of a load-bearing artifact before its source dir is deleted (D6).

| Field | Source |
|---|---|
| Filename | `<nnn>-<source-filename>` slugified |
| Provenance header (HTML comment) | Original path `specs/<dir>/<file> @ <commit-sha>`, copy date |
| Body | Byte-for-byte artifact content, unmodified |

**Validation rules**:

- V5: every exterior reference to a deleted path resolves to an appendix whose provenance
  header names that exact source path (FR-005, SC-005).

## Entity 4 — ReversalLink (relationship)

Directed edge: *original decision claim* → *superseding entry*.

| Property | Rule |
|---|---|
| Endpoints | Both ends must exist within Entity 1 (anchor-checked) or point into authoritative governance doc |
| Reciprocity (V-r / SC-006) | Written at BOTH entries: original's Outcome states what undid it; successor's Why/Outcome names what it replaced; no surviving unexplained contradiction between entries |
| Evidence | Each link cites its trigger (feature id, ruling date, or record) in one clause |
| To external home | When superseded-by-governance (e.g., a constitution principle), link text names the governing document & section instead of another entry |

## Entity 5 — Tombstone Map (`specs/history-map.md`)

Working-tree stub replacing deleted archive dirs.

| Field | Example |
|---|---|
| Line per retired feature | `001 → brave-search-mcp → #001-brave-search-mcp → standing` |
| Numbering marker | `Last used feature number: 013` (anti-reset sentinel for sequential scan, D5) |
| Pointer | One sentence: full narratives live at `docs/history/index.qmd`; raw sources retrievable via git history (FR-008) |

**Validation rules**:

- V6: every deleted dir id appears exactly once in map; ids, slugs match Entity 1 anchors;
  marker integer equals max ever-used number.

## Entity 6 — Archive Inventory Record (transient)

Checklist driving passes 1–3; lives in tasks implementation tracking, not shipped art:
for each archived dir — `dir-name`, artifact classes present (`spec/plan/research/tasks/
data-model/contracts/checklists/evidence/quickstart`), consolidation state
(`pending → drafted → audited`), deletion state (`pending → done`). The cleanup_status
transition gate: `deleted` allowed only when consolidation=audited AND V1–V6 green AND
exterior-link scan zero-hit.

## State flow summary

```text
Archived dir ──consolidate──▶ entry drafted ──audit(V1,V3,V4,budget)──▶ audited
audited + preserve-refs(D6: appendices V5) ──delete+retarget(SC-004 scan)──▶ removed,
tombstone row written (V6)
```

No ring-back: `removed` is terminal in the working tree (recovery = git history).
