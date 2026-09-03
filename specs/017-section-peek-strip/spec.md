# Feature Specification: Section Peek Strip

**Feature Branch**: `017-section-peek-strip`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "For long, header-structured replies, render a slim hover-peek bar strip along the reply's edge — one bar per section, sized proportionally — that at rest is a near-invisible hairline, fattens on hover, pops a preview card on dwell, and smooth-scrolls the transcript to the section on click. Winner of ideas/003-chat-outline (Card 006); runner-up Card 001 (floating panel) is the future upgrade path."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a long reply's shape and jump to a section via the strip (Priority: P1)

A user receives an assistant reply that is long and structured with section headings. Outside the chat area — in a slim gutter immediately to the right of the transcript's scrollbar (chat area, then scrollbar, then ticks) — a column of thin horizontal ticks appears for that reply: one tick per section, left-aligned with their origin at the chat border, each tick's width proportional to its section's length, and each tick sitting vertically beside the part of the reply it points to, so the reply's shape is readable at a glance and the ticks stay glued to their sections while the transcript scrolls. At rest the ticks are subtle hairlines that do not demand attention. The user moves the pointer to the gutter, the ticks brighten; pausing on a tick extends it a tiny bit to the right, and clicking it smooth-scrolls the transcript so that section sits at the top of the viewport. The user reaches any section in about two interactions with no permanent screen chrome inside the conversation itself.

**Why this priority**: This is the core value from the chosen card — glanceable structure plus a fast jump. It stands alone: no preview, no settings work, and it already solves the "long reply, where was that part?" problem.

**Independent Test**: Can be fully tested by opening a long multi-section reply, confirming the tick gutter appears to the right of the scrollbar, hovering it, clicking a tick, and confirming the viewport lands on that section — plus confirming short replies show no ticks.

**Acceptance Scenarios**:

1. **Given** an assistant reply that exceeds the length/section threshold with three or more sections, **When** the user views it, **Then** a tick column is present in the gutter to the right of the scrollbar with exactly one tick per section, each tick left-aligned at the chat border, sized proportionally to its section's length, in document order, and vertically positioned beside its section.
2. **Given** the ticks at rest, **When** the user looks at the conversation, **Then** the ticks read as subtle hairlines confined to the gutter outside the chat area and do not overlap, displace, or push any reply content.
3. **Given** the transcript scrolls, **When** the user scrolls the conversation, **Then** the ticks remain vertically aligned with their sections (scroll-synced), never drifting.
4. **Given** the ticks are visible, **When** the user hovers over the gutter, **Then** the ticks brighten, and pausing on a tick extends it a tiny bit to the right — none of which shifts the conversation layout.
5. **Given** a tick is extended, **When** the user clicks it, **Then** the transcript's scroll container smoothly scrolls so that section's heading rests at the top of the viewport — correct even when the conversation holds multiple long replies.
6. **Given** an assistant reply below the threshold (short, or fewer than the minimum sections), **When** the user views it, **Then** no ticks appear for that reply.
7. **Given** a reply with two identically titled sections, **When** the user clicks the second section's tick, **Then** the viewport lands on the second occurrence — never the first.

---

### User Story 2 - Dwell on a tick to preview the section before jumping (Priority: P2)

While using the strip, the user wants to confirm a tick is the section they want before committing to the jump. Pausing the pointer deliberately on a tick — after a short, tuned dwell — pops a floating preview window anchored outside the chat area at that tick, showing the section's heading and its opening lines as plain text. Merely crossing the gutter on the way to something else never fires a preview, and the preview dismisses promptly when the pointer leaves. Clicking the preview, or the tick beneath it, performs the same smooth-scroll jump as clicking a tick directly.

**Why this priority**: The preview is what makes the strip a "peek" affordance rather than a blind jump list; it builds directly on Story 1's strip and jump machinery and materially raises confidence in the jump.

**Independent Test**: Can be fully tested by hovering a tick and holding still until the preview appears (showing the right heading and opening lines), clicking it to jump, then brushing across the gutter without pausing and confirming no preview fires.

**Acceptance Scenarios**:

