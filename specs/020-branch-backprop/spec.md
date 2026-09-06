# Feature Specification: Branch Back-Propagation (Anchored Context Artifacts)

**Feature Branch**: `020-branch-backprop`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Branched chats can push their outcomes back into the parent chat's context as user-controlled, anchored, collapsible artifacts, so the parent stays in sync with decisions and fixes made on the branch. The parent silently keeps stale assumptions — it still believes code it produced is correct even after the user fixed it on a branch — so resuming the parent produces answers based on a version of reality the user already moved past. From the branch the user triggers an explicit, user-controlled back-propagate: either the raw branch delta (the branch-only turns plus the anchored excerpt, verbatim) or a model-written summary of what happened. The payload lands in the parent as a persisted artifact — a new entry kind on the existing message model (the same collapsible pattern as tool calls and reasoning), anchored exactly at the branch point in the parent thread. It sits where it was generated and scrolls up as new turns arrive, steering every future composition of the parent. Nothing existing is moved or rewritten — the operation is purely additive."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Propagate a branch outcome into the parent chat (Priority: P1)

A user branched off a parent chat to fix an error, and the fix works on the branch. From the branch, the user triggers an explicit back-propagate action and chooses the payload: the raw branch delta (branch-only turns plus the anchored excerpt at the branch point, verbatim) or a model-written summary of what happened on the branch. The payload lands in the parent chat as a persisted, collapsible artifact — a distinct kind of message entry — positioned exactly at the branch point in the parent thread. The parent chat's own messages are untouched; the artifact is inserted, not merged.

**Why this priority**: This is the core loop. Without the ability to move a branch outcome into the parent as a real, anchored artifact, nothing else in the feature has value.

**Independent Test**: Can be fully tested by creating a branch of a chat, completing at least one exchange on the branch, triggering back-propagation with each payload mode, and verifying an anchored artifact appears in the parent at the branch point with the expected content and no existing messages altered.

**Acceptance Scenarios**:

1. **Given** a branch with at least one branch-only exchange, **When** the user triggers back-propagation and chooses the raw delta, **Then** the parent chat gains a collapsible artifact at the branch point whose content is the branch-only turns plus the anchored excerpt, verbatim.
2. **Given** a branch with at least one branch-only exchange, **When** the user triggers back-propagation and chooses the summary, **Then** a model-written summary of the branch outcome is produced and lands in the parent as an anchored, collapsible artifact.
3. **Given** a propagation has just landed, **When** the user inspects the parent chat, **Then** every pre-existing parent message — before and after the anchor — is exactly as it was, and the artifact sits between them at the branch point.
4. **Given** the artifact in the parent, **When** the user views it, **Then** it is visually consistent with existing collapsible message entries (such as tool calls and reasoning) and clearly labeled with its origin (source branch and payload mode).

---

### User Story 2 - The parent resumes with corrected context (Priority: P2)

After propagation, the user returns to the parent chat and continues the conversation. The model's future answers in the parent account for the propagated artifact: the stale assumption (for example, that code the parent produced is still broken) no longer silently persists. The artifact steers every future composition of the parent because it is a real part of the parent's message history, not an overlay or a side note.

**Why this priority**: Moving the payload is worthless if the parent keeps answering from stale assumptions. This story is the actual payoff — the parent's future answers reflect reality as the user moved it forward.

**Independent Test**: Can be fully tested by propagating a correction (e.g., "the code from turn N was fixed to do X instead of Y") from a branch, then asking the parent a question whose correct answer requires that correction, and verifying the answer reflects the propagated context without the user restating it.

**Acceptance Scenarios**:

1. **Given** a propagated artifact describing a fix to earlier parent output, **When** the user resumes the parent and asks a question the stale assumption would answer wrongly, **Then** the answer reflects the corrected state conveyed by the artifact.
2. **Given** a parent chat that gained new turns after the artifact landed, **When** the user sends another message, **Then** the artifact remains part of the conversation as earlier history and continues to inform composition.
3. **Given** a propagated artifact, **When** the user scrolls the parent conversation, **Then** the artifact scrolls up with the history like any other message entry, anchored at the branch point rather than pinned to the bottom.

