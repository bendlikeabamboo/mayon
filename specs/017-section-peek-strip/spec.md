# Feature Specification: Section Peek Strip

**Feature Branch**: `017-section-peek-strip`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "For long, header-structured replies, render a slim hover-peek bar strip along the reply's edge — one bar per section, sized proportionally — that at rest is a near-invisible hairline, fattens on hover, pops a preview card on dwell, and smooth-scrolls the transcript to the section on click. Winner of ideas/003-chat-outline (Card 006); runner-up Card 001 (floating panel) is the future upgrade path."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a long reply's shape and jump to a section via the strip (Priority: P1)

A user receives an assistant reply that is long and structured with section headings. Along the reply's edge appears a slim strip: one small horizontal bar per section, each bar sized in proportion to its section's length, so the reply's shape is readable at a glance. At rest the strip is a subtle hairline that does not demand attention. The user moves the pointer to the strip, the bars fatten to become an interactive map, and clicking a bar smooth-scrolls the transcript so that section sits at the top of the viewport. The user reaches any section in about two interactions with no permanent screen chrome.

**Why this priority**: This is the core value from the chosen card — glanceable structure plus a fast jump. It stands alone: no preview, no settings work, and it already solves the "long reply, where was that part?" problem.

**Independent Test**: Can be fully tested by opening a long multi-section reply, confirming the hairline strip appears, hovering it, clicking a bar, and confirming the viewport lands on that section — plus confirming short replies show no strip.

**Acceptance Scenarios**:

1. **Given** an assistant reply that exceeds the length/section threshold with three or more sections, **When** the user views it, **Then** a slim strip is present along the reply's edge with exactly one bar per section, sized proportionally to each section's length, in document order.
2. **Given** a strip at rest, **When** the user looks at the conversation, **Then** the strip reads as a subtle hairline and does not displace, overlay, or push any reply content.
3. **Given** the strip is visible, **When** the user hovers over it, **Then** the bars fatten into a clearly readable map without shifting the conversation layout.
4. **Given** the bars are fattened, **When** the user clicks a bar, **Then** the transcript's scroll container smoothly scrolls so that section's heading rests at the top of the viewport — correct even when the conversation holds multiple long replies.
5. **Given** an assistant reply below the threshold (short, or fewer than the minimum sections), **When** the user views it, **Then** no strip appears for that reply.
6. **Given** a reply with two identically titled sections, **When** the user clicks the second section's bar, **Then** the viewport lands on the second occurrence — never the first.

---

### User Story 2 - Dwell on a bar to preview the section before jumping (Priority: P2)

While using the strip, the user wants to confirm a bar is the section they want before committing to the jump. Pausing the pointer deliberately on a bar — after a short, tuned dwell — pops a small preview card showing that section's heading and its opening lines as plain text. Merely crossing the strip on the way to something else never fires a preview, and the preview dismisses promptly when the pointer leaves. Clicking the preview, or the bar under it, performs the same smooth-scroll jump as clicking a bar directly.

**Why this priority**: The preview is what makes the strip a "peek" affordance rather than a blind jump list; it builds directly on Story 1's strip and jump machinery and materially raises confidence in the jump.

**Independent Test**: Can be fully tested by hovering a bar and holding still until the preview appears (showing the right heading and opening lines), clicking it to jump, then brushing across the strip without pausing and confirming no preview fires.

**Acceptance Scenarios**:

1. **Given** a fattened strip, **When** the user pauses the pointer on a bar for the dwell duration, **Then** a preview card appears showing that section's heading and the opening lines of its content as plain text (no raw markup, no half-rendered formatting).
2. **Given** the pointer sweeps across the strip without pausing, **When** it crosses several bars quickly, **Then** no preview card appears.
3. **Given** a preview card is open, **When** the pointer leaves the strip and preview area, **Then** the preview dismisses promptly without lingering.
4. **Given** a preview card is open, **When** the user clicks the preview (or the bar beneath it), **Then** the transcript scrolls to that section exactly as a direct bar click would.
5. **Given** a reply was edited or regenerated after previews were shown, **When** the user dwells on a bar again, **Then** the preview shows that section's current heading and opening lines — never stale text from the previous version.

---

### User Story 3 - Turn the strip on and off with a persisted setting (Priority: P3)

The user can switch the section strip off entirely from settings. With it off, no strip, hover behavior, or preview appears on any reply — the transcript looks exactly as it does today. The preference persists: it survives closing and reopening the app, and switching it back on restores the strip everywhere it applies.

