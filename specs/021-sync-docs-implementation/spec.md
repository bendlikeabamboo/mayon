# Feature Specification: Sync Docs With Current Implementation

**Feature Branch**: `[021-sync-docs-implementation]`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "I want to sync the docs with the actual current implementation." Priorities stated by the owner: users obey the path of least resistance, so everything must be easy; the majority of users are not developers and just want the fastest way to use the product — they are prioritized.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Time User Succeeds by Following the Docs (Priority: P1)

A non-technical first-time user, starting from the product's landing/installation page and
reading only the beginner-facing documentation (getting started, first chat, everyday
usage), reaches a working product and completes their first real task without ever hitting
an instruction that contradicts the application as it exists today — no renamed features,
no missing steps, no controls that do not exist, no defaults that differ from what the
product actually does.

**Why this priority**: The owner states the majority of users are not developers and want
the fastest possible path to using the product. Any gap between the beginner docs and
reality is a dead end that loses these users immediately. This is the path of least
resistance, made real.

**Independent Test**: Give the beginner docs to a person who has never used the product
and have them follow it top-to-bottom without help. They succeed end-to-end, and every
instruction they follow matches what they see.

**Acceptance Scenarios**:

1. **Given** a fresh installation of the product, **When** the user follows the
   beginner/getting-started documentation step by step, **Then** each described action,
   control, and outcome matches the application exactly, and the user reaches a working
   first session.
2. **Given** the documentation describes a default value or preset, **When** the user
   opens the corresponding screen in the product, **Then** the product shows that same
   default without the user needing to change anything.
3. **Given** the documentation names a feature, screen, or control, **When** the user
   looks for it in the product, **Then** it exists under that exact name in the place the
   documentation says it is.

---

### User Story 2 - Everyday Task Guides Match the Product (Priority: P2)

A returning non-technical user consults a task-oriented guide (connecting a provider,
running a lab, taking a quiz, understanding data and privacy) and completes the task
following only the guide. Nothing in the guide references removed capabilities, stale
names, or outdated behavior, and nothing the product now requires is missing from the
guide.

**Why this priority**: These guides are how non-developers keep using the product beyond
first contact. They are the second-largest source of friction when stale, and they serve
the same prioritized audience as Story 1.

**Independent Test**: For each task guide, a user unfamiliar with that feature completes
the task using only the guide; no step fails or contradicts the product.

**Acceptance Scenarios**:

1. **Given** any task-oriented guide for non-developers, **When** the documented steps
   are performed in the current product, **Then** every step succeeds as written.
2. **Given** a capability that varies by installation (for example, features that only
   exist when an optional server component is present), **When** the guide covers it,
   **Then** the guide states when the capability applies and what the user sees when it
   does not.
3. **Given** the product has changed a flow that a guide describes, **When** the sync is
   complete, **Then** the guide reflects the current flow and no longer contains the
   outdated version.

---

### User Story 3 - Contributor and Design Docs Match Reality (Priority: P3)

A developer or contributor follows the contributor-facing documentation (building,
contributing, architecture explanation, reference material) and finds that every command
runs as written, every described boundary matches the actual system, and the documented
operating rules match how the project is actually run today.

**Why this priority**: Necessary for the project's health but serving the minority
audience; the owner explicitly prioritizes non-developers, so this comes after the
product-facing docs.

**Independent Test**: Execute every command and verify every stated fact in the
contributor docs against the repository and the running system; all pass.

**Acceptance Scenarios**:

1. **Given** any command in the contributor documentation, **When** it is run as written
   from the documented starting point, **Then** it succeeds with the documented result.
2. **Given** the architecture/reference documentation describes a boundary, rule, or
   behavior, **When** the actual system is inspected, **Then** the system matches the
   description or the description is updated to match the system.

---

### Edge Cases

- Documentation describes intended behavior that the implementation fails to deliver:
  this is treated as a defect in the product (recorded for fixing), not silently resolved
  by rewriting the docs to match broken behavior.
- A documented feature exists only in a not-yet-released state: docs are synced to what a
  current user actually has; unreleased behavior is not presented as available.
- Two documents disagree with each other about the same fact: the discrepancy is resolved
  so all living documents state one consistent, current truth.
- Historical/dev-notes content describing past phases: verified to remain clearly framed
  as history, not corrected to mirror today's system (it is a record, not a manual).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST audit every living documentation page against the current
  implementation and record each place where the documentation and the product disagree.
- **FR-002**: Each recorded disagreement MUST be resolved by updating the documentation
  to match the current implementation, except where the disagreement reveals a product
  defect, which MUST be recorded as a defect instead of being documented away.
- **FR-003**: The audit and corrections MUST prioritize beginner-facing documentation
  first, then everyday task documentation, then contributor-facing documentation.
- **FR-004**: Every instruction in beginner- and task-facing documentation MUST be
  verifiable by performing it in the current product with the documented result.
- **FR-005**: Every command in contributor-facing documentation MUST be verifiable by
  running it as written with the documented result.
- **FR-006**: Documentation MUST NOT present a capability as available to a user who
  cannot see it in their current installation; capability-dependent content MUST state
  when it applies.
- **FR-007**: Documentation MUST use the exact names the product uses today for screens,
  features, controls, and settings.
- **FR-008**: Where documents overlap (for example, installation covered in more than one
  place), the overlapping content MUST agree, with one place designated as primary where
  practical.
- **FR-009**: Each corrected page MUST be re-verified end-to-end after corrections so
  that fixing one page does not leave neighboring pages stale.
- **FR-010**: The outcome of the sync (what was stale, what was corrected, what defects
  were found in the product) MUST be recorded in the project's decision history.

### Key Entities *(include if feature involves data)*

- **Documentation Page**: A living user- or contributor-facing document; has an audience
  (beginner user, everyday user, contributor) and a verification status (verified
  against current implementation or not).
- **Discrepancy**: One place where a page and the current implementation disagree;
  includes the location, what the page says, what the product actually does, and the
  resolution (page corrected, or product defect recorded).
- **Product Defect**: A disagreement where the implementation, not the documentation, is
  wrong; recorded for separate fixing rather than documented away.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time non-technical user completes getting started to a working
  first session following only the documentation, with zero doc-caused dead ends.
- **SC-002**: 100% of living documentation pages have been checked against the current
  implementation, with a recorded result per page.
- **SC-003**: 100% of recorded documentation/implementation discrepancies are either
  corrected or explicitly recorded as product defects — none left unresolved.
- **SC-004**: Every command in contributor documentation runs successfully as written,
  with zero required unstated workarounds.
- **SC-005**: A user can complete every documented everyday task (providers, labs,
  quizzes, data/privacy) following only the corresponding guide on the first attempt.

## Assumptions

- The current implementation is the source of truth; where docs and product disagree, the
  docs change (unless the disagreement is a product bug — see Edge Cases).
- "The docs" means the living documentation (beginner guides, task guides, contributor
  guides, architecture/reference pages). Historical development notes and decision-history
  pages are records of the past and are out of scope for correction, beyond keeping them
  clearly framed as history.
- The audience split is: non-developer product users first (beginner and everyday guides),
  developers/contributors second, per the owner's stated priorities.
- "Easy for everyone" is interpreted as: correct, complete, step-by-step, using the
  product's real names, with no assumed prior knowledge in beginner material.
- The docs cover a product whose capabilities can vary by installation; capability-gated
  content must be explicit about applicability rather than assuming the fullest install.
