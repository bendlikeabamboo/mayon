# Quickstart: Consolidated Decision History — End-to-End Validation

**Feature**: 013-consolidate-spec-history
Run from repo root on a clean checkout of the feature branch. Every check below is a
plain command; no app build or dev stack needed. Commands use `rg` (ripgrep) and `wc`;
substitute equivalents if unavailable.

## Prerequisites

- Repo checkout with implementation complete (Passes 1–3 in [research.md](research.md) D7).
- Baseline word count recorded before deletion: **133,926** (full `.md`+`.qmd` corpus,
  inventory.md; supersedes the ~108k first-pass estimate that excluded subdirectories).
- `pnpm install` done (for the Prettier lint gate).

## Validation scenarios

### S1 — Narrative completeness (FR-001/002/003, US-1)

Open `docs/history/index.qmd` and verify:

1. Exactly 12 entries with headings `## NNN — <title>` for every retired dir 001–012,
   ordered by number, grouped into narrative arcs.
2. Every entry shows all four labeled blocks — **Goal**, **Why**, **Outcome & reversals**,
   **Learnings** — plus a status line (`standing | partly-superseded | superseded → <anchor>`).
3. Reading start-to-finish flows as one story: intro scope note, connective sentences
   between features, arc retrospectives, closing arc; intro cross-references
   `docs/developer_notes/`.

Expected: no placeholder text, no entry missing a block, arcs recognizable.

### S2 — Coverage bijection (SC-002, data-model V1)

```bash
diff \
  <(ls -d specs/0* -d 2>/dev/null | grep -Ev '013' | sed 's#specs/0##;s#/.*##' | sort) \
  <(grep -oP '^## \K\d{3}(?= —)' docs/history/index.qmd | sort)
```

Expected: empty diff (every archived dir has exactly one matching entry; note post-cleanup
only `specs/history-map.md` remains, so run this against the recorded inventory list if
already deleted).

### S3 — Volume budget (FR-004, SC-003, data-model V2)

Measured pre-deletion baseline (2026-08-27): **133,926 words** across dirs 001–012 ⇒
ceiling **≤13,392 words** for the consolidated page.

```bash
TOTAL=$(wc -w < docs/history/index.qmd)
echo "history words: $TOTAL / ceiling 13392"
```

Expected: total ≤13,392. Per-entry spot check: the word count between successive
`^## \d{3}` headings ≤700.

### S4 — Reversal reciprocity (SC-006, data-model V-r)

For each `status=superseded` or `partly-superseded` entry: confirm the original entry's
Outcome names what later undid it, AND the successor entry's prose names what it replaced,
with a trigger citation. Cross-check against known rulings during drafting (e.g., Home
chips reduction, serif-typography rejection, expound auto-link reversal) — each must be
narrated, not silently dropped.

Expected: zero one-sided reversals.

### S5 — Preserved detail & link retargeting (FR-005/009, SC-004, data-model V5)

Before deletion the exterior-reference scan is baselined:

```bash
rg -n 'specs/(00[1-9]|01[0-2])' --glob '!specs/**'   # must be EMPTY after Pass 3
```

Known baseline hits to retarget into `docs/history/appendices/<nnn>-<slug>.md`:
`docs/dev/architecture.qmd` line ~310; `docs/dev/seams.qmd` lines ~76, 77, 80, 119, 123,
127, 131, 135. After retargeting, rerun the scan.

Expected: zero matches outside `specs/`; each appendix carries a provenance header naming
its original path and commit.

### S6 — Tombstone & recoverability (FR-008, D5)

```bash
cat specs/history-map.md        # rows for 001–012 + "Last used feature number: 013"
git log --oneline -- specs/005-shape-driven-results | head -3   # history retrievable
```

Expected: map lists all 12 ids with anchors into the history page; git log shows the
deleted dir's commit trail (recovery path works).

### S7 — Repository gates (Constitution I)

```bash
pnpm format && pnpm lint          # Prettier-clean Markdown/YAML; ESLint untouched
pnpm check                        # unaffected but required green before merge
pnpm test                         # expected unchanged/green
```

Expected: all green. No files under `src/` or `server/src` modified
(`git diff --name-only | grep -E '^src/|^server/'` → empty).

### S8 — Docs site registration (D1)

Confirm `_quarto.yml` gained part *'Decision History'* → chapter `history/index.qmd`.
If Quarto is installed locally: `quarto render docs/_quarto.yml --to html` renders without
error and the new section appears in nav (CI `deploy-pages.yml` enforces this on merge).

Expected: render clean (or CI-green), sidebar shows Decision History.

## Definition of validated

S1–S8 all pass ⇒ FR-001…FR-009 demonstrably satisfied; SC-001…SC-006 measurable outcomes
observed. The deletion ordering guarantee lives here: no `git rm` of any archived dir may
occur until S1–S5 and S7 have passed once against pre-deletion state.
