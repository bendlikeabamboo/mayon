# Feature Specification: Mermaid Repair Integrity (028 defects)

**Feature Branch**: `fix/issue-72-mermaid-repair`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Issue #72 (P3) — mermaid (028): repair silently rewrites valid syntax, quadratic rescans, non-idempotent output, fix affordance side effects; plus unreadable error display and a hardcoded exclusion selector list in coverage tests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repair fixes only what is broken (Priority: P1)

A learner receives a reply containing a mermaid diagram that fails to render because of
one specific fault (say, a missing `end`). Today the automatic repair pass runs
whole-source pattern rewrites, so even though the fault is elsewhere, the diagram's
`%%{init}%%` directive line is rewritten into invalid JSON, C4 directive argument lists
(`Person_Ext(alias, "Label", "Description")`) are collapsed into single arguments, and
xychart axis/data lists (`["Jan", "Feb", "Mar"]`, `bar [10, 20, 30]`) are mangled — a
valid-syntax diagram is corrupted by the very pass meant to save it, and the only reason
anything renders afterward is that mermaid fails even further downstream. The user
expects repair to touch only the actual fault: valid syntax elsewhere in the diagram
survives byte-for-byte, and when the failure is not one of the known repairable fault
classes, the diagram fails honestly with its original error. The repair must also stay
cheap (one pass per rule, no repeated whole-source rescans) and stable (applying it
twice always yields the same output as applying it once).

**Why this priority**: Highest severity in the issue — silent corruption of valid
diagram syntax on every failed render that contains directives, C4, or charts; the
other stories depend on the repair seam remaining trustworthy.

**Independent Test**: A corpus of diagrams whose failure is NOT in the repairable
family (missing `end`, unterminated edge) but which contain `%%{init}%%` directives,
C4 directive calls with multiple quoted arguments, and xychart quoted/numeric axis
lists: after repair, every directive line and argument list is byte-identical to the
input (repair returns identity or a surgical, fault-local edit); for repairable faults
the repaired output still parses; and applying repair twice equals applying it once for
every corpus entry and every first-pass output.

**Acceptance Scenarios**:

1. **Given** a diagram that fails only because of a non-repairable fault (e.g. a
   missing `end`) and contains an `%%{init}%%` directive, **When** repair runs, **Then**
   the directive line is byte-identical in the output and the render reports the
   original underlying error.
2. **Given** a C4 diagram with multi-argument directive calls, or an xychart with
   quoted axis labels or numeric data lists, **When** repair runs for a fault elsewhere
   (or no fault at all in these families), **Then** those argument/data lists are
   unchanged.
3. **Given** a repairable fault of a known class (comma-separated quoted lists in edge
   labels, embedded quotes in labels, unquoted comma labels in flowchart node labels,
   typographic quotes outside directives/comments), **When** repair runs, **Then** the
   fault is repaired, the repair leaves everything outside the fault site unchanged,
   and the repaired diagram parses.
4. **Given** any input, **When** repair is applied to repair's own output, **Then** the
   result equals the first output (idempotence).
5. **Given** arbitrarily long fault chains (e.g. an edge label listing many quoted
   strings), **When** repair runs, **Then** the whole chain collapses in one pass —
   repair work grows linearly with diagram size, not quadratically.

---

### User Story 2 - The fix-this-diagram action never leaves orphan rows (Priority: P2)

A learner with no provider configured (fresh install, or the active provider was
removed) opens a conversation containing a failed diagram and clicks "Fix this
diagram". Today the action charges straight into the send pipeline, which persists a
user message row first and only then discovers there is no provider — leaving an orphan
user row in the conversation, an empty assistant state, and interrupted-turn noise. The
user expects the action to validate first: with no provider configured, nothing is
persisted, the conversation is unchanged, and the configuration problem is surfaced as
the same clear guidance the composer shows.

**Why this priority**: Medium severity in the issue; it silently mutates the immutable
conversation record exactly when the user cannot recover it themselves.

