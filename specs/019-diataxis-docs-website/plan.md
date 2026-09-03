# Implementation Plan: Diátaxis Documentation Website

**Branch**: `019-diataxis-docs-website` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-diataxis-docs-website/spec.md`

## Summary

Restructure the Mayon docs from a Quarto **book** (linear parts) to a Quarto **website** organized by Diátaxis quadrant — Tutorials, How-to guides, Reference, Explanation — plus dedicated non-Diátaxis shelves for development notes and decision history. Same content, re-filed and selectively split (~3/4 strict), same GitHub Pages pipeline (`deploy-pages.yml` runs `quarto render docs/` → `build/docs`). Moved pages get `aliases` so previously-published URLs redirect; all internal and repo-level pointers are repaired in the same change.

## Technical Context

**Language/Version**: Markdown/Quarto `.qmd`; Quarto unpinned (`quarto-dev/quarto-actions/setup@v2` = latest stable). No runtime code.

**Primary Dependencies**: Quarto (site generation), GitHub Actions `.github/workflows/deploy-pages.yml` (publish on push to main → GitHub Pages).

**Storage**: N/A — static site; git is the source of truth.

**Testing**: Manual click-through scenarios (see `quickstart.md`) + automated link check (`lychee`) against the rendered `build/docs`. No Vitest scope — no `src/`/`server/` files touched.

**Target Platform**: Static docs website at `https://bendlikeabamboo.github.io/mayon`.

**Project Type**: Documentation restructure (static site).

**Performance Goals**: N/A — site build stays a single `quarto render`; no new pipeline steps except an optional link-check job.

**Constraints**: FR-008 — same publishing destination and workflow; no app code changes; zero broken internal links after cutover; ideas-dir and repo invariants untouched.

**Scale/Scope**: 13 `.qmd` pages + 8 history appendices (`.md`); one `_quarto.yml`; repo-level pointer updates in `AGENTS.md`, `CONTRIBUTING.md` (if it links docs paths), and `.specify/memory/constitution.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Code Quality (layering, StorageDriver, secrets, `+` prefix) | Pass | No application code in scope. |
| I. Toolchain pins (Node 22 / pnpm 10 / no bun / no Rust) | Pass | Docs-only change; no toolchain additions (this is why the platform card was declined). |
| II. Testing Standards | Pass | No bug fix, no `src/lib`/`server/src` behavior change; validation is click-through + link check per quickstart. |
| III/IV. UX / Performance | N/A | No SPA or server changes. |
| Quality Gates (`pnpm check`/`lint`/`test`) | Pass | Docs-only diff; gates run green regardless and still gate the merge. |
| Governance: constitution cites `docs/dev/architecture.qmd` + `docs/dev/seams.qmd` as authoritative | **Action required** | Cutover moves these files. Path references in `.specify/memory/constitution.md` must be updated in the same change — a PATCH-level clarification amendment (wording/path only, no principle change) with a Sync Impact Report prepended, per Governance. |
| `AGENTS.md` references to docs paths | Pass (mechanical) | `AGENTS.md` governs mechanics; its doc-path references are updated in the same change. |

No gate violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/019-diataxis-docs-website/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── docs-site.md     # Phase 1 output — navigation & URL contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
docs/
├── _quarto.yml            # project.type: website; sidebar grouped by section
├── index.qmd              # landing: intent descriptions per section (FR-006)
├── tutorials/             # getting-started (+ split learning material)
├── how-to/                # providers, data-and-privacy, labs, quizzes, building, contributing
├── reference/             # seams (+ reference tables split out of mixed pages)
├── explanation/           # architecture (+ conceptual material split out)
├── dev-notes/             # developer_notes/ as-is (dedicated shelf)
└── history/               # decision history + appendices (dedicated shelf)

.github/workflows/deploy-pages.yml   # unchanged (FR-008)
AGENTS.md / CONTRIBUTING.md          # doc-path pointer updates
.specify/memory/constitution.md      # PATCH amendment: updated doc paths
```

**Structure Decision**: Quadrant directories at `docs/` root (flat, obvious, one directory per sidebar section); history appendices stay `.md` under `history/appendices/` exactly as today. Per-page filing is finalized in `tasks.md`; direction per spec: `getting-started` → tutorials; `guide/providers`, `data-and-privacy`, `labs`, `quizzes`, `dev/building` → how-to; `dev/seams` → reference; `dev/architecture` → explanation; `chat-and-branching` → tutorial or how-to (decided at task breakdown); `contributing` → how-to; `developer_notes/` + `history/` → dedicated shelves.

## Complexity Tracking

No constitution violations to justify.
