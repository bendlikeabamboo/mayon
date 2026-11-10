# Feature Specification: Micro-Thoughts Follow-Up Fixes (029 defects)

**Feature Branch**: `fix/issue-71-micro-thoughts`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Issue #71 (P3) — micro-thoughts (029): critic correction drops reasoning, live blocks duplicate, regenerate breaks on multi-row turns; plus paced-preset per-block drain stalls, finished thoughts keep pulsing, trace keeps a trailing whitespace-only reasoning segment, and missing regression tests for all of the above."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Self-corrected replies keep their micro-thoughts (Priority: P1)

A learner asks a question; the model's reply contains malformed markdown (a broken mermaid
fence), the built-in critic detects it, and the model re-emits a corrected reply. Before
feature 029 the iteration's reasoning was persisted unconditionally; today the corrected
reply is persisted as one fresh row while the original stream's micro-thoughts are silently
dropped — after a reload the self-corrected answer shows no thought process at all. The user
expects the original stream's reasoning segments to survive next to the corrected answer.

**Why this priority**: Permanent data loss in the persisted timeline (high severity in the
issue); every self-corrected reply with reasoning is affected.

**Independent Test**: A scripted turn whose original stream interleaves reasoning + malformed
text and whose critic re-emit produces corrected text persists, in order: the original
stream's anchored reasoning row(s), then the corrected text row; a no-correction turn still
persists reasoning exactly once.

**Acceptance Scenarios**:

1. **Given** a streamed reply with one or more reasoning segments followed by malformed text
   that the critic corrects, **When** the turn finishes, **Then** the persisted timeline
   contains the original reasoning rows (arrival order, anchored) followed by the corrected
   text row, and this survives reload.
2. **Given** a valid reply (no correction), **When** the turn finishes, **Then** reasoning
   rows persist exactly once — the fix introduces no double-persist.
3. **Given** a correction re-stream that itself emits reasoning deltas, **When** the
   corrected row persists, **Then** the correction's own reasoning remains discarded (029
   research D6 unchanged).

---

### User Story 2 - Each live thought appears once and stops pulsing when finished (Priority: P2)

During a multi-iteration turn (reasoning → text → tool call → reasoning → text), the live
timeline keeps every prior iteration's live block next to the just-persisted durable rows,
so finished thoughts render twice and a stale empty text bubble lingers. Separately, an
earlier finished reasoning burst keeps its pulsing "still thinking" dot because nothing
ever closes a live reasoning block until the whole turn ends. The user expects each thought
to appear exactly once, and a finished burst to look finished while later blocks stream.

**Why this priority**: Visible duplication and a misleading streaming indicator on every
tool-using turn with reasoning; core to 029's live-timeline promise.

**Independent Test**: A two-iteration scripted turn (iteration 1: reasoning + text + tool
call; iteration 2: reasoning + text) shows each thought exactly once in the live timeline
(the persisted row replaces the live block at each iteration boundary), and a completed
reasoning burst carries a non-streaming indicator while the next block streams.

**Acceptance Scenarios**:

1. **Given** iteration 1 persisted its reasoning and text rows and a tool call is running,
   **When** iteration 2's reasoning starts streaming, **Then** the live timeline shows only
   iteration 2's live reasoning — no duplicate of iteration 1's persisted thought and no
   stale empty live text bubble.
2. **Given** a reasoning burst has ended and text is now streaming in the same iteration,
   **When** the live timeline renders, **Then** the finished burst no longer shows the
   pulsing (active-streaming) indicator while it remains visible.
3. **Given** the whole turn ends (finish or abort), **When** the timeline settles, **Then**
   no live blocks remain (029 terminal-closure rule unchanged).

---

### User Story 3 - Regenerate replaces the whole interleaved assistant turn (Priority: P2)

An interleaved reply persists as multiple rows (reasoning, text, reasoning, text, trailing
reasoning). The regenerate affordance only appears when the newest timeline item is an
assistant text message — a turn ending on a trailing thought hides the button — and when
the turn does end on text, regenerate deletes only that one row, leaving the earlier
reasoning/text rows of the same reply orphaned ahead of the fresh reply. The user expects
regenerate to remain available and to remove the entire assistant turn.

**Why this priority**: Broken affordance + corrupted timeline on every multi-row turn;
directly regresses 029's interleaved persistence.

**Independent Test**: A persisted turn of [user, reasoning, text, reasoning(trailing,
anchored)] offers regenerate (anchored on the text row), and activating it deletes every
row after the user message (reasoning + text + trailing reasoning) before re-sending.

