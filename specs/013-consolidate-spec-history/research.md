# Phase 0 Research: Consolidated Decision History

**Feature**: 013-consolidate-spec-history | **Date**: 2026-08-27
**Input**: [spec.md](spec.md) — no `[NEEDS CLARIFICATION]` markers existed; this file
resolves the open design questions a docs-only feature still carries.

## Baseline measurements (from repo survey, 2026-08-27)

| Measurement | Value |
|---|---|
| Archived feature dirs (001–012) | 12 |
| Artifact files across archive | ~160 |
| Combined `.md` source words | ~108,000 (10% ceiling ⇒ **≤13,392 words**) |
| Existing precedent history doc | `docs/developer_notes/` (~3,100 words, pre-speckit phases) |
| Exterior refs into `specs/…` | 9 links: `docs/dev/architecture.qmd:310` (009), `docs/dev/seams.qmd:76,77,80,119,123,127,131,135` (004/005/009) |
| Docs rendering | Quarto book (`docs/_quarto.yml`) → GitHub Pages via `deploy-pages.yml` |
| Numbering policy | `init-options.json: feature_numbering=sequential` — next number scanned from existing `specs/0NN-*` dir names |

---

## D1 — Output location and format: `docs/history/index.qmd`, single Quarto page

**Decision**: One Quarto page at `docs/history/index.qmd`, registered in `docs/_quarto.yml`
as a new part *'Decision History'* after *'Development Notes'*. GitHub-flavored Markdown
inside `.qmd`, matching house style.

**Rationale**: `docs/` is already the canonical documentation home and renders to the
public site; a `.qmd` page inherits nav/search/breadcrumbs for free. The spec's narrative
requirement (FR-003: reads as one continuous story top-to-bottom) favors one unpaginated
file over per-feature chapters. User explicitly named `docs/history` as the location.

**Alternatives considered**: (a) plain `docs/history.md` — no site registration, invisible
in rendered docs; (b) multi-file chapters under `history/<era>/` — better for >20k words,
premature at our ≤10.8k budget and hurts continuous-narration reading; (c) keep inside
`specs/` — wrong audience home; specs is working storage, not published knowledge.

## D2 — Relationship to `docs/developer_notes/`: complementary, cross-linked once

**Decision**: Keep `developer_notes/` untouched. The new history's intro gets a two-sentence
cross-reference: developer notes narrate the pre-speckit foundation build phases; the
decision history covers every speckit-planned feature (001 onward).

**Rationale**: FR-007 forbids cleanup from disturbing authoritative documents; rewriting or
merging developer notes would violate it and expand scope. Distinct timeframes mean neither
duplicates the other; one pointer prevents readers treating them as competing histories.

**Alternatives considered**: (a) fold developer notes into the new history — out of scope,
violates FR-007; (b) ignore the overlap silently — risks contradictory "where is the
history?" confusion.

## D3 — Entry schema and length budget

**Decision**: Every entry follows one fixed template with four labeled blocks —
*Goal*, *Why*, *Outcome & reversals*, *Learnings* — plus a status line
(`standing | partly superseded | superseded → <anchor>`). Hard cap **700 words per
entry**, target 450–550; intro/outro narration ≈300–500 words combined. Total stays well
under the 13,392-word SC-003 ceiling even at cap (12 × 700 = 8,400).

**Rationale**: A rigid template makes entries scannable and makes the four spec-mandated
questions impossible to omit (FR-002); fixed budgets make FR-004/SC-003 mechanically
checkable rather than taste-based.

**Alternatives considered**: (a) freeform essay per feature — coherent but unverifiable
against coverage/budget criteria; (b) table of one-liners — fails "narratively sound";
(c) variable-length entries mirroring feature size — reintroduces detail bloat (the very
problem being cleaned up).

## D4 — Ordering and narration devices

