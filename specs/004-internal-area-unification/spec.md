# Feature Specification: Internal Area Unification

**Feature Branch**: `004-internal-area-unification`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Live use of MCP tool calls surfaced four defects and a direction: (1) while a tool-call approval is pending, the assistant's pre-tool text ('Alright, I'll call…') renders twice — the streamed copy and the persisted copy — and only collapses to one after the approval resolves; once the model moves on to a tool call, that text segment should be considered terminated. (2) Assistant-initiated interaction is scattered: pacing chips render in the compose area, approvals render down by the prompt area, choices render as radio-style options in the chat's internal area — converge everything into the internal area and reserve the compose area strictly for user input. (3) A tool call awaiting approval renders with a failure icon and 'No result recorded' — it should read as pending, because it is pending. (4) The tool result renders as an unbounded wall of raw JSON — results must be collapsible and collapsed by default. Additionally, the captured 'assembled request' shows the system prompt twice and a stray bare assistant message ('The Three Trees' — actually the choices row), so the request trace must reflect what is actually sent."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - One authoritative copy of each assistant text segment (Priority: P1)

As a learner watching a turn that talks, then calls a tool, I want the assistant's text segment to appear exactly once — while it streams, at the moment the tool call starts, while the approval waits, and after the turn completes — so the timeline never shows the same sentence twice and never "fixes itself" only after I approve.

**Why this priority**: The duplicate is the most visible dishonesty in the reported flow: the text is persisted when the model moves to the tool call, but the live streaming copy is not retired at that boundary, so both render for the entire approval wait. It gates trust in everything else the timeline shows.

**Independent Test**: Trigger a turn where the model writes a sentence, then requests a high-risk tool call (e.g. an MCP web search requiring approval). During the approval wait, the sentence appears exactly once; after approving and finishing the turn, it still appears exactly once, in the same position.

**Acceptance Scenarios**:

1. **Given** a turn whose assistant text segment ends at a tool-call boundary, **When** the boundary is reached (text persisted, tool call issued), **Then** the live streaming form of that segment is retired in the same update — there is no interval where the persisted row and the live buffer both render.
2. **Given** a tool call awaiting approval, **When** the timeline renders during the wait, **Then** each prior assistant text segment of the turn renders exactly once.
3. **Given** a multi-iteration turn (text → tool → more text → final text), **When** each iteration boundary is crossed, **Then** only the currently-streaming segment renders live; all earlier segments render once each as persisted entries.
4. **Given** the turn completes or is aborted, **When** the durable entries replace live state, **Then** no segment count changes and no content jumps — final rendering equals what was streamed, once.

---

### User Story 2 - Tool calls awaiting a decision read as pending (Priority: P1)

As a learner asked to approve a tool call, I want the tool's timeline row to say it is waiting for me — not to wear a failure icon and "No result recorded" — so the timeline never claims something went wrong while it is actually waiting, and genuine failures still stand out.

**Why this priority**: The failure presentation during the wait is actively misleading (it convinced the reporter something had errored), and it collides with the 003 contract that reserved "No result recorded" for genuine gaps. Pending is a distinct, honest state.

**Independent Test**: Trigger a high-risk MCP tool call and freeze on the approval ask: the tool row shows an explicit waiting/undecided presentation with no failure mark and no "No result recorded". Decline it: the row shows a declined outcome. Separately abort a turn mid-flight through a normal tool call: the genuine-gap marker remains.

**Acceptance Scenarios**:

1. **Given** a tool call whose approval ask is live and undecided, **When** its timeline row renders, **Then** it presents a waiting state (no failure icon, no "No result recorded", no success mark).
2. **Given** a page reloaded while an approval was pending, **When** the chat renders, **Then** the tool row paired with an undecided ask reads as undecided — consistent with the ask entry — not as a failed or incomplete call.
3. **Given** a tool call the learner declined, **When** it renders, **Then** it shows a declined outcome that is visually distinct from both pending and errored.
4. **Given** a non-terminal tool call whose result never arrived (turn aborted mid-flight), **When** it renders, **Then** the genuine-gap marker remains; given a genuinely failed result, the failure mark remains.
5. **Given** a tool call that completed, **When** it renders, **Then** the success mark shows regardless of the tool's terminality.

---

### User Story 3 - Tool results are compact and collapsed by default (Priority: P1)

As a learner reading a turn that used an MCP tool, I want the tool result to render as a quiet, compact unit — tool name, status, and at most a one-line summary — with the full payload available under a collapsed-by-default expander, so a search result never floods the conversation as a wall of raw text.

**Why this priority**: The reported wall of text is the MCP result payload rendered verbatim as the row's body. Deterministic tools already produce short summaries; MCP results carry raw payloads with no display summary. The fix restores readability for every tool uniformly.

**Independent Test**: Open the reported brave_web_search chat (and any chat with large tool results): each result renders as a compact row with a bounded one-line summary; the full payload is absent until expanded, then shows inside a bounded, scrollable container. The same chat rendered before the fix shows the wall of text — after the fix, with no data change.

**Acceptance Scenarios**:

