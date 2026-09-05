# Decision: Improved Security Posture

- **Slug**: security-posture
- **Decided**: 2026-09-03
- **Verdict**: go
- **Artifacts reviewed**: intake.md | research.md | problem.md | concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | strong | Real, owner-confirmed problem: posture detection is entirely manual today, and the public launch + just-shipped 0.6.0 gate make the gap between intended and shipped posture consequential (problem.md; research.md). |
| Evidence strength | adequate | Load-bearing facts are first-party verified (repo inventory of absences, PUBLIC repo via `gh`, installer/compose contents, 0.6.0 changelog); external prior art is cited but snippet-level, and demand is owner-stated only (no external users exist — a structural property of a single-user app, not a missing measurement). |
| Value vs. inaction | strong | Cost of inaction is concrete and compounding (undetected CVE accumulation, unverified installer, weak defaults live in every install) while the recommended fix is days-cheap and reversible — value clearly dominates. |
| Feasibility / appetite fit | strong | Option B is `small` (days), uses free levers verified available (public repo, pnpm lockfile present, existing release pipeline to attach reporting to), with zero runtime impact by construction. |
| Strategic fit | strong | Directly extends the ideas/002 secure-public-launch trajectory and the owner's own framing ("ideally automatable, no feature/performance impact"); respects all standing rulings (no multi-user, skippable setup, same-day sessions) as non-goals. |
| Risk posture | adequate | Key risks identified and bounded by design (report-only avoids release breakage; reversible; degrades gracefully if alert noise is heavy), but mitigations are not yet proven: the update-PR × release-contract interaction and alert-triage burden are assumptions explicitly queued for validation during specification. |

## Verdict & Rationale

**Go** on Option B (zero-config detection, report-only). The scorecard clears the bar: problem validity strong, evidence adequate — the decisive facts are directly verified from the repository itself, not assumption — and a recommended concept exists. Option A would leave detection at infinite latency across a public launch, which the cost of inaction argues against; Option C is the right destination eventually but currently violates the problem's own no-feature-impact constraint and builds on a gate shipped the same day this assessment ran. Acknowledged unknowns that do **not** block a go but must be validated in specification: Dependabot-style update PRs versus the CI-enforced three-`package.json` release contract, `pnpm audit` compatibility with the pnpm 10 lockfile in CI, and the owner's real appetite for triaging alerts. If validation during specification fails any of these, the verdict should be revisited rather than the design bent around it.

## If go — Handoff to `/speckit.specify`

- **Problem**: Mayon's security posture is maintained by hand and memory — nothing automatically detects vulnerable dependencies, images, or supply-chain weaknesses, and the owner wants that fixed with zero feature/performance impact.
- **Chosen approach**: Option B — zero-config detection, report-only: GitHub-native dependency alerts + security-update PRs and secret scanning/push protection (free, repo is PUBLIC), plus release-pipeline scan reporting (dependency audit + container-image scan of both published images) that records and surfaces findings without gating.
- **In scope / out of scope**: In — detection and reporting, upstream of the artifact, report-only. Out — all shipped-artifact hardening (digest pinning, installer checksums, non-root containers, compose hardening keys, DB password fallback removal, TLS defaults/floor promotion), gating CI/releases on findings, auth-gate redesign, multi-user, zero-trust-edge, specific-CVE patching, anything running at app runtime.
- **Success metrics**: automated discovery of a known-vulnerable dependency within ~7 days; every release run reports dependency + image scan status; zero measurable runtime regression vs 0.6.0; zero new required prompts and unchanged one-line install; posture gaps enumerable from continuous output instead of one-off audits (last two qualitative).
- **Carried-forward open questions**: threat model (internet-facing vs LAN); what "no feature/performance impact" is measured against; whether the Caddy floor counts as "done" for TLS; whether external installers are an expected audience; plus assumptions to validate — update-automation PRs coexisting with the release contract, `pnpm audit` × pnpm 10 lockfile in CI, acceptable CI minutes added, and the owner actually triaging alerts.
