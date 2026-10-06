# Feature Specification: LLM Context-Remaining Indicator

**Feature Branch**: `023-llm-context-remaining`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "As user, I want to be able to see how much of the LLM context is left."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Glanceable context-remaining indicator in the chat (Priority: P1)

While chatting, the user can see — at a glance, without leaving the chat view — how much of the active model's context window is still available for the current conversation. The indicator relates consumed context to the active model's window and refreshes after each completed exchange, when the selected model changes, and when the user switches chats or navigates branch paths.

**Why this priority**: This is the entire ask: visibility of a resource the user currently cannot see. Long conversations silently approach the wall where requests fail or quality degrades; the indicator alone already changes how users manage long chats.

**Independent Test**: Open any chat with at least one completed exchange; confirm the indicator is visible in the chat view, reflects the latest exchange against the active model's window, and updates after the next reply, after a model switch, and after switching chats or branch paths.

**Acceptance Scenarios**:

1. **Given** a chat with at least one completed exchange and a model whose context window is known, **When** the exchange completes, **Then** the indicator shows how much context that exchange consumed and how much remains, measured against that model's context window.
2. **Given** a new, empty chat, **When** the user views the indicator, **Then** it shows (near-)full availability — accounting for fixed conversation instructions where their expected consumption is known.
3. **Given** the user switches to a model with a different context window, **When** the indicator refreshes, **Then** remaining context is recomputed against the new model's window without requiring a new exchange.
4. **Given** the user switches to a different chat or navigates to a different branch path, **When** the indicator refreshes, **Then** it reflects the active conversation path's latest exchange, never the previously viewed one.

---

### User Story 2 - Trustworthy numbers: reported when available, clearly-labeled estimates otherwise (Priority: P2)

Where the inference provider reports actual token usage for an exchange, the indicator uses those numbers. Where usage is not yet available — no exchange completed, or a provider that does not report usage — the indicator presents an approximation that is visibly marked as approximate. Estimates never masquerade as exact; when real usage arrives, the indicator corrects to it.

**Why this priority**: Trust decides whether users act on the indicator. It builds on Story 1's presence: an indicator nobody believes is worse than none, but it is worthless without the indicator existing first.

**Independent Test**: Chat with a provider that reports usage and confirm the numbers track the reported totals; then check a state with no reported usage (fresh chat) and confirm the approximation carries a visible "estimated" marking that disappears once reported usage arrives.

**Acceptance Scenarios**:

1. **Given** a completed exchange for which the provider reported usage, **When** the indicator refreshes, **Then** its values derive from that reported usage.
2. **Given** no reported usage is available for the active path, **When** the indicator displays, **Then** its values are visibly marked as approximations.
3. **Given** a previously estimated value and a new exchange whose usage is reported, **When** the indicator refreshes, **Then** it replaces the estimate with the reported figures instead of accumulating drift.
4. **Given** the user switches models mid-chat and the new provider reports usage, **When** the next exchange completes, **Then** the indicator's source of truth follows the active model's latest exchange.

---

### User Story 3 - Low-context warning states (Priority: P3)

As remaining context shrinks, the indicator escalates through visual states — normal, low, near-exhaustion — consistent with the app's existing visual language. At near-exhaustion the user can tell the conversation is about to hit the wall before requests fail, accompanied by brief plain-language guidance on what to do next (for example, starting a new chat or branching).

**Why this priority**: Warnings only matter once the indicator exists and is trusted (Stories 1–2). They turn passive visibility into actionable foresight.

**Independent Test**: Grow a conversation toward its window and observe the indicator pass through distinct low and near-exhaustion states with escalating visual treatment; confirm a fresh chat returns to the normal state.

**Acceptance Scenarios**:

1. **Given** remaining context above the low threshold, **When** the indicator displays, **Then** it presents its normal appearance with no alarm.
2. **Given** remaining context below the low threshold, **When** the indicator displays, **Then** its state is visibly distinct from normal.
3. **Given** remaining context nearly exhausted, **When** the indicator displays, **Then** it shows its strongest state together with brief guidance on what the user can do.
4. **Given** an indicator in a low or near-exhaustion state, **When** the user starts a new chat, **Then** the new chat's indicator presents the normal state.

---

### User Story 4 - On-demand breakdown of what consumes the context (Priority: P4)

From the indicator, the user can open a small detail view showing what the context is spent on — conversation history, the latest exchange, and fixed conversation instructions — together with the window size and whether each figure is known or estimated.

**Why this priority**: Depth for power users. The glanceable indicator already satisfies the core need; the breakdown explains the number when someone wants to act on it.

**Independent Test**: Open the indicator's detail view in a chat with history and confirm it itemizes consumption into meaningful categories that are consistent with the displayed total, and states the provenance of each figure.