---

### User Story 3 - Review and manage propagated artifacts (Priority: P3)

Propagated artifacts behave like other collapsible message entries: collapsed by default, expandable to read in full. Because the summarized payload is model-written and can drop a crucial detail, the user can delete an artifact from the parent or regenerate a summary (raw-delta artifacts do not need regeneration — they are verbatim by construction).

**Why this priority**: The propagation is user-controlled and trustworthy only if the user retains authority over the artifact after it lands. Management affordances protect against summary fidelity loss but deliver no value before the core loop works.

**Independent Test**: Can be fully tested by propagating a summary, expanding and collapsing it, regenerating it and verifying a new summary replaces the old one, then deleting it and verifying it disappears from both the rendered conversation and future composition.

**Acceptance Scenarios**:

1. **Given** a propagated artifact in the parent, **When** the user toggles it, **Then** it collapses to a compact labeled strip and expands to show the full payload, in the same interaction pattern as other collapsible entries.
2. **Given** a summary artifact, **When** the user chooses regenerate, **Then** a new summary is generated from the same branch outcome and replaces the previous one, staying anchored at the same position.
3. **Given** any propagated artifact, **When** the user deletes it, **Then** the artifact is removed from the parent conversation and no longer informs future answers; no other message is affected.

---

### User Story 4 - Artifacts are durable history (Priority: P3)

A propagated artifact is part of the parent conversation's record. Reloading the app, returning to the conversation later, and restoring from a backup all show the artifact exactly as it landed, anchored where it was created. Full-text search over conversation history is unaffected.

**Why this priority**: Durability is required for correctness — an artifact that vanishes on reload would silently break the feature's promise — but it delivers no new standalone value beyond what existing message persistence already provides.

**Independent Test**: Can be fully tested by propagating an artifact, reloading the app and verifying it is still anchored and rendered; searching for a word from its content and verifying search behaves as before; then performing a backup-and-restore cycle and verifying the artifact survives.

**Acceptance Scenarios**:

1. **Given** a propagated artifact, **When** the user reloads the app or reopens the conversation, **Then** the artifact is present, anchored at the branch point, with content and origin labels intact.
2. **Given** a conversation containing a propagated artifact, **When** the user performs a backup and later restores it, **Then** the artifact is present and rendered correctly afterwards.
3. **Given** a conversation containing a propagated artifact, **When** the user searches conversation history for text in regular messages, **Then** search results are unchanged by the artifact's presence.

---

### Edge Cases

