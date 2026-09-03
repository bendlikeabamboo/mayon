# Feature Specification: Diátaxis Documentation Website

**Feature Branch**: `019-diataxis-docs-website`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Diátaxis documentation website — restructure Mayon's documentation around the Diátaxis framework (tutorials / how-to guides / reference / explanation), published as a browsable documentation website instead of a linear book." (Source: prespec verdict, `ideas/006-diataxis-docs/spec.md`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a task answer by intent (Priority: P1)

A user who knows exactly what they want to accomplish ("configure a provider", "back up my data") opens the docs, chooses the How-to guides section from the navigation, and lands on a task-focused page that gets them the result without wading through teaching material.

**Why this priority**: This is the core pain the feature exists to fix — today task-hunters must scroll through a fixed chapter sequence with interleaved teaching content. Intent-shaped navigation is the primary value.

**Independent Test**: Can be fully tested by picking five representative tasks and verifying each is reachable from section navigation alone, delivering a complete answer without requiring other sections first.

**Acceptance Scenarios**:

1. **Given** the published docs site, **When** the user opens the How-to guides section and selects a guide, **Then** the page leads with the task steps, not conceptual background.
2. **Given** a guide that today mixes a walkthrough with reference tables, **When** it is re-filed under How-to guides, **Then** the walkthrough and the reference material are either split into separate pages or the mixing is minor enough not to mislead a task-focused reader.

---

### User Story 2 - Learn the app from zero (Priority: P2)

A brand-new user arrives knowing nothing about the app and follows the Tutorials section as a guided learning path — from installation/first run to a first completed workflow — without needing to know which chapter comes next.

**Why this priority**: Onboarding is the book format's genuine strength; the restructure must not lose it. Tutorials preserve the linear narrative for the audience that actually wants one.

**Independent Test**: Can be fully tested by walking the tutorial path end-to-end as a new user would and completing the app's core workflow without consulting other sections.

**Acceptance Scenarios**:

1. **Given** the Tutorials section, **When** a new user follows it in order, **Then** they reach a working installation and complete the app's core workflow.
2. **Given** the site navigation, **When** a new user looks for "where do I start", **Then** the Tutorials section is discoverable as the starting point.

---

### User Story 3 - Look up a fact (Priority: P3)

A developer or contributor who needs a specific fact (an architectural contract, a boundary rule, a build command) jumps straight to the Reference section — or uses site search — and finds it without reading any narrative.

**Why this priority**: Fact-hunters are the other half of the core pain; reference material must be reachable and scannable rather than buried mid-chapter.

**Independent Test**: Can be fully tested by locating a set of specific facts (one per existing dev doc) via section navigation or search, in a few clicks and without reading surrounding prose.

**Acceptance Scenarios**:

1. **Given** the Reference section, **When** a developer selects a reference page, **Then** the content is scannable (headings, tables, rules) rather than narrative prose.
2. **Given** site search, **When** the developer searches for a term documented in reference material, **Then** the relevant reference page appears in results.

---

### User Story 4 - Browse the project's history on its own shelf (Priority: P4)

A reader (often the maintainer or a future contributor) wants the development notes, decision history, or changelog — chronological, story-shaped content — and finds it in a dedicated section that does not pretend to be one of the four quadrants.

**Why this priority**: Owner ruling from the prespec playthrough: non-Diátaxis content keeps its own dedicated space rather than being squeezed into Explanation. Lower priority than reader-facing quadrants because it serves a smaller audience.

**Independent Test**: Can be fully tested by verifying every history/notes page is reachable from its dedicated section and none are mis-filed into a quadrant.

**Acceptance Scenarios**:

1. **Given** the site navigation, **When** a reader opens the dedicated history/notes section, **Then** development notes and decision history are present and browsable.
2. **Given** any quadrant section, **When** browsing its pages, **Then** no chronological development-note or decision-history page appears there.

---

### User Story 5 - Follow an existing link through the cutover (Priority: P5)

A returning reader follows a link that predates the restructure — from the repository's agent/contributor instructions, a cross-reference between pages, or a bookmark — and still lands on the content they expected.

