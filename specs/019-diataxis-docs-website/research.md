# Research: Diátaxis Documentation Website

Date: 2026-09-03 · Branch: `019-diataxis-docs-website`

## R1 — Site engine

- **Decision**: Stay in Quarto; flip `project.type` from `book` to `website` in `docs/_quarto.yml`.
- **Rationale**: Delivers the what (quadrant sections + browsable website) with an afternoon of config; keeps the existing `deploy-pages.yml` (`quarto render docs/` → `build/docs`) untouched, satisfying FR-008.
- **Alternatives considered**: Docusaurus / MkDocs Material / VitePress (prespec Card 003) — declined at verdict: full content migration plus a permanent second toolchain for features (versioning, generated API reference) that only pay off if docs keep growing. Quarto book with re-labeled parts (Card 002) — declined: "seems lazy"; keeps linear prev/next chrome.

## R2 — Navigation shape

- **Decision**: Website with a single sidebar whose `contents:` are grouped by the section directories (`tutorials/`, `how-to/`, `reference/`, `explanation/`, `dev-notes/`, `history/`), plus the existing navbar; page-level prev/next chrome is dropped with the book type (website pagination off by default).
- **Rationale**: One obvious TOC maps 1:1 to FR-001/FR-006; search (`sidebar: search: true`) carries fact-lookup (User Story 3).
- **Alternatives considered**: Per-section auto sidebars (`sidebar: auto` per directory) — more chrome, no reader value at 13 pages. Navbar dropdowns — hides sections behind clicks.
- **Confidence note**: Quarto website sidebar/grouping options are stable, well-documented behavior; verify exact YAML keys against the installed Quarto version at implementation (unpinned setup action).

## R3 — Redirect strategy for moved URLs

- **Decision**: Add `aliases` frontmatter to every moved page pointing at its previous public URL; Quarto emits HTML redirect pages for aliases, so old deep links keep working.
- **Rationale**: SC-003 / User Story 5 require link continuity; GH Pages static hosting offers no server-side redirects; aliases are Quarto-native and cheap.
- **Alternatives considered**: Accept breakage with stable entry points only (spec allowed it as fallback) — weaker than what aliases give for free. A redirect map file + external redirector — over-engineering.

## R4 — Link verification

- **Decision**: Automated link check of the rendered site in `build/docs` using `lychee` (local run documented in quickstart; optional CI job in a later task).
- **Rationale**: SC-003 demands an automated zero-broken-links check; lychee handles plain HTML output, is single-binary, and respects robots/exclusions.
- **Alternatives considered**: `htmltest` — equivalent, less common. Manual click-through — fails the "automated" criterion. Broken-links check inside Quarto — not a feature.

## R5 — Current publishing facts (from repo)

- `deploy-pages.yml`: push to `main` → `quarto render docs/` → upload `build/docs` → GH Pages at `bendlikeabamboo.github.io/mayon`. Quarto version unpinned (`setup@v2`).
- Content inventory: 13 `.qmd` pages; `docs/history/appendices/` holds 8 `.md` appendices included by the history section.
- Repo-level doc-path pointers exist in `AGENTS.md`, `CONTRIBUTING.md`, and `.specify/memory/constitution.md` (constitution cites `docs/dev/architecture.qmd` + `docs/dev/seams.qmd`).

All Technical Context unknowns resolved; no NEEDS CLARIFICATION remains.
