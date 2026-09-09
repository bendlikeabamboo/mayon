# Feature Specification: Smooth Streaming — Steady Cadence with a Soft Blur Edge

**Feature Branch**: `022-smooth-streaming`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Streaming chat replies emerge at a steady, calm cadence with a soft blur edge at the growth point — no bursty pop-in — with the look exposed as a single preset-shaped appearance setting. Streamed text currently appears chunk-by-chunk as markdown re-renders, which reads as flicker and makes generation feel cheap; steady cadence plus a soft edge makes streaming feel polished and intentional without touching the markdown DOM shape."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Steady, calm streaming cadence (Priority: P1)

A user sends a chat message and watches the reply generate. Instead of text appearing in irregular, visible chunks (flicker), the reply grows in small, regular increments at a calm, readable pace. When the model finishes, any remaining not-yet-shown text completes smoothly rather than dumping in one final burst.

**Why this priority**: Bursty pop-in is the core pain — it reads as flicker and makes generation feel cheap. The cadence improvement alone already transforms how streaming feels, even without any edge visuals.

**Independent Test**: Stream a long reply with the cadence behavior enabled and observe the growth: text appears in small regular increments with no sudden chunk pop-in, and the end of the stream completes smoothly. Delivers a calm streaming feel on its own.

**Acceptance Scenarios**:

1. **Given** a reply whose text arrives from the model in bursts of varying size, **When** the reply is streaming, **Then** the visible text grows in small, regular increments with no visible large-chunk pop-in at any point.
2. **Given** a fast model that delivers the entire reply almost at once, **When** the stream ends, **Then** all remaining unshown text completes visibly within about a second and does not appear as one sudden dump.
3. **Given** a reply containing prose, code blocks, and lists, **When** text is being revealed, **Then** visible increments never split a word — text appears whole-word or at safe content boundaries.
4. **Given** a model that streams in a slow trickle, **When** text arrives, **Then** display keeps up with arrival — nothing is held back beyond the short smoothing window, and the reply never feels artificially slowed.

---

### User Story 2 - Soft blur edge at the growth point (Priority: P2)

With the edge effect active, the newest text of an in-flight reply emerges through a soft blur/fade at the growing edge, giving streaming a distinct, intentional visual identity. The edge lifts with a short, smooth transition when the reply completes, in step with the final text reveal. The effect yields to content where a blur would look wrong (code blocks, lists, tables) and never interferes with selecting text.

**Why this priority**: The edge supplies the visual identity that makes the calm cadence feel designed rather than merely throttled. It builds on Story 1's pacing to look right, which is why it is second.

**Independent Test**: Enable the edge effect and stream a reply: a soft edge is visible at the growth point in flowing text, is suppressed/softened when the growth point enters a code block, list, or table, and lifts smoothly on completion. Text selection still works during streaming.

**Acceptance Scenarios**:

1. **Given** a streaming reply in flowing prose, **When** new text appears, **Then** a soft blur/fade marks the growing edge of the newest text.
2. **Given** the growth point is inside a code block, list, or table, **When** streaming continues, **Then** the edge effect is suppressed or softened so those elements stay crisp and readable.
3. **Given** the model has finished, **When** the reply completes, **Then** the edge lifts with a short un-blur transition that finishes together with the final text reveal — completion never reads as a burst.
4. **Given** an in-flight reply with the edge effect active, **When** the user selects or copies text, **Then** the edge treatment does not block or intercept those interactions.

---

### User Story 3 - One preset-shaped appearance setting (Priority: P3)

A single appearance setting controls the streaming look, offered as named presets rather than separate toggles:

- **Calm** — steady cadence only, with a plain cursor as the activity indicator (no edge effect).
- **Standard** — today's behavior, unchanged (no cadence smoothing, no edge effect).
- **Expressive** — steady cadence plus the soft blur edge (the full combination).

The choice persists across sessions and applies to subsequent streams. Future visual effects are expected to join this same setting as additional presets instead of growing new toggles.

**Why this priority**: The setting is the delivery vehicle and the extensibility frame, but it carries no value on its own — Stories 1 and 2 define what it serves. Existing users must see no change until they opt in.

**Independent Test**: Open appearance settings, switch between Calm / Standard / Expressive, and stream a reply under each: the look matches the preset's description, Standard matches today's behavior exactly, and the choice survives a restart.

**Acceptance Scenarios**:

1. **Given** a fresh or existing user who has never touched the setting, **When** they check appearance settings, **Then** Standard is preselected and streaming looks exactly as it does today.
2. **Given** the user selects Expressive, **When** they stream a reply, **Then** both the steady cadence and the soft edge are active.
3. **Given** the user selects Calm, **When** they stream a reply, **Then** text still emerges at the steady cadence and only a plain cursor indicates activity — no blur edge.
4. **Given** a chosen preset, **When** the user closes and reopens the app, **Then** the choice is retained.