**Acceptance Scenarios**:

1. **Given** the newest timeline items are an assistant text row followed by a trailing
   anchored reasoning row, **When** generation is idle, **Then** the regenerate affordance
   is available on that turn's last assistant text row.
2. **Given** regenerate is activated on a multi-row assistant turn, **When** it runs,
   **Then** all rows of that assistant turn back to the previous user message (reasoning,
   text, self-corrected, tool rows) are deleted, and the user turn is re-sent.
3. **Given** a legacy turn ending on an unanchored (pre-029) reasoning row, **When** the
   gate is evaluated, **Then** regenerate stays hidden (legacy repair semantics unchanged).

---

### User Story 4 - Paced presets do not stall between text blocks (Priority: P3)

On a non-standard streaming preset, an interleaved turn persists one row per text block.
The deferred finalize drain runs on every append; after the first block the store has
cleared the buffer and reset the pacer, so each extra block waits the full drain deadline
(~1.2 s) while the pacer has nothing to release. A turn with N text blocks adds roughly
(N−1)×1.2 s of dead waiting. The user expects pacing to cost at most one drain per turn.

**Why this priority**: Latency-only, no data loss; standard preset unaffected.

**Independent Test**: On a paced preset, a scripted multi-block interleaved turn's rows
persist without any per-block deadline wait — the drain runs at most once for the turn
(the finalize append that still has unflushed buffer content).

**Acceptance Scenarios**:

1. **Given** a paced preset and a multi-block turn, **When** the later blocks' rows
   persist, **Then** no drain-deadline wait occurs for them (the buffer was already
   flushed/cleared by the first finalize append).
2. **Given** a paced preset and a single-block turn, **When** the turn finishes,
   **Then** the eased drain still runs once before the durable row replaces the live
   bubble (022 behavior preserved).
3. **Given** the standard preset, **When** any turn finishes, **Then** finalize persists
   immediately with no drain wait (unchanged).

---

### User Story 5 - The trace shows no phantom reasoning segment (Priority: P3)

The diagnostics trace prunes a whitespace-only reasoning segment only when the next
reasoning-start arrives. A whitespace-only final burst survives to the trace while the
agent loop never persisted a row for it, so the diagnostics panel renders a phantom
segment. The user (developer inspecting a trace) expects the trace's segment list to match
what the loop actually persisted.

**Why this priority**: Diagnostics-only divergence; low impact.

**Independent Test**: A scripted stream ending with a whitespace-only reasoning burst
produces a trace whose segment list drops it at the segment's end / stream finish, while a
real trailing thought (non-whitespace) is kept.

**Acceptance Scenarios**:

1. **Given** a stream whose final reasoning burst is whitespace-only, **When** the segment
   closes or the stream finishes, **Then** the trace's segment list no longer contains it.
2. **Given** a stream ending with a real (non-whitespace) trailing thought, **When** the
   trace is built, **Then** that segment is kept.

---

### Edge Cases

- Correction re-emit aborted mid-stream: whichever text wins (fresh partial or original),
  the original stream's reasoning rows still persist and no live blocks survive.
- Tool-budget exhaustion path (direct append after the loop's final interim persist):
  reasoning was already persisted by the interim walk; the boundary signal is a no-op.
- Correction that produces text identical to the original buffer: takes the normal block
  walk — reasoning persists exactly once (no correction-specific double-persist).
- Image-bearing corrected turns: images append after the corrected text (033 §2 unchanged);
  reasoning rows persist before the corrected row.
- Multi-text-block finalize on a paced preset: only the first block's append drains (the
  buffer empties); later finalize blocks skip the wait.
- A trailing whitespace-only segment with no following reasoning-start (closed by text-start
  or finish): pruned by the new finish/close rules.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a critic correction replaces the reply text, the system MUST persist the
  original stream's reasoning segments as anchored reasoning rows (arrival order, whitespace-only
  segments dropped) BEFORE appending the corrected text row.
- **FR-002**: When no correction changes the text (or the correction returns identical text),
  the system MUST persist reasoning exactly once via the normal block walk — the corrected-path
  persist MUST NOT add a second set of rows.
