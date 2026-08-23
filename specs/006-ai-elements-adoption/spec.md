# Feature Specification: AI Elements Adoption (Selective Community UI Convergence)

**Feature Branch**: `006-ai-elements-adoption`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "based on `research/002-svelte-ui-components.md` let's check how we can use svelte AI Elements on our own chat app so as we have to maintain less things or allow us to converge even by a little bit towards the global consensus. you are free to use the mcp's available to you (brave search OR answer, not sure which one works, zread, z web search or something). in the end my goal is for us to maintain less"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Searchable Model Picker (Priority: P1)

A learner with several providers configured wants to switch the model guiding their
session. Today they pick from a long dropdown and scroll. With this feature, they open a
model picker dialog, type a few characters to filter by model or provider name, and
confirm with keyboard or click. The interaction matches the picker pattern used across
modern AI chat products, so it feels familiar on first use.

**Why this priority**: It is the only candidate surface every user touches on every
session, it replaces the largest single hand-maintained component (~124 lines), and it is
completely independent of the chat render path — the safest, highest-traffic win.

**Independent Test**: Can be fully tested by configuring two or more providers, opening
the picker, filtering by typing, and selecting a model; delivers a working, familiar
model-switching experience on its own.

**Acceptance Scenarios**:

1. **Given** the user has multiple configured providers, **When** they open the model
   picker and type part of a model name, **Then** only matching models (and matches on
   provider name) are shown, and pressing Enter selects the highlighted one.
2. **Given** the picker is open, **When** the user presses Escape or clicks outside,
   **Then** the dialog closes with no change to the active model.
3. **Given** the user selects a model, **When** the picker closes, **Then** the active
   model indicator reflects the choice and persists for the session per existing
   behavior.
4. **Given** the user has no providers configured yet, **When** they open the picker,
   **Then** they see a clear empty state pointing to provider setup rather than a blank
   list.

---

### User Story 2 - Consensus Tool-Approval Flows (Priority: P2)

A learner whose session uses tool servers occasionally receives requests that need human
judgment: the assistant asks for missing information (elicitation) or wants permission to
run a potentially sensitive action (sampling approval). Today these prompts appear in
individually hand-built dialogs/cards. With this feature, both flows render through one
shared approval pattern — request details, response entry where applicable, and
approve/decline actions with visible pending, success, and failure states — matching how
tool approval looks across the broader AI tool ecosystem.

**Why this priority**: Approval interactions are safety-critical UX where convergence to
a well-tested community pattern matters most, and consolidating two bespoke surfaces
(elicitation dialog + sampling approval card) into one pattern is a direct
"maintain less" reduction.

**Independent Test**: Can be fully tested by triggering an elicitation request and a
sampling request from a tool server and completing approve/decline on each; delivers a
coherent approval experience on its own.

**Acceptance Scenarios**:

1. **Given** a tool server requests elicitation input, **When** the approval surface
   appears, **Then** the user sees what is being asked, can provide the requested
   response, and sees pending then success/failure feedback after submitting.
2. **Given** a sampling approval request arrives mid-conversation, **When** the user
   declines it, **Then** the tool receives the refusal, the surface reflects the
   declined outcome, and the conversation continues without dangling UI.
3. **Given** a restore or other maintenance operation is in progress, **When** approval
   surfaces would query data, **Then** they degrade gracefully (no broken dialogs) until
   the operation completes.
4. **Given** the app runs without the server runtime that hosts tool servers, **When**
   the user browses the chat, **Then** no approval UI appears (progressive degradation
   is unchanged).

---

### User Story 3 - Collapsible Tool-Call Display (Priority: P3)

A learner reviewing a past session wants to see which tools the assistant used and what
came back, without that detail dominating the transcript. With this feature, each tool
activity renders as a collapsible block: tool name always visible, parameters and
results expandable on demand — the same collapsed-by-default presentation used by
mainstream agent chat UIs.

**Why this priority**: It improves an existing thin surface (tool activity rows) and
retires bespoke display code, but it is a polish/consistency layer rather than a daily
workflow; safe to land after P1 and P2 establish the pattern.

**Independent Test**: Can be fully tested by running a session that invokes tools and
expanding/collapsing each tool block in the transcript; delivers a clearer transcript on
its own.

**Acceptance Scenarios**:

1. **Given** a transcript containing tool activity, **When** the user views it, **Then**
   each tool call shows its name in a collapsed block by default.
2. **Given** a collapsed tool block, **When** the user expands it, **Then** parameters
   and the result body are shown; collapsing again hides them.