1. **Given** a hovered tick, **When** the user pauses the pointer on it for the dwell duration, **Then** a floating preview window appears anchored outside the chat area at that tick — never rendered inside the reply content — showing that section's heading and the opening lines of its content as plain text (no raw markup, no half-rendered formatting).
2. **Given** the pointer sweeps across the gutter without pausing, **When** it crosses several ticks quickly, **Then** no preview window appears.
3. **Given** a preview window is open, **When** the pointer leaves the gutter and preview area, **Then** the preview dismisses promptly without lingering.
4. **Given** a preview window is open, **When** the user clicks the preview (or the tick beneath it), **Then** the transcript scrolls to that section exactly as a direct tick click would.
5. **Given** a reply was edited or regenerated after previews were shown, **When** the user dwells on a tick again, **Then** the preview shows that section's current heading and opening lines — never stale text from the previous version.

---

### User Story 3 - Turn the strip on and off with a persisted setting (Priority: P3)

The user can switch the section strip off entirely from settings. With it off, no strip, hover behavior, or preview appears on any reply — and the gutter itself is not reserved, so the transcript looks and lays out exactly as it does today. The preference persists: it survives closing and reopening the app, and switching it back on restores the gutter and ticks everywhere they apply.

**Why this priority**: An explicit requirement guaranteeing user control, but it is a thin layer over Stories 1–2 and delivers no value on its own without the strip existing.

**Independent Test**: Can be fully tested by toggling the setting off (strip vanishes from all qualifying replies), restarting the session (preference holds), toggling it back on (strip returns).

**Acceptance Scenarios**:

1. **Given** the strip is active on qualifying replies, **When** the user turns the setting off, **Then** every tick disappears immediately — no ticks, hover affordances, or previews — and the gutter reservation is released so reply layout returns exactly to its pre-feature geometry.
2. **Given** the setting was turned off, **When** the user closes and reopens the app, **Then** the strip remains off and qualifying replies show no ticks.
3. **Given** the setting is off, **When** the user turns it back on, **Then** the gutter is reserved again and ticks reappear on all currently qualifying replies with correct proportions and working jumps.

---

### Edge Cases