---

### Edge Cases

- **Stream aborted or errors mid-reply**: all already-arrived text must become fully visible immediately, the edge effect must lift, and nothing may remain hidden or blurred.
- **Regenerate / branch navigation mid-stream**: the pacing state resets cleanly for the new stream; no stale edge treatment is left on the old message.
- **Very fast token arrival**: the reveal rate accelerates so the backlog stays small; the accepted hidden-latency window is a few hundred milliseconds.
- **Very slow trickle**: display never falls behind arrival by more than the smoothing window; a slow model must not feel even slower.
- **Reply ends inside or right after a code block / list / table**: the edge effect must already be suppressed or softened there, and completion must still look clean.
- **Empty or whitespace-only chunks**: no visible stutter or flicker in the cadence.
- **Selection mid-stream under the edge effect**: selecting text beneath a soft blur may look slightly odd — accepted as rare; the effect must still let the selection through.
- **Copy during streaming**: copies the currently visible text, consistent with today's behavior, and works with the effect active.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST reveal incoming reply text at a steady, calm cadence while streaming, instead of showing text in irregular chunks as it arrives.
- **FR-002**: Text MUST be revealed on safe boundaries — never splitting a word mid-reveal — including in replies containing code blocks, lists, and tables.
- **FR-003**: The reveal rate MUST increase as the amount of arrived-but-unshown text grows, keeping the display lag within the accepted window (a few hundred milliseconds) even for fast models.
- **FR-004**: At stream end, the system MUST complete any remaining unshown text with an eased final reveal so the end of a reply never appears as a sudden dump.
- **FR-005**: The system MUST guarantee that all text the model actually delivered becomes visible: on completion, on abort, and on error, nothing arrived may remain hidden.
- **FR-006**: When the full effect is enabled, the system MUST present a soft blur/fade treatment at the growing edge of the newest text of an in-flight reply.
- **FR-007**: The soft edge MUST lift with a short un-blur transition when the reply completes, finishing in step with the final text reveal.
- **FR-008**: The soft edge MUST be suppressed or softened when the growth point is non-flowing content (code block, list, table) so those elements remain crisp.
- **FR-009**: The soft edge treatment MUST NOT block text selection, copying, or any existing interaction with the reply content.
- **FR-010**: The feature MUST NOT change how reply content is structured such that existing capabilities regress: source-linked selection/highlight alignment (expound), full-text search, and copy buttons MUST behave exactly as they do today, during and after streaming.
- **FR-011**: The system MUST expose the streaming look as a single appearance setting with preset choices — Calm (steady cadence, plain cursor), Standard (current behavior), Expressive (cadence + soft edge).
- **FR-012**: The setting MUST default to Standard, so existing users see no change until they opt in.
- **FR-013**: The chosen preset MUST persist across sessions and apply to subsequent streams without requiring a reload.
- **FR-014**: The setting MUST be shaped so additional visual-effect presets can be added later without introducing separate toggles.

### Key Entities *(include if feature involves data)*

- **Streaming appearance preference**: a per-user presentation choice selecting exactly one preset (Calm / Standard / Expressive) from the single appearance setting; persisted across sessions; extended over time by additional effect presets rather than new settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Watching a streamed reply, text growth appears continuous and regular — no visible chunk pop-in at any point during at least 95% of a reply's streaming duration, including the final second.
- **SC-002**: While streaming, text that has arrived but is not yet shown never exceeds roughly half a second of lag; after the stream ends, 100% of delivered text is visible within about one second, without a visible dump.
- **SC-003**: With the full effect enabled, expound selection alignment, full-text search, and copy buttons work identically to today during and after streaming — zero regressions in existing behavior.
- **SC-004**: Switching presets takes effect on the next stream (or the running stream) without a page reload, and the choice is still in effect after restarting the app.
- **SC-005**: Fast models do not feel throttled: a reply that the model finishes quickly appears fully revealed within about one second of the model finishing, regardless of preset.
- **SC-006**: Qualitative: observers describing a streamed reply with Expressive enabled use words like "calm," "smooth," or "polished" rather than "flickery" or "jumpy."

## Assumptions

- Preset names (Calm / Standard / Expressive) follow the feature proposal's example naming; final labels are a design decision to settle during planning, while the three-level structure (none-with-cursor / today / full effect) is fixed.
- The default preset is Standard — today's behavior — so the feature is strictly opt-in.
- The deliberate latency of a few hundred milliseconds between arrival and display is an accepted product decision made during pre-spec evaluation.
- Scope is limited to assistant chat reply text streaming; other progressive UI (tool activity indicators, status lines) is unaffected.
- No per-word effects gallery: typewriter, drop-in, and span-level effects are out of scope; one effect family delivered through the preset dial.
- The chat pipeline gains one more internal stateful stage (the pacing layer) to test and maintain — an accepted complexity trade-off.
