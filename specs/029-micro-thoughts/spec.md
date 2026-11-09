# Feature Specification: Micro-Thought Streams (Interleaved Reasoning)

**Feature Branch**: `029-micro-thoughts`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "`ideas/open-ai-micro-thoughts.md` as `029-*`" — from the idea file: "GPT 6-Luna gives out simultaneous micro thoughts, thoughts after thoughts. Does our application supports this? If not, we should. You can use search tool during the spec phase and the research phase."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - See micro-thoughts live, in their arrival positions (Priority: P1)

A user chatting with a capable model (e.g., GPT-6 Luna) sends a message. While the reply
streams, the model emits short reasoning bursts — "micro thoughts" — between stretches of
answer text: a thought, then some answer, then another thought ("thoughts after thoughts"),
with thoughts arriving alongside the growing answer. Today the application treats reasoning
as a single pre-answer block, so interleaved bursts would be merged into one lump and the
user loses the back-and-forth rhythm of the model's thinking. With this feature, each
micro-thought burst appears live in the conversation at the point where it arrives, visually
distinct from answer text, and the user can follow the model thinking *while* it answers.

**Why this priority**: This is the core value of the feature — observing the model's
reasoning rhythm as it happens. Without live interleaved display, the feature does not exist
in any meaningful form.

**Independent Test**: Can be fully tested by streaming a reply from a model that emits
three distinct reasoning bursts interleaved with answer text and verifying each burst renders
at its arrival position, unmerged and unreordered, while the answer streams.

**Acceptance Scenarios**:

1. **Given** a conversation with a reasoning-capable model, **When** the model emits a
   reasoning burst, then answer text, then a second reasoning burst within the same reply,
   **Then** both bursts are visible as separate collapsible thought entries, each positioned
   between the answer text stretches it arrived with.
2. **Given** a reasoning burst is currently streaming, **Then** the user sees it growing in
   real time (consistent with the existing live "thought process" presentation) without the
   answer text pausing, jumping, or being hidden while thoughts arrive.
3. **Given** a model emits several rapid successive bursts ("thoughts after thoughts"),
   **Then** each burst remains a distinct entry; the UI does not visually thrash while they
   arrive in quick succession.

---

### User Story 2 - Conversation history reproduces the interleaved structure (Priority: P2)

After a reply with interleaved micro-thoughts completes (and after the user reloads or
reopens the conversation), the saved transcript shows the same interleaved structure the
user watched live: each micro-thought burst in its original position relative to the answer
text, not flattened into one block before the reply.

**Why this priority**: Persistence makes the feature durable and trustworthy; users rely on
history to revisit how a conclusion was reached. It depends on Story 1's data but is a
distinct deliverable (history fidelity).

**Independent Test**: Can be fully tested by completing an interleaved reply, reloading the
application, and verifying the reopened conversation shows identical burst count, content,
and ordering to the live view.

**Acceptance Scenarios**:

1. **Given** a completed reply containing three interleaved micro-thought bursts,
   **When** the user reloads the conversation, **Then** all three bursts reappear in their
   original positions with identical content and ordering.
2. **Given** the user stops a reply mid-stream after at least one micro-thought burst
   arrived, **When** the conversation is reopened later, **Then** the bursts received before
   the stop are preserved in their positions.

---

### User Story 3 - Existing single-block reasoning providers are unaffected (Priority: P3)

Users chatting with models that reason in the classic way — one continuous reasoning block
before the answer (the current behavior most providers exhibit today) — see exactly the same
experience as before: one "thought process" entry preceding the reply. The interleaved
presentation is a strict superset, not a replacement, and must not disturb the existing flow.

**Why this priority**: Protects the entire existing user base and keeps the risk of the
change contained; required for the feature to ship safely, but delivers no new value on its
own.

**Independent Test**: Can be fully tested by streaming a reply from a provider that emits
one reasoning block before content and verifying the rendered result (live and after reload)
is identical to the pre-feature presentation.

**Acceptance Scenarios**:

1. **Given** a model that emits a single reasoning block before answer text, **When** the
   reply streams, **Then** exactly one thought entry appears before the answer, as today.
2. **Given** a model configured with reasoning disabled, **When** a reply streams,
   **Then** no thought entries appear and nothing about the reply changes.

---

### Edge Cases

- What happens when a micro-thought burst arrives but no answer text follows before the
  stream ends (a trailing thought)? The burst is kept as the final entry of the turn.
- What happens when a burst contains only whitespace or is empty? It is not displayed and
  not persisted.
- What happens when the user stops generation mid-burst? The partial burst text received so
  far is kept; nothing after the stop is added.
