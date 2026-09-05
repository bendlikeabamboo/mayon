# Phase 0 Research: Security Posture Detection

**Feature**: `019-security-posture-detection` | **Date**: 2026-09-03
**Input**: spec.md FRs; assessment chain (`.specify/assessments/security-posture/`); live repo audit (2026-09-03)

All spec NEEDS CLARIFICATION slots were resolved at assessment time (see spec Assumptions); this research resolves the plan-level technical unknowns queued in the decision record.

## Live repo audit (verified 2026-09-03 via GitHub API)

| Setting | Current state | Consequence for this feature |
|---------|---------------|------------------------------|
| Vulnerability (Dependabot) alerts | **disabled** (404 on API) | Must be enabled — this is the FR-001/FR-002/FR-003 engine |
| Dependabot security updates | **disabled** | Must be enabled — delivers the FR-003 update proposals |
| Secret scanning | enabled | Story 3 engine already live; verification only |
| Push protection | enabled | FR-005/FR-006 already live; verification + allowlist flow only |
| Secret scanning: non-provider patterns | disabled | Leave off — generic-pattern noise exceeds solo-maintainer noise budget; provider-pattern coverage is the high-signal core (D6) |
| Secret scanning: validity checks | disabled | Leave off — nice-to-have, not required by any FR |
| Default branch | `main` | Settings changes apply repo-wide |

## Decisions

### D1 — Dependency detection & update proposals: GitHub-native Dependabot (alerts + security updates), no `dependabot.yml`

- **Decision**: Enable two repo settings (vulnerability alerts; Dependabot security updates). Do **not** add `.github/dependabot.yml`.
- **Rationale**: Alerts re-evaluate the dependency graph (including lockfiles) against new advisories continuously — this is what converts detection latency from infinite to ≤7 days (SC-001) with zero scheduled maintenance (FR-013). Security-update PRs are generated from alerts alone; a `dependabot.yml` only adds *scheduled version updates*, which the assessment deliberately excluded (PR flood vs solo-maintainer budget). Monorepo support (root, `server/`, `packages/shared/`) comes free from the dependency graph — no per-directory config needed.
- **Alternatives considered**: Renovate (stronger grouping/automerge; unnecessary power for one maintainer, and its update-PR cadence is exactly the noise B rejected — research snippets); scheduled `pnpm audit` cron job (redundant with continuous alerts; more moving parts); nightly scheduled workflow (same redundancy).

### D2 — Dependency audit in CI: `pnpm audit`, report-only, in `ci.yml`

