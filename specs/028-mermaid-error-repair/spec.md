# Feature Specification: Mermaid Diagram Error Repair & Containment

**Feature Branch**: `028-mermaid-error-repair`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "If the model gives out a mermaid graph but this graph has issues, we currently don't correct this. The error I can still see in the text and in my case it says: `Mermaid render failed: Parse error on line 2: ...tring"] -->|"sad", "SAD", "sleepy", "del ... Expecting 'SQE', ... got 'STR'`. In addition every time there's a mermaid error, the whole screen becomes scrollable vertically and on the bottom there's a mermaid banner that says 'Syntax error in text'." (`ideas/iron-out-mermaid-errors.md`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A broken diagram never breaks the page (Priority: P1)

Whenever a diagram in a chat message fails to render, the failure is confined to that diagram's own block. The rest of the interface is untouched: no page-wide vertical scrolling appears, no banner or overlay shows up anywhere else on screen, and the chat remains fully interactive — scrolling, replying, and opening other messages all behave as if nothing had failed. Today, a single bad diagram corrupts the entire screen (page-level scrollbar plus a floating "Syntax error in text" banner at the bottom); after this story, the only visual evidence of a failure lives inside the diagram's block, presented in the established visual vocabulary of the chat rather than as a raw parser dump.

**Why this priority**: This is the defect that turns one flawed diagram into a broken application for every user who hits it. It is independently shippable (containment alone is a strict improvement), it is the smallest safe slice, and every other story in this feature builds on the guarantee that failures are contained before they can be repaired or presented.

**Independent Test**: Produce a message containing a diagram with the exact fault from the input description (an edge label containing commas and quotes, such as `-->|"sad", "SAD", "sleepy", "del"`). Observe: no page-level scrollbar appears that was not there before, no banner exists anywhere outside the diagram block, and all error visuals (notice, source, reason) appear only inside the diagram's own block.

**Acceptance Scenarios**:

1. **Given** a rendered message containing a diagram that fails to render, **When** the failure occurs, **Then** all error visuals appear exclusively within that diagram's own block.
2. **Given** a failed diagram on screen, **When** the user inspects the page, **Then** the page's scrollability and layout are identical to a page containing no failed diagram, and no banner or injected element exists anywhere outside the diagram block.
3. **Given** a failed diagram on screen, **When** the user scrolls, sends a new message, and opens other conversations, **Then** every interaction behaves exactly as it would without the failed diagram.

---

### User Story 2 - Flawed diagrams repair themselves (Priority: P2)

When the assistant emits a diagram with syntax faults, the system detects the fault at render time and repairs it automatically, so the user sees the intended diagram instead of an error. The repair happens without any user action, covers the common fault classes found in model output — including the quoted-label fault from the input description — and is bounded so a hopeless diagram cannot loop forever. Repair never rewrites history: the stored message keeps the diagram source exactly as the model wrote it, and only the displayed render uses the repaired version. When a diagram has been repaired, the user can tell, and can still see the original source. Diagrams that were already valid are completely unaffected.

**Why this priority**: This is the feature's payoff — "we currently don't correct this" is the core complaint. It ranks below Story 1 because a self-healing diagram that still wrecks the page layout on failure would remain a defect, while containment alone already restores a usable chat.

**Independent Test**: Send the exact failing example from the input description through a conversation and let the reply render: the user sees a rendered diagram, not an error notice; the stored message still contains the original, unrepaired source; a visible indication marks the diagram as repaired and offers access to the original source.

**Acceptance Scenarios**:

1. **Given** a completed message containing a diagram with a syntax fault of a class commonly produced by language models (including edge labels containing commas and/or quotes, as in the input example), **When** the message renders, **Then** the user sees a rendered diagram rather than an error notice.
2. **Given** a diagram that was automatically repaired, **When** the user inspects the message, **Then** the stored source is byte-for-byte the original as emitted by the model, the interface indicates that the displayed diagram was repaired, and the original source remains viewable.
3. **Given** a diagram whose faults persist after the maximum number of repair attempts, **When** attempts are exhausted, **Then** the system stops trying (no retries without limit) and presents the failure as described in Story 3.
4. **Given** no model provider is configured or reachable, **When** a faulty diagram renders, **Then** repairs that do not depend on a provider still apply, and provider-dependent repair degrades silently to the Story 3 presentation.
5. **Given** a diagram that renders successfully today, **When** this feature is in place, **Then** it renders identically, with no added visible delay, error flicker, or visual change.

---

### User Story 3 - An honest, actionable fallback when repair fails (Priority: P3)

When a diagram cannot be repaired automatically, the user is left in a good state instead of a dead end. The diagram's block shows a plain-language notice that the diagram could not be rendered, the underlying reason available on demand (not a raw parser dump forced into the text), and the diagram source in a readable, formatted form so the user can read the model's intent themselves. From there, a single explicit action asks the assistant to fix the diagram in the conversation: the request carries the broken source and the failure reason, the assistant's reply renders as a corrected diagram, and the original message is never altered.

**Why this priority**: It completes the loop for the residual set of diagrams automation cannot save, and it converts the worst outcome (stuck with red error text) into a one-action recovery. It depends on Stories 1 and 2 for its framing (containment, repair exhausted) and on a configured provider for its fix action, so it lands last.

**Independent Test**: Render a message with a diagram whose faults survive automatic repair: the block shows the notice, an on-demand reason, and readable source; trigger the "fix this diagram" action; the assistant's follow-up reply contains a corrected, rendering diagram; the original message remains unchanged.

**Acceptance Scenarios**:

1. **Given** a diagram that could not be automatically repaired, **When** its failure is presented, **Then** the diagram's block contains a plain-language notice, a way to reveal the underlying failure reason, and the diagram source displayed in readable formatted form — and nothing outside the block (per Story 1).
2. **Given** an unrepaired diagram, **When** the user triggers the in-conversation fix action, **Then** the assistant receives the broken source together with the failure reason, and its reply renders as a corrected diagram, while the original message stays unmodified.
3. **Given** the fix action and no available provider, **When** the user views the failed diagram, **Then** the action is visibly unavailable with a brief explanation rather than silently failing.

---

### Edge Cases

- What happens when a diagram's source is still streaming and incomplete? Repair and failure presentation must wait until the diagram block is complete; a half-arrived diagram must not flash an error or trigger repair attempts that the finished source would not need.
- What happens when a "repaired" diagram renders but differs from what the model intended? The original source stays stored and inspectable (Story 2), so the user can always compare; the repair is indicated, never silent.
- What happens when the theme changes (light/dark) or the message re-renders after the fact? A repaired diagram must re-render stably in the current theme — it must not flash back to an error state or require re-repair visible to the user.
- What happens when the user opens the interactive diagram preview (pan/zoom) on a repaired diagram? The preview shows the repaired render; any source view reachable from the preview shows the original source.
- What happens with very large or complex diagrams? Repair and rendering remain time-bounded and must not freeze the interface; a slow repair degrades to the Story 3 presentation rather than hanging.
- What happens when the same fault class repeats across many messages in one conversation? Each diagram is repaired independently with the same bounds; costs and behavior stay predictable per diagram.
- What happens to text selections and highlights anchored in a message containing a repaired diagram? Because stored message content is never modified, existing anchors and offsets remain valid.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST contain all visuals of a diagram render failure — notice, source, and reason — inside the diagram's own block, with no elements injected anywhere else on the page.
- **FR-002**: The system MUST preserve page layout on diagram failure: no new page-level scrollability, overlays, or banners may appear as a consequence of a failed diagram.
- **FR-003**: The system MUST attempt automatic repair of a faulty diagram's source at render time before presenting a failure, with a bounded number of attempts per diagram.
- **FR-004**: Repair MUST NOT modify the stored message: the conversation record keeps the diagram source exactly as originally emitted.
- **FR-005**: When a displayed diagram was automatically repaired, the interface MUST indicate this and MUST provide access to the original, unrepaired source.
- **FR-006**: Diagrams that render successfully without this feature MUST render identically with it — no visual change, no added user-perceptible delay, and no error flicker.
- **FR-007**: Repair attempts MUST be time-bounded and non-blocking: the chat stays responsive while repair runs, and an over-long repair degrades to failure presentation rather than hanging.
- **FR-008**: The failure presentation for an unrepaired diagram MUST include a plain-language notice and the diagram source in readable form, with the underlying failure reason available on demand instead of dumped inline as raw parser output.
- **FR-009**: For an unrepaired diagram, the system MUST offer a one-action, in-conversation fix affordance that supplies the broken source and failure reason to the assistant and renders the corrected reply as a diagram, leaving the original message unmodified.
- **FR-010**: Repair that depends on a model provider MUST degrade gracefully when no provider is configured or reachable, without errors surfaced mid-chat; provider-independent repairs continue to apply.
- **FR-011**: During streaming, the system MUST NOT present failure visuals or consume repair attempts for a diagram block that is not yet complete.
- **FR-012**: Re-renders (e.g., theme changes) of a repaired diagram MUST reproduce the repaired render stably, without reverting to an error state in between.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of diagram render failures in a representative fault corpus leave the page layout pixel-identical to the pre-failure state (no new page-level scrollbars, banners, or out-of-block elements), verified by automated and visual inspection.
- **SC-002**: At least 90% of a curated corpus of model-produced faulty diagrams — including the exact quoted-label example from the input description — render successfully with zero user action.
- **SC-003**: Valid diagrams render with no user-perceptible change in delay or appearance relative to the pre-feature behavior.
- **SC-004**: Provider-dependent repair cost is predictable: at most one model-assisted repair request per failed diagram, never more.
- **SC-005**: Chats containing failed or repaired diagrams remain fully interactive at all times — during repair, after failure, and across theme changes — with no frozen or corrupted interface states.

## Assumptions

- Repair is a render-time concern only; the conversation transcript is an immutable record, which also keeps existing highlight/anchor offsets valid.
- Repair is layered: deterministic, provider-independent fixes first; a single model-assisted repair attempt as fallback when a provider is configured. This layering is the assumed default, chosen for cost predictability and offline tolerance.
- The repair indication is subtle and adjacent to the diagram (consistent with the interface's existing conventions for showing provenance of displayed content); it is not a modal or prominent interruption.
- Scope is limited to Mermaid diagram blocks inside chat messages; all other rendered content is unaffected, and the existing interactive diagram preview (pan/zoom) is retained as-is.
- Making the model emit fewer broken diagrams in the first place (prompt-side prevention), hand-editing diagrams in the interface, and validating diagram semantics (as opposed to syntax) are out of scope.
- No new persistent data entities are introduced; repair state is derived at render time from the message content.