- What happens when a provider that never reasons is used? No thought entries are produced;
  behavior is identical to today.
- What happens when the connection drops mid-reply? Behavior follows the existing
  interrupted-stream handling; bursts received before the drop remain in place.
- What happens when bursts are extremely long relative to the answer? The presentation
  stays collapsed-by-default after completion so a chatty thinker does not drown the answer;
  the user can expand any burst.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST preserve the arrival order of reasoning segments relative to
  answer text within a single reply: reasoning and answer content MUST be able to alternate
  ("thoughts after thoughts"), and later reasoning MUST NOT be merged into an earlier block
  or hoisted before the answer.
- **FR-002**: The system MUST render each reasoning segment as its own collapsible
  "thought" entry at its arrival position, visually distinct from answer text, following the
  established thought-presentation conventions.
- **FR-003**: While a reply streams, the system MUST show reasoning segments growing in
  real time and MUST NOT delay, reorder, or hide already-shown segments as new ones arrive.
- **FR-004**: The system MUST persist every reasoning segment with its position within the
  reply so that reopening the conversation reproduces the interleaved structure exactly.
- **FR-005**: The system MUST treat a reply that contains one continuous reasoning block
  before the answer (today's common shape) as a special case of interleaving and render it
  identically to the current presentation.
- **FR-006**: Reasoning segments MUST remain excluded from what is sent back to the model
  as conversation context, consistent with current behavior.
- **FR-007**: The system MUST support interleaved reasoning whether the conversation runs
  with or without the optional companion server, matching how the rest of streaming works
  today (progressive degradation).
- **FR-008**: When a reply is stopped or interrupted, the system MUST persist the reasoning
  segments (including a partially received segment) received up to that point.
- **FR-009**: Thought entries MUST default to collapsed once the reply completes and MUST
  be expandable individually, so long reasoning does not drown the answer.
- **FR-010**: The system MUST NOT require the user to change any setting for micro-thoughts
  to appear; a provider that streams interleaved reasoning displays it under the existing
  thinking preference (reasoning enabled), and reasoning disabled suppresses it as today.
- **FR-011**: Rapid successive bursts MUST be presented as distinct entries without visual
  instability (no layout jumping of already-visible content).

### Key Entities *(include if feature involves data)*

- **Micro-thought (reasoning segment)**: A contiguous burst of the model's reasoning text
  within one reply. It has its content, its position relative to other segments of the same
  reply, and a streaming state (growing / complete). Multiple micro-thoughts may occur in one
  reply; they are ordered, never merged.
- **Assistant turn**: One model reply, composed of an ordered sequence of alternating
  reasoning segments and answer text. The sequence is authoritative for both live display
  and history.
- **Thought presentation**: The collapsible UI affordance a reasoning segment is shown in,
  sharing the existing "thought process" conventions (live indicator while streaming,
  collapsed summary when complete).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a model interleaves three or more distinct reasoning bursts within one
  reply, 100% of bursts are visible live at their arrival positions — none merged, hoisted,
  or reordered.
- **SC-002**: For every completed interleaved reply, reopening the conversation reproduces
  the identical segment sequence (count, content, order) with no discrepancies.
- **SC-003**: Replies from models that emit a single pre-answer reasoning block are
  rendered identically before and after this feature (no regression), verified across the
  providers currently supported.
- **SC-004**: The visible reveal cadence of answer text is not degraded by interleaved
  thought handling: answer text continues to appear at the same steady pace as today, with
  no perceptible stalls when bursts arrive (no added visible delay at bursts' arrival).
- **SC-005**: A user can expand or collapse each micro-thought individually and reach any
  burst from a completed reply in one interaction.

## Assumptions

- "Simultaneous micro thoughts" means short reasoning bursts emitted within the same reply
  stream, interleaved with answer text ("thoughts after thoughts"). Providers stream one
  token sequence; truly parallel, side-by-side thought channels are not assumed and are out
  of scope.
- Providers that inline their reasoning into the answer text itself (no separate reasoning
  channel) cannot be distinguished and remain out of scope; their text renders as ordinary
  answer text, as today.
- The existing per-provider thinking preferences and effort settings continue to control
  whether reasoning is requested; no new user-facing setting is introduced.
- Reasoning content continues to be excluded from conversation context replay, consistent
  with current behavior; changing what the model receives is out of scope.
- Display conventions (collapsed when complete, live indicator while streaming) reuse the
  existing thought-process presentation patterns rather than introducing a new visual
  language.
- Usage and cost accounting semantics are unchanged by this feature; reasoning tokens are
  already part of provider usage reporting and are handled as today.