**Why this priority**: An explicit requirement guaranteeing user control, but it is a thin layer over Stories 1–2 and delivers no value on its own without the strip existing.

**Independent Test**: Can be fully tested by toggling the setting off (strip vanishes from all qualifying replies), restarting the session (preference holds), toggling it back on (strip returns).

**Acceptance Scenarios**:

1. **Given** the strip is active on qualifying replies, **When** the user turns the setting off, **Then** every strip disappears immediately — no bars, hover affordances, or previews — and reply layout is otherwise unchanged.
2. **Given** the setting was turned off, **When** the user closes and reopens the app, **Then** the strip remains off and qualifying replies show no strip.
3. **Given** the setting is off, **When** the user turns it back on, **Then** strips reappear on all currently qualifying replies with correct bars and working jumps.

---

### Edge Cases

- How does the strip behave while a reply is still streaming in? It must not thrash: the strip does not appear until the reply finishes streaming (or otherwise reaches a stable, complete set of sections), so bars never jitter as headings arrive; once shown it reflects the final structure.
- What happens when a reply is extremely long with dozens of sections? The strip stays slim and usable: bars remain individually hoverable (a minimum usable size for very short sections), and long content compresses proportionally rather than overflowing.
- How are heading-like fragments inside code blocks, quotations, tables, math, or other generated content handled? They are excluded — only the reply's real document headings produce sections, using the same rendered structure the reply display already uses. The reply's markdown source is never altered to build the outline.
- What happens when a user edits or regenerates a reply that has a strip? The strip hides while the new content streams, then reappears for the finished reply with correct bars and refreshed section excerpts.
- What about touch devices, where there is no hover? On touch input there is no dwell-preview step: tapping a bar jumps directly to that section. (A deliberate choice of tap-to-jump over hiding the strip, preserving the affordance on touch.)
- Does the strip steal scrolling or block reply interactions? No: wheel and touch scrolling over the strip scrolls the transcript normally, and text selection, the expound/highlight feature, and copy affordances inside replies behave identically whether or not the strip is present.
- Do the strip and preview interfere with text selection alignment (expound/highlight offsets)? They must not: because they are injected elements containing text, they are excluded from the selection-to-source alignment machinery, so selections and highlights inside replies keep resolving to correct source offsets.
- What happens when the user clicks a bar while a previous smooth scroll is still in flight? The destination is stable: the final resting position is always the correct section top, and repeated clicks never stack side effects.
- What happens when a user with a reduced-motion preference clicks a bar? The jump moves without animation while landing at exactly the same position, with no other behavioral difference.
- What happens when only one section exists (a single heading atop a long reply)? No strip appears — a one-bar map has nothing to navigate between.
- Where-am-I position marker (a live indicator of the current viewport on the strip)? Explicitly deferred: it is the upgrade path toward the floating-panel card and is excluded from this first cut to keep risk low.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST show a section strip on an assistant reply when, and only when, the reply qualifies: it has finished streaming, contains at least three sections delimited by document headings, and its rendered height exceeds roughly one viewport of the transcript. Replies failing any part of this threshold MUST show no strip.
- **FR-002**: The strip MUST present exactly one bar per section, in document order, with each bar's size proportional to its section's share of the reply's length; very short sections MUST retain a minimum bar size that keeps them individually reachable.
- **FR-003**: At rest the strip MUST be a subtle hairline that does not overlap, displace, or reflow any conversation content; the fattened hover state MUST likewise cause no layout shift.
- **FR-004**: Hovering the strip MUST fatten its bars into an interactive map; the pointer must land on a generous hit area per bar so small sections remain easy to target.
- **FR-005**: Deliberately dwelling on a bar (a short, fixed pause) MUST open a preview card showing that section's heading and the opening lines of its content as plain text; sweeping across the strip without pausing MUST NOT open any preview.
- **FR-006**: The preview MUST dismiss promptly when the pointer leaves the strip and preview area, and MUST NOT remain after the pointer moves on.
- **FR-007**: Clicking a bar or its preview MUST smooth-scroll the transcript's scroll container so that section's heading rests at the top of the viewport, landing on the correct occurrence even with duplicate headings or multiple long replies in the conversation.
- **FR-008**: The strip and its data MUST be derived only from the reply's rendered document headings via the existing markdown rendering path; the reply's markdown source MUST NOT be mutated, and heading-like content inside code blocks, quotations, tables, and math MUST be excluded.
- **FR-009**: Section previews MUST be served from plain-text excerpts cached per section; the cache MUST refresh when the reply is edited or regenerated so previews never show stale content.
- **FR-010**: While a reply is streaming, the strip MUST NOT appear (and any existing strip on that reply MUST hide), preventing mid-stream reflow or thrash; it appears once the reply completes.
- **FR-011**: On touch input there is no dwell step: tapping a bar MUST jump directly to that section without showing a preview.
- **FR-012**: The strip MUST NOT intercept wheel or touch scrolling — scrolling over it MUST scroll the transcript normally — and MUST NOT block text selection, the expound/highlight feature, or copy interactions within the reply.
- **FR-013**: The strip and preview are injected elements containing text; the system MUST exclude them from the selection-to-source alignment machinery so text selections and highlights inside replies continue to resolve to correct source offsets.
- **FR-014**: A setting MUST turn the strip on and off; when off, no strip affordance of any kind appears on any reply. The preference MUST persist across sessions.
- **FR-015**: Jump navigation MUST respect the user's reduced-motion preference by scrolling without animation to the identical landing position.
- **FR-016**: The strip is per-reply: each qualifying reply carries its own strip reflecting its own sections; strips on other replies are unaffected.