1. **Given** any tool result whose payload exceeds a small presentation threshold (e.g. the brave_web_search JSON), **When** it renders, **Then** the body is collapsed by default and the visible summary is a single bounded line.
2. **Given** a collapsed result, **When** the learner expands it, **Then** the full payload is shown in a bounded, scrollable container — never an unbounded block — and can be collapsed again.
3. **Given** a tool result that already carries a short stored summary, **When** it renders, **Then** it shows that summary as its one line (no regression for deterministic tools).
4. **Given** chats recorded before this change, **When** they render, **Then** the compact presentation applies with no stored-row modification.
5. **Given** the provider context assembled from the same chat, **When** compared before/after, **Then** it is unchanged — the full payload remains what the model receives.

---

### User Story 4 - Assistant-initiated interaction lives only in the internal area (Priority: P2)

As a learner, I want everything the assistant initiates — pacing choices, approvals, sampling asks, elicitations — to appear in the chat's internal lane at its chronological position, and the compose area reserved strictly for what I type, so there is exactly one place to look for one way to respond to the assistant.

**Why this priority**: This is the unification the feature is named for. The pieces all exist (chips in the composer, asks at the timeline tail, choices offers in the lane) but they answer the same need in three places; converging removes the scatter without new concepts. It depends on US1–US3 for a coherent lane to converge into.

**Independent Test**: Run the pacing flow end-to-end: when the model offers choices, the offer renders in the internal lane and its options are tappable there; the compose area shows no chips in any state (gate pending, approval pending, idle). Tapping an option sends the reply; the offer becomes read-only with the taken option marked.

**Acceptance Scenarios**:

1. **Given** an active pacing gate (the model presented choices), **When** the timeline renders, **Then** the offer is tappable in the internal lane at its chronological position — and the compose area renders no suggestion chips.
2. **Given** a taken choice, **When** the offer re-renders (including after reload), **Then** it is read-only with the taken option marked, per the existing durable-offer behavior.
3. **Given** any chat state (idle, streaming, approval pending, gate pending), **When** the compose area renders, **Then** it contains only user-input affordances — no assistant-initiated choices, approvals, or suggestions.
4. **Given** an approval/sampling/elicitation ask, **When** it renders (live or durable), **Then** it appears in the internal lane at its chronological position with the lane's visual conventions, not as a compose-area or prompt-area surface.
5. **Given** a chat with no pending pacing point, **When** the learner wants to steer, **Then** they type freely in the composer — nothing assistant-initiated occupies the compose area.

---

### User Story 5 - The request trace reflects what was actually sent (Priority: P3)

As a learner debugging odd model behavior, when I capture the "assembled request" from diagnostics, I want it to mirror the real wire payload — the system prompt exactly once, and message rows labeled with their kind and tool identity — so a choices offer never looks like a stray one-line assistant message and I never suspect the app of double-sending context.

**Why this priority**: The captured trace currently logs the raw context rows alongside the joined system prompt, which duplicates the system text and strips tool identity — producing both phantom defects the reporter spotted. It is diagnostics-only, fully independent, and cheap once described honestly.

**Independent Test**: Capture the request trace for a turn that includes a choices offer and a tool call: the system prompt appears once; the choices row is visibly a tool interaction (not a bare assistant text turn); the trace's message sequence matches the projected payload sent to the provider.

**Acceptance Scenarios**:

1. **Given** any captured request trace, **When** rendered, **Then** the system prompt content appears exactly once (no system rows duplicated into the message list).
2. **Given** a trace containing a choices offer or tool call, **When** rendered, **Then** the row identifies its kind/tool identity, so it cannot be mistaken for a stray assistant text message.
3. **Given** the same turn, **When** the trace's messages are compared with the projected payload actually sent, **Then** they correspond one-to-one.

### Edge Cases

