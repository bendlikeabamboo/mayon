# Implementation Plan: Consolidated Decision History

**Branch**: `013-consolidate-spec-history` | **Date**: 2026-08-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-consolidate-spec-history/spec.md`

## Summary

Create a single narratively-consolidated decision history at `docs/history/index.qmd`
covering every completed feature in the specification archive (dirs 001–012): for each,
what was set out to achieve, why, whether it was later reversed/superseded, and learnings
— bounded to a short per-entry budget and ≤10% of source volume (SC-003). Preserve every
still-binding decision (FR-005) by moving load-bearing detail pointed to from authoritative
docs into `docs/history/appendices/`, then clean up: remove the consolidated feature
directories from the working tree, rewrite all exterior pointers, stamp a tombstone map so
sequential feature numbering never silently resets, and register the new section in the
Quarto docs book. Approach is pure documentation work executed in three auditable passes:
consolidate → audit coverage/integrity → delete + redirect.

## Technical Context

**Language/Version**: Documentation-only change — GitHub-flavored Markdown prose, Quarto
`.qmd` pages (same toolchain as existing `docs/`), YAML touch in `docs/_quarto.yml`.

**Primary Dependencies**: None added. Uses repo-standard tooling only: Prettier (formats
`.md`, enforced by `pnpm lint`), ripgrep/grep (audit scans), Quarto (site rendering, CI —
`deploy-pages.yml`; local render optional if installed).

**Storage**: N/A (git working tree + git history are the persistence layer; deleted
material stays retrievable via git — satisfies FR-008).

**Testing**: No app tests affected. Validation = scripted scans defined in
[quickstart.md](quickstart.md): coverage bijection, word-budget measurement, broken-link
zero-hit scan, git-recoverability spot-checks, `pnpm lint` gate.

**Target Platform**: Repository + Quarto-rendered docs site (GitHub Pages).

**Project Type**: Docs consolidation / repository hygiene (no runtime code).

**Performance Goals**: N/A for app runtime. Process goal: condensed history ≤10% of
source volume and readable end-to-end in one sitting (<15 minutes).

**Constraints**: Per-entry hard cap 700 words (target 450–550); zero broken references to
removed paths (SC-004); authoritative documents untouched except deliberate additive
pointer updates (`AGENTS.md` "Where to look" row, `docs/_quarto.yml` nav, rewriting the 9
identified `specs/…` reference URLs to their new appendix homes); deletion only after
coverage audit passes (FR-006); sequential feature numbering protected against reset
(D5 research).

**Scale/Scope**: 12 archived feature dirs (~160 files, ~108,000 words across `.md`
sources) → 1 consolidated page (≈12 entries + intro/outro narration) + up to ~9
appendix pages carrying preserved load-bearing contract detail + 1 tombstone map.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| I. Code Quality — layering/StorageDriver | N/A: no application code touched. |
| I. Code Quality — gates `pnpm check` / `pnpm lint` | MUST pass at merge; relevant here because Prettier checks Markdown → all generated `.qmd`/`.md` MUST be Prettier-clean (run `pnpm format` over touched files; validated in quickstart). Toolchain pins respected. |
| I. Code Quality — no secrets in settings | N/A; history text MUST NOT reproduce API keys or secrets from any past research material (included as a drafting rule). |
| I. Code Quality — `+` filename prefix | Respected: no files use leading `+`; SvelteKit routing irrelevant outside `src/`. |
| II. Testing Standards | No behavior change ⇒ no new unit tests required; regression-style protection supplied instead by the scripted audits in quickstart (coverage/budget/link checks). `pnpm test` expected green/unaffected. |
| III. UX Consistency — component vocabulary, progressive enhancement | N/A (docs site). Narrative consistency rule substitutes: entries follow one shared template (D3) matching existing docs voice/format conventions. |
| III. UX Consistency — user-facing operations cause no downtime | N/A runtime; preserves the analogous spirit — docs site builds unchanged except additive nav entry; CI Pages deploy verified non-breaking. |
| III. UX Consistency — expound offsets | N/A. |
| IV. Performance — perf probe, FTS columns, restore atomicity | N/A. |
| IV. Performance — justified bundle growth | Not applicable to SPA bundle; analogue honored — history volume itself capped (FR-004, SC-003) rather than growing unbounded documentation weight. |

**Gate result: PASS** — no violations requiring Complexity Tracking. Post-design re-check
(Phase 1 complete): still PASS; all produced artifacts are Markdown/YAML under `specs/013…`,
`docs/history/`, plus two additive pointer edits; nothing contravenes any principle.

## Project Structure

### Documentation (this feature)

```text
specs/013-consolidate-spec-history/
├── plan.md              # This file
├── research.md          # Phase 0 output — key decisions D1–D7
├── data-model.md        # Phase 1 output — document/entry schemas
├── quickstart.md        # Phase 1 output — end-to-end validation guide
└── tasks.md             # Phase 2 output (/speckit-tasks; NOT created here)
```

Note: no `contracts/` directory — this feature exposes no runtime/library/UI interface;
its "interface" is the documented entry schema, carried in `data-model.md` instead
(per outline rule: skip contracts for purely internal work).

### Source / Repository Changes (working tree)

```text
docs/
├── _quarto.yml                      # EDIT (additive): new part 'Decision History'
│                                    #   → chapters: history/index.qmd
└── history/
    ├── index.qmd                    # CREATE: consolidated decision history
    │                                #   (intro narration + 12 entries + closing arc)
    └── appendices/
        └── <nnn>-<slug>.md          # CREATE only where load-bearing detail needs
                                     #   preservation (initially: 004, 005, 009)
