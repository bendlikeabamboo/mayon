# Concept: Improved Security Posture

- **Slug**: security-posture
- **Created**: 2026-09-03
- **Recommended option**: B — Zero-config detection, report-only

## Options

### Option A — Do nothing (wait and watch)
- **Sketch**: Build nothing now. Let 0.6.0 soak, collect post-launch feedback, and rely on manual audits if concern arises; revisit this assessment after the auth gate is proven and the floor is retired. The problem statement and cost of inaction stand as recorded.
- **Appetite**: small (no build effort; the cost is carried by the risk, not the calendar)
- **Trade-offs**: Wins: zero effort, zero new alert noise, zero risk of violating the "no feature/performance impact" clause, full respect for the "prove Card 001 first" sequencing. Sacrifices: detection latency stays infinite — every goal in problem.md goes unmet, and a public launch happens with the owner's only control being memory. Risks: a vulnerable dependency or image ships silently; the documented deployment weaknesses persist for every install.
- **Rabbit holes**: None of its own — the rabbit hole is complacency: "wait for soak" can silently become "never."

### Option B — Zero-config detection, report-only
- **Sketch**: The owner starts hearing about security degradation instead of having to ask. GitHub-native features (free, because the repo is public) are switched on at the repo-settings level: dependency vulnerability alerts with automated security-update PRs, and secret scanning with push protection. The release pipeline additionally produces a scan summary — dependency audit plus container-image scan of both published images — that is recorded and visible but blocks nothing. What the user experiences: nothing; installs, upgrades, runtime, and features are untouched, since everything runs in repo tooling upstream of the artifact.
- **Appetite**: small (days)
- **Trade-offs**: Wins: detection latency drops from infinite to a weekly-ish cadence plus per-release visibility (goals 1, 2, 4 of problem.md met directly; goal 3 largely — ongoing effort is reading alerts, not operating tooling); zero user-facing friction; zero runtime impact; fully reversible. Sacrifices: does nothing about the shipped-artifact weaknesses (installer verification, floating tags, root container, DB password fallback, TLS defaults) — detection of weakness is not remediation of it; alert noise may still tax the solo maintainer; report-only means findings can be ignored. Risks: update PRs could interact awkwardly with the CI-enforced release contract (three package.json versions + CHANGELOG must move together); audit tooling may report unfixable transitive findings, creating noise with no action.
- **Rabbit holes**: Alert-triage workflow creep (dashboards, issue automation); tuning scanner severity thresholds to silence noise; being tempted to "fix" every reported finding immediately instead of triaging; scope pressure to add gating once scans exist.

### Option C — Full posture program (detect + harden the shipped artifact)
- **Sketch**: Everything in Option B, plus the shipped deployment is hardened as part of the product: base images and release images pinned to digests, installer downloads verified against published checksums, server container runs non-root with dropped capabilities, the defaultable database password fallback removed, and scanner findings at CRITICAL/HIGH gate the release pipeline. TLS defaults or a promoted (non-"stopgap") floor complete the story. What the user experiences: a stricter but slightly less forgiving install/upgrade path — pinning and checksums change upgrade mechanics, and hardening changes container behavior.
- **Appetite**: medium (weeks), with genuine uncertainty — the container-hardening portion has unbounded tail risk
- **Trade-offs**: Wins: directly retires nearly the entire cost-of-inaction list; the shipped artifact inherits the posture (goal 2 fully); detection plus enforcement. Sacrifices: collides with the problem's own constraint — changed upgrade/install mechanics and stricter defaults are exactly the "feature impact" the intake excludes, and several pieces brush against owner friction rulings (defaults doing more, not less); weeks of work on a solo project that just shipped a major auth change; hardening changes risk breaking real deployments (volume permissions under non-root, upgrade paths for existing installs). Risks: digest pinning turns "pull latest patch" into manual work; non-root server may conflict with volume ownership; TLS-by-default without a domain is a UX hole; gating on scanner output can block releases on unfixable findings.
- **Rabbit holes**: Non-root server + named-volume permission debugging; installer backward compatibility across engines (docker/podman); TLS defaults without a domain (self-signed warnings, ACME prerequisites); scanner-gate false-positive firefighting at release time; scope creep toward the `zero-trust-edge` card (explicit non-goal).

## Recommendation

**Option B.** The problem's binding constraints — zero feature impact, zero friction, solo-maintainer capacity, and a just-shipped auth gate that needs soak time — are all satisfied by detection-only automation and violated (or strained) by hardening. B converts the problem's core hurt (detection latency: infinite) into a bounded, measurable signal (weekly cadence + per-release reporting) in days, at zero runtime cost, using levers the evidence shows are free for a public repo. C is the honest destination eventually, but doing it now means building on unproven ground — the research itself flagged that the gate shipped today. A is defensible on sequencing grounds alone, but it leaves detection at zero across a public launch, which the cost of inaction says is the one outcome the owner should not accept. If even B's alert noise proves too heavy, it degrades gracefully (alerts can be narrowed) without unwinding anything.

## Out of Scope (for the recommended option)

- All shipped-artifact hardening: digest pinning, installer checksum verification, non-root/capability-hardened containers, compose hardening keys, removal of the `POSTGRES_PASSWORD:-mayon` fallback, TLS defaults or floor promotion (inherited non-goals + newly excluded for B).
- Gating CI or releases on scan findings — B is report-only by design; making findings blocking is a deliberate later decision, not part of B.
- Redesigning the 0.6.0 auth gate; multi-user anything; building `zero-trust-edge`; patching specific CVEs as a project.
- Any runtime component inside the app — detection lives entirely in repo tooling.

## Assumptions to Validate

- The project remains on GitHub with Actions; native alerts/scanning stay free for public repos (verified public today).
- A weekly-ish alert cadence genuinely satisfies "learn without remembering" for the owner.
- Update-automation PRs can coexist with the CI release contract (three package.json versions + CHANGELOG moving together) — validate interaction during specification.
- Dependency audit tooling works correctly against the pnpm 10 lockfile in CI.
- Report-only scans add acceptable minutes to the release workflow's budget.
- The owner will actually triage incoming alerts (the human-in-the-loop assumption that makes report-only viable).
- No runtime performance impact holds because detection runs entirely off the app's execution path.
