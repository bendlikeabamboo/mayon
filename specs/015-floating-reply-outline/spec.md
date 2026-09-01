# Feature Specification: Floating Reply Outline

**Feature Branch**: `015-floating-reply-outline`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "as user, sometimes when the llm replies, it replies with chapter headers or something and sometimes their replies are long. that's okay but i just wish there's like a floating outline that I can maybe interact with to speed up my searching in the UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump to any section of a long reply from a floating outline (Priority: P1)

A user receives an assistant reply that is structured with section headings and runs several screens long. Scrolling and visually hunting for a section they remember ("the part about deployment") is slow. A floating outline — an always-reachable panel that does not displace the conversation — lists that reply's headings in document order, nested to mirror their levels. The user clicks an entry and the conversation scrolls so the chosen heading sits at the top of the viewport, briefly emphasized so the landing point is unmistakable.

**Why this priority**: This is the core value from the user's request — a one-interaction path into any section of a long reply. It stands alone: no position tracking, no small-screen work, and it already solves the "long reply, where was that part?" problem.

**Independent Test**: Can be fully tested by opening a reply with multiple headings, opening the outline, clicking an entry, and confirming the viewport lands on that section in a single interaction — plus confirming the outline mirrors the reply's real heading structure.

**Acceptance Scenarios**:

1. **Given** a conversation containing an assistant reply with multiple headings, **When** the user opens the outline and clicks an entry, **Then** the conversation scrolls smoothly so that section's heading is positioned at the top of the viewport, reached in a single interaction without manual scrolling.
2. **Given** an assistant reply with headings, **When** the user views its outline, **Then** every heading appears exactly once, in document order, with visual nesting that mirrors the headings' levels.
3. **Given** an assistant reply contains two sections with identical heading text, **When** the user clicks the second entry, **Then** the viewport lands on the second occurrence — never the first.
4. **Given** an assistant reply whose headings change after the outline was opened (for example, the reply finishes being produced, or is regenerated), **When** the user next uses the outline, **Then** its entries reflect the reply's current heading structure and jumps land at the true current positions.

---

### User Story 2 - Outline tracks reading position while scrolling (Priority: P2)

While reading a long reply the user scrolls manually. The open outline highlights whichever section is currently in view and keeps the highlight correct as sections enter and leave the viewport — the outline doubles as a live map of where the user is inside the reply. Moving the highlight never disturbs the scroll or the browsing history.

**Why this priority**: Turns the outline from a jump list into a orientation aid for long replies; builds on the same structure as Story 1 but is independently valuable and testable once jumps exist.

**Independent Test**: Can be fully tested by opening a long reply's outline, scrolling manually through it, and confirming the highlight moves to the section in view and rests on the correct section when scrolling stops.

**Acceptance Scenarios**:

1. **Given** the outline is open for a long reply, **When** the user scrolls the conversation manually, **Then** the outline highlights the section currently in view, updating as sections enter and leave the viewport.
2. **Given** the user stops scrolling at an arbitrary point inside a section, **When** scrolling ends, **Then** the highlight rests on the section containing the viewport's reading position.
3. **Given** the highlight changes during manual scrolling, **When** the user checks the browsing history afterwards, **Then** no history entries were created by the highlight changes.
4. **Given** the user is reading a different assistant reply (one with headings), **When** the outline is consulted, **Then** it reflects that reply's headings rather than the previous reply's.

---

### User Story 3 - Outline stays available and out of the way on small screens (Priority: P3)

On a narrow or small-screen viewport there is no room for a side-floating panel. The user keeps an equivalent way in: a compact floating affordance opens the same outline as a small overlay; picking an entry jumps exactly as on desktop. The overlay never obscures the message composer or primary controls, and dismissing it leaves scroll and content untouched.

**Why this priority**: Parity for small screens using the same outline data and jump behavior as the desktop panel; valuable but not required for the core desktop value.

**Independent Test**: Can be fully tested by loading a long reply at a mobile width, tapping the floating affordance, selecting a section, and confirming the viewport lands there in two taps or fewer.

**Acceptance Scenarios**:

1. **Given** a long reply viewed below the desktop breakpoint, **When** the user looks for the outline, **Then** a compact floating affordance is visible without obscuring the composer or other primary controls.
2. **Given** the compact overlay is open, **When** the user selects an entry, **Then** the conversation scrolls to that section exactly as a desktop outline click would (landing position, heading emphasis, no history side effects).
3. **Given** the compact overlay is open, **When** the user dismisses it without selecting, **Then** the conversation is unchanged — no scroll, no content shift.

---

### Edge Cases