- How does the strip behave while a reply is still streaming in? It must not thrash: the strip does not appear until the reply finishes streaming (or otherwise reaches a stable, complete set of sections), so ticks never jitter as headings arrive; once shown it reflects the final structure.
- What happens when a reply is extremely long with dozens of sections? The gutter stays slim and usable: ticks remain individually hoverable (a minimum usable row size for very short sections), and long content compresses proportionally rather than overflowing.
- How are heading-like fragments inside code blocks, quotations, tables, math, or other generated content handled? They are excluded — only the reply's real document headings produce sections, using the same rendered structure the reply display already uses. The reply's markdown source is never altered to build the outline.
- What happens when a user edits or regenerates a reply that has a strip? The strip hides while the new content streams, then reappears for the finished reply with correct ticks and refreshed section excerpts.
- What about touch devices, where there is no hover? On touch input there is no dwell-preview step: tapping a tick jumps directly to that section. (A deliberate choice of tap-to-jump over hiding the strip, preserving the affordance on touch.)
- Does the strip steal scrolling or block reply interactions? No: wheel and touch scrolling over the gutter scrolls the transcript normally, and text selection, the expound/highlight feature, and copy affordances inside replies behave identically whether or not the strip is present.
- Do the strip and preview interfere with text selection alignment (expound/highlight offsets)? They must not: because they are injected elements containing text, they are excluded from the selection-to-source alignment machinery, so selections and highlights inside replies keep resolving to correct source offsets.
- What happens when the user clicks a tick while a previous smooth scroll is still in flight? The destination is stable: the final resting position is always the correct section top, and repeated clicks never stack side effects.
- What happens when a user with a reduced-motion preference clicks a tick? The jump moves without animation while landing at exactly the same position, with no other behavioral difference.
- What happens when only one section exists (a single heading atop a long reply)? No ticks appear — a one-tick map has nothing to navigate between.
- Where do the ticks live when multiple replies qualify? Each qualifying reply keeps its own tick column (per-reply strips); because the gutter is scroll-synced, the columns distribute naturally along the scroll length and never collide.
- What happens when far-away replies are virtualized away (lazy mounting)? A reply's ticks exist only while the reply is mounted; they reappear (correctly positioned) as the user approaches it. Ticks never cause rows to mount or stay mounted.
- Where-am-I position marker (a live indicator of the current viewport on the strip)? Explicitly deferred: it is the upgrade path toward the floating-panel card and is excluded from this first cut to keep risk low.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST show a section strip on an assistant reply when, and only when, the reply qualifies: it has finished streaming, contains at least three sections delimited by document headings, and its rendered height exceeds roughly one viewport of the transcript. Replies failing any part of this threshold MUST show no ticks.
- **FR-002**: The strip MUST present exactly one tick per section, in document order. Each tick is a thin horizontal hairline, left-aligned with its origin at the chat border (the gutter's left edge, immediately right of the scrollbar); its width MUST be proportional to its section's share of the reply's length (very short sections retain a minimum visible width), and its vertical position MUST tile proportionally so each tick sits beside its section.
- **FR-003**: The strip lives OUTSIDE the chat area: a slim gutter column immediately to the right of the transcript's scrollbar (chat area, then scrollbar, then ticks). While the feature is enabled, the transcript reserves this gutter; the ticks themselves MUST NOT overlap, displace, or reflow any conversation content at rest or on hover, and the reservation is released when the feature is off.
- **FR-004**: The gutter and its ticks MUST be scroll-synced: as the transcript scrolls, the ticks stay vertically aligned with their sections (a transform-only sync; no layout-affecting work tied to scroll), so a tick always points at the content beside it.
- **FR-005**: Hovering the gutter MUST brighten its ticks; pausing the pointer on a tick MUST extend it a tiny bit to the right (a width-only transition, no layout shift); the pointer must land on a generous hit area per tick so small sections remain easy to target.
- **FR-006**: Deliberately dwelling on a tick (a short, fixed pause) MUST open a floating preview window anchored outside the chat area at that tick — never rendered inside the reply content — showing that section's heading and the opening lines of its content as plain text; sweeping across the gutter without pausing MUST NOT open any preview.
- **FR-007**: The preview MUST dismiss promptly when the pointer leaves the gutter and preview area, and MUST NOT remain after the pointer moves on.
- **FR-008**: Clicking a tick or its preview MUST smooth-scroll the transcript's scroll container so that section's heading rests at the top of the viewport, landing on the correct occurrence even with duplicate headings or multiple long replies in the conversation.
- **FR-009**: The strip and its data MUST be derived only from the reply's rendered document headings via the existing markdown rendering path; the reply's markdown source MUST NOT be mutated, and heading-like content inside code blocks, quotations, tables, and math MUST be excluded.
- **FR-010**: Section previews MUST be served from plain-text excerpts cached per section; the cache MUST refresh when the reply is edited or regenerated so previews never show stale content.
- **FR-011**: While a reply is streaming, the strip MUST NOT appear (and any existing ticks for that reply MUST hide), preventing mid-stream reflow or thrash; ticks appear once the reply completes.
- **FR-012**: On touch input there is no dwell step: tapping a tick MUST jump directly to that section without showing a preview.
- **FR-013**: The strip MUST NOT intercept wheel or touch scrolling — scrolling over the gutter MUST scroll the transcript normally (implemented as a wheel relay: the gutter forwards wheel deltas to the transcript's scroll container, the ONLY wheel handling the strip may have) — and MUST NOT block text selection, the expound/highlight feature, or copy interactions within the reply.
- **FR-014**: The strip and preview are injected elements containing text; the system MUST exclude them from the selection-to-source alignment machinery so text selections and highlights inside replies continue to resolve to correct source offsets.
- **FR-015**: A setting MUST turn the strip on and off; when off, no strip affordance of any kind appears on any reply AND the gutter reservation is released (the transcript lays out exactly as before the feature). The preference MUST persist across sessions.
- **FR-016**: Jump navigation MUST respect the user's reduced-motion preference by scrolling without animation to the identical landing position.
- **FR-017**: The strip is per-reply: each qualifying reply carries its own tick column reflecting its own sections; because the gutter is scroll-synced, multiple replies' tick columns coexist along the scroll length without collision.

### Key Entities *(include if feature involves data)*

- **Section**: One heading-delimited region of an assistant reply. Attributes: heading text, document-order position, proportional length, plain-text excerpt (heading plus opening lines) used by the preview. Exists only as a derived view over the reply's rendered content — not stored content.
- **Section strip preference**: The user's on/off choice for the strip feature, persisted per user profile and applied to every reply view.
- **Excerpt cache**: Transient per-reply store of section plain-text excerpts, invalidated when the reply's content changes (edit, regenerate, completion of a fresh stream).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who knows which section they want can go from viewing a long reply to reading that section in two interactions or fewer (hover/click), without manual scrolling through the reply.
- **SC-002**: 100% of replies below the threshold show no ticks; no navigation noise appears on short or single-section replies.
- **SC-003**: At rest, the strip's visual footprint is small enough to escape casual attention — it occupies no more than a hairline sliver in the gutter outside the chat area (right of the scrollbar), and no conversation content is displaced or reflowed by its presence or its hover state.
- **SC-004**: Tick clicks land on the correct section 100% of the time, including in conversations with multiple long replies and duplicate headings.
- **SC-005**: Toggling the setting off removes every tick and the gutter reservation immediately, and the preference persists across app restarts; toggling back on restores it without further configuration.
- **SC-006**: Text selection, expound/highlight alignment, and copy tasks inside replies that show a strip succeed at the same rate as in replies without one — no regressions.
- **SC-007**: Previews always show the section's current content: after an edit or regenerate, no stale preview text is ever shown.
- **SC-008**: During reply streaming, no ticks appear mid-stream (no visual thrash), and the ticks appear promptly once the reply completes.
- **SC-009**: Ticks stay vertically aligned with their sections across the full scroll range (no drift), including after content above them grows or shrinks.

## Assumptions

- **Threshold defaults**: "Sufficiently long and multi-section" means at least 3 sections and rendered height greater than about one transcript viewport. These are tunable defaults, chosen so typical multi-chapter replies qualify while ordinary answers stay clean.
- **Placement (2026-09-02 owner refinement)**: The strip lives outside the chat area in a dedicated gutter immediately right of the transcript's scrollbar (chat area → scrollbar → ticks), replicating the thin right-edge tick ruler from the owner's reference (a prompt-navigator panel with left-aligned horizontal ticks). While the feature is enabled the transcript reserves the gutter (the reply column narrows by the gutter width); when disabled no space is reserved.
- **Scroll-sync choice**: Ticks keep a 1:1 spatial mapping with their sections (a tick sits beside the part of the reply it points to) by scroll-syncing the gutter with a single transform update per scroll frame. This preserves per-reply tick columns for multi-reply conversations; a fixed overview-ruler mapping (whole reply compressed into the viewport height) was rejected for collision and disorientation reasons.
- **Streaming choice**: The strip appears only after the reply finishes streaming (rather than live-updating during the stream). This is the lowest-risk reading of "must not thrash" and matches the reply-completion model used elsewhere.
- **Dwell timing**: The preview dwell is a fixed short pause in the 300–500 ms range (default ~400 ms), tuned to feel deliberate without feeling dead; dismissal on pointer-leave is immediate. Exact values are tuning details for implementation.
- **Touch fallback choice**: Tap-to-jump directly (skip preview) is the chosen touch behavior over hiding the strip on touch, preserving navigation value on touch devices.
- **Where-am-I marker**: Deferred out of the first cut per the decision record; it is the upgrade path toward the floating-outline card (015) and may return as a follow-up.
- **Desktop-first hover model**: Hover/extend/dwell behavior assumes a pointer-capable device; touch devices take the tap-to-jump path above.
- **Existing rendering as source of truth**: Sections come from the same rendered heading structure the reply display already produces; no new markdown parsing path is introduced.
- **Dependencies**: Builds on the existing reply rendering, transcript scroll container, settings surface, and selection-alignment exclusion list; no new persistent data beyond the strip preference.

## Out of Scope

- Persistent floating outline panel (Card 001 — implemented separately as 015; the where-am-I marker is this feature's future bridge to it).
- Heading anchor deep links (Card 004 — candidate cheap-rider follow-up).
- Accordion-collapsed replies (Card 005 — rejected).
- Reply content search beyond section jumps.
- Live section previews that render full markdown mid-stream.