- What happens when the branch has no branch-only content (the user branched but never diverged)? Propagation is unavailable in that state; there is no delta to move. The control is hidden or disabled with an explanatory reason rather than producing an empty artifact.
- What happens when the parent kept living during the branch (parent turns exist between the branch point and the propagation moment)? The artifact stays anchored at the branch point. The turns generated in between sit after the artifact and are not rewritten — their staleness is an accepted, on-the-record trade-off of anchoring over history rewriting.
- What happens on a branch of a branch (deep nesting)? Propagation targets the immediate parent only. Reaching a grandparent requires propagating up one level at a time.
- What happens when summary generation fails (model error, timeout)? The user sees a clear failure, nothing lands in the parent, and both retrying the summary and choosing the raw delta remain available.
- What happens when the user propagates the same branch more than once? Each propagation creates its own artifact anchored at the branch point; none replaces or rewrites a previous one. Deleting is the removal path.
- What happens when the raw delta is very large (long branch with many tool turns)? The artifact stores the full verbatim payload and renders collapsed; nothing is silently truncated.
- What happens when the source branch is later deleted? The already-propagated artifact lives in the parent as an independent persisted entry and is unaffected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST offer an explicit, user-initiated back-propagation action from a branched chat to its immediate parent chat. Propagation MUST NOT happen implicitly or automatically.
- **FR-002**: On triggering propagation, the system MUST offer exactly two payload modes: (a) the raw branch delta — the branch-only turns plus the anchored excerpt at the branch point, verbatim — and (b) a model-written summary of the branch outcome.
- **FR-003**: The propagated payload MUST land in the parent chat as a persisted, collapsible message entry of a new entry kind, rendered consistently with existing collapsible entries (tool calls, reasoning) and labeled with its source branch and payload mode.
- **FR-004**: The artifact MUST be anchored exactly at the branch point in the parent thread and remain there permanently; parent turns created after propagation MUST appear after it as normal history.
- **FR-005**: The operation MUST be purely additive: no existing message in the parent or the branch may be moved, edited, reordered, or deleted by a propagation.
- **FR-006**: The raw delta MUST contain the branch-only turns verbatim. For content edited mid-turn on the branch, the final state MUST be used; tool-call turns on the branch MUST be included as they appear in the branch transcript.
- **FR-007**: The summary mode MUST be produced from the branch's outcome; the user MUST be able to regenerate a summary (replacing the prior one in place at the same anchor) and delete any artifact.
- **FR-008**: Every future composition of the parent conversation MUST include propagated artifacts as part of the conversation history, so that new parent answers account for their content.
- **FR-009**: Propagation MUST target the immediate parent only; the system MUST NOT propagate to grandparents, siblings, or other existing or future branches.
- **FR-010**: Propagation MUST be unavailable (hidden or disabled with a stated reason) when the branch has no branch-only content relative to the parent.
- **FR-011**: A propagation MUST be atomic: either the artifact is fully persisted in the parent or the parent is left completely unchanged.
- **FR-012**: Propagated artifacts MUST persist across app reloads and MUST be included in the existing backup and restore behavior like other message entries.
- **FR-013**: Summary generation failure MUST leave the parent unchanged, surface a clear error to the user, and leave both retry and raw-delta paths available.

### Key Entities *(include if feature involves data)*

- **Propagated context artifact**: A distinct kind of message entry in a conversation. Attributes: payload content (verbatim delta or summary text), payload mode (raw/summary), reference to the source branch, anchor position at the branch point in the parent thread, origin labels shown to the user, creation and regeneration timestamps. Belongs to the parent conversation's message history like any other entry.
- **Branch relationship**: The existing parent/branch linkage between two conversations, including the branch point — the shared position in the parent thread from which the branch diverged, and the locus of the anchored excerpt.
- **Anchored excerpt**: The shared exchange at the branch point, included verbatim in a raw-delta payload so the artifact reads as a real artifact of that moment in the parent thread.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After propagating a correction from a branch, resuming the parent produces answers consistent with that correction in 100% of test cases where the stale assumption would otherwise have produced a demonstrably wrong answer, without the user restating the fix.
- **SC-002**: A raw-delta propagation lands in the parent in under 2 seconds; a summary propagation completes within the app's normal answer latency for the connected model (under 30 seconds in typical use).
- **SC-003**: After any propagation, a comparison of all pre-existing parent and branch messages shows zero changes (no edits, moves, or deletions).
- **SC-004**: A propagated artifact survives an app reload and a backup-and-restore cycle with content, anchor position, and origin labels intact.
- **SC-005**: A user completes the propagate flow — trigger, choose mode, confirm landing — in under 30 seconds and no more than 5 interactions.

## Assumptions

- Propagation targets the immediate parent only (on-record ruling for deep branching; broader reach can be a follow-on).
- Anchoring at the branch point was chosen over history rewriting; the "stale middle" (parent turns generated between anchor and propagation) is an accepted trade-off and is not addressed by this feature.
- Raw-delta policy defaults: branch-only turns verbatim, final state of mid-turn edits, tool calls included as they appear on the branch. Refining this policy further is a planning-stage concern.
- Multiple propagations from the same branch are allowed; each is an independent, additive artifact.
- The new entry kind becomes a permanent part of the message model (accepted trade-off), reusing the established collapsible-entry rendering pattern rather than introducing a new UI primitive.
- The summarized mode costs one extra model round-trip per propagation (accepted trade-off).
- The feature applies wherever branching exists today; it requires the same server-backed storage chats already depend on, and no new runtime capability beyond what chats already use.
- On the record as rejected: plain sync notes, divergence markers, branch promotion, and a tree-scoped decision ledger with a separate store.