**Why this priority**: Link churn was a known snag accepted at verdict time; fixing it in the same change prevents quiet, long-lived breakage. Last because it guards value rather than creating it.

**Independent Test**: Can be fully tested by link-checking every internal reference and repo-level pointer (agent instructions, README, cross-page links) after cutover — zero broken internal links.

**Acceptance Scenarios**:

1. **Given** the reorganized site, **When** a link-check of all internal cross-references and repository documentation pointers runs, **Then** no link 404s.
2. **Given** a bookmarked page from the old structure, **When** the reader opens it after cutover, **Then** the site either serves the page at a corresponding location or the reader can reach the content from the home page in at most two additional steps.

---

### Edge Cases

- What happens when a page substantially interleaves a walkthrough with reference tables? It is split into separate pages filed in their respective sections; only minor mixing is tolerated (the accepted "3/4 strict" bar).
- How does the system handle content that fits no quadrant and is not history (e.g., a contributing guide)? It is filed under the closest task-oriented section or a dedicated shelf, and the placement decision is recorded so it is not silently re-litigated.
- What happens when a new page is authored after the cutover? Placement into a section is a required authoring decision; contributor guidance states the four quadrants plus the dedicated shelves.
- How is a mis-filed page detected after the fact? If a page's section label contradicts its content (a task page filed as explanation, or vice versa), it is re-filed during routine docs review.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The documentation MUST be organized into four top-level sections corresponding to the Diátaxis quadrants: Tutorials (learning-oriented), How-to guides (task-oriented), Reference (information-oriented), and Explanation (understanding-oriented).
- **FR-002**: Every documentation page MUST belong to exactly one top-level section.
- **FR-003**: Non-Diátaxis content — development notes, decision history, and any changelog — MUST live in dedicated separate sections and MUST NOT be filed into a quadrant.
- **FR-004**: Pages that substantially interleave learning-oriented and task/reference-oriented material MUST be split into separate pages; minor mixing MAY be tolerated where splitting would damage the page.
- **FR-005**: The documentation MUST be published as a browsable website whose navigation exposes the sections directly (not only a single linear chapter order), with search available.
- **FR-006**: The website MUST provide section-level entry points that tell the reader which section serves which intent (e.g., a short description per section).
- **FR-007**: All internal cross-references and repository-level documentation pointers (agent/contributor instructions, README, linked docs) MUST be updated as part of the same change; the change MUST leave zero broken internal links.
- **FR-008**: The existing publishing destination and workflow for the docs site MUST be preserved (same public home), and existing entry-point URLs MUST remain valid.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of documentation pages are filed in exactly one of the four quadrants or a dedicated non-Diátaxis section — zero unfiled or dual-filed pages.
- **SC-002**: For five representative reader tasks, a task-focused page is reachable from the section navigation in at most two clicks from the docs home.
- **SC-003**: An automated link check after cutover reports zero broken internal links.
- **SC-004**: A new user can complete the app's core workflow following only the Tutorials section.
- **SC-005**: A fact-lookup exercise (one fact per existing dev doc) succeeds via section navigation or site search without reading narrative prose.

## Assumptions

- The existing documentation toolchain is retained; the platform-migration alternative was considered and declined at the prespec verdict (revisit only if the docs grow substantially).
- The site continues to publish to the same public destination via the same workflow; only structure and navigation change.
- Existing content is largely reusable as-is; the work is re-filing plus targeted page splits, not a rewrite.
- The accepted splitting strictness is approximately "3/4 strict": split where a page genuinely interleaves concerns, tolerate minor mixing — quadrant purity is not a goal in itself (owner ruling).
- Old deep-link bookmarks may change addresses; entry-point URLs stay stable and internal links are all repaired in the same change (accepted trade-off from the playthrough).
- Repository documents that reference doc paths (agent instructions, contributor docs, governance references to the as-is design docs) are updated together with the restructure.
- No application code changes are in scope; standard repository quality gates still apply to any touched files.