- What happens when a reply has no document headings at all? No outline is offered for it; the affordance never appears for structure-less replies.
- What happens when a reply is extremely long with dozens of headings, including deep nesting? The outline remains usable: it scrolls internally if needed, deep levels stay visually distinct (indented or collapsed), and long heading text is truncated for display without losing jump accuracy.
- How are heading-like fragments inside code blocks, quotations, tables, math, or other generated content handled? They are excluded — only the reply's real document headings produce outline entries.
- What happens when the user clicks an entry while a previous smooth scroll is still in flight, or clicks the current section's entry repeatedly? The destination is stable: the final resting position is always the correct section top, and repeated jumps never stack side effects.
- What happens when the user jumps while the reply is still being produced (content still arriving below the target heading)? The jump lands at the heading's true current position; the outline keeps updating as further headings appear.
- What happens when a user with a reduced-motion preference jumps to a section? The jump moves without animation while landing at exactly the same position with the same heading emphasis and no other behavioral difference.
- Does the outline interfere with existing reply interactions (text selection, the expound/highlight menu, copy affordances)? It must not: reply-surface interactions behave identically whether the outline is open, closed, or overlaying part of the view.
- What happens when the user dismisses the outline mid-read? Dismissal changes nothing about scroll position or content; reopening restores the outline already synced to the current reading position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every assistant reply containing at least one document heading MUST have an outline available, listing every heading of that reply exactly once, in document order, with nesting that mirrors the headings' levels.
- **FR-002**: The outline MUST be a floating panel that overlays the conversation; opening, closing, or using it MUST NOT reflow, shift, or push any conversation content.
- **FR-003**: The outline MUST reflect the reply the user is currently reading: as the user's reading position moves to a different assistant reply that has headings, the outline's entries follow that reply.
- **FR-004**: Activating an outline entry MUST scroll the conversation so the target heading is positioned at the top of the viewport and briefly emphasize the heading (roughly 1–2 seconds, self-fading, never blocking interaction).
- **FR-005**: Outline entries MUST derive only from the reply's real document headings; heading-like text inside code blocks, quotations, tables, math, or generated chrome MUST NOT produce entries.
- **FR-006**: The outline MUST stay in step with reply content: entries update when the reply's headings appear or change (including while the reply is still being produced), and a jump after any change lands at the heading's true current position.
- **FR-007**: Jumps between identically named sections MUST resolve by position (nth occurrence within the reply), never by matching heading text.
- **FR-008**: While the user scrolls manually, the outline MUST highlight the section currently in view, updating continuously and resting on the correct section when scrolling stops; highlight changes MUST NOT create browsing-history entries.
- **FR-009**: The outline MUST be dismissible (and re-openable) with a single interaction; dismissing MUST NOT alter scroll position or content, and reopening MUST present the outline already reflecting the current reading position.
- **FR-010**: Replies with no document headings MUST NOT offer an outline.
- **FR-011**: Below the desktop breakpoint, the outline MUST be reachable through a compact floating affordance that opens the same entries in a small overlay; selection MUST behave identically to a desktop click, and dismissal MUST have no effect on scroll or content.
- **FR-012**: Jumps MUST respect the user's reduced-motion preference by omitting scroll animation while preserving the exact landing position, heading emphasis, and all other behavior.
- **FR-013**: The outline MUST NOT interfere with existing reply-surface interactions: text selection, the expound/highlight flow, and copy affordances MUST behave identically whether or not the outline is open or overlaying the view.
- **FR-014**: The outline MUST NOT introduce new durable user data; its entries and state derive from reply content at view time and are presentation-only.
- **FR-015**: The outline MUST visually match the application's existing design conventions (spacing, typography, theming, both light and dark appearances).

### Key Entities *(include if feature involves data)*

- **Heading entry**: One navigable section of an assistant reply. Attributes: heading text (as displayed), nesting level, and ordered position within that reply. No stored identity — entries exist only while the outline is shown.
- **Reply outline**: The ordered collection of heading entries for one assistant reply, derived from the reply's structure at view time. It is the single source the floating panel and the compact overlay render from, and it is never persisted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user seeking a remembered section of a multi-heading reply reaches it in a single interaction from an open outline, with zero manual scrolling.
- **SC-002**: Locating a known section in a reply with 10 or more headings takes under 3 seconds using the outline.
- **SC-003**: When the user stops scrolling at any point in a long reply, the outline names the section actually in view — correct in 100% of spot checks across the reply.
- **SC-004**: The conversation renders identically with the outline open and closed — zero layout shift in side-by-side comparison.
- **SC-005**: Text selection, expound/highlight, and copy interactions succeed identically with the outline open versus closed in a verification pass (zero regressions).
- **SC-006**: On a small-screen viewport, a user reaches any section of a long reply in two taps or fewer via the compact affordance.
- **SC-007**: Users reading long structured replies describe navigation as quick lookup rather than a scrolling hunt (qualitative check during review of the built feature).

## Assumptions

- The outline applies to assistant replies only; user messages are out of scope.
- Any assistant reply with at least one document heading qualifies — no separate length threshold — because a one-entry outline for a short reply is harmless and keeps the rule unambiguous.
- "Currently reading" means the assistant reply occupying the viewport; the default retargeting trigger is scroll position, with hover/focus refinements left as a plan-time choice.
- Heading emphasis on jump follows the convention already established for section jumps: a brief (~1–2 s) emphasis that fades on its own and never blocks interaction.
- Interaction conventions proven by the Settings navigation feature (smooth scroll to section top, no history entries on scroll-spy changes, reduced-motion handling, compact small-screen overlay) are mirrored here for consistency.
- The outline's open/closed state and current target are session-scoped presentation state; nothing is written to storage.
- Streaming replies may show the outline as soon as their first headings exist; jumps during streaming land at the heading's current true position even if content continues to arrive afterward.
- Deep heading levels (roughly fourth level and deeper) remain reachable; whether they are always shown, indented, or collapsed behind expansion is a presentation detail for planning.
