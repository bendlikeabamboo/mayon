# Quickstart: Security Posture Detection

**Feature**: `019-security-posture-detection` | **Date**: 2026-09-03

End-to-end validation that detection exists, is report-only, and changed nothing user-facing. Implementation code lives in `tasks.md`; contracts referenced here are in [contracts/platform-integration.md](./contracts/platform-integration.md).

## Prerequisites

- `gh` authenticated with repo admin on `bendlikeabamboo/mayon` (settings changes).
- Docker or Podman available locally (image-scan rehearsal).
- pnpm 10 installed (`corepack`-pinned by the repo).
- Working directory: repo root.

## Scenario 1 — Detection enabled and live (FR-001/002, SC-001)

1. Enable the two disabled settings (one-time):
   ```bash
   gh api -X PUT repos/bendlikeabamboo/mayon/vulnerability-alerts
   gh api -X PATCH repos/bendlikeabamboo/mayon \
     -F security_and_analysis[dependabot_security_updates][status]=enabled
   ```
2. Verify:
   ```bash
   gh api repos/bendlikeabamboo/mayon/vulnerability-alerts            # expect 204
   gh api repos/bendlikeabamboo/mayon --jq '.security_and_analysis'   # alerts context
   ```
   **Expected**: vulnerability alerts `204`; `dependabot_security_updates.status: enabled`; `secret_scanning` and `secret_scanning_push_protection` both `enabled`.
3. Open the repo's Security tab. **Expected**: a Dependabot alerts section exists (initially it may list findings for the current lockfiles — that is the first-run baseline from research.md; triage is review-only).

## Scenario 2 — Dependency audit parity (FR-002/FR-009, D2)

1. Rehearse locally what CI reports:
   ```bash
   pnpm audit --json > /tmp/audit-root.json; echo "exit=$?"
   ( cd server && pnpm audit --json > /tmp/audit-server.json; echo "exit=$?" )
   ( cd packages/shared && pnpm audit --json > /tmp/audit-shared.json; echo "exit=$?" )
   ```
   **Expected**: valid JSON per root regardless of findings; a non-zero exit on findings is acceptable locally because CI must swallow it (report-only).
2. After implementation, run CI on a PR. **Expected**: the audit job is green even with findings; its summary shows one section per manifest root; the JSON artifact is downloadable.

## Scenario 3 — Image scan rehearsal (FR-007, D3/D7)

1. Build both images locally:
   ```bash
   docker build -t mayon-web:local .
   docker build -t mayon-server:local server/
   ```
2. Scan with Trivy (same engine the pipeline uses):
   ```bash
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy image --severity HIGH,CRITICAL mayon-web:local
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy image --severity HIGH,CRITICAL mayon-server:local
   ```
   **Expected**: a findings table (or empty result) per image — never a hard requirement to be clean.
3. On the next real tag run: **Expected** — the release completes regardless of findings; each `build-and-push` leg's summary shows its scan table with an explicit `clean`/`findings`/`scan-failed` state; two SARIF categories appear under Code scanning; the release assets list is unchanged (no new files).

## Scenario 4 — Push protection & false-positive escape (FR-005/FR-006)

1. On a throwaway branch, add the AWS documentation example key:
   ```bash
   git checkout -b push-protection-test
   printf 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n' > /tmp/test.txt
   git add /tmp/test.txt 2>/dev/null || git add -f /tmp/test.txt 2>/dev/null || (mv /tmp/test.txt . && git add test.txt)
   git commit -m "push protection test"
   git push -u origin push-protection-test
   ```
   **Expected**: push is **blocked** before remote storage, with the triggering content and secret location named.
2. Test the allow path via the push-protection prompt (or delete the content). Then clean up: `git checkout main && git branch -D push-protection-test && git push origin --delete push-protection-test`.

## Scenario 5 — Update-proposal contract check (FR-004, D5)

When the first Dependabot security PR appears:

```bash
gh pr diff <number> --name-only
```

**Expected**: only package manifests (dependency sections). Any `CHANGELOG.md` or `version`-field diff is a contract violation — resolve manually, do not merge as-is.

## Scenario 6 — Zero user-facing change (FR-011/FR-012, SC-004)

1. `git diff <base> --stat` — **Expected**: changes confined to `.github/` (plus this spec tree). No `src/`, `server/src/`, `docker-compose.yml`, `install.sh`, or release-asset inputs touched.
2. Release-asset parity: compare the release-assets list of the next release with the previous release — **Expected**: identical file set.
3. Runtime parity: the built images' inputs are unchanged, so installed behavior is identical; app boots and the existing test suites pass (`pnpm test`). No perf-probe run is required because no runtime code changed — this satisfies the constitution's measured-claims rule by construction (artifact inputs identical), noted in plan.md's Constitution Check.
