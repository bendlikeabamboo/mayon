# Feature Specification: Security Posture Detection

**Feature Branch**: `019-security-posture-detection`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: assessment handoff `.specify/assessments/security-posture/decision.md` — verdict **go** on "Option B — Zero-config detection, report-only": Mayon's security posture is maintained by hand and memory; this feature makes the project automatically tell the maintainer when dependencies, release artifacts, or committed content introduce known weaknesses, with zero impact on features, performance, or the install experience.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintainer learns of a vulnerable dependency without checking (Priority: P1)

A dependency in the project's dependency manifests has (or acquires) a known published vulnerability. Within one weekly cycle — with no one running a scan, audit, or check — the maintainer is notified which dependency is affected, how severe the vulnerability is, and, when a fixed version exists, is handed a prepared update proposal ready for review. When no fix exists yet, the maintainer is still told, so the risk is known rather than invisible.

**Why this priority**: This is the core hurt from the assessment: detection latency is currently infinite (only manual audits surface vulnerabilities). Every other goal in the problem definition depends on this signal existing.

**Independent Test**: Introduce a dependency with a known published vulnerability into the manifests; within one weekly cycle a notification identifying dependency, vulnerability, and severity appears without any human action, and delivers the value "the maintainer now knows".

**Acceptance Scenarios**:

1. **Given** a dependency with a known published vulnerability in the project's manifests, **When** one weekly cycle elapses, **Then** the maintainer has received a notification identifying the dependency, the vulnerability, and its severity, without anyone triggering a scan.
2. **Given** a notified vulnerability for which a fixed version exists, **When** the maintainer opens the notification, **Then** a proposed update ready for review accompanies it.
3. **Given** a notified vulnerability for which no fixed version exists, **When** the notification arrives, **Then** the notification is still delivered, marked as having no available fix.

---

### User Story 2 - Every published release carries a security assessment record (Priority: P2)

Each time a release is published, both shipped application artifacts — the browser client bundle and the server application — are automatically assessed for known vulnerabilities, and the resulting record (findings with severities, or an explicit clean result) is stored and viewable afterward. The maintainer never runs a manual scan, and the release itself always completes regardless of what the record says.

**Why this priority**: The assessment showed installers inherit whatever ships. Detection at the source (Story 1) is not enough; the shipped artifact — what users actually install — needs its own visible, per-release posture record.

**Independent Test**: Publish any release; afterward a viewable assessment record covering both shipped artifacts exists for that release, and the release succeeded whether or not findings were present.

**Acceptance Scenarios**:

1. **Given** a release is published, **When** the release pipeline finishes, **Then** an assessment record exists for that release covering both shipped artifacts, listing any identified known vulnerabilities with severities.
2. **Given** a release whose assessment identifies critical findings, **When** the release publishes, **Then** the release still completes, and the findings are visible in the record (report-only: findings never block a release).
3. **Given** a release with no identified findings, **When** the release publishes, **Then** the record exists and explicitly states a clean result — absence of findings is recorded, never silence.

---

### User Story 3 - Credentials are stopped before they land (Priority: P3)

When committed content resembles a credential or secret, the push is prevented before anything is stored remotely, and the author is told what triggered the block. When the maintainer judges a block to be a false positive, they can allow the content through deliberately.