**Decision**: Strict chronological order by feature number (001→012), grouped into soft
narrative arcs by system area (foundations/timeline UX ↔ provider/AI plumbing ↔ polish),
with connective sentences between features ("with providers templated, the next friction
was …"). Each arc closes with a one-paragraph retrospective hooking learnings forward.
Reversals are always written at both ends of the pair: the original entry says what later
undid it; the successor entry names what it replaced (reciprocal ReversalLink,
[data-model.md](data-model.md)).

**Rationale**: Chronology + connective tissue is the minimum machinery that turns isolated
entries into a story (FR-003); reciprocal reversal writing enforces SC-006 and prevents
the classic failure of surviving contradictions left unexplained.

**Alternatives considered**: (a) thematic ordering (all provider features together) —
cleaner taxonomy but loses cause-and-effect timeline; (b) flat list without arcs — checklist
dump, explicitly rejected by the user.

## D5 — Deletion mechanics, recoverability, and numbering anti-reset

**Decision**: Delete consolidated dirs with `git rm -r specs/001…` through `specs/012…`
after audits pass. Recovery = git history (`git log -- specs/<dir>`); no archive copy.
Create a small tombstone `specs/history-map.md`: one line per retired feature
(`001 → brave-search-mcp → anchor#001 → standing`) plus an explicit
`Last used feature number: 013` marker so `/speckit.specify` sequential scanning never
silently restarts numbering at a reused digit after deletion.

**Rationale**: Spec assumption A3 already accepted git-as-archive; duplicating sources
elsewhere would fight FR-004 spirit. Without the marker, the sequential-scan policy in
`.specify/init-options.json` would happily mint a new `001-…` post-cleanup — colliding
conceptually with history-recorded numbers and confusing future考古. The map doubles as
SC-004-safe redirect stub for humans who type old paths.

**Alternatives considered**: (a) rename dirs into `specs/archive/` instead of deleting —
keeps clutter the user asked to clean; (b) `git branch specs-archive` only — discoverability
too low; tombstone file gives same guarantee cheaply; (c) renumber future features manually
— relies on human memory, exactly the failure mode this feature exists to remove.

## D6 — Load-bearing references into `specs/…`: preserve detail in appendices, then retarget

**Decision**: Before deletion, copy each artifact actually referenced from authoritative
docs into `docs/history/appendices/<nnn>-<slug>.md` (initially: contracts from 004
(interactive-surfaces, tool-activity-status, request-trace), 005 (tool-result-shapes), 009
(request-settings-resolution, dialect-catalog)). Then rewrite the 9 exterior links to point
at the appendix paths. Appendices are verbatim preservations — not condensed — because they
carry normative detail authoritative pages depend on (FR-005/FR-009: narrative points to
rules rather than restating them; rules stay whole). Additionally run a full-repo scan for
any remaining `specs/0(0[1-9]|1[0-2])` path reference outside `specs/` itself; each hit gets
retargeted or justified before deletion proceeds. Audit procedure recorded in quickstart.

**Rationale**: Survey found real pointers (`architecture.qmd:310`; eight in `seams.qmd`)
from constitution-designated authoritative pages into spec artifacts — naive deletion
breaks both links and the normative homes behind them (exactly US-3's risk case). Verbatim
appendix copy preserves precision engineers rely on, while the index page stays within its
word budget; redirect satisfies SC-004 zero-broken-links.

**Alternatives considered**: (a) inline the detail into seams/architecture pages — edits
protected authoritative docs beyond additive pointer updates, inflating those pages;
(b) delete detail and point everything at history narrative — lossy, drops exact wire-rule
tables engineers cite; (c) leave referenced dirs undeleted — partial cleanup violates FR-006.

## D7 — Execution strategy and gates

**Decision**: Implement in three ordered passes, using subagent dispatch for context-heavy
reading per project constraint `subagent_delegation_for_context`: **Pass 1 consolidate**
(batches ≤3 archived dirs per subagent read/draft against the D3 schema; main session edits
assemble the narrative), **Pass 2 audit** (coverage bijection, word budget, secret scan,
link inventory — all scripted checks green before any deletion), **Pass 3 delete+retarget**
(git rm, link rewrites, tombstone, `_quarto.yml` + AGENTS.md additions, `pnpm format` over
touched Markdown). Merge gates: standard `pnpm check` / `pnpm lint` / `pnpm test` plus the
quickstart audit scripts; drafting rule: never quote API keys, tokens, or secrets from any
research material into history text.

**Rationale**: The biggest execution risk is silent knowledge loss at scale (108k words);
batched subagents keep per-context load sane, and the strict pass ordering makes FR-005→
FR-006 sequencing mechanical rather than aspirational.

**Alternatives considered**: (a) single-session straight-through consolidation — context
sprawl on 108k input words, high drift/fabrication risk across 12 entries; (b) fully parallel
12-way subagents — no cross-entry coherence or reversal detection, defeating FR-003/SC-006.

---

**Status**: All design unknowns resolved; no clarifications outstanding. Ready for Phase 1
artifacts ([data-model.md](data-model.md), [quickstart.md](quickstart.md)) — note
`contracts/` intentionally omitted (no runtime interfaces; see plan Project Structure).