- **Decision**: New CI job running `pnpm audit` per manifest root, producing a JSON artifact and a human-readable job summary; the job is always-green (`continue-on-error` semantics) per FR-009.
- **Rationale**: PR-time signal independent of platform alert latency; pnpm-lock.yaml exists and pnpm 10 supports audit against its lockfile (assessment-verified feasibility). Lockfile-level audit catches what a manifest-only view misses.
- **Alternatives considered**: `npm audit`/Yarn (wrong package manager — constitution pins pnpm 10); Snyk/Socket (third-party accounts, cost, supply-chain surface for zero marginal coverage at this scale); omitting CI audit entirely (Dependabot alerts alone leave no PR-time record — weakens SC-005's one-place view).

### D3 — Image vulnerability assessment: Trivy via `trivy-action`, scanned post-build in `docker-publish.yml`

- **Decision**: In each `build-and-push` matrix leg, scan the built image for vulnerabilities (and embedded secrets) after build, before/after push — non-blocking. Output: severity-filtered table into the job summary (CRITICAL/HIGH prominence), full SARIF uploaded to code scanning, full JSON uploaded as a run artifact.
- **Rationale**: FR-007 requires per-release records covering both shipped artifacts; the two GHCR images *are* the shipped artifacts' delivery vehicle, and scanning the built image covers the complete dependency closure (OS packages + app deps) that lockfile audit cannot see. Trivy is OSS, single-binary, SARIF-capable, and was the strongest-evidenced option in assessment research. SARIF gives durable per-release visibility in the Security tab (SC-002, SC-005).
- **Alternatives considered**: Grype/Syft (equivalent capability, smaller Actions ecosystem); Docker Scout (vendor-coupled to Docker Hub semantics); Snyk container scanning (account/cost); a scheduled image-rescan pipeline (out of scope — records are per-release by spec).

### D4 — Report-only mechanics: non-blocking steps + visible gaps

- **Decision**: Scan/audit steps use explicit non-failure semantics, and any scan that cannot run/complete is recorded as a failed/missing assessment in the run summary (FR-010), never silently skipped.
- **Rationale**: FR-009 (never gate) and FR-010 (no silence) together demand "fail loud, block nothing". Workflow-level `continue-on-error` on the scan step combined with a summary line stating the gap satisfies both; a separate always-runs reporting step records the outcome.
- **Alternatives considered**: `severity` exit-code gating (violates FR-009); skipping failed scans silently (violates FR-010); `warning` annotations only (insufficient visibility).

### D5 — Update-PR × release contract: rely on Dependabot's dependency-section-only edits, verified not assumed

- **Decision**: No code. FR-004 is satisfied by (a) Dependabot security PRs editing only dependency manifests' dependency sections — never `version` fields or `CHANGELOG.md`, and (b) a quickstart verification step: the first real security PR's diff is inspected against the release bookkeeping (three `version` stamps + changelog section). Conflicts, if any, surface as ordinary git conflicts for manual resolution — which is exactly FR-004's requirement.
- **Rationale**: The release contract (`verify-version`) only evaluates at tag time; a PR that never touches the version fields cannot corrupt it. Adding custom guards would be complexity without a demonstrated failure mode.
- **Alternatives considered**: Pre-emptive CI check rejecting PRs touching `CHANGELOG.md` (no evidence of need; adds a gate in a report-only feature); grouped-update config (rejected with D1).

### D6 — Secret scanning posture: keep current on-state, provider patterns only

- **Decision**: Verify secret scanning + push protection remain enabled (already are); leave non-provider (generic) patterns and validity checks off.
- **Rationale**: FR-005/FR-006 are already delivered by the platform; enabling generic patterns would add false-positive volume (regex-level matches) against the noise budget, and validity checks are advisory. The allowlist escape hatch (FR-006) is native push-protection behavior.
- **Alternatives considered**: gitleaks/trufflehog CI scanning (catches secrets post-commit rather than preventing remote storage — weaker than FR-005's "prevented before stored"; adds a tool dependency); enabling generic patterns (noise).

### D7 — "Both shipped artifacts" operationalization

- **Decision**: The web SPA image and the server image built by the existing `docker-publish.yml` matrix are the two assessed artifacts; each matrix leg scans its own image, and the release's record is the union of both legs' outputs (summary sections + two SARIF categories + artifacts).
- **Rationale**: No new naming model needed — the spec's artifact taxonomy maps 1:1 onto the existing matrix. SARIF `category` is unique per image so code-scanning results don't collide.
- **Alternatives considered**: Scanning the registry-resolved GHCR tags post-push (equivalent content, extra pull step, no added fidelity); scanning tarballs (same, more plumbing).

### D8 — Permissions: least-privilege additions only

- **Decision**: `build-and-push` jobs gain `security-events: write` (required for SARIF upload); no other permissions change; `verify-version` and `release-assets` jobs untouched. Third-party action pinned by commit SHA (tighter than the repo's existing major-tag convention, justified as supply-chain posture for a security tool — noted as a deliberate, documented inconsistency).
- **Rationale**: SARIF upload is the only new privileged operation; the release contract's integrity depends on leaving its jobs alone.
- **Alternatives considered**: Repo-wide `security-events: write` (over-broad); skipping SARIF for JSON-artifact-only reporting (loses durable Security-tab history, weakens SC-005).

## Open items carried to tasks.md

- Exact step ordering/IDs inside `docker-publish.yml` legs and `ci.yml` (mechanical, tasks phase).
- First-run baseline: after settings are enabled, existing lockfiles may immediately surface known alerts — expect a non-empty initial alert list; triage is review-only.
