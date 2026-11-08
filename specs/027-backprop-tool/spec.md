# Feature Specification: Conversational Back-Propagation Tool

**Feature Branch**: `027-backprop-tool`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Let's create a tool for the model to use that back-propagates the current chat to the parent chat. As user, there are cases where the branched out chat has already completed its purpose and I kind of want to backpropagate already but due to the nature of the turns, I end up having 'i think this chapter is done, just say "okay" so I can backpropagate'. you see? it's so unergonomic. i think user just say 'i think i'm done here, let's backpropagate' or if they just say 'i think i'm done here' and then LLM will say something like 'got it. Do you like to backpropagate now so parent chat will be updated?' There should be a tool that the LLM can use so when user explicitly says to 'back propagate', then the tool can execute this on his own." (`ideas/back-propagate-tool.md`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Back-propagation executed in-conversation on explicit request (Priority: P1)

A branch chat has fulfilled its purpose. Instead of steering the assistant into a throwaway closing turn ("just say 'okay' so I can backpropagate") and then reaching for the manual control, the user simply says "I'm done here — back-propagate this to the parent." The assistant, through a back-propagation tool available to it, executes the propagation in that same turn. The outcome is exactly what the manual control produces: the branch's outcome lands in the parent chat as the same anchored, collapsible entry, in the same payload mode (verbatim delta or summary) the user asked for. The assistant then confirms briefly and plainly — what was propagated, in which mode, and to which parent chat — without dumping the propagated content back into the conversation. The exchange ends with the awkward dance eliminated: zero throwaway turns, zero required out-of-conversation actions.

**Why this priority**: This is the feature's entire reason to exist — the ergonomic gap the user named. Every other story either guards it or extends it.

**Independent Test**: In a branch chat with messages, ask the assistant to back-propagate in plain words. By the end of the assistant's turn, the parent chat contains the propagated entry, anchored and behaving identically to one created via the manual control; the branch timeline records the tool activity; the assistant's reply is a short confirmation.

**Acceptance Scenarios**:

1. **Given** a branch chat with at least one message, **When** the user explicitly asks the assistant to back-propagate (e.g., "backpropagate this to the parent", "let's backpropagate", "send this up to the parent chat"), **Then** the assistant executes the propagation via its tool within the same turn and the branch's outcome lands in the parent chat as an anchored entry.
2. **Given** a successful tool-triggered propagation, **When** the parent chat is inspected, **Then** the entry is the same kind of artifact the manual control produces — same anchoring at the branch point, same payload-mode behavior, same collapsibility, and the same eligibility for later summary regeneration — with no marker distinguishing it as tool-triggered in its user-facing behavior.
3. **Given** the user names a payload mode in conversation (e.g., "summarize it for the parent" vs. "send the whole thing up"), **When** the tool executes, **Then** the corresponding mode (summary vs. verbatim delta) is used.
4. **Given** the user requests propagation without naming a mode, **When** the tool executes, **Then** the system's existing default mode applies and the assistant's confirmation states which mode was used.
5. **Given** a successful propagation, **When** the assistant replies, **Then** it confirms the outcome in one or two sentences (parent chat, mode) and does not reproduce the propagated content as chat text.
6. **Given** the manual back-propagation control on a branch chat, **When** the tool exists, **Then** the manual control continues to work unchanged — the tool is an additional path, not a replacement.

---

### User Story 2 - Offered (never forced) on natural completion signals (Priority: P2)

The user signals the branch's work is complete without using the word "backpropagate": "I think this chapter is done," "that's all I needed here." The assistant recognizes the completion signal and offers back-propagation once, in plain terms — "Got it — want me to back-propagate this to the parent chat now so it stays current?" It never propagates on inference alone: the tool fires only after the user agrees. If the user agrees, the tool executes exactly as in Story 1. If the user declines or moves on, the assistant drops the subject for the rest of the turn and does not re-request a declined propagation, mirroring the app's existing etiquette for declined actions.

**Why this priority**: It converts the most common natural phrasing ("I'm done here") into the same smooth path, but it builds on the tool existing (Story 1) and is behavioral guidance layered on top.

