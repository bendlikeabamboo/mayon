# Quickstart: Validating the Docs Sync

**Feature**: specs/021-sync-docs-implementation

Prerequisites: pnpm dependencies installed (`pnpm install`), Docker (or Podman via
`MAYON_DEV_ENGINE`) for the dev stack, Quarto CLI on PATH, and a clean `pnpm dev` stack.
Run validations in order; each maps to a spec success criterion.

## 1. Docs site builds and nav resolves (SC-002 hygiene)

```bash
quarto render docs
```

Expected: render completes without errors; every page in `docs/_quarto.yml` nav exists;
no dead relative links reported. (Inspection of rendered HTML under `docs/_site/` is fine
for link checks.)

## 2. Beginner walkthrough — first-time user (SC-001, P1)

Start the stack (`pnpm dev`, open http://localhost:5173) and follow
`docs/tutorials/getting-started.qmd` top-to-bottom as a fresh user:

- Every named control exists with the exact documented name (DB pill reads "DB ready";
  boot-gate text matches; landing page is the dashboard).
- You reach a working first chat performing only documented steps, with no dead ends.
- Repeat with `docs/tutorials/chat-and-branching.qmd`: branch via "Branch from this" /
  "Branch from this text"; confirm the doc does not claim a provider switcher in the
  chat view; confirm the sidebar/tree description matches the rail and the /tree page.

Expected: zero doc-caused dead ends; any mismatch found is a new discrepancy (fix doc or
record defect — data-model.md rules).

## 3. Everyday task guides (SC-005, P2)

For each guide, perform its steps in the running product using only the guide:

- providers.qmd: add a provider from the template picker (expect 18 templates incl.
  GitHub Copilot), set active, save key (stored locally, never echoed).
- labs.qmd: generate a lab, complete checklist items (progress "{done}/{total} done");
  page no longer claims local SQLite / no server.
- quizzes.qmd: generate a quiz, answer, review attempt history.
- data-and-privacy.qmd: verify statements against the running stack (server required,
  keys local, data in Postgres volume).

Expected: every step succeeds as written on the first attempt.

## 4. Contributor commands (SC-004, P3)

Run each command in `docs/how-to/building.qmd` and the commands tables of
`docs/how-to/contributing.qmd` / `CONTRIBUTING.md` as written:

```bash
pnpm build && pnpm check && pnpm lint && pnpm test
pnpm --filter @mayon/server test
```

Expected: all succeed with the documented results; the two contributor docs agree on
branch naming and commit convention.

## 5. Factual contract audit (SC-002, SC-003)

Walk `contracts/docs-accuracy-contract.md` row by row against the docs. Expected: every
applicable row is true; every seeded discrepancy from data-model.md is `doc-fixed`,
`defect-recorded`, or `wontfix` with written justification — none `open`.

## 6. Repo gates unchanged (constitution)

```bash
pnpm check && pnpm lint && pnpm test
```

Expected: green. Docs-only edits must not break gates; defects discovered in the product
during walkthroughs are recorded in the decision history (FR-010), not fixed here.

## Done when

Sections 1–6 all pass, and every Documentation Page entity is in status `verified`.
