# Idea Research: Improved Security Posture

- **Slug**: security-posture
- **Created**: 2026-09-03
- **Evidence confidence (overall)**: medium

## Users & Demand

- Mayon's only user is its owner (single-user self-hosted; multi-user explicitly ruled out) — demand for this idea is the owner's own stated want, recorded at intake. — [source: ideas/002-secure-public-launch/decisions.md; owner rulings in project memory] (confidence: high, cited)
- Security-posture work is already an active, resourced effort, not hypothetical demand: ideas/002 reached a verdict 2026-09-01 and the winning in-app password+TOTP auth gate shipped in 0.6.0 (2026-09-03). — [source: ideas/002-secure-public-launch/decisions.md; CHANGELOG.md `## [0.6.0]`] (confidence: high, cited)
- This session runs in a git worktree named `security-scan` — weak contextual signal that the owner already associates this idea with automated scanning specifically. — [source: session environment] (confidence: medium, cited)
- No external user reports, tickets, or telemetry exist for this repo; there is no observed demand beyond the owner. — [source: repo inventory; ASSUMPTION that no off-repo signal exists] (confidence: medium, assumption)

## Prior Art

- **Internal — ideas/002-secure-public-launch** (verdict 2026-09-01): winner Card 001 `password-mfa-gate` (shipped as 0.6.0); Card 002 `proxy-basic-auth` (Caddy floor) = stopgap on-ramp; Card 004 `zero-trust-edge` = standing fallback; Card 005 multi-user rejected. The cards explicitly record failure modes: unguarded endpoints opening the gate silently, missing rate limiting (brute force), and a host-published app port voiding the proxy. — [source: ideas/002-secure-public-launch/decisions.md + cards/] (high, cited)
- **Internal — SECURITY.md exists** (repo root): private disclosure via GitHub security advisories; only the latest release line is supported; documents key storage (browser IndexedDB / OS keychain, never in `settings`). README documents that the default `:8080` publish is plain HTTP with the gate mode-controlled, and positions the Caddy floor as the public-launch stopgap. — [source: SECURITY.md, README.md] (high, cited)
- **External — dependency automation:** Dependabot provides zero-config, GitHub-native vulnerability alerts plus automated security-update PRs; a widely recommended pattern is Dependabot for security alerts + Renovate for regular version updates. Mayon has neither configured. — [source: search snippets, see Sources] (medium, cited)
- **External — container scanning:** Trivy (OSS) scans container images, IaC, secrets, and SBOMs; `trivy-action` plugs into GitHub Actions with SARIF upload to the Security tab and severity gates (fail on CRITICAL/HIGH) — a drop-in automatable path for mayon's two GHCR images built in `docker-publish.yml`. — [source: github.com/aquasecurity/trivy and trivy-action snippets] (medium, cited)
- **External — installer pattern:** `curl | bash` installers without checksum/signature verification are a recognized supply-chain weakness, and real projects receive security issues filed about exactly this pattern (rtk-ai/rtk#1158, anomalyco/opencode#29923). Mayon's `install.sh` is this pattern today (no checksum, no signature, plain HTTPS as only trust). — [source: security.stackexchange.com snippet; github.com issue snippets] (medium, cited)

## Market & Context

- Default deployment today: plain HTTP on host `:8080`, and the auth gate is mode-controlled (`security.mode` = `open` disables all auth). TLS exists only via the opt-in Caddy floor templates. Cost of doing nothing: the 0.6.0 gate's value can be silently voided by defaults (`open` mode, floor never enabled). — [source: README.md, docs/dev/seams.qmd, docker-compose.yml, server/src/auth/gate.ts] (high, cited)
- Zero-cost automation levers that are table stakes for GitHub projects are all absent here: no dependabot.yml, no renovate, no CodeQL/code-scanning, no `pnpm audit` in CI, no image scanning, no digest pinning, no installer checksums. The repo is **public**, so GitHub-native Dependabot alerts, secret scanning/push protection, and CodeQL are available free. — [source: repo inventory absences; `gh repo view` = PUBLIC] (high, cited)
- The flip side of automation is triage: scanners generate alert noise a solo maintainer must process, and running Dependabot+Renovate together is noted to double PR noise. — [source: search snippets; ASSUMPTION on maintainer capacity] (medium, mixed)

## Data & Constraints

- Toolchain: pnpm 10.15.0 pinned, Node >=22, `pnpm-lock.yaml` present (so `pnpm audit` works); CI installs `--frozen-lockfile`; `pnpm.onlyBuiltDependencies` already restricts postinstall scripts to 3 packages. — [source: package.json, .github/actions/ci/action.yml] (high, cited)
- Deployment surface: only web publishes to host (`${MAYON_PORT:-8080}`); server/db internal-only. Hardening gaps in the shipped deployment: `${POSTGRES_PASSWORD:-mayon}` insecure fallback with plaintext compose env, no compose hardening keys (`user:`/`read_only:`/`cap_drop:`/`security_opt:`) anywhere, server container runs as root (no `USER` in `server/Dockerfile`). — [source: docker-compose.yml, server/Dockerfile] (high, cited)
- Supply-chain facts: base images (`node:22-alpine`, `nginx:alpine`, `caddy:2`, `postgres:17-alpine`), published GHCR images, and consumer defaults (`${MAYON_VERSION:-latest}`) all float on tags — no digest pinning; third-party Actions pinned to major tags, not SHAs; `install.sh` verifies no checksums/signatures on downloaded artifacts. — [source: Dockerfile, server/Dockerfile, docker-publish.yml, install.sh] (high, cited)
- Auth implementation (0.6.0): global `onRequest` gate, argon2id + AES-256-GCM-wrapped TOTP, httpOnly/sameSite/secure cookies with same-day expiry, exponential rate-limit ladder with lockout, origin-check CSRF, fail-closed boot, recovery CLI. Authorization is binary at the gate (session-or-none); sensitive endpoints (`/api/db/query` arbitrary SQL, `/api/llm/proxy`, `/api/backup/*` up to 512MB, `/api/import/sqlite`, `/ws/mcp`) have no per-endpoint RBAC. — [source: server/src/auth/*, docs/dev/seams.qmd] (high, cited)
- Owner constraint rulings that bind any security work: no multi-user accounts; security setup prompt optional/skippable; same-day session lifetime. — [source: ideas/002 decisions; project rulings] (high, cited)

## Evidence Against the Idea

- The "without impacting features" clause collides with the strongest remaining levers: mandatory `locked` mode, forced security setup, TLS-by-default, or removing the `POSTGRES_PASSWORD:-mayon` fallback are precisely the friction the owner has ruled against before (skippable setup, convenience-first auth). The realistic scope may shrink to CI/supply-chain automation only. — [source: ideas/002 decisions; owner rulings] (high, cited)
- The auth gate shipped literally today (0.6.0, 2026-09-03); layering more security work before collecting real-world feedback risks building on unproven ground — ideas/002's own plan calls for proving Card 001 before removing the floor. — [source: CHANGELOG 0.6.0; decisions.md] (medium, cited)
- "Ideally automatable" still implies a permanent triage burden; for a solo hobby project, scanning noise can cost more than the risk it retires, and Dependabot-style PR floods are a documented downside. — [source: search snippets; ASSUMPTION on maintainer capacity] (medium, mixed)
- Deployment-model exposures (`:latest` default, floating base tags, unverified installer, root server container) are choices embedded in the product's distribution; "fixing" them changes upgrade/install behavior for existing users, which may count as feature impact. — [source: install.sh, docker-compose.yml inventory; ASSUMPTION on what counts as feature impact] (medium, mixed)

## Gaps & Open Questions

- [NEEDS CLARIFICATION: threat model — is Mayon intended to be internet-facing post-launch, or LAN/trusted-network only? ideas/002 implies public launch, but this idea's scope vs that effort is unstated]
- [NEEDS CLARIFICATION: what "no feature/performance impact" is measured against — CI duration, image size, runtime latency, or the owner's UX-friction rulings]
- [NEEDS CLARIFICATION: scope boundary — CI/supply-chain automation only (audit, scanning, pinning, checksums), or also deployment hardening (compose keys, root container, DB password fallback, default TLS)]
- [NEEDS CLARIFICATION: appetite for gating — should scanner findings fail CI/release, or report-only?]
- [NEEDS CLARIFICATION: whether the Caddy floor is considered "done" for TLS or TLS should become default behavior]

## Sources

Internal (local repo, read-only; policy: repo inventory): `.github/workflows/{ci,docker-publish,deploy-pages}.yml`, `.github/actions/ci/action.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, `Dockerfile`, `server/Dockerfile`, `install.sh`, `SECURITY.md`, `README.md`, `docs/dev/seams.qmd`, `docs/dev/architecture.qmd`, `CHANGELOG.md`, `ideas/002-secure-public-launch/decisions.md` + `cards/`, `server/src/auth/*`, `package.json`, `pnpm-lock.yaml`; repo visibility via `gh repo view` (host: api.github.com, policy: allowlisted, confirmed PUBLIC).

External — evidence taken from search-result snippets only; **no page fetches were performed**, so no URL Trust Policy fetch branch applies:

- https://appsecsanta.com/sca-tools/dependabot-vs-renovate (host: appsecsanta.com, policy: search-snippet, not fetched)
- https://vulert.com/blog/renovate-vs-dependabot/ (host: vulert.com, policy: search-snippet, not fetched)
- https://devopsboys.com/blog/renovate-vs-dependabot-dependency-updates-2026 (host: devopsboys.com, policy: search-snippet, not fetched)
- https://blog.pullnotifier.com/blog/dependabot-vs-renovate-dependency-update-tools (host: blog.pullnotifier.com, policy: search-snippet, not fetched)
- https://github.com/aquasecurity/trivy (host: github.com, policy: search-snippet, not fetched; host allowlisted)
- https://github.com/aquasecurity/trivy-action (host: github.com, policy: search-snippet, not fetched; host allowlisted)
- https://security.stackexchange.com/questions/213401/is-curl-something-sudo-bash-a-reasonably-safe-installation-method (host: security.stackexchange.com, policy: search-snippet, not fetched; host allowlisted)
- https://github.com/rtk-ai/rtk/issues/1158 (host: github.com, policy: search-snippet, not fetched; host allowlisted)
- https://github.com/anomalyco/opencode/issues/29923 (host: github.com, policy: search-snippet, not fetched; host allowlisted)
- https://tferdinand.net/en/why-curl-bash-is-a-dangerous-bad-habit/ (host: tferdinand.net, policy: search-snippet, not fetched)
