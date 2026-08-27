# Feature Specification: Consolidated Decision History

**Feature Branch**: `013-consolidate-spec-history`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "Consolidate all our decisions made in the specs into a shorter, more concise and less detailed version of what transpired, kept in `docs/history`. Keep there the condensed version of what we set out to achieve, why we wanted to achieve it, whether it got reversed later on, and what our learnings were. The output must be coherent and narratively sound. Then clean up the old spec files (spec refinement, research, etc.)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the project's decision history in one place (Priority: P1)

As a developer (current or future), I can open a single consolidated decision history under
`docs/history` and read a coherent narrative of every completed feature recorded in the
project's specification archive. For each feature the narrative answers four questions:
what we set out to achieve, why we wanted to achieve it, whether that decision was later
reversed or superseded (and by what), and what we learned. I no longer need to excavate
individual, detailed specification documents to understand why the product is shaped the
way it is.

**Why this priority**: The condensed history is the value payload of this feature. Without
it there is nothing to protect during cleanup and no reason to do the cleanup at all. It is
also independently deliverable: the history can exist while old specs remain in place.

**Independent Test**: Pick any completed feature at random; using only `docs/history`, a
reader unfamiliar with that feature can correctly state its goal, its rationale, its current
status (including reversals), and one durable learning — in under two minutes.

**Acceptance Scenarios**:

1. **Given** a repository with archived feature specifications, **When** a reader opens the
   consolidated history under `docs/history`, **Then** every archived completed feature has
   exactly one entry covering goal, rationale, reversal status, and learnings.
2. **Given** an earlier decision that was overturned by a later feature, **When** the reader
   consults either entry (the original or the overturning one), **Then** the narrative states
   the reversal explicitly and points to the decision that replaced it, rather than leaving
   contradictory advice unexplained.
3. **Given** a reader who reads the history top to bottom, **When** they finish, **Then** the
   document reads as one continuous story of the project's evolution — chronologically
   ordered with connective narration — not as isolated bullet-point dumps per feature.

---

### User Story 2 - Repo reflects current truth after cleanup (Priority: P2)

Once a feature's knowledge is safely condensed into the history, its original specification
artifacts (specification, plan, research notes, task breakdowns, data models, contracts,
checklists, quickstart guides, evidence) are removed from the working tree as part of a
cleanup pass. The retained material remains retrievable through the project's history, but
the working tree stops presenting superseded planning detail as if it were current guidance.

**Why this priority**: Cleanup delivers the second half of the stated intent, but it is only
safe *after* US 1's consolidation exists and is trusted. It cannot ship first without risking
knowledge loss.

**Independent Test**: After the cleanup pass runs, the working tree contains no leftover
artifacts for fully-consolidated features, while in-flight work and authoritative governance
documents are untouched.

**Acceptance Scenarios**:

1. **Given** all archived features have entries in the consolidated history, **When** the
   cleanup pass completes, **Then** each fully-consolidated feature directory and its
   artifacts are absent from the working tree.
2. **Given** a feature whose consolidation is incomplete, **When** the cleanup pass runs,
   **Then** that feature's artifacts are left untouched until its consolidation completes.
3. **Given** documents designated as authoritative elsewhere (governance principles,
   operating guide, architecture documentation, active implementation plans), **When** the
   cleanup pass runs, **Then** none of them are modified or removed by this feature.

---

### User Story 3 - No binding knowledge dies in the deletion (Priority: P3)

Before anything is deleted, an audit pass confirms that every decision which still governs
current behavior either already lives in a persistent governance home (principles,
operating guide, architecture docs) or is captured in the consolidated history. Readers who
follow references out of the history land on living rules, not dead ends. Nothing in the
repository points at paths that no longer exist.

**Why this priority**: This story protects the long-term quality of both deliverables but is
the final trust gate rather than new user-visible capability; it can be validated last.

**Independent Test**: Sample governing decisions from the deleted material; verify each is
findable afterward in either the consolidated history or the appropriate governance
document, and confirm zero broken links across all repository documentation.

**Acceptance Scenarios**:

1. **Given** the full set of pre-cleanup specification artifacts, **When** each still-binding
   decision recorded in them is checked against post-cleanup state, **Then** each one is
   locatable in the consolidated history or in a governance document.
2. **Given** the post-cleanup repository, **When** all documentation is scanned for
   references to removed paths, **Then** no reference to a deleted location remains.

---