- **Multiple tool calls in one boundary**: several calls issued together, some auto-executing (low risk) while others await approval — each row shows its own correct state (ok / awaiting) independently.
- **Declined vs errored vs no-result**: all three are recorded outcomes and must remain visually distinct from each other and from pending; the fix must not collapse them into one failure look.
- **Abort while awaiting approval**: the pending sweep resolves undecided asks; the paired tool row must settle to an aborted/undecided presentation, not linger as pending (spinner-truth rule applied to tool rows).
- **Reload with a pending approval**: the undecided ask row persists (002 behavior); its paired tool row must agree with it (undecided), never failure.
- **Large payloads from any tool**: the collapse rule is derived from payload shape/size generically — no UI-side per-tool lists (constitution III); the registry remains the only tool classification source.
- **Terminal tools**: an unpaired terminal call keeps its neutral presentation (003) and never gains a pending/failed look.
- **Legacy storage shapes**: older choices pairs and pre-kind rows continue to render through the same unified presentation.
- **Branch/expound integrity**: unification is presentation-only; row identifiers, ordering columns, and highlight offsets are never rewritten.
- **Live/persisted handoff**: retiring a live segment and mounting its durable form must not visibly reorder or restyle content within the same frame (continuity rule from 002/003 holds).
- **Cold-start chats**: with strategy default replies no longer in the composer, a brand-new chat must remain fully usable via free typing (and the strategy prose gate where applicable).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST render exactly one authoritative copy of every assistant text segment: when a segment terminates at a tool-call boundary, the persisted entry must replace the live streaming form in the same update, with no interval in which both render (during approval waits, execution, or completion).
- **FR-002**: The system MUST present a tool call whose decision is outstanding (live pending ask, or a persisted undecided ask after reload) as waiting — with no success mark, no failure mark, and no "No result recorded" — and MUST resolve that presentation as soon as the decision or outcome is recorded.
- **FR-003**: The system MUST visually distinguish the recorded outcome states of a tool activity — succeeded, failed, declined, genuinely-no-result (non-terminal, aborted), terminal-without-result, and awaiting-decision — sourcing tool classification solely from the tool registry.
- **FR-004**: Tool results MUST render collapsed by default with a compact, single-line visible summary of bounded length; the full payload MUST be reachable via an expander that renders inside a bounded, scrollable container. This MUST apply to previously recorded chats without stored-row modification.
- **FR-005**: Where a stored result lacks a short display summary, the presentation layer MUST derive one (e.g. truncation) without altering stored content or provider-visible context.
- **FR-006**: Pacing choices MUST be offered as tappable options on the choices offer in the timeline's internal lane at its chronological position; selecting an option submits the user reply and links it to the offer per existing durable behavior. The compose area MUST NOT present assistant-initiated choices or suggestions in any chat state.
- **FR-007**: Approvals, sampling asks, and elicitations MUST render in the internal lane at their chronological position (live and durable), consistent with internal-lane visual conventions; the compose area MUST remain a user-input-only surface.
- **FR-008**: The request trace MUST mirror the wire payload: the system prompt appears exactly once, and message rows carry their kind/tool identity so choices and tool interactions are identifiable as such.
- **FR-009**: Changes affecting historical rendering MUST be presentation-layer only: no migration, no stored-row rewrites, no change to provider-visible context (existing golden equivalence tests must pass unmodified), and all standard quality gates (type-check, lint, both test suites) must pass.

### Key Entities _(include if feature involves data)_

- **Text segment**: the span of assistant text between turn start (or a prior tool boundary) and the next tool-call boundary or turn end; the unit of single-authority rendering within a multi-iteration turn.
- **Tool activity status (presentation vocabulary)**: awaiting-decision · running · succeeded · failed · declined · no-result (genuine gap) · terminal; derived at render time from stored rows, live pending asks, and registry classification — never stored.
- **Display summary**: the single-line, length-bounded presentation of a tool result, derived from the stored summary when present and from the payload otherwise.
- **Interactive choices offer**: a pending pacing offer in the internal lane whose options are tappable; becomes read-only (taken option marked) once linked to a user reply.
- **Request trace**: the diagnostics record of a provider call; must correspond one-to-one with the projected payload actually sent.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 0 duplicate renders of any assistant text segment across approval-wait and multi-iteration fixtures — exactly one copy before, during, and after the wait (verifiable by pausing an approval and counting).
- **SC-002**: 0 failure marks and 0 "No result recorded" on tool calls awaiting a decision (live and after reload); 100% of decline/failure/genuine-gap fixtures retain their distinct marks.
- **SC-003**: 100% of tool results above the presentation threshold render collapsed by default with a visible summary of at most one bounded line and an expander with a bounded container — verified on the reported brave_web_search chat and the fixture corpus, with no data change.
- **SC-004**: 0 assistant-initiated interactive elements in the compose area across all chat states (idle, streaming, gate pending, ask pending); the pacing flow completes end-to-end from the timeline offer, including after reload.
- **SC-005**: Provider-visible context unchanged (existing golden equivalence tests pass unmodified); request-trace fixtures show the system prompt exactly once and identify choices/tool rows; all quality gates green.

## Assumptions

- **Relation to prior features**: This is the third iteration on the timeline model (`specs/002-chat-timeline-kinds`, `specs/003-timeline-ux-fixes`); the kind model, canonical ordering, presentation registry, tool registry, and provider projection remain as delivered.
- **"Terminated" means the segment, not the turn**: a turn remains multi-iteration; the reporter's rule is applied at text-segment granularity — the segment ending at a tool-call boundary is final the moment the boundary is reached.
- **Persisted payloads are sacred**: the stored tool-result content is the provider/audit payload; the wall-of-text fix derives presentation only (FR-005), never truncating what is stored or sent.
- **Strategy default replies are assistant-initiated**: static strategy reply suggestions leave the compose area together with gate chips; when no pacing point is active, no suggestion surface exists anywhere and the learner types freely.
- **Trace vs wire**: the actual provider request already sends the system prompt once (system rows are excluded by the projection); only the captured trace duplicates it — FR-008 is a diagnostics-fidelity fix, not a request-assembly change.
- **Ask placement is already internal**: approvals/sampling/elicitations already render in the timeline; US4 formalizes the rule and unifies their presentation rather than relocating them.
- **No new UI-side tool lists**: pending/collapse rules derive from live state, stored outcomes, and registry classification only (constitution III).