**Acceptance Scenarios**:

1. **Given** the indicator, **When** the user opens its detail view, **Then** it itemizes consumption (history, latest exchange, fixed instructions) consistent with the displayed total, and shows the window size with its provenance (known or estimated).
2. **Given** some values in the detail view are approximations, **When** they are displayed, **Then** each approximation is individually marked.

---

### Edge Cases

- **Provider reports no usage at all**: the estimate-only path keeps working; values stay clearly marked as approximations.
- **Model's context window is unknown** (custom endpoint, router-selected model): the indicator shows consumption without inventing a limit and marks the window as unknown, rather than silently guessing one.
- **A router serves different models per reply**: the indicator reflects the model that served the latest exchange; the detail view names which model/window the figures refer to.
- **Mid-stream behavior**: the indicator need not update during streaming, but it must be correct once the exchange completes; if it does update live, values must not contradict the final state.
- **Branch navigation and regeneration**: usage follows the active path; regenerating a reply replaces — not adds — the previous attempt's contribution.
- **Editing or deleting past messages**: the next recompute reflects the change instead of clinging to stale counts.
- **A request rejected for exceeding the context**: the failure is explained in terms consistent with the indicator (the wall the user was warned about).
- **Very large single contributions** (image attachments, oversized tool results): the indicator absorbs the jump after the exchange and the warning states react.
- **Reopening an old chat**: the last known usage persists with the conversation rather than resetting to "empty".
- **Fixed instructions, tool results, and attachments**: all count as consumed context, since they are part of what the provider processes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display, for the active chat, a glanceable indicator of remaining context measured against the active model's context window, visible in the chat view while composing.
- **FR-002**: The system MUST refresh the indicator after each completed exchange, and recompute it when the selected model, active chat, or branch path changes.
- **FR-003**: The system MUST base the indicator on provider-reported token usage whenever usage is reported for the latest exchange.
- **FR-004**: The system MUST visibly distinguish approximations from reported values; estimates are marked and never presented as exact.
- **FR-005**: The system MUST escalate the indicator's visual state (normal → low → near-exhaustion) as remaining context shrinks, with thresholds defined as fractions of the context window.
- **FR-006**: The system MUST provide brief, plain-language guidance when remaining context is nearly exhausted.
- **FR-007**: The system MUST NOT invent a context window when the model's limit is unknown; it shows consumption and marks the limit as unknown.
- **FR-008**: The indicator MUST NOT block or degrade composing and sending messages in any state.
- **FR-009**: The system SHOULD offer an on-demand breakdown of context consumption (history vs. latest exchange vs. fixed instructions) with the provenance of each figure.
- **FR-010**: The system MUST reflect the app's conversation-path semantics: branching, regeneration, message editing, and deletion recompute the active path's usage rather than accumulating stale counts.

### Key Entities *(include if feature involves data)*

- **ContextWindow**: the total context capacity associated with a model; key attributes are its size and provenance (provider-declared, known from a maintained catalog, user-specified, or unknown).
- **ContextUsage**: the context consumed by the active conversation path as of its latest exchange; key attributes are the consumed amount, whether the figure is reported or estimated, and the anchor (which exchange and which model it came from).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can determine how much context remains for the active chat within 3 seconds, without navigating away from the chat view.
- **SC-002**: For exchanges where usage is reported, the indicator matches the reported totals exactly; for approximated values, the displayed figure is within a stated tolerance and corrects to reported figures on the next reported exchange.
- **SC-003**: In a deliberately grown conversation, the low and near-exhaustion states appear before requests start failing, and a user in the near-exhaustion state can name the guidance offered.
- **SC-004**: Switching chats, branch paths, or models shows the correct corresponding values 100% of the time, with no stale carryover from the previously viewed conversation.

## Assumptions

- Scope is display-only for v1: no automatic summarization, compaction, or trimming of history; near-exhaustion guidance points to user actions such as starting a new chat or branching.
- The indicator lives in the chat view near the composer so it is glanceable while typing; exact placement follows existing UI conventions.
- Inference providers report token usage per completed request (the app's diagnostics already rely on this); where a provider does not report it, estimation from message content is acceptable and clearly marked.
- Model context-window sizes are known from provider/model metadata or a maintained catalog; custom endpoints may not know theirs, which FR-007 covers.
- Thresholds for the low and near-exhaustion states are product-chosen defaults (roughly a quarter and a tenth of the window remaining) and are tunable without redesign.
- Everything sent as part of a request counts toward consumption: conversation history, fixed instructions, tool results, and attachments.
- The indicator is per chat (per active conversation path), not a global figure across chats.