### Edge Cases

- What happens when a feature is only partially superseded (some decisions stand, others
  reversed)? Each entry must separate standing outcomes from reversed ones instead of
  labeling the whole feature "reversed" or "kept".
- What happens when archived source material for a feature is sparse or inconsistent in
  structure? The entry is written from whatever exists, flagging gaps honestly rather than
  inventing rationale.
- What happens when this consolidation-and-cleanup feature itself produces artifacts?
  Its own working directory is excluded from cleanup; it retires by the same policy only
  once a future pass consolidates it like any other feature.
- What happens when two archived features contradict each other with no explicit reversal?
  The later entry wins narratively and the history records the contradiction as a learning
  rather than silently preferring one side.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system of record MUST provide a single consolidated decision history under
  `docs/history` covering every completed feature then present in the specification archive.
- **FR-002**: Each feature entry MUST answer, in plain prose: (a) what was being built
  (goal), (b) why (rationale/trigger), (c) whether the outcome was later reversed or
  superseded and by what, and (d) learnings worth carrying forward.
- **FR-003**: The history MUST be narratively sound: chronological ordering, connective
  narration between features, and readable end-to-end as a coherent account rather than a
  per-feature checklist dump.
- **FR-004**: The consolidated history MUST be substantially more concise than its sources:
  drastically less detailed than the archived specifications combined, with each feature
  entry held to a short fixed budget so total length stays proportionally small.
- **FR-005**: Before any source artifact is deleted, every decision within it that still
  binds current behavior MUST be verifiably captured in either the consolidated history or
  an existing governance/authoritative document; nothing load-bearing may exist only in
  deleted material.
- **FR-006**: Cleanup MUST remove specification-era artifacts (specification, plan, research,
  tasks, data model, contracts, checklists, quickstart, evidence) only for features whose
  consolidation is complete under FR-001/FR-002.
- **FR-007**: Cleanup MUST NOT touch in-flight/unconsolidated work, this feature's own
  working directory, or any designated authoritative documents (principles, operating guide,
  architecture documentation, active plans).
- **FR-008**: Deleted source material MUST remain retrievable from the project's recorded
  history, so cleanup reduces working-tree noise without permanently destroying provenance.
- **FR-009**: Where a learning has a current home in a governance document, the history
  entry SHOULD point to it rather than duplicate the rule, keeping one source of truth.

### Key Entities *(include if feature involves data)*

- **Decision History Entry**: One feature's condensed record — goal, rationale, reversal
  status (with pointer to successor where applicable), learnings; produced per archived
  feature.
- **Consolidated Decision History**: The single ordered document aggregating all entries
  into a narrative whole, stored under `docs/history`.
- **Specification Archive Inventory**: The set of completed feature directories eligible
  for consolidation and cleanup; drives coverage checks (every inventory item ⇒ one entry)
  and safe-deletion checks.
- **Reversal Link**: A named connection between an original decision and the later decision
  that overturned or superseded it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Using only `docs/history`, a reader can retrieve goal, rationale, status, and
  learnings for any archived feature in under two minutes.
- **SC-002**: 100% of feature directories in the specification archive at cleanup time have
  a corresponding entry in the consolidated history before their artifacts are removed.
- **SC-003**: The consolidated history's total word count is no more than 10% of the
  combined word count of the source material it condenses.
- **SC-004**: After cleanup, a scan of all repository documentation finds zero references to
  removed paths.
- **SC-005**: An audit sampling of still-binding decisions from pre-cleanup material finds
  100% of them located post-cleanup in either the consolidated history or a governance
  document.
- **SC-006**: Every reversal involving archived features is explicitly narrated — zero
  contradictions between surviving documents left unexplained.

## Assumptions

- `docs/history` does not yet exist and will be created by this work; it becomes the
  canonical home for the project's decision history going forward (subsequent features may
  append future entries).
- "Old spec files" means the artifact sets inside completed feature directories of the
  specification archive. Future feature work keeps using that same directory tree; only
  retired features are cleaned up.
- Permanent-looking deletions are acceptable because the project's version-control history
  preserves everything (FR-008); no separate archive copy of deleted material is required.
- Governance documents (development principles, operating guide, architecture docs) already
  capture standing rules and remain authoritative; the history narrates decisions and links
  to those homes instead of restating norms (FR-009).
- The consolidated history is written in the same language and general documentation format
  as the rest of the project's documentation, readable standalone without tooling.
