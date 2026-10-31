# Feature Specification: Enforceable Text-First Runtime Tier

**Feature Branch**: `025-text-first-runtime`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "ideas/012-easier-interaction-for-models/spec.md — AI agents can implement and verify new Mayon features end-to-end, with browser automation no longer the bottleneck of feature work. Declare and freeze the two-tier boundary that already exists (data and logic behind the repository/driver seams, web UI as thin passenger), make it machine-enforceable (boundary lint + dependency-direction checks in CI), and write the one-page agent's map (where features live, how they're proven, where the browser is allowed to matter)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Boundary violations are caught by machines (Priority: P1)

Mayon's architecture already separates the app into two tiers: the data model and execution logic live behind the repository/storage seams, and the web UI is a thin passenger on top. Today that separation is purely conventional — nothing fails a gate when UI-layer code reaches past the repository façade into data-layer internals. After this feature, an automated gate inspects every change for boundary violations: UI-layer code importing data-layer internals, bypassing the repository façade, or otherwise breaking the covered dependency directions. A violating change fails the gate with a message an implementing agent can act on without human explanation; a boundary-respecting change passes untouched.

**Why this priority**: Discipline decay is the named failure mode of this design — without a machine wire, the boundary guarantee rots and every straddling feature relitigates placement. The map (Story 2) and the placement policy (Story 3) only hold if the boundary physically holds. The wire alone already protects the seam even before any map or policy exists.

**Independent Test**: Plant each class of violation in a scratch change (e.g., a component importing storage internals directly, logic importing the database handle directly): the gate fails and names the file and broken rule; remove the violation and the same change passes. Delivers standing protection on its own.

**Acceptance Scenarios**:

1. **Given** a change in which a UI component imports data-layer internals directly, **When** the automated gates run, **Then** the change fails with a report naming the offending file, the broken rule, and the sanctioned alternative.
2. **Given** a change whose UI-layer code only uses the repository façade, **When** the automated gates run, **Then** no boundary violation is reported.
3. **Given** a change that breaks a covered dependency direction between the tiers by any route the rules cover (not only direct imports), **When** the gates run, **Then** the change fails the same way.
4. **Given** a legitimate exception case, **When** it is added to the explicit escape-hatch list through review, **Then** the gate passes for exactly that case and nothing broader.
5. **Given** the enforcement is live, **When** a later change re-introduces a violation anywhere in the codebase, **Then** it fails again — the wire cannot be quietly bypassed.

---

### User Story 2 - One-page agent's map (Priority: P2)

An implementing agent (or a new human contributor) starting on a Mayon feature can read a single page that answers: where does feature logic live (behind the boundary, whenever it can without much effort), how is it proven (seed state through the repository seam and assert on text outcomes in non-browser tests), and where is the browser allowed to matter (UI-only wiring, plus rare camera-duty visual checks). The page states the placement policy outright and points at the authoritative architecture documents rather than duplicating them, so the map and the enforcement rules cannot drift apart silently.

**Why this priority**: The map converts the boundary from an enforcement detail into steering: it is what actually prevents an agent from defaulting to Playwright-style verification at planning time. It depends on Story 1's vocabulary but not on its mechanics, and it delivers navigation value even while enforcement is still being wired.

**Independent Test**: Hand the map to an agent with no other Mayon context and a representative feature request: the agent plans implementation and verification without browser automation and can state what, if anything, genuinely requires the browser.

**Acceptance Scenarios**:

1. **Given** an agent with no prior Mayon context and only the map, **When** asked to plan a feature whose logic is boundary-placeable, **Then** the plan places the logic behind the seam with logic-layer text tests and no browser automation for behavior verification.
2. **Given** a feature with genuinely UI-only behavior (pixel/animation behavior), **When** planned per the map, **Then** browser coverage is limited to that UI-only behavior.
3. **Given** an agent needing live-stack verification at RC time, **When** it consults the map, **Then** it uses the existing health and data doors as the sanctioned path rather than inventing a new surface.
4. **Given** the map and the enforcement configuration, **When** the boundary rules change, **Then** the map's references keep pointing at the authoritative documents — the map does not maintain a second, drift-prone copy of the rules.

---

### User Story 3 - Text-first proving as the norm for new features (Priority: P3)

New feature work is planned, reviewed, and proven text-first: behavior lands behind the boundary with non-browser tests that seed state through the repository seam and assert on text outcomes. Browser automation is demoted from courtroom to camera: it covers only what logic cannot reach, and visual checks are occasional screenshot-plus-review passes rather than scripted UI tests. Legacy logic entangled with components walks down behind the seam opportunistically — when touched, not via a mass migration.

**Why this priority**: This is the payoff story — the actual unblocking of agent-driven feature work — but it is emergent behavior from Stories 1–2 plus review practice rather than something a single change can deliver. It lands last because it needs the wire and the map to exist.

**Independent Test**: Review features shipped after adoption: each boundary-placeable feature carries logic-layer text tests for its behavior, lives behind the seam, and adds scripted browser tests only for UI-only behavior.

**Acceptance Scenarios**:

1. **Given** a new feature whose logic can live behind the boundary without much effort, **When** the implementation lands, **Then** the logic sits behind the seam and its behavior is covered by non-browser logic-layer tests.
2. **Given** a feature that straddles the DOM and the logic tier (streaming render, expound offsets, selection mapping), **When** it is implemented, **Then** decisions and consequences live behind the seam and only pixel/animation behavior remains in UI coverage.
3. **Given** legacy component-entangled logic that a new feature must touch, **When** the feature lands, **Then** the touched logic moves behind the seam — opportunistically, without requiring a wider migration.
4. **Given** a visual change, **When** it is verified, **Then** it is checked camera-style (screenshot + review) and no new scripted browser test is added for behavior logic tests already prove.

---

### Edge Cases

- **Existing violations on day one**: enforcement must not go live failing the whole tree — pre-existing boundary breaks are triaged as part of enabling the wire (fixed, or explicitly listed as baselined escape hatches).
- **DOM-married logic**: expound offsets, selection mapping, streaming render will keep recurring; the policy splits decisions/consequences (behind the seam) from pixel/animation behavior (UI) so straddling features stop relitigating placement.
- **Escape-hatch abuse**: exceptions are centralized, justified, and reviewed; each addition is a visible reviewable act, and no blanket-disable mechanism survives a change.
- **Test-quality gaming**: the wire checks placement and dependency direction, not whether tests are honest — presence checks are gameable; test quality remains review discipline (explicit non-goal of enforcement).
- **Legitimate internal consumers**: the data tier's own modules and sanctioned tooling (tests, seed scripts, dev tooling) may touch internals; the rules must scope them correctly rather than blanket-failing them.
- **Server-side code**: no new server boundary is invented; the server's existing gates stand unchanged. The wire governs the app's tier separation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST declare the two-tier boundary as authoritative — data model and execution logic behind the repository/storage seams, web UI as a thin passenger — in the existing architecture documentation, not a parallel new document.
- **FR-002**: Automated enforcement MUST fail any change in which UI-layer code imports data-layer internals or bypasses the repository façade.
- **FR-003**: Enforcement MUST run as part of the existing merge-blocking gates, so a violating change cannot pass review regardless of approval.
- **FR-004**: Violation reports MUST identify the offending file and the broken rule, and point to the sanctioned alternative, so an implementing agent can self-correct without human explanation.
- **FR-005**: Exceptions MUST be explicit, centralized in the enforcement configuration, individually justified, and reviewable; no mechanism may disable enforcement for a whole change or leave an unlisted violation passing.
- **FR-006**: The project MUST publish a one-page agent's map covering where features live, how they are proven, where the browser is allowed to matter, and the placement policy — referencing (not duplicating) the authoritative documents.
- **FR-007**: The map MUST state the placement policy: logic that can live behind the boundary without much effort must be placed there and proven as text in logic-layer tests; the browser covers only what logic cannot reach; visual checks are camera-style and rare.
- **FR-008**: The sanctioned text proving path — seeding state through the repository seam and asserting on text outcomes without a browser — MUST be documented as the default proving method and MUST keep working (formalized, not rebuilt).
- **FR-009**: RC-time live-stack verification MUST remain available through the existing health and data-access doors, with no new runtime surface added for it.
- **FR-010**: The feature MUST NOT add a new external client surface (REST, MCP, or other) to the runtime.

### Key Entities *(include if feature involves data)*

- **Boundary declaration**: the authoritative statement of the two tiers and the allowed dependency directions; owned by the architecture documents.
- **Enforcement rule set**: the machine-checked boundary rules (import boundaries and dependency-direction checks) wired into the existing gates.
- **Escape hatch**: an explicit, reviewed exception entry in the enforcement configuration, with scope and justification.
- **Agent's map**: the one-page steering document for implementing agents — placement policy, proving path, and browser allowance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every violation class the rules claim to cover, when planted in a candidate change, fails an automated gate (100% of a planted-violation checklist), and a clean boundary-respecting change produces zero boundary failures.
- **SC-002**: Every live exception appears in the reviewed enforcement configuration with a justification; no unreviewed bypass path exists (verified by inspection).
- **SC-003**: An implementing agent given only the agent's map correctly plans text-first implementation and verification for a representative sample of features: placement and proving method match the policy for each sampled feature.
- **SC-004**: For every feature shipped after adoption whose logic is boundary-placeable, the logic lands behind the seam with non-browser text tests, and no new scripted browser test duplicates logic-layer coverage.
- **SC-005**: The live stack remains verifiable at RC time through the existing doors (health and data query) with no new surface — demonstrated by an RC-time check exercising them.

## Assumptions

- The two-tier boundary already exists in substance (repositories behind the shared database façade, the storage-driver seam, pure logic modules); this feature names, freezes, wires, and maps — it does not re-architect.
- The existing non-browser test harness (seed through repositories, assert on text) is the sanctioned text interface; it is formalized as policy, not rebuilt.
- Enforcement slots into the existing lint/CI gate structure; no bespoke enforcement tool is built.
- Legacy component-entangled logic migrates opportunistically when touched; no mass migration ships with this feature.
- Prompt-quality evaluation ("is the prompt good") stays outside Mayon — owned by the separate evaluation tooling — and is out of scope.
- The browser story never reaches zero: UI wiring and occasional visual snapshots remain; the browser is demoted from courtroom to camera, not eliminated.
- Boundary vocabulary in this spec (repository façade, storage seam, health/data doors) refers to Mayon's documented seams; exact mechanics are left to planning.
