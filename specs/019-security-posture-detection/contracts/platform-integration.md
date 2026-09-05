# Contracts: Platform Integration

**Feature**: `019-security-posture-detection` | **Date**: 2026-09-03

This feature exposes no application interfaces. Its "contracts" are the configurations and observable outputs that the repo, its pipelines, and the platform exchange. Implementation detail belongs to `tasks.md`; this document fixes the *interfaces* tasks must honor.

## 1. Repo-settings contract (platform state, no files)

| Setting | Required state | Set via | Verified by |
|---------|----------------|---------|-------------|
| Vulnerability alerts (Dependabot alerts) | enabled | repo Settings → Code security, or `PUT /repos/{owner}/{repo}/vulnerability-alerts` (admin) | `GET .../vulnerability-alerts` → 204 |
| Dependabot security updates | enabled | repo Settings → Code security | `GET .../security-and-analysis` → `dependabot_security_updates.enabled` |
| Secret scanning | enabled (already) | — (verify only) | `security_and_analysis.secret_scanning.enabled` |
| Push protection | enabled (already) | — (verify only) | `security_and_analysis.secret_scanning_push_protection.enabled` |
| Non-provider patterns / validity checks | disabled (deliberate, D6) | — (verify only) | same API path |

`.github/dependabot.yml` is deliberately **not** part of this contract (D1): security-update PRs require only the settings above.

## 2. `ci.yml` contract — dependency audit job

- **New job** (name indicative, e.g. `dependency-audit`): runs on the same triggers as existing CI (push to default branch + PRs).
- **Behavior**: audits all three manifest roots (workspace root, `server/`, `packages/shared/`); produces (a) a human-readable summary section per root and (b) one JSON report artifact covering all roots.
- **Non-gating guarantee (FR-009)**: the job MUST always conclude green; findings are expressed in summary/artifact content, never in exit codes.
- **Gap visibility (FR-010)**: an audit command that cannot run MUST produce a summary section stating the failure, and the job stays green.
- **Untouched**: existing jobs (`check/lint/test/build`, e2e) and their gating semantics MUST NOT change.

## 3. `docker-publish.yml` contract — release image scans

- **Permissions**: `build-and-push` legs additionally require `security-events: write`. No other permission changes; `verify-version` and `release-assets` MUST remain byte-for-byte behaviorally unchanged (release contract).
- **Scan steps** (per matrix leg, post-build):
  - Vulnerability + secret scan of the built image (severity-filtered table rendered into the job summary; CRITICAL/HIGH prominent).
  - SARIF upload to code scanning with a **unique category per image** (`<pipeline-prefix>/web-image`, `.../server-image`) so results never collide across legs.
  - Full JSON report uploaded as a run artifact named per image.
- **Non-gating guarantee (FR-009)**: scan/upload failures MUST NOT fail the release workflow or prevent publishing/push.
- **Gap visibility (FR-010)**: a missing/failed scan MUST be stated in the job summary for that leg (`scan-failed` state in the Release Assessment Record — see data-model.md).
- **SARIF contract**: format SARIF 2.1.0; one upload per leg per run; categories as above.

## 4. Update-PR contract (platform-generated)

- Dependabot security PRs MUST be inspectable against the release bookkeeping: their diff is restricted to dependency sections of package manifests. Any diff touching `version` fields or `CHANGELOG.md` is a contract violation to be resolved manually (FR-004, D5).
- PR body carries advisory linkage (maps to `linked_findings` in data-model.md).

## 5. Observable consumer surfaces

- **Security tab**: Dependabot alerts (dependency findings) + code scanning alerts (image findings, per-category).
- **Run summaries**: per-PR audit sections; per-release-leg scan tables including explicit clean/failed states.
- **Run artifacts**: `dependency-audit` JSON (CI), per-image SARIF/JSON (release runs).
- **Release assets**: unchanged set (install.sh, compose files, floor templates) — this feature adds nothing to release bodies or assets.