**Independent Test**: Run a set of conversations ending in completion-signal phrasings that do not explicitly request propagation: each ends with at most one plain-language offer, zero propagations without agreement, and immediate propagation after an explicit "yes."

**Acceptance Scenarios**:

1. **Given** a branch chat where the user signals completion without requesting propagation, **When** the assistant replies, **Then** it offers back-propagation at most once, in plain language, and does not propagate.
2. **Given** such an offer, **When** the user agrees (e.g., "yes, go ahead"), **Then** the assistant executes the propagation via the tool and confirms as in Story 1.
3. **Given** such an offer, **When** the user declines or continues with something else, **Then** no propagation occurs and the assistant does not re-request it.
4. **Given** a completion signal in a root chat (no parent), **When** the assistant replies, **Then** it does not offer back-propagation.

---

### User Story 3 - Gated where invalid, safe when it fails (Priority: P3)

The tool exists only where propagation is meaningful, and every failure mode is boring and recoverable. On a root chat the tool is not offered to the model at all; on a branch with no messages it cannot run. When execution fails, the tool reports the reason in a form the assistant relays plainly ("couldn't propagate: this branch has no messages yet"), both chats remain unchanged and uncorrupted, and the user can retry — conversationally or via the manual control. A propagation already in flight refuses a second concurrent start rather than double-propagating, and a repeat request after a completed summary propagation follows the system's existing regeneration semantics instead of silently stacking duplicates.

**Why this priority**: These guarantees make Story 1 trustworthy, but they are refinements of a path that already works when conditions are ideal.

**Independent Test**: Attempt propagation via conversation on a root chat (no tool offered), on an empty branch (refused with a clear reason), twice concurrently (second refused), and after a completed summary propagation (follows existing regeneration behavior); verify both chats' data is intact after each.

**Acceptance Scenarios**:

1. **Given** a root chat, **When** the turn's tools are assembled, **Then** the back-propagation tool is not offered to the model, and if the user asks for propagation anyway the assistant explains that this chat is not a branch.
2. **Given** a branch chat with no messages, **When** propagation is attempted, **Then** it is refused with a clear reason and nothing lands in the parent.
3. **Given** a propagation already running, **When** a second propagation is requested before the first completes, **Then** the second is refused cleanly and only one artifact lands.
4. **Given** a propagation failure of any kind, **When** the failure is reported, **Then** neither chat's existing content is altered, lost, or duplicated, and the assistant relays the reason without inventing a success.
5. **Given** a branch that was already propagated, **When** the user asks to propagate again, **Then** the behavior matches the manual control's for the same act — another propagation lands another artifact; in-place regeneration of an existing summary artifact remains a distinct, manually triggered affordance the tool does not perform.

---

### Edge Cases