**Why this priority**: Cheaply prevents an entire class of posture damage (committed secrets are costly to retract and are a standing weakness noted in the project's own security policy). It is third because it guards the development pipeline rather than the shipped product, and misfires have an escape hatch.

**Independent Test**: Attempt to push content resembling a live credential; the push is prevented before remote storage with an informative message, and a designated maintainer can subsequently allow it through if it is a false positive.

**Acceptance Scenarios**:

1. **Given** committed content resembling a live credential, **When** a push is attempted, **Then** the push is prevented before anything is stored remotely and the author sees which content triggered the block.
2. **Given** a blocked push the maintainer determines is a false positive, **When** the maintainer marks the content as allowed, **Then** the push can proceed and the same content does not re-block future pushes.

---

### Edge Cases

- What happens when the assessment capability is unreachable at release time? The release still publishes (report-only), and the missing assessment must itself be visible as a gap — a release must never look "clean" because its scan silently didn't happen.
- What happens when a vulnerable dependency has no fixed version? The notification is delivered without an update proposal and remains attention-worthy until the vulnerability is fixed or the dependency is replaced.
- What happens when an automated update proposal would conflict with the project's release bookkeeping (per-package version stamps and the change-log record)? The conflict must be surfaced for manual resolution; proposals must never silently corrupt release records.
- What happens when multiple vulnerabilities affect the same dependency? Findings consolidate into one notification per dependency (each with its own severity) rather than an alert storm.
- What happens when a legitimate file trips the credential detector? The maintainer allows it once and the allow survives future pushes of the same content.
- What happens after a merged update fixes a previously reported vulnerability? The outstanding notification resolves without manual cleanup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST notify the maintainer automatically when a dependency in the project's dependency manifests has a known published vulnerability, within one weekly cycle of that vulnerability becoming known — without anyone triggering a scan.
- **FR-002**: Each vulnerability notification MUST identify the affected dependency, the vulnerability, and its severity, and indicate whether a fixed version exists.
- **FR-003**: Where a fixed version exists, the system MUST prepare a proposed dependency update ready for human review.
- **FR-004**: Automated update proposals MUST NOT bypass or corrupt the project's release bookkeeping (version stamps across the project's package manifests and its change-log record); any conflict MUST be surfaced for manual resolution rather than silently resolved.
- **FR-005**: The system MUST prevent a push whose content resembles a credential or secret from being stored remotely, informing the author which content triggered the block.
- **FR-006**: The maintainer MUST be able to allow a blocked push they judge to be a false positive, and that allowance MUST persist for the same content.
- **FR-007**: For every published release, the system MUST produce an assessment record covering both shipped artifacts (browser client bundle and server application) that lists identified known vulnerabilities with severities, or an explicit clean result when none are found.
- **FR-008**: Assessment records MUST be retained per release and viewable afterward without the maintainer running manual commands; all current findings MUST be reviewable in one place.
- **FR-009**: No finding MUST ever block a release or fail a merge — detection is report-only by decision.
- **FR-010**: If an assessment could not be produced for a published release, that gap MUST be visible as a missing/failed record, never as silence.
- **FR-011**: Detection MUST operate entirely upstream of the shipped artifact: the installed application's features, runtime behavior, and performance MUST be unchanged.
- **FR-012**: The install and upgrade experience MUST be unchanged — the existing one-step install is preserved and no new user-facing prompts are introduced.
- **FR-013**: Keeping detection alive MUST require zero scheduled maintenance beyond reviewing findings; there MUST be no new recurring manual operational steps.

### Key Entities *(include if feature involves data)*

- **Security Finding**: a detected weakness — kind (vulnerable dependency, artifact vulnerability, blocked credential), severity, affected dependency or artifact, whether a fix exists, status (open, resolved, dismissed), and discovery date.
- **Release Assessment Record**: a per-release posture snapshot — the release it belongs to, the two shipped artifacts covered, the list of findings (possibly empty-but-explicit), and when it was produced.
- **Dependency Update Proposal**: a prepared, reviewable change for one dependency — current and proposed versions, the finding(s) it addresses, and its review status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A known-vulnerable dependency present in the project is brought to the maintainer's attention within 7 days, with zero human action required (baseline today: never — manual audits only).
- **SC-002**: 100% of published releases have a viewable assessment record covering both shipped artifacts, produced automatically (baseline: 0%).
- **SC-003**: 100% of pushes containing credential-like content are prevented from being stored remotely on first occurrence.
- **SC-004**: Zero change in the installed application: identical feature set, identical install steps, no new prompts, and runtime performance indistinguishable from the prior release — verified by measurement, not assertion, consistent with the project constitution's requirement that performance claims be measured.
- **SC-005**: Time for the maintainer to enumerate all currently known weaknesses from stored output is under 5 minutes, with no manual scanning (qualitative).
- **SC-006**: Ongoing effort to keep detection running is review-only: zero scheduled maintenance tasks appear in any workflow (qualitative).

## Assumptions

- The repository host's native security capabilities are free at the current repository visibility (public) and are the expected delivery vehicle; this depends on the project remaining on its current host.
- A roughly weekly notification cadence satisfies "learn without remembering"; faster cadences are unnecessary for a single-user product.
- Report-only is a deliberate, revisitable decision from the assessment: findings never gate merges or releases in this feature.
- Automated update proposals will interact with the release version contract (three version-stamped package manifests plus a change-log section per release); that interaction is validated during planning, and FR-004 bounds the damage if it conflicts.
- The project's dependency audit tooling is compatible with the current package-manager lockfile; compatibility is verified during planning.
- The maintainer reviews findings as they arrive (solo-maintainer human-in-the-loop); notifications are consolidated per dependency to respect a one-person noise budget.
- Detection runs entirely in project tooling upstream of the artifact, so the app's runtime path, bundle, and container behavior are untouched.
- Existing release-notes conventions are unaffected: assessment records are separate artifacts, not changes to release bodies.
- Scope deliberately excludes (per the assessment decision): shipped-artifact hardening (digest pinning, installer verification, non-root containers, compose hardening, database-password fallback removal, TLS defaults), gating on findings, auth-gate redesign, multi-user support, and patching specific CVEs as project work.
