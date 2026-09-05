# Tasks: Security Posture Detection

**Input**: Design documents from `/specs/019-security-posture-detection/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/platform-integration.md, quickstart.md

**Tests**: No automated test tasks — the spec requests none (config-only feature; no `src/` or `server/src/` behavior). Validation is pipeline-level via `quickstart.md` scenarios, referenced inline.

**Organization**: Tasks are grouped by user story. US1 (settings enablement), US2 (workflow changes), and US3 (push-protection verification) are mutually independent.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Descriptions reference exact file paths or the exact platform surface (contracts/platform-integration.md section)

## Path Conventions

Config-only feature: all repo changes live under `.github/`; the settings half of the feature lives in repo configuration on github.com (no files). Paths below are repository-root relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline facts before any change

- [X] T001 Record baseline repo-security-settings state via `gh api repos/bendlikeabamboo/mayon/vulnerability-alerts` and `gh api repos/bendlikeabamboo/mayon --jq .security_and_analysis`; reconcile with the research.md audit table and note any deltas (expected: alerts + security updates disabled, secret scanning + push protection enabled)
- [X] T002 [P] Read `.github/workflows/ci.yml` and `.github/workflows/docker-publish.yml`; map existing job names, `permissions:` blocks, trigger surfaces, and the `verify-version`/`release-assets` job boundaries that MUST remain untouched (read-only, no edits)

**Checkpoint**: Baseline recorded; workflow structure mapped.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Access check that blocks settings tasks in US1 and US3

- [X] T003 Verify admin access for settings changes: `gh api repos/bendlikeabamboo/mayon --jq .permissions` returns `"admin": true`; if false, stop and obtain an admin token before US1/US3 (US2 needs only write access to the repo)

**Checkpoint**: Platform access confirmed — user story work can begin.

---

## Phase 3: User Story 1 - Maintainer learns of a vulnerable dependency without checking (Priority: P1) 🎯 MVP

**Goal**: Dependency vulnerability alerts and security-update proposals are live via repo settings — no files added (deliberately no `.github/dependabot.yml`, per research.md D1)

**Independent Test**: `quickstart.md` Scenario 1 — alerts API returns 204, security updates show `enabled`, Security tab exposes a Dependabot alerts section; performed entirely through settings with zero repo file changes

### Implementation for User Story 1

- [X] T004 [US1] Enable Dependabot vulnerability alerts: `gh api -X PUT repos/bendlikeabamboo/mayon/vulnerability-alerts`, then verify `GET` returns 204 (settings contract: contracts/platform-integration.md §1)
- [X] T005 [US1] Enable Dependabot security updates: `gh api -X PATCH repos/bendlikeabamboo/mayon -F security_and_analysis[dependabot_security_updates][status]=enabled`, then verify `security_and_analysis.dependabot_security_updates.status == "enabled"` (settings contract §1)
- [X] T006 [US1] Confirm the Security tab now exposes a Dependabot alerts section and record the first-run baseline: existing lockfiles may immediately surface findings — triage is review-only, no auto-remediation work in this feature (research.md open item)
- [X] T007 [US1] Independent-test pass: execute quickstart.md Scenario 1 end-to-end and confirm no `.github/dependabot.yml` was created anywhere in the repo (git status clean of it)

**Checkpoint**: Vulnerable-dependency detection is live with weekly-cadence alerts and fix proposals — the MVP is independently usable.

---

## Phase 4: User Story 2 - Every published release carries a security assessment record (Priority: P2)

**Goal**: Non-gating dependency audit in CI and per-image vulnerability scans on release builds, reported via summaries, SARIF, and artifacts

**Independent Test**: quickstart.md Scenario 2 (local audit parity) + Scenario 3 (local Trivy rehearsal); final confirmation on the next tag run shows both legs' summaries with explicit clean/findings/scan-failed states and an unchanged release-assets list

### Implementation for User Story 2

- [X] T008 [P] [US2] Add a report-only `dependency-audit` job to `.github/workflows/ci.yml` per contracts/platform-integration.md §2: audit all three manifest roots (workspace root, `server/`, `packages/shared/`), write one summary section per root, upload one JSON report artifact; job MUST stay green on findings and on audit failure (gap stated in summary, FR-009/FR-010)
- [X] T009 [P] [US2] Add `security-events: write` to the `permissions:` block of the `build-and-push` job in `.github/workflows/docker-publish.yml` (contracts §3 / D8); confirm by diff that `verify-version` and `release-assets` jobs are untouched
- [X] T010 [US2] Add non-gating Trivy scan steps to each `build-and-push` matrix leg in `.github/workflows/docker-publish.yml` (contracts §3, research.md D3/D4/D7): severity-filtered table into the job summary, SARIF upload with unique per-image category (`web-image` / `server-image`), full JSON uploaded as a run artifact, explicit `clean`/`findings`/`scan-failed` summary line; scan/upload failure MUST NOT fail the leg (depends on T009)
- [X] T011 [US2] Validate: run quickstart.md Scenario 2 step 1 locally (audit parity across three roots) and Scenario 3 steps 1–2 (build both images locally, scan with Trivy); verify both modified workflows are syntactically valid and confirm `git diff` shows only the two intended files (depends on T008, T010)

**Checkpoint**: Release pipelines produce visible, non-blocking security records for both shipped artifacts.

---

## Phase 5: User Story 3 - Credentials are stopped before they land (Priority: P3)

**Goal**: Push protection verified live with a working false-positive escape hatch (platform already delivers it — this story proves it, per research.md D6)

**Independent Test**: quickstart.md Scenario 4 — a push containing the AWS documentation example key is blocked before remote storage, and the allow path works

### Implementation for User Story 3

- [X] T012 [US3] Execute quickstart.md Scenario 4 on a throwaway branch: commit the AWS example key, confirm push is blocked with the triggering content named, exercise the allow path, then delete the test branch and content — **CLOSED 2026-09-05, owner decision (d): degraded US3 accepted — platform push-protection/secret-scanning enforcement does not engage for AWS patterns on this repo (evidence: validation-log.md Scenario 4 incl. 2026-09-05 re-test); FR-005/FR-006 unmet by platform, limitation documented; enforcement gap deferred to a follow-up story to be created by the owner**
- [X] T013 [US3] Confirm secret-scanning scope decision holds: `gh api repos/bendlikeabamboo/mayon --jq .security_and_analysis` shows `secret_scanning.enabled` and `secret_scanning_push_protection.enabled` true, with `non-provider patterns` and `validity checks` still disabled (contracts §1; no changes — verification only)

**Checkpoint**: Credential blocking proven end-to-end with the escape hatch working.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Zero-change guarantees and full validation pass

- [X] T014 Verify repo confinement per quickstart.md Scenario 6.1: `git diff <base> --stat` shows changes confined to `.github/` and `specs/` — no `src/`, `server/src/`, `docker-compose.yml`, or `install.sh` changes
- [X] T015 [P] Run the existing quality gates `pnpm check && pnpm lint && pnpm test` and confirm green (nothing app-side changed — proves it)
- [X] T016 Run all quickstart.md scenarios end-to-end and record outcomes; note any deferred items (Scenario 3 step 3 release-run observation and Scenario 6.2 release-assets parity defer to the next tag/RC run — recorded in validation-log.md)
- [ ] T017 First-security-PR contract check: when the first Dependabot security-update PR arrives, `gh pr diff <number> --name-only` confirms only package manifests changed; any `CHANGELOG.md` or `version`-field diff is a contract violation to resolve manually, not merge (quickstart.md Scenario 5; may defer until a PR exists — deferred 2026-09-03: no Dependabot security PR yet; alerts went live during this session)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001 baseline (T002 independent); blocks US1 and US3 settings/verification tasks
- **User Stories (Phases 3–5)**: Mutually independent; US1 and US3 require T003; US2 requires only T002 (workflow mapping) and write access
- **Polish (Phase 6)**: T014–T015 after the stories they guard; T016 after all stories; T017 is event-driven (first Dependabot PR) and may close after merge

### User Story Dependencies

- **US1 (P1)**: T003 → T004 → T005 → T006 → T007 (settings toggles share one API surface; sequential for clean verification)
- **US2 (P2)**: T002 → T008 ∥ T009 → T010 → T011 (ci.yml and docker-publish.yml are different files — parallel; T010 needs T009's permission block)
- **US3 (P3)**: T003 → T012 ∥ T013 (both verification-only)

### Parallel Opportunities

- T002 runs alone in Setup; T008 ∥ T009 in US2; T012 ∥ T013 in US3
- Entire stories run in parallel: US1 (settings) vs US2 (workflow files) vs US3 (verification) touch disjoint surfaces
- T015 runs any time after all file changes are done

---

## Parallel Example: User Story 2

```bash
# Different files, no overlap — launch together:
Task: "Add report-only dependency-audit job to .github/workflows/ci.yml (T008)"
Task: "Add security-events: write permission to build-and-push in .github/workflows/docker-publish.yml (T009)"
# Then sequentially: T010 (scan steps, needs T009), T011 (validation, needs both)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 + Phase 2 (baseline + access)
2. Complete Phase 3 (US1): two settings toggles + verification
3. **STOP and VALIDATE**: quickstart.md Scenario 1 — detection is live with weekly-cadence alerts and fix proposals
4. This alone delivers the assessment's core goal (detection latency from infinite to ≤7 days)

### Incremental Delivery

1. US1 → MVP (detection live)
2. US2 → release-pipeline records (audit + image scans)
3. US3 → push-protection proof (mostly already live)
4. Polish → confinement + gates + full quickstart pass

### Notes

- No automated test tasks: the feature deliberately has no `src/`/`server/src/` behavior; quickstart scenarios are the validation surface
- Every workflow change MUST preserve the release contract: `verify-version`, `release-assets`, and release bodies untouched (FR-004)
- Every new pipeline step MUST be non-gating (FR-009) with explicit gap visibility (FR-010)
- Commit after each task or logical group; stop at any checkpoint to validate independently