### Key Entities *(include if feature involves data)*

- **Section**: One heading-delimited region of an assistant reply. Attributes: heading text, document-order position, proportional length, plain-text excerpt (heading plus opening lines) used by the preview. Exists only as a derived view over the reply's rendered content — not stored content.
- **Section strip preference**: The user's on/off choice for the strip feature, persisted per user profile and applied to every reply view.
- **Excerpt cache**: Transient per-reply store of section plain-text excerpts, invalidated when the reply's content changes (edit, regenerate, completion of a fresh stream).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who knows which section they want can go from viewing a long reply to reading that section in two interactions or fewer (hover/click), without manual scrolling through the reply.
- **SC-002**: 100% of replies below the threshold show no strip; no navigation noise appears on short or single-section replies.
- **SC-003**: At rest, the strip's visual footprint is small enough to escape casual attention — it occupies no more than a hairline sliver of the reply's edge, and no conversation content is displaced or reflowed by its presence or its hover state.
- **SC-004**: Bar clicks land on the correct section 100% of the time, including in conversations with multiple long replies and duplicate headings.
- **SC-005**: Toggling the setting off removes every strip immediately and the preference persists across app restarts; toggling back on restores it without further configuration.
- **SC-006**: Text selection, expound/highlight alignment, and copy tasks inside replies that show a strip succeed at the same rate as in replies without one — no regressions.
- **SC-007**: Previews always show the section's current content: after an edit or regenerate, no stale preview text is ever shown.
- **SC-008**: During reply streaming, no strip appears mid-stream (no visual thrash), and the strip appears promptly once the reply completes.

## Assumptions

- **Threshold defaults**: "Sufficiently long and multi-section" means at least 3 sections and rendered height greater than about one transcript viewport. These are tunable defaults, chosen so typical multi-chapter replies qualify while ordinary answers stay clean.
- **Streaming choice**: The strip appears only after the reply finishes streaming (rather than live-updating during the stream). This is the lowest-risk reading of "must not thrash" and matches the reply-completion model used elsewhere.
- **Dwell timing**: The preview dwell is a fixed short pause in the 300–500 ms range (default ~400 ms), tuned to feel deliberate without feeling dead; dismissal on pointer-leave is immediate. Exact values are tuning details for implementation.
- **Touch fallback choice**: Tap-to-jump directly (skip preview) is the chosen touch behavior over hiding the strip on touch, preserving navigation value on touch devices.
- **Where-am-I marker**: Deferred out of the first cut per the decision record; it is the upgrade path toward the floating-outline card (015) and may return as a follow-up.
- **Desktop-first hover model**: Hover/fatten/dwell behavior assumes a pointer-capable device; touch devices take the tap-to-jump path above.
- **Existing rendering as source of truth**: Sections come from the same rendered heading structure the reply display already produces; no new markdown parsing path is introduced.
- **Dependencies**: Builds on the existing reply rendering, transcript scroll container, settings surface, and selection-alignment exclusion list; no new persistent data beyond the strip preference.

## Out of Scope

- Persistent floating outline panel (Card 001 — implemented separately as 015; the where-am-I marker is this feature's future bridge to it).
- Heading anchor deep links (Card 004 — candidate cheap-rider follow-up).
- Accordion-collapsed replies (Card 005 — rejected).
- Reply content search beyond section jumps.
- Live section previews that render full markdown mid-stream.
