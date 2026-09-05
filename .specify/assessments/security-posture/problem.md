# Problem Definition: Improved Security Posture

- **Slug**: security-posture
- **Created**: 2026-09-03
- **Inputs used**: intake.md | research.md

## Problem Statement

Mayon's security posture is maintained by hand and by memory: nothing automatically tells the owner when dependencies, container images, release artifacts, or deployment defaults have become vulnerable or weaker than intended, and several shipped defaults (plain-HTTP publish, gate-open mode, root server container, defaultable database password, unverified installer downloads) can silently sit below the posture the 0.6.0 auth gate implies. As the app moves toward public launch, the owner carries all of this risk personally, and the idea's own constraint demands any improvement leave existing features and performance untouched.

## Affected Users & Stakeholders

- **Users**: the owner-operator (the app's only user — single-user self-hosting, multi-user ruled out) — installs and operates the app via Docker Compose and bears the full exposure risk of undetected security degradation; also explicitly wants a friction-free experience, which bounds what "fixing" this may cost. — [source: ideas/002-secure-public-launch/decisions.md; research.md Users & Demand]
- **Stakeholders**: the owner as sole maintainer — decides scope and pays any ongoing triage cost of added detection; solo-maintainer alert noise is a documented downside to weigh. — [source: research.md Market & Context]
- **Stakeholders**: future installers of the public one-line install (none exist yet) — would inherit whatever posture ships, including installer/deployment weaknesses; repo is public, so posture is externally visible to anyone evaluating the project. — [source: research.md; install.sh; `gh repo view` PUBLIC] [NEEDS CLARIFICATION: whether external installers are an expected audience at all]

## Goals

- The owner learns of security degradation — vulnerable dependencies, vulnerable base/release images, supply-chain weaknesses — without having to remember to check. Detection latency drops from "whenever someone audits" to automated. (baseline: no detection exists)
- The shipped artifact inherits the posture improvements, not just the development repo — what a fresh install gets must be covered, since installers, not developers, are the exposure surface. (baseline: improvements exist only as findings in this assessment)
- Ongoing posture maintenance requires minimal recurring manual effort; residual work is limited to reviewing findings, not operating the process. (baseline: zero process, all manual)
- No existing feature regresses and no measurable runtime performance degrades as a result of the improvements; install/upgrade steps and the skippable-setup ruling stay intact. (baseline: current 0.6.0 behavior; qualitative until [NEEDS CLARIFICATION: measurement definition])

## Non-Goals

- Multi-user accounts, multi-tenant isolation, or per-user identity models — ruled out by owner decision. — [source: ideas/002 decisions; owner rulings]
- Revisiting or redesigning the 0.6.0 auth gate itself (argon2/TOTP/sessions/rate limiting) — just shipped; its proof period is standing, and ideas/002 plans floor removal only after it is proven.
- Building the `zero-trust-edge` fallback (Card 004) — it remains a standing fallback, not part of this problem.
- Patching specific known vulnerabilities — this problem is about continuous detection and posture, not any one CVE.
- Changing the owner's friction rulings (skippable security setup, same-day sessions, no re-login within a day) to buy security.

## Success Metrics

- Time-to-detection for a known-vulnerable dependency introduced into the lockfile: automated discovery without human action, within one scan cadence cycle (e.g. ≤7 days). (baseline: infinite/unknown — nothing detects this today)
- Every release pipeline run reports dependency and container-image scan status for both published images. (baseline: zero scans on zero runs)
- Runtime performance: no measurable regression from app start to steady-state interaction versus 0.6.0. (baseline: 0.6.0 numbers; qualitative/relative until [NEEDS CLARIFICATION: which measurements count])
- User-facing friction delta: zero new required prompts and an unchanged one-line install. (baseline: current install/setup flow; qualitative)
- Posture visibility: the owner can enumerate current gaps from continuously produced output rather than from a one-off audit like the research stage. (baseline: gaps known only from this assessment; qualitative)

## Cost of Inaction

Vulnerable dependencies and base images accumulate undetected — every added dependency widens the invisible attack surface. The documented supply-chain and deployment weaknesses (unverified installer downloads, floating `:latest` tags, root server container, defaultable database password, gate-open availability on a host-published port) persist for every current and future install, and a public launch multiplies exposure while detection capability stays at zero. The 0.6.0 gate's promise can be silently voided by weaker defaults, and the owner's only compensating control remains remembering to check by hand.

## Open Questions

- [NEEDS CLARIFICATION: threat model — is Mayon intended to be internet-facing post-launch, or LAN/trusted-network only?]
- [NEEDS CLARIFICATION: what "no feature/performance impact" is measured against — CI duration, image size, runtime latency, or the owner's UX-friction rulings]
- [NEEDS CLARIFICATION: scope boundary — CI/supply-chain detection only, or also deployment-hardening posture (compose defaults, root container, installer verification, TLS default)]
- [NEEDS CLARIFICATION: gating appetite — should detected findings block CI/releases, or report-only to avoid breaking the release flow?]
- [NEEDS CLARIFICATION: is the Caddy floor considered "done" for TLS, or should TLS become default behavior?]
- [NEEDS CLARIFICATION: whether external installers are an expected audience, which would raise the stakes for shipped-artifact posture]
