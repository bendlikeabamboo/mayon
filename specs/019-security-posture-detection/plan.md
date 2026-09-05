# Implementation Plan: Security Posture Detection

**Branch**: `019-security-posture-detection` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-security-posture-detection/spec.md`

## Summary

Add CI-side, report-only security detection to the existing pipeline — no application code, runtime, or install-path changes. Enable GitHub-native dependency vulnerability alerts + Dependabot security updates (repo settings), keep secret scanning/push protection verified on, add a non-gating dependency audit to CI, and add non-gating Trivy vulnerability scans of both published container images reported via SARIF (Security tab), job summaries, and run artifacts. Findings never block merges or releases (FR-009); the release contract jobs are untouched (FR-004).

## Technical Context

**Language/Version**: Workflow YAML (GitHub Actions) + repo configuration only; existing toolchain pins untouched (Node 22, pnpm 10.15.0, SvelteKit SPA + Node server)

**Primary Dependencies**: GitHub-native platform services (Dependabot alerts & security updates, secret scanning/push protection — already on, code scanning for SARIF); Trivy via `aquasecurity/trivy-action` (new, CI-runner-only); `pnpm audit` (existing toolchain)

**Storage**: N/A — no application data is created or read; findings live in GitHub platform state (alert tables, code scanning, PRs, workflow artifacts)

**Testing**: Existing Vitest suites unaffected (no `src/` or `server/src/` changes); feature validated via workflow runs and the quickstart scenarios

**Target Platform**: GitHub Actions `ubuntu` runners; results consumed on github.com (Security tab, PR queue, run summaries)

**Project Type**: CI/CD configuration & platform enablement for the existing pnpm-workspace monorepo (SPA + server + shared package)

**Performance Goals**: Zero runtime overhead in the shipped application; release pipeline may grow by minutes of non-gating scan time

**Constraints**: Report-only — no step may fail a merge or release; release-contract jobs (`verify-version`, `release-assets`) untouched; existing RC-first release flow unchanged; no new release assets; solo-maintainer noise budget (weekly-cadence alerts, per-dependency consolidation)

**Scale/Scope**: 2 published container images, 3 package manifests, 2 workflows modified, 4 repo settings toggled/verified, 1 new CI job

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality (layering, seams, pins) | N/A / pass | No application code touched — config/CI only; toolchain pins respected (pnpm 10 audit uses existing lockfile) |
| I. No secrets in `settings` | pass (reinforced) | Feature adds push protection verification; app secret model unchanged |
| II. Testing Standards | pass | No new behavior in `src/lib/` or `server/src/` → no new unit tests required; validation is pipeline-level (quickstart) |
| III. UX Consistency | N/A | No UI changes |
| III. No downtime/restarts | pass | Nothing in the app runtime path |
| IV. Performance (measured claims) | pass | SC-004 claims zero runtime impact because the app artifacts are byte-identical inputs — verified in quickstart; perf probe N/A since no runtime code changes |
| IV. Bundle growth | pass | No SPA dependencies added |
| Quality gates (`pnpm check`/`lint`/`test`) | pass | No TS source changes; existing gates unaffected |
| Release contract (RC-first, versions, CHANGELOG, release notes) | pass (explicit gate) | FR-004: scan/audit additions must not alter `verify-version`/`release-assets` behavior or release bodies; Dependabot security PRs touch dependency sections only — validated in quickstart |
| Migrations (`pnpm db:generate`) | N/A | No schema changes |

## Project Structure

### Documentation (this feature)

```text
specs/019-security-posture-detection/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── platform-integration.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
.github/
├── workflows/
│   ├── ci.yml               # modified: add report-only dependency-audit job
│   └── docker-publish.yml   # modified: add security-events permission + non-gating image-scan steps
└── dependabot.yml           # NOT created — deliberate (see research.md D2)

(repo settings — no files)
├── Dependabot alerts         # enable (currently disabled)
├── Dependabot security updates # enable (currently disabled)
├── Secret scanning           # verify on (already enabled)
└── Push protection           # verify on (already enabled)
```

**Structure Decision**: Config-only feature — the deliverables are two modified workflow files and four repo-settings states; no source tree changes, no release-asset changes. The platform-settings half of the feature lives outside the repo (documented in `contracts/platform-integration.md`), which is why the source tree delta is two files.

## Complexity Tracking

> No constitution violations to justify — table intentionally empty.