- **FR-003**: The agent loop MUST signal an iteration boundary — after each iteration's blocks
  are persisted (interim tool-boundary walk and the turn's finalize persist) and when a critic
  correction re-emit begins — and the live timeline MUST close and clear its live blocks at
  that signal, so a persisted thought never remains duplicated as a live block into the next
  iteration.
- **FR-004**: A live reasoning entry MUST carry whether its burst is still streaming; the
  streaming indicator MUST show only while the burst is open, and the store MUST close open
  reasoning blocks when a new reasoning or text segment starts.
- **FR-005**: The regenerate affordance MUST be available when the last assistant turn ends on
  a trailing anchored reasoning row, anchored on that turn's last assistant text row; trailing
  unanchored (legacy) reasoning MUST NOT enable it.
- **FR-006**: Regenerate MUST delete every row of the targeted assistant turn back to the
  previous user message (reasoning, assistant text, self-corrected, tool rows) before re-sending
  the user turn.
- **FR-007**: On non-standard presets, the deferred finalize drain MUST run at most once per
  turn — only for a finalize append that still has unflushed buffer content; interim and
  later-block appends MUST NOT wait on the drain deadline.
- **FR-008**: The turn trace MUST prune a trailing whitespace-only reasoning segment when the
  segment closes or the stream finishes (not only on the next reasoning-start), while keeping
  non-whitespace trailing segments.
- **FR-009**: Regression coverage MUST include: original-stream reasoning + critic correction;
  a two-iteration turn asserting live-block reset; regenerate on a multi-row turn; and a
  fast-tier test driving the interleaved mock script shape through the store/loop seams. An
  e2e driving the interleaved mock in the browser is included as an optional,
  maintainer-verifiable task (requires the dev stack).

### Key Entities *(include if feature involves data)*

- **LiveBlock (amended)**: the store's ordered live segments of the in-flight turn; gains the
  rule that a reasoning block's `open` flag is honored in the live timeline (streaming
  indicator) and that all live blocks clear at iteration boundaries, not only turn
  start/teardown.
- **PersistBlock (unchanged shape)**: the loop's shadow of an iteration's blocks; the
  corrected-critic path now consumes its reasoning entries before the corrected append.
- **Reasoning row (durable, unchanged shape)**: `kind: 'reasoning'` with
  `metadata: {iteration, anchored: true}` — the fix only adds writers on the corrected path.
- **Assistant turn (timeline notion, new)**: the run of non-user rows after a user message up
  to the next user message; regenerate scope and the trailing-anchored-reasoning gate are
  defined over it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every self-corrected reply that streamed reasoning shows its original
  micro-thoughts after reload (verified by a fail-first persistence test).
- **SC-002**: In a two-iteration turn, each reasoning burst appears exactly once in the live
  timeline at every point in time (verified by a fail-first store test).
- **SC-003**: Regenerate is offered on a turn ending in an anchored trailing thought and
  removes 100% of that turn's rows back to the previous user message (fail-first tests).
- **SC-004**: On paced presets, an N-text-block turn performs at most one drain wait per turn
  (zero deadline stalls for blocks after the first finalize append) — fail-first timing test.
- **SC-005**: For a stream ending in a whitespace-only burst, the trace's segment list equals
  the set of reasoning rows the loop persisted (fail-first trace test).
- **SC-006**: A fast-tier regression test replaying the interleaved mock's frame order passes
  without any browser or dev stack.

## Assumptions

- The iteration-boundary signal is a new optional `AgentTurnDeps` callback (named
  `onIterationBoundary`) fired by the loop; the store clears `liveBlocks` in response. This
  amends the 029 stream-segments store contract ("cleared at turn start/teardown") — the
  amendment is documented in this feature's contracts.
- The drain-once mechanism reuses the 033 `final` append marker plus an unflushed-buffer
  check; interim (non-final) appends no longer wait for the eased drain. This narrows the
  022 deferred-finalize behavior to the turn's finalize appends — documented as an amendment.
- Regenerate scope is "all rows after the previous user message of the targeted turn"
  (including tool and self-corrected rows); the page handler delegates to a store method so
  the scope is unit-testable without mounting the route.
- The e2e for the interleaved mock is optional and maintainer-verifiable (needs the Docker
  dev stack); fast-tier coverage via the store/loop seams is the required bar.
- No schema, projection, or mock-protocol changes; the mock's `[[interleaved-thoughts]]`
  script and contract stay as shipped in 029.

## Open Questions

_None blocking._ Residual (accepted, documented in the plan): on paced presets, interim
text blocks persist without waiting for their eased tail reveal (the buffer is cleared at
persist anyway; the alternative would re-introduce per-block waits).
