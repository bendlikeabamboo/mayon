# Feature Specification: Timeline UX Fixes

**Feature Branch**: `003-timeline-ux-fixes`

**Created**: 2026-08-20

**Status**: Draft

**Input**: User description: "Live use of the new timeline surfaced four defects: (1) the pending spinner spins forever on finished replies — including past chats, persisting after reload; (2) within a turn, the assistant reply renders before its thought process, followed by the choices offer rendered as a tool call with 'No Result Recorded' — presentation order should be canonical: reasoning, then assistant text, then tool activity; (3) terminal tool calls (the choices presenter) never expect a result, so the failure mark and 'No Result Recorded' must not appear for them — only for specific tools; (4) the diagnostics panel crashes with a duplicate-key error on repeated MCP lifecycle events for the same server, blocking the user from opening chats and sharing console output."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Navigation and diagnostics unblocked (Priority: P1)

As a learner, when an MCP server has connected and disconnected (or reconnected) during my session, I want the diagnostics panel to open without crashing, so I can keep using the app and share diagnostics output when reporting problems.

**Why this priority**: This is a hard crash — it blocks opening chats entirely for affected sessions, including the ability to report the very issues the other stories fix. It is the smallest, most isolated fix and must land first.

**Independent Test**: Open the diagnostics panel (or the chat route that mounts it) for a session whose event log contains two lifecycle events for the same server (e.g. connect then disconnect). The panel opens; both events render as separate rows; no error screen.

**Acceptance Scenarios**:

1. **Given** a diagnostics log containing two or more lifecycle events with the same server identity, **When** the diagnostics panel renders, **Then** every event appears as its own row and the application does not crash.
2. **Given** any diagnostics log, **When** the panel renders, **Then** each rendered row has a unique render identity even when events share their kind and server.

---

### User Story 2 - Spinner tells the truth (Priority: P1)

As a learner, I want the "working" spinner to appear only while my reply is actually being generated, so a finished conversation looks finished — including chats I reopen later.

**Why this priority**: A permanently spinning indicator on every completed reply (including past chats, surviving reload) makes the app feel broken and trains users to ignore real progress signals. It is a one-line-class rendering defect with user-visible impact on every chat.

**Independent Test**: Open a completed past chat and reload it — no spinner is visible anywhere; then send a new prompt — the spinner appears while streaming and disappears when the reply completes.

**Acceptance Scenarios**:

1. **Given** any completed assistant reply (past chat, after reload), **When** it renders, **Then** no streaming/pending spinner or "Thinking" state is displayed.
2. **Given** an in-flight reply, **When** text is streaming in, **Then** the streaming indicator is visible next to the live reply; **When** the reply completes and persists, **Then** the indicator disappears in the same update that the durable reply replaces the live one.

---

### User Story 3 - Deterministic turn order (Priority: P1)

As a learner reading a completed turn, I want its items presented in a fixed, chronological narrative order — the model's thinking for an iteration first, then the text it produced, then the tool activity it performed — so the timeline reads like the process actually happened, in every chat regardless of when it was recorded.

**Why this priority**: The observed chat showed reply → thinking → tool offer, which reads as dishonest history (the exact failure mode the kind model was built to fix). The order must be canonical and deterministic so the timeline is predictable and auditable.

**Independent Test**: Open the affected chat (reply rendered before its reasoning, offer after): after the fix it displays reasoning → reply → choices offer, without any data rewrite.

**Acceptance Scenarios**:

1. **Given** a turn containing reasoning, an assistant reply, and a tool call, **When** rendered from stored history, **Then** within that turn the order is: reasoning entries, the assistant reply, then the tool activity — and this holds for chats recorded before this fix with no modification of stored rows.
2. **Given** a multi-iteration turn (thinking → tool → more thinking → final reply), **When** rendered, **Then** each iteration's reasoning stays with its iteration in chronological order; the fix does not flatten all thinking to the top of the turn.
3. **Given** a turn being streamed live, **When** reasoning and text are arriving, **Then** live items appear in the same canonical position their persisted forms will occupy — no re-ordering jump when the turn completes.
4. **Given** new turns recorded after this fix, **When** persisted, **Then** the stored chronology itself follows the canonical order (reasoning recorded before the reply text of the same iteration), so display order and storage order agree going forward.

---

### User Story 4 - Honest terminal tool presentation (Priority: P2)

As a learner, when the model uses a tool that ends the turn by design (like presenting pacing choices), I want it rendered as what it is — an offer with options — never as a failed or incomplete tool call, so the timeline never claims something went wrong when it didn't.

**Why this priority**: It corrects the most visible mislabeling (red X + "No Result Recorded" under a choices offer) but depends on the presentation-dispatch fixes of Story 3 landing first for a clean test; it is otherwise isolated.

**Independent Test**: Trigger the pacing choices flow in a new chat: the offer renders with its options (and the taken choice marked once tapped) with no failure mark and no "No Result Recorded"; separately abort a turn mid-way through a normal (non-terminal) tool call: that call still shows "no result recorded" because a result genuinely never arrived.

**Acceptance Scenarios**:

1. **Given** a choices offer in either storage shape (legacy offer-with-result pair, or the single offer entry), **When** rendered, **Then** it presents as an offer — label and options, taken option marked when the user's selection exists — never as a tool unit with a failure mark.
2. **Given** a tool call the system classifies as terminal (no result expected), **When** it renders without a paired result, **Then** no failure indicator and no "No result recorded" message is shown.
3. **Given** a non-terminal tool call whose result never arrived (turn aborted mid-flight), **When** rendered, **Then** the incomplete marker remains — the fix must not erase genuine gaps.
4. **Given** a tool result that genuinely failed, **When** rendered, **Then** the failure mark remains.

---

### Edge Cases

- **Repeated lifecycle events**: three or more lifecycle events for one server (connect/disconnect/reconnect) render as three distinct rows.
- **Terminal classification source**: "terminal" is taken from the existing tool registry's classification — one source of truth; no separate UI-maintained list of tool names.
- **Legacy chats**: ordering and offer-presentation rules apply to chats recorded before the kind model (derived kinds) and after (stored kinds) alike.
- **Hidden bookkeeping rows** (empty tool-call rows, hidden prompts) stay hidden after reordering — reordering never resurrects suppressed rows.
- **Turn boundaries**: reordering happens strictly within a turn (between user messages); user messages and their position never move.
- **Branch/expound integrity**: presentation-time ordering only — stored row identifiers, ordering columns, and highlight offsets are never rewritten.
- **Live/persisted handoff**: replacing live items with durable ones must not visibly reorder content within the same frame (continuity rule from the prior feature still holds).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The diagnostics view MUST assign a unique render identity to every event row, such that two events sharing kind and server identity render as separate rows without errors.
- **FR-002**: Pending/streaming indicators MUST be displayed only while a turn is in flight; the system MUST NOT display any streaming indicator on completed replies, past chats, or after reload.
- **FR-003**: The system MUST present each turn's items in canonical order — per iteration: reasoning, then assistant text, then tool activity — and MUST apply this order to previously recorded chats without rewriting stored rows (presentation-time ordering).
- **FR-004**: For turns recorded after this fix, the system MUST persist per-iteration reasoning before the assistant text of the same iteration, so stored order matches the canonical display order going forward.
- **FR-005**: Choices offers MUST render as offers (label + options, taken option marked when linked) in both storage shapes; they MUST NOT render as tool units.
- **FR-006**: Tool calls classified as terminal MUST NOT display a failure indicator or a "no result recorded" message; non-terminal calls without results, and genuinely failed results, MUST retain their existing markers.
- **FR-007**: Terminal classification MUST come from the existing tool registry (single source); the presentation layer MUST NOT maintain its own tool-name list.
- **FR-008**: All changes MUST be presentation-layer only where they affect historical rendering: no migration, no stored-row rewrites, no change to provider-visible context (existing golden equivalence tests must continue to pass), and all standard quality gates (type-check, lint, both test suites) must pass.

### Key Entities _(include if feature involves data)_

- **Turn (presentation grouping)**: the span between consecutive user messages; the unit within which canonical ordering applies. Derived at render time; never stored.
- **Canonical item order**: within an iteration: reasoning → assistant text → tool activity; iterations in chronological order. A pure presentation rule.
- **Terminal tool**: a tool whose call ends the turn without an expected result, as classified by the tool registry. Drives whether an unpaired call may show "no result recorded".

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 0 application crashes from diagnostics rendering across logs containing repeated same-server lifecycle events; each event renders as a distinct row (fixture-driven).
- **SC-002**: 0 spinner/pending indicators visible on completed chats — verifiable on a corpus of past chats before and after reload, plus a live-streaming session where the indicator appears and then disappears exactly at completion.
- **SC-003**: 100% of turns in the fixture corpus (including the reported chat shape: reply-before-reasoning) render in canonical order with no stored-row modifications.
- **SC-004**: 0 failure marks and 0 "no result recorded" messages on terminal tool calls; non-terminal unpaired calls retain the marker in 100% of abort fixtures.
- **SC-005**: Provider-visible context unchanged (existing golden equivalence tests pass unmodified) and all quality gates green.

## Assumptions

- **Relation to prior feature**: This is a defect-fix follow-up to `specs/002-chat-timeline-kinds`; the kind model, registry, and projection remain as delivered — only the four reported defects are in scope.
- **Spinner root cause scope**: The fix is a rendering guard distinguishing live from durable items; no streaming state-machine changes.
- **Ordering mechanism**: Presentation-time ordering within turns (plus corrected persistence order for new rows, FR-004); no database migration and no rewriting of stored order — row identifiers, ordering columns, branch references, and highlight offsets are immutable.
- **Choices offer shape**: Both storage shapes (legacy pair, single entry) are already persisted today; the fix is solely in presentation dispatch.
- **Terminal classification**: The tool registry already marks terminal tools; the presentation layer consults it rather than duplicating tool names.
- **Diagnostics fix scope**: Render-identity uniqueness only; event capture, storage, and dedupe semantics are unchanged.
- **Live ordering**: Live items already render after durable ones; the canonical-order fix places live reasoning/text consistently with where their durable forms will sit, without introducing a second live path.