**Independent Test**: With provider resolution rejecting, activating the fix action
(which routes through the ordinary send path) surfaces the missing-key/missing-provider
guidance and the persisted conversation contains no new rows (no user row, no assistant
row); the store is not left in a streaming state. With a provider configured, the fix
action sends exactly one visible user message as before (028 fix-affordance contract
unchanged).

**Acceptance Scenarios**:

1. **Given** no resolvable provider and a failed diagram, **When** the user activates
   the fix action, **Then** no row of any kind is persisted for the attempt and the
   store is not streaming.
2. **Given** no resolvable provider and any other send entry point (composer,
   regenerate), **When** a send is attempted, **Then** likewise no user row is
   persisted and the same configuration guidance is surfaced (the protection lives in
   the shared send path, not only the diagram action).
3. **Given** a configured provider, **When** the fix action is activated, **Then**
   behavior is exactly the 028 contract: one visible user message carrying the original
   source and failure reason, no metadata coupling, no automatic re-sends.

---

### User Story 3 - Diagram failures are readable, not a wall of overflow (Priority: P3)

A learner's diagram fails to render. Today the failure reason is squeezed into a single
inline code line (long multi-line parser errors overflow horizontally or collapse into a
run-on line) and is hidden behind a collapsed "Why?" disclosure, while the diagram
source sits in an always-expanded block. The user expects the full failure text — title
and message — to be visible immediately, wrapped within the block so nothing overflows
the chat column, with the diagram source still available in a collapsed disclosure.

**Why this priority**: Low severity in the issue but daily-visible for every failed
diagram; pure presentation.

**Independent Test**: A failed diagram block shows the complete failure text (error
name/title and full message) as visible wrapped text (no horizontal overflow, line
breaks preserved), and the diagram source remains available behind a collapsed
disclosure; the block stays fully contained (028 containment contract unchanged) and
the fix affordance still appears exactly where a handler exists.

**Acceptance Scenarios**:

1. **Given** a diagram whose failure produces a long, multi-line parse error, **When**
   the failure block renders, **Then** the complete failure text is visible without any
   interaction and wraps within the block (no horizontal overflow).
2. **Given** the same block, **When** the user wants the original source, **Then** it
   is available behind a collapsed disclosure inside the same block.
3. **Given** a message rendered without a fix handler (labs, quizzes, live streams), **When**
   the failure block renders, **Then** the new presentation appears without the fix
   action, exactly as before.

---

### User Story 4 - Selection-exclusion coverage stays in lockstep with the real exclusion list (Priority: P3)

When a new piece of rendering chrome (a badge, a button, a strip) is added around
rendered messages, the text-selection alignment layer excludes it via a shared
selector list. Today the coverage test that proves prose alignment survives chrome
hardcodes its own smaller copy of that list, so the next chrome addition silently
diverges: the test keeps passing while the shipped behavior and the tested behavior
drift apart. The user expects the coverage test to derive its exclusions from the same
list the product uses, so a divergence becomes a test failure.

**Why this priority**: Low severity, test-infrastructure only; it protects every future
feature that renders chrome next to selectable prose.

**Independent Test**: The exclusion-coverage suite iterates the exported exclusion
selector list; adding a hypothetical selector to the export changes what the coverage
test excludes (verified by the import being live, not a copied constant).

**Acceptance Scenarios**:

1. **Given** the exported exclusion selector list, **When** the coverage test computes
   the excluded DOM text, **Then** it uses the exported list itself — the hardcoded
   copy is gone.
2. **Given** all current fixtures, **When** the coverage suite runs with the live
   import, **Then** every existing alignment fixture still passes (no behavior change,
   only derivation).

---

### Edge Cases

- What happens when a diagram's only fault lives inside an `%%{init}%%` directive
  (e.g. typographic quotes in the JSON)? The directive is never rewritten (strictest
  reading of "preserve valid syntax"); the diagram fails with its original error.
  Broadening to directive-local repair is future work.
- What happens when a quoted-list chain has hundreds of elements? One pass collapses
  the maximal run; output is a single quoted label.
