# Quickstart: Validate the Diátaxis Documentation Website

Runbook-style validation proving the feature end-to-end. No implementation details — those live in `tasks.md`.

## Prerequisites

- Quarto CLI installed locally (any recent stable; CI uses `quarto-dev/quarto-actions/setup@v2`).
- `lychee` for the link check (optional but required for SC-003 sign-off).
- Repo checked out on branch `019-diataxis-docs-website`.

## Build & preview

```bash
quarto render docs/     # renders to build/docs — must succeed with zero warnings about missing pages
quarto preview docs/    # local browsable site
```

## Validation scenarios

### V1 — Structure (SC-001, FR-001..003)

Browse the sidebar: exactly six sections — Tutorials, How-to guides, Reference, Explanation, Development notes, Decision history. Confirm no page sits outside them and no dev-note/history page appears inside a quadrant.

### V2 — Task lookup by intent (SC-002, User Story 1)

From the landing page, pick 5 representative tasks (e.g., configure a provider, back up data). Each task-focused page must be reachable in ≤ 2 clicks and lead with steps, not theory.

### V3 — New-user tutorial path (SC-004, User Story 2)

Follow the Tutorials section in order; complete the app's core workflow without leaving it.

### V4 — Fact lookup (SC-005, User Story 3)

Using section navigation or search, locate one fact per former dev doc (architecture concept, seam rule, build command) without reading narrative prose.

### V5 — Link continuity (SC-003, User Story 5)

```bash
lychee build/docs --offline
```

Zero broken internal links. Additionally spot-check 3 old public URLs (e.g., the pre-cutover providers page) — each must redirect to its new location.

### V6 — Entry points & pipeline (FR-008)

`git diff` shows `.github/workflows/deploy-pages.yml` untouched. Landing page and navbar links resolve. Repo pointers (`AGENTS.md`, `CONTRIBUTING.md`, constitution) reference the new paths.

## Expected outcome

All six scenarios pass → the spec's success criteria are met and the change is ready for review; merge to `main` publishes via the existing GH Pages flow.