3. **Given** a tool call that failed or was declined, **When** the block is expanded,
   **Then** the failure/decline outcome is clearly distinguishable from a success.

---

### Edge Cases

- What happens when the model list is very large (dozens of models across providers)?
  Filtering and keyboard navigation must stay responsive, and long names must truncate
  gracefully.
- What happens when an approval dialog is open and the connection to the tool server
  drops? The surface must show a recoverable failure state, not hang in pending.
- What happens when the same approval request fires twice (retry)? The second request
  must not produce a duplicate overlapping dialog.
- What happens when the app is in read-only/maintenance mode (restore in progress)?
  Approval and picker surfaces must not attempt writes and must surface the busy state.
- What happens for keyboard-only and screen-reader users? Dialogs must trap focus,
  close on Escape, and announce states.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST provide a model picker that filters configured models by
  typed text (matching model name or provider name) and supports full keyboard
  navigation and selection.
- **FR-002**: Model picker MUST include a clear empty state guiding provider setup when
  no models are configured.
- **FR-003**: System MUST render tool-approval requests (elicitation and sampling) via a
  single shared approval pattern presenting request details, an optional response entry,
  and approve/decline actions with visible pending, success, failure, and declined
  states.
- **FR-004**: System MUST render tool activity in the transcript as
  collapsed-by-default blocks exposing tool name, parameters, and result on demand, with
  visually distinct failure/decline outcomes.
- **FR-005**: All replaced surfaces MUST match the app's existing visual conventions
  (theming, dark mode, spacing, typography) with no new styling system introduced.
- **FR-006**: This feature MUST NOT change message rendering, source-offset text
  highlighting (expound), branch navigation, or transcript persistence behavior.
- **FR-007**: Surfaces MUST continue to degrade progressively based on detected runtime
  capabilities; no approval or tool UI may render when its backing capability is absent.
- **FR-008**: Adopted components MUST become first-party code (copied in, then owned
  locally) with no runtime coupling to the upstream registry, no auto-updates, and no
  new third-party runtime packages added to the application bundle.
- **FR-009**: Adoption MUST be limited to leaf UI surfaces; the community components for
  message rendering, streaming response rendering, conversation containers, and prompt
  input are explicitly out of scope.

### Key Entities _(include if feature involves data)_

- **Model option**: A selectable model handle as presented today — provider identity,
  model identifier, display name; no new persisted data.
- **Approval request**: An incoming tool-initiated ask (information request or action
  permission) with its current lifecycle state (pending, approved, declined, succeeded,
  failed); lifecycle semantics unchanged from today.
- **Tool activity entry**: An existing transcript record of a tool invocation (name,
  parameters, outcome); presentation-only change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Net custom UI code across the replaced surfaces does not increase — the
  feature lands as a net deletion or is cost-neutral against the ~550 lines of
  bespoke UI it replaces (model picker, two approval surfaces, tool display).
- **SC-002**: Zero new third-party runtime packages are added to the application
  (verified at review against the dependency manifest).
- **SC-003**: A user can select any configured model in at most two interactions (open
  picker, confirm) with typing as the only filter mechanism required.
- **SC-004**: All existing quality gates (type-check, lint, test suites, including
  expound and tree/branching tests) pass with no regressions after each replaced
  surface lands.
- **SC-005**: Each replaced surface is indistinguishable in visual quality from the
  rest of the app (reviewed against existing theming and dark mode) — consensus
  pattern, native look.

## Assumptions

- Source material is the "Svelte AI Elements" community component registry identified in
  `research/002-svelte-ui-components.md` (copy-in model, MIT-licensed); the specific
  donor blocks referenced are `model-selector`, `confirmation`, and `tool`. Final block
  choice may shift during planning if inspection reveals a better fit, provided the
  no-runtime-coupling rule (FR-008) holds.
- The app's existing component vocabulary (shadcn-svelte style on the current UI
  primitives, existing icon set) is the styling baseline; donor code is expected to
  align with minimal adjustment.
- Donor components may be adapted freely once copied in — trimming unused variants is
  preferred over keeping dead code.
- No data model, persistence, or API changes are in scope; every change is
  presentation-layer on existing stores and services.
- Suggestions/starter prompts, reasoning display, task/checkpoint panels, and any
  generative-UI ambitions from the research doc are deferred to future features; this
  feature's boundary is the three stories above.
- The chat message render path (markdown, math/diagram rendering, highlighting,
  branching) remains hand-maintained by design — convergence there is explicitly
  rejected by the research findings and constitution.