- What happens when the provider disappears between the fix action's preflight and the
  stream (race)? Behavior is unchanged from today's mid-stream failure path — the turn
  errors and persists normally; only the pre-append window changes.
- What happens when the failure reason is empty or a non-Error value? The block renders
  the string form (or a plain fallback) — never a blank reason area.
- What happens on theme re-render of a failed diagram? The same failure block is
  rebuilt with the new presentation; no raw error text ever appears outside the block.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Repair MUST leave valid syntax outside the fault site byte-identical —
  in particular, `%%{…}%%` directive lines and comment lines, C4-style directive
  argument lists, and xychart-style axis/data lists must never be rewritten when the
  fault lies elsewhere or the family is not repairable.
- **FR-002**: Each repair rule MUST be a no-match on its own output and on positions
  where the matched shape is valid syntax in that diagram family; the composite repair
  MUST satisfy `repair(repair(x)) === repair(x)` for every input.
- **FR-003**: Repair MUST apply each rule exactly once per invocation (single pass);
  repairing a fault chain of any length must not re-scan the whole source per element.
- **FR-004**: When no rule changes the source, the render seam MUST reject with the
  underlying original error (028 render-pipeline contract preserved: exactly one
  deterministic repair attempt, unchanged source ⇒ original error).
- **FR-005**: A send attempt whose provider cannot be resolved MUST NOT persist any
  message row and MUST NOT enter the streaming state; the configuration error MUST be
  surfaced through the established error presentation.
- **FR-006**: The failed-diagram block MUST present the complete failure text (title
  and message) visibly, wrapped so it cannot overflow horizontally, and MUST keep the
  diagram source available in a collapsed disclosure; the fix affordance's presence
  rules are unchanged.
- **FR-007**: The exclusion-coverage test MUST derive its selector list from the
  product's exported exclusion selectors (no parallel hardcoded copy).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of a preservation corpus (diagrams failing for non-repairable
  reasons while containing init directives, C4 calls, and xychart lists) emerge from
  repair with every directive line and argument/data list byte-identical to the input.
- **SC-002**: The idempotence property `repair(repair(x)) === repair(x)` holds for 100%
  of the fault corpus and 100% of first-pass outputs.
- **SC-003**: Zero orphan user rows across all send entry points when no provider is
  resolvable (verified by store round-trip with provider resolution rejecting).
- **SC-004**: Failed-diagram blocks produce no horizontal overflow for long multi-line
  errors at narrow viewport widths; the full failure text is visible without
  interaction.

## Assumptions

- Repair stays a pure, provider-independent, deterministic string transform at the
  existing seam; the 028 render-pipeline contract (one repair attempt in the failure
  path; unchanged repaired source ⇒ underlying original error; repaired attempt
  failure ⇒ that attempt's error) is unchanged and merely re-anchored by the new rule
  semantics.
- "Surgical" is achieved structurally — rules are scoped to diagram families and label
  positions where the matched shape is never valid (e.g. quoted-list collapse applies
  only inside pipe-delimited edge labels of flowchart-family diagrams) — rather than by
  parsing mermaid's error text, which is brittle across mermaid versions.
- Repair rules for label faults are scoped to flowchart-family diagrams (`graph` /
  `flowchart`); typographic-quote normalization remains global except on directive and
  comment lines. Broadening rules to other diagram families is explicit future work
  with dedicated fixtures.
- The fix affordance remains rendered whenever a handler exists; provider absence is
  handled by the shared send path's preflight (surfacing configuration guidance)
  rather than by reactively hiding the button — matching the issue's acceptance ("never
  persists a user row") and 028's "not silently failing" posture.
- The 028 contracts `render-pipeline.md` and `fix-affordance.md` are amended in place
  with cross-references to feature 036; `docs/reference/seams.qmd` §"Mermaid render
  seam" is updated in the same change.
- No new persistent entities, schema, or server surface; all work is render-time,
  store-path, presentation, and tests.
- The exported exclusion-selector constant lives in the selection/alignment module
  (`src/lib/chat/selection.ts`), not the sourcemap module — the issue's file
  attribution is corrected accordingly.