docs/dev/
├── architecture.qmd                 # EDIT: retarget 1 `specs/009…` Detail link → appendix
└── seams.qmd                        # EDIT: retarget 8 `specs/004|005|009…` links → appendices
AGENTS.md                            # EDIT (additive one-line): point 'Where to look' at
                                     #   docs/history for feature decision recall
specs/
├── history-map.md                   # CREATE tombstone: NN → title → history anchor →
                                     #   status; records last-used number (anti-reset)
├── 001-brave-search-mcp/ … 012-ui-visual-articulation/   # DELETE after audits pass
└── 013-consolidate-spec-history/    # PROTECTED (own working dir; cleaned only by a
                                     #   future consolidation pass)
```

**Structure Decision**: Documentation-only layout mirroring the existing Quarto book.
No `src/` changes whatsoever. The single-page `index.qmd` holds the whole narrative
(FR-003 reads best unpaginated); appendices are split per feature so preserved low-level
detail never dilutes the story (FR-004/FR-009 separation of narrative from normative
detail).

### Narrative arc plan (Phase-2 foundational output, T007)

Strict chronological order inside three soft arcs; connective narration at every seam;
one retrospective paragraph closes each arc; global closing arc ends at the present.

| Arc | Features | Storyline |
|-----|----------|-----------|
| A — Agent surface takes shape | 001 brave-search-mcp, 002 chat-timeline-kinds, 003 timeline-ux-fixes, 004 internal-area-unification | From a first tool integration to a unified, contract-governed interaction surface: tool calls arrive (001), become typed timeline entries (002), their UX failure modes get fixed (003), and the whole internal area is unified under explicit contracts (004) that later arcs lean on |
| B — AI plumbing industrializes | 005 shape-driven-results, 006 ai-elements-adoption, 007 inference-provider-templates, 008 inference-router-templates, 009 provider-request-settings, 010 custom-expound-instructions | Results rendered by shape not server identity (005), UI vocabulary modernized onto AI elements (006), provider onboarding templated (007→008), wire-request behavior centralized and hardened (009), and expound gains user-authored instruction control within the offset-sanctuary rules (010) |
| C — Platform & delivery polish | 011 podman-support, 012 ui-visual-articulation | Engine flexibility (011: docker/podman choice incl. rootless) and a deliberate visual articulation pass over settings and surfaces (012), closing at today's product shape |

Cross-arc threads to keep alive in narration: contracts as governance currency
(A creates what B/C consume); defaults-as-decisions (persona/level/mode flips; Home chips
reduction); reversals handled openly rather than quietly (see inventory evidence table).

## Complexity Tracking

> Empty — Constitution Check passed with no violations needing justification.