- **User asks, then the standing safety confirmation is declined**: the user explicitly requests propagation, the tool is invoked, and the user declines the app's confirmation for state-changing agent actions — no propagation occurs, the assistant acknowledges the decline once, and it does not re-request within the turn (existing declined-action etiquette).
- **Ambiguous mode phrasing**: "send everything up" reads as the verbatim-delta mode; "give the parent the gist" reads as summary. When truly ambiguous, the assistant asks one short question or states the default it is using — it does not guess silently against the user's interest.
- **Branch containing tool-result turns**: the verbatim delta includes tool results as it does today; the tool path changes nothing about delta content.
- **Parent chat deleted or unresolvable mid-request**: the tool fails with a clear reason; the branch is unaffected.
- **Propagation requested mid-summary-generation** (or any other in-flight propagation): refused as concurrently running, per Story 3.
- **User asks to propagate to a grandparent or another chat**: out of scope — propagation targets the immediate parent only, as today; the assistant declines what the mechanism does not support rather than approximating it in prose.
- **Tools unavailable for the provider or session**: with the tool path unavailable, the assistant says it cannot run the propagation itself and the manual control remains the path; no degraded imitation (e.g., pasting the delta as chat text) is performed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat agent MUST be given a back-propagation tool on branch chats that have at least one message, and MUST NOT be offered the tool on root chats.
- **FR-002**: When the user explicitly requests back-propagation in conversation, the assistant MUST be able to execute it via the tool within the same turn, and the resulting parent-chat artifact MUST match what the manual control produces for the same chat and mode — same anchoring, same payload modes (verbatim delta and summary), same downstream behavior (collapsibility, regeneration eligibility).
- **FR-003**: The tool MUST accept the payload mode as chosen in conversation; when the user does not specify one, the system's existing default mode MUST apply and the confirmation MUST name the mode used.
- **FR-004**: Tool execution MUST follow the app's existing confirmation pattern for state-changing agent actions; a declined confirmation MUST be final for the turn, with no re-request.
- **FR-005**: On a completion signal that does not explicitly request propagation, the assistant MUST offer back-propagation at most once per turn and MUST NOT execute it without the user's explicit agreement.
- **FR-006**: The tool's result MUST report either success (including the parent chat's identity and the mode used) or failure (including a human-readable reason) in a form the assistant can relay plainly; the assistant MUST NOT report success when the tool failed.
- **FR-007**: Failures MUST leave both the branch and the parent chat unchanged — no partial writes, no duplicated or corrupted entries — and a subsequent retry MUST be able to succeed.
- **FR-008**: A second propagation started while one is already running MUST be refused rather than queued or interleaved.
- **FR-009**: A repeat propagation after an earlier one MUST behave exactly as a repeat via the manual control does (a further artifact lands); in-place regeneration of an existing summary artifact MUST remain a distinct manually triggered affordance that the tool does not perform.
- **FR-010**: The tool's invocation and result MUST be recorded in the branch chat's timeline with the same visibility as other agent tool activity.
- **FR-011**: The manual back-propagation control MUST continue to exist and behave unchanged alongside the tool.

### Key Entities *(include if feature involves data)*

- **Back-propagation tool**: the agent-callable action that performs, at the model's hand, the same propagation the manual control performs — input: payload mode (optional); effect: one branch artifact in the immediate parent; availability: branch chats with content only.
- **Branch artifact (existing)**: the anchored, collapsible parent-chat entry produced by propagation; created identically whether triggered manually or via the tool. No new persisted entity is introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a branch chat, an explicit conversational request results in the propagated artifact being visible in the parent chat by the end of the assistant's turn, with zero throwaway user turns required.
- **SC-002**: 100% of tool-triggered artifacts are indistinguishable in user-facing behavior from manually triggered ones for the same chat and mode, verified across both payload modes.
- **SC-003**: Across a battery of completion-signal conversations without explicit requests, zero propagations execute without user agreement, and each conversation contains at most one offer.
- **SC-004**: Across a failure battery (root chat, empty branch, concurrent second request, unresolvable parent), zero instances of corrupted, partial, or duplicated entries in either chat, and every recoverable case succeeds on retry.
- **SC-005**: The pre-feature workaround exchange (user engineering a minimal closing turn to enable manual propagation) no longer appears in conversations where the user explicitly requests propagation.

## Assumptions

- "Explicit request" covers natural phrasings synonymous with back-propagating ("send this up to the parent", "update the parent with this"), not only the literal word "backpropagate"; judgment lives in the assistant's conversational behavior, not a keyword list.
- When no mode is specified, the existing default (verbatim raw delta, per the current propagation default) applies; the assistant states which mode was used.
- The safety confirmation for invoking the tool follows the app's standing pattern for state-changing agent actions (one confirmation, decline is final) rather than inventing a new gating mechanism — planning aligns the risk class with comparable tools.
- Offer-on-completion behavior is conversational (system-prompt guidance) and is verified with the project's existing mock-LLM conversation testing approach; no separate persistence or scheduling exists for offers.
- Scope is the immediate parent only, matching existing propagation semantics; no new data model, store, or background process is introduced — the tool reuses the existing propagation mechanism end to end.
- When the tool path is unavailable (provider without tool support, session safety fallback), the assistant says so and the manual control remains the path; no degraded prose imitation of propagation.
