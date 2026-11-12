# Implementation Plan: Release hygiene for 0.10.0

**Branch**: `034-release-hygiene` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-release-hygiene/spec.md`

## Summary

Issue #74 collects six release-hygiene defects introduced by the 0.9.0→0.10.0 release
train: missing 0.10.0 changelog/version preparation (the release pipeline's
`verify-version` gate cannot pass), three stalenesses in the two authoritative docs
(projection vision gate / assistant image parts, per-segment reasoning, undocumented
mermaid render contract), a deleted idea tombstone with two vanished ideas, an
incomplete mock-LLM README for the 030 image dispatch, process-fault-swallowing
handlers in the langfuse stub fixture, and an already-mostly-fixed e2e engine/ledger
item. The approach: prepare the 0.10.0 release files (fold the two `## [Unreleased]`
entries, compile 027–031 + PR #77 content, bump three manifests, keep fresh
`## [Unreleased]`), surgically update the stale doc passages against the shipped code,
restore the idea tombstone, extend the fixture README, de-swallow the stub, and verify
the e2e item — with **no tagging** (maintainer-only).

## Technical Context

**Language/Version**: Markdown/Quarto docs (`*.qmd`), JSON manifests, one Node ESM
fixture (`server.mjs`). No product code.

**Primary Dependencies**: none new. Editing existing artifacts only.

**Storage**: N/A (no database change).

**Testing**: No vitest suites are expected to be touched or required (no `src/lib/` or
`server/src/` behavior changes). Verification is: Prettier (`pnpm lint` covers
`CHANGELOG.md`, `ideas/`, `tests/e2e/README.md`; note `docs/`, `specs/`,
`tests/fixtures/` are Prettier-ignored), `node --check` for the stub, a standalone
stub probe (curl-level), the release-contract replication loop (jq + grep, mirroring
`.github/workflows/docker-publish.yml:59-74`), and grep-based doc-accuracy checks. Any
vitest invocation, if ever needed, must use the fleet's capped wrapper (see quickstart).

**Target Platform**: repo docs + CI release contract + test fixtures.

**Project Type**: web-app repo (docs/release/fixture hygiene slice).

**Performance Goals**: N/A.

**Constraints**: RC-first release flow (AGENTS.md "Releasing & versioning"); NO
`git tag`, NO tag pushes, NO `gh release` from this work. Docs are Prettier-ignored —
manual style-match. CHANGELOG entries must match existing Keep-a-Changelog section
style (see `## [0.9.0]` for Added/Changed/Fixed phrasing) and must satisfy
`prettier --check CHANGELOG.md` (Pretter wrapping).

**Scale/Scope**: ~6 files edited (3 manifests, CHANGELOG, seams.qmd,
architecture.qmd, ideas/history-map.md, mock-llm README, langfuse stub) + 1
verify-only item. No refactors beyond the issue's scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Code quality (layering, seams) | PASS | No product code touched; docs are updated TO the shipped seams (no seam deviation — the code is authoritative, the docs lag). |
| I. `pnpm check` + `pnpm lint` gates | PASS (planned) | Gates run in validation; scoped prettier for speed where full lint is unnecessary. |
| I. No secrets in settings | N/A | No settings touched. |
| II. Tests must pass before merge | PASS | No suite changes; suites unaffected (fixture change is behavior-preserving for the e2e consumer — evidence via standalone probe; full e2e remains maintainer-run on the dev stack). |
| II. Bug fix ⇒ regression test | PASS (interpreted) | The stub fix is a test-fixture fix, not product behavior; its "regression test" is the standalone probe (quickstart S5) that fails with the current swallow-everything shape (probe asserts a 400 on malformed body AND no process handlers present; the abort-survival property is probed standalone). A permanent unit harness for `tests/fixtures/` would fight the tsconfig exclusion; rejected (documented in research D7). |
| III. UX consistency | N/A | No UI change. |
| IV. Performance | N/A | No runtime change. |
| Quality gates: RC-first flow | PASS | This feature IS the RC preparation (steps 1–2 of the release steps): versions = tag base in all three files, changelog section present, curated notes ready for the maintainer to paste at RC time. Tagging/promotion explicitly out of scope. |
| Docs authority | PASS | `docs/explanation/architecture.qmd` + `docs/reference/seams.qmd` updated to match shipped code (projection.ts, kinds.ts, mermaid.ts, Markdown.svelte) — verified line-by-line in research D2/D9. |

## Project Structure

### Documentation (this feature)

```text
specs/034-release-hygiene/
├── plan.md              # This file ($speckit-plan command output)
├── research.md          # Phase 0 output ($speckit-plan command)
├── data-model.md        # Phase 1 output ($speckit-plan command)
├── quickstart.md        # Phase 1 output ($speckit-plan command)
├── contracts/           # Phase 1 output ($speckit-plan command)
│   ├── release-contract.md      # 0.10.0 changelog structure + entry inventory + manifest rules
│   ├── idea-tombstone.md        # restored ideas/history-map.md format + sentinel rules
│   └── stub-fault-surface.md    # langfuse stub HTTP fault semantics (400/abort/no-swallow)
└── tasks.md             # Phase 2 output ($speckit-tasks command - NOT created by $speckit-plan)
```

### Source Code (repository root)

No new source structure. Touched artifacts (all edits, no new product files):

```text
package.json                        # version → 0.10.0
server/package.json                 # version → 0.10.0
packages/shared/package.json        # version → 0.10.0
CHANGELOG.md                        # [Unreleased] emptied; [0.10.0] section authored
docs/reference/seams.qmd            # projection rules line; new mermaid render-seam contract
docs/explanation/architecture.qmd   # per-kind semantics, projection table, UI-stack mermaid note
ideas/history-map.md                # restored tombstone (sentinel 013 + 2 retirement records)
tests/fixtures/mock-llm/README.md   # 030 image dispatch documentation (routes/shapes/pacing)
tests/fixtures/langfuse-stub/server.mjs  # fault handling moved to request path
tests/e2e/README.md                 # only if US6 verification finds drift (expected: no edit)
```

**Structure Decision**: single-repo artifact edits; the feature directory carries all
new planning docs.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — no violations.

## Release-safety note (binding for all tasks)

**No `git tag`, no tag push, no `gh release`, no GitHub Release edits.** This feature
stops at "files ready": the maintainer performs the RC tag (`v0.10.0-rc1`), CI
publishes, and the maintainer populates the RC release body from the
`## [0.10.0]` section (per AGENTS.md, release steps 3–4 / RC cycle). Subsequent fleet
fixes (#71–#75) append entries inside the still-unreleased `## [0.10.0]` section until
the stable tag exists; `## [Unreleased]` stays empty above it (research D2).
