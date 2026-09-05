# Validation Log: Security Posture Detection

**Feature**: `019-security-posture-detection` | **Implemented**: 2026-09-03 | **Branch**: `security-scan` (worktree)

Outcomes of every `quickstart.md` scenario as executed during implementation. Deferred items are listed explicitly.

## Scenario 1 — Detection enabled and live — ✅ PASS

- `PUT /vulnerability-alerts` → ok; `GET` → 204 (alerts on).
- `security_and_analysis.dependabot_security_updates.status` → `enabled`.
- Security tab confirmed live by GitHub's own push banner during later tests: *"GitHub found 40 vulnerabilities on bendlikeabamboo/mayon's default branch (18 high, 18 moderate, 4 low)"* — Dependabot analyzed the default branch shortly after enablement (the alerts API read `0` in the first minutes; 40 by end of session — enablement propagation, not a fault).
- No `.github/dependabot.yml` exists (D1 respected).

## Scenario 2 — Dependency audit parity — ✅ PASS

- Local rehearsal across all three roots produced JSON reports; root alone: **41 vulnerabilities (4 low / 17 moderate / 20 high)**; `server` and `packages/shared` also report findings.
- FINDINGS branch of the CI step exercised locally (JSON present + non-zero exit) — the always-green summary/artifact behavior matches contracts §2.

## Scenario 3 — Image scan rehearsal — ✅ PASS (step 3 deferred)

- Web image built and scanned: **clean** (0 HIGH/CRITICAL; alpine 3.24.1 base).
- Server image built (repo-root context, as CI does) and scanned: **real findings, including CRITICAL tar CVE-2026-59873 and HIGH CVE-2026-59874** plus multiple HIGH CVEs — proving the report-only surface has genuine signal to show.
- **Deferred**: observing the actual release run (two legs' summaries, SARIF categories, unchanged assets list) — happens at the next tag/RC push.

## Scenario 4 — Push protection & false-positive escape — ❌ FAILED VERIFICATION

- Vector 1 (bare AWS docs example secret): **not blocked**.
- Vector 2 (AWS docs example key pair `AKIAIOSFODNN7EXAMPLE` + secret): **not blocked** (docs examples are pattern-allowlisted — expected).
- Vector 3 (synthetic random `AKIA…` 16-char ID + 40-char secret — no real credential): **not blocked**, and `GET /secret-scanning/alerts` returned **0** — post-push scanning did not flag it either.
- Settings report `secret_scanning.enabled: enabled` and `secret_scanning_push_protection.enabled: enabled` throughout.
- **Cleanup**: all three throwaway branches deleted from `origin`; test files removed; synthetic credentials never real, no longer present remotely.
- **Interpretation / follow-up (needs a decision, out of this feature's scope)**: push protection is settings-enabled but not enforcing for the AWS partner pattern in this repo (personal-account public repo). Options: (a) re-test later in case of propagation lag, (b) raise with GitHub support/discussions, (c) compensating CI-side secret scanning (e.g. gitleaks job in `ci.yml`) — a scope change that should go back through the assessment pipeline, not be slipped in here.

### Re-test 2026-09-05 (two days later — propagation lag ruled out)

- Settings unchanged (`secret_scanning` + `push_protection` enabled; non-provider patterns + validity checks off).
- Fresh synthetic `AKIA…` ID + 40-char secret pair pushed on a throwaway branch: **not blocked** (push exit 0).
- **0 secret-scanning alerts after ~10 minutes** — for a repo this size the documented expectation is "within minutes" (GHAS 101; docs' detection-scope page confirms paired credentials alert when both parts share a file, which our vector satisfied). The immediate-check caveat from 2026-09-03 is eliminated.
- The docs-example pair being permitted is consistent with GitHub's allowlist; the random pair failing **both** block and alert means AWS partner-pattern detection is not engaging on this repo at all, despite settings reporting enabled — narrowed to a platform-side fault or a personal-account coverage difference (not verifiable from outside).
- Cleanup: throwaway branch deleted from origin, test file removed; synthetic credential never real, no longer present remotely.
- **Standing follow-up options**: (a) repeat once in an org-owned scratch repo to isolate the personal-account factor, (b) GitHub support with this log, (c) compensating CI-side scanner via the assessment pipeline, (d) accept a degraded US3 and record it at decide time.
- **Owner decision 2026-09-05: option (d)** — degraded US3 accepted for this spec; owner will create a follow-up story for the push-protection enforcement gap. FR-005/FR-006 remain recorded as unmet by platform; SC-003 is not met.

## Scenario 5 — Update-proposal contract check — ⏳ DEFERRED (event-driven)

- No Dependabot security-update PR exists yet (alerts went live during this session). Check `gh pr diff <n> --name-only` on the first PR; contract violation = any diff touching `CHANGELOG.md` or `version` fields (tasks.md T017).

## Scenario 6 — Zero user-facing change — ✅ PASS (assets parity deferred)

- `git diff main --stat`: only `.github/workflows/ci.yml` (+44) and `.github/workflows/docker-publish.yml` (+65); untracked additions confined to `specs/019-security-posture-detection/` and `.specify/assessments/`. The `ideas/diataxis-docs.md` delta is pre-existing committed state on this branch, untouched by the feature.
- Quality gates all green: `pnpm install --frozen-lockfile` → `@mayon/shared build` → `svelte-kit sync` → `pnpm check` **0 errors / 0 warnings** → `pnpm lint` pass → `pnpm test` **117 files / 1804 tests passed**.
- Images' build inputs unchanged → runtime parity by construction (constitution's measured-claims rule satisfied per plan.md Constitution Check).
- **Deferred**: release-assets list parity — verify on the next release (must remain the same four files).

## Gate status at completion

| Gate | Result |
|------|--------|
| `pnpm check` | 0 errors, 0 warnings |
| `pnpm lint` | pass (ESLint + Prettier) |
| `pnpm test` | 117 files / 1804 tests passed |
| Confinement | only `.github/` modified |
| Settings (US1) | alerts on, security updates on |
| Scans (US2) | YAML valid; rehearsal clean |
| Push protection (US3) | **not enforced — degraded US3 accepted by owner 2026-09-05; follow-up story planned** |
