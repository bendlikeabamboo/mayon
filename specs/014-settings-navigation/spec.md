# Feature Specification: Settings Page Navigation

**Feature Branch**: `014-settings-navigation`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "Feature: Settings page navigation for a single-page settings route. WHAT: Reaching any specific settings area (like Backup) must be quick and self-evident, without scrolling past everything else. WHY: the settings page is one long scroll today; length plus scan-load makes finding a known section slow and frustrating (real example: looking for backup, second-from-bottom)." Direction carried in from the 001-settings-navigation playthrough verdict (ideas/001-settings-navigation/decisions.md): keep the single settings page and section order; sticky anchor rail with scroll-spy; rail clicks smooth-scroll and push a hash; visible search field plus cmd-K over a static section index with aliases, hits scroll and flash the heading; nothing unmounts when navigating; mobile loses the rail and needs a decided floating jump affordance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-click jump to a known section via anchor rail (Priority: P1)

A user opens Settings looking for a specific area they already know exists (for example, Backup, which today sits second-from-bottom after a long Providers section). Instead of scrolling past everything and visually scanning, they see a slim, always-visible rail alongside the page that lists the page's real sections in page order, mirroring the existing section headings. They click "Backup" and the page scrolls smoothly so the Backup section is at the top of the viewport. While they scroll the page manually, the rail's highlight moves to whichever section is currently in view, so the rail doubles as a live map of where they are.

**Why this priority**: This is the core fix for the reported frustration — the fastest path to any known section, plus a browsable map for discovery. It works on its own with no search and no URL changes; implementing only this already delivers the primary value.

**Independent Test**: Can be fully tested by loading Settings, clicking the last rail entry, and confirming the viewport lands on that section — with no scrolling or typing — and by confirming the highlight follows manual scrolling.

**Acceptance Scenarios**:

1. **Given** the Settings page is loaded on a desktop-width screen, **When** the user clicks the "Backup" entry in the rail, **Then** the page scrolls smoothly and the Backup section heading is positioned at the top of the viewport, reached in a single interaction without manual scrolling.
2. **Given** the user is scrolled to an arbitrary position in Settings, **When** the user scrolls the page manually, **Then** the rail highlights the section currently in view, updating as sections enter and leave the viewport, and ends on the correct section when scrolling stops.
3. **Given** the user scrolls the page manually, **When** the highlight changes, **Then** no browsing-history entries are created (using the back button afterwards does not replay the scroll).
4. **Given** the page content has changed height (for example, more providers configured, or a conditional section appearing), **When** the user scrolls or clicks a rail entry afterwards, **Then** the highlight and jump targets still land on the correct, current section.

---

### User Story 2 - Jump to a section by name via visible search (Priority: P2)

A user who prefers typing — or who remembers roughly what an area is called but not where it sits — uses the search field at the top of the Settings page (also reachable with a cmd-K keyboard shortcut). They type part of a section name or a common synonym ("restore", "providers"); matching sections are offered from a maintained index of section names, headings, and aliases. Choosing a hit scrolls the page to that section and briefly flash-highlights its heading so the destination is unmistakable.

**Why this priority**: Fastest path for keyboard users and the best answer when a section's location on the page is unknown; builds directly on the same jump mechanism as the rail but is independently valuable and testable.

**Independent Test**: Can be fully tested by opening Settings, typing "backup" into the visible search field, selecting the hit, and confirming the viewport lands on the Data/Backup area with a brief heading flash.

**Acceptance Scenarios**:

1. **Given** the Settings page is loaded, **When** the user presses cmd-K (Ctrl-K on non-Mac platforms), **Then** the search field receives focus without the page scrolling or losing state.
2. **Given** focus is in the search field, **When** the user types "backup", **Then** matching section entries are offered based on section names, headings, and maintained aliases.
3. **Given** matching entries are offered, **When** the user selects one, **Then** the page scrolls to that section and its heading briefly flashes so the user can see where they landed.
4. **Given** focus is in the search field, **When** the user types text matching no section or alias, **Then** a clear "no matching section" state is shown and nothing scrolls or flashes.
5. **Given** the Settings page is loaded, **When** the user has not interacted with any search gesture or shortcut, **Then** the search field is visible on the page without any keyboard shortcut or special gesture being required.

---

### User Story 3 - Bookmarkable, shareable, back/forward-walkable sections (Priority: P3)

A user who jumps to a section — or arrives via a link — gets the section addressable in the URL (for example `…/settings#data`). Explicit jumps (rail clicks, search hits) record one history entry each, so the browser back/forward buttons walk back through the sections the user visited, landing each time with the target section at the top of the viewport. A link or bookmark containing a section anchor lands directly on that section when opened.

**Why this priority**: Valuable for returning to a section and for sharing exact locations, but it depends on the jump behavior from Story 1 and does not block the core value.

**Independent Test**: Can be fully tested by clicking two rail entries in turn, pressing Back twice, and confirming each Back lands with the previously visited section at the top of the viewport; and by loading a URL with a section anchor and confirming the page opens on that section.

**Acceptance Scenarios**:

1. **Given** the user clicks a rail entry or selects a search hit, **When** the jump completes, **Then** the URL shows the section's anchor and exactly one history entry is added for that explicit jump.
2. **Given** the user has jumped to two sections in sequence, **When** the user presses Back, **Then** the page returns to the previously visited section with it positioned at the top of the viewport (not mid-content).
3. **Given** a URL containing a section anchor is opened (from a bookmark or shared link), **When** the page loads, **Then** the viewport lands on that section.
4. **Given** a URL contains an anchor for a section that does not currently exist (for example, a section that is hidden because its capability is unavailable), **When** the page loads or the anchor is used, **Then** the page opens normally at the top with no error, broken state, or endless scrolling.
5. **Given** the user reloads the page while scrolled within a section, **When** the browser restores the previous scroll position, **Then** the result is deterministic: the viewport ends up at a sensible location consistent with the section map, and the rail highlight matches what is in view.

---

### User Story 4 - Jump capability on small screens (Priority: P4)

On a narrow/mobile viewport the rail is hidden for space, but the user keeps an equivalent one-or-two-tap way to jump: a small floating jump button is available on the Settings page; activating it reveals the same list of sections in a compact overlay; picking one scrolls there (and records history) exactly as a rail click would.

**Why this priority**: Parity for the growing small-screen case; the mechanism reuses the same jump behavior, so it is valuable but not required for the desktop core value.

**Independent Test**: Can be fully tested by loading Settings at a mobile width, confirming the rail is absent, tapping the floating jump button, selecting a section, and confirming the viewport lands there in two taps or fewer.

**Acceptance Scenarios**:

1. **Given** the Settings page is loaded below the desktop breakpoint, **When** the user looks for the rail, **Then** it is hidden, and a floating jump affordance is visible without obscuring primary controls.
2. **Given** the floating jump affordance is visible, **When** the user taps it and selects a section from the compact list, **Then** the page scrolls to that section and the overlay closes, matching the desktop jump behavior including URL anchor update.
3. **Given** the floating jump overlay is open, **When** the user dismisses it without selecting, **Then** the page is unchanged — no scroll, no history entry.

---

### Edge Cases

- What happens when the user clicks the same rail entry repeatedly or clicks while a smooth scroll is already in flight? The target is stable: repeated jumps to the current section do not stack duplicate history entries, and the final destination is always the correct section top.
- How does the system handle scroll-spy accuracy when section heights change dynamically (provider list grows/shrinks; the conditional Sandbox DB section appears or disappears with server capability)? The rail's targets and highlight must reflect the page as it is now — a jump after a content change still lands at the true section top, and the highlight never rests on a section the user is not actually viewing.
- What happens when a section listed in the index is not currently rendered (capability-gated)? It is omitted from the rail, search results, and floating list for as long as it is absent, and returns automatically when present.
- How does search handle empty input, whitespace-only input, or very long input? Empty or blank input shows the full section list as options; long input that matches nothing shows the no-match state.
- What happens when the user activates the keyboard shortcut (cmd-K) outside the Settings page? Nothing happens there; the shortcut is scoped to Settings and must not interfere with other pages or steal focus.
- What happens when a user with a reduced-motion preference jumps to a section? The jump respects the preference (moves without animation) while still landing at the exact section top, updating the URL, and recording history identically.
- What happens when jumping while an unsaved edit is in progress in another section (for example, mid-edit in a provider form)? The jump proceeds; nothing unmounts and no edits are lost, and no unsaved-changes prompt appears.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Settings page MUST remain a single page and single address; all sections keep their current order and content, and no navigation affordance introduced here may unmount, replace, or paginate sections.
- **FR-002**: The Settings page MUST present a persistent navigation rail, visible while browsing settings, listing every currently rendered section in page order with labels that mirror the actual section headings.
- **FR-003**: The rail MUST highlight the section currently in view and keep that highlight correct as the user scrolls manually, including after content changes alter section heights.
- **FR-004**: Activating a rail entry MUST scroll the page smoothly so the target section's top is positioned at the top of the viewport.
- **FR-005**: Changes to the rail highlight caused by scrolling MUST update the current view without creating browsing-history entries.
- **FR-006**: Every explicit jump (rail click or search-hit selection) MUST record exactly one history entry and reflect the target section's anchor in the page address; repeated jumps to the already-current section MUST NOT stack duplicate history entries.
- **FR-007**: Opening the Settings page with a section anchor in its address MUST land the viewport on that section; an anchor naming an absent section MUST be ignored gracefully (page opens normally, no error).
- **FR-008**: Browser Back/Forward following explicit jumps MUST revisit the previously visited sections, each time landing with the target section at the top of the viewport regardless of any remembered scroll position.
- **FR-009**: The Settings page MUST show a visible search field at the top of the page, usable with no keyboard shortcut or special gesture; a cmd-K shortcut (Ctrl-K on non-Mac) MUST additionally focus it, scoped to the Settings page only.
- **FR-010**: Search MUST match against a maintained static index of section names, their heading text, and a curated alias list of common synonyms; selecting a hit MUST scroll to that section and briefly flash its heading to confirm the destination.
- **FR-011**: The section index (names, headings, aliases, anchors) MUST be updated whenever a settings section is added, renamed, or removed, so rail labels, search hits, and anchors always match the real page.
- **FR-012**: Sections whose capability is not currently available (for example, the conditional Sandbox DB section) MUST be excluded from the rail, search index offerings, and floating list while absent, without errors elsewhere.
- **FR-013**: Search MUST serve known section names/aliases only — it MUST NOT search within section content — and MUST present a clear "no matching section" state when nothing matches.
- **FR-014**: Below the desktop breakpoint, where the rail is hidden, the Settings page MUST offer a floating jump affordance that opens a compact section list (the same sections and order as the rail); selecting an entry MUST behave identically to a rail click (scroll, anchor update, one history entry), and dismissing the overlay MUST have no effect on scroll or history.
- **FR-015**: Section jumps MUST respect the user's reduced-motion preference by omitting scroll animation while preserving the exact landing position and all URL/history behavior.
- **FR-016**: Navigating between sections MUST NOT discard any in-progress user state in the page: no section may lose unsaved edits, open disclosures, or in-flight actions because the user jumped away and back.
- **FR-017**: The rail, search field, and floating affordance MUST visually match the application's existing design conventions (spacing, typography, theming, both light and dark appearances).

### Key Entities *(include if feature involves data)*

- **Settings section entry**: One navigable section of the Settings page. Attributes: display name (mirroring the real heading), anchor identifier used in the address, ordered position on the page, availability condition (always, or tied to a runtime capability), and zero or more search aliases (common synonyms users might type, e.g. backup/restore-related terms for the Data section).
- **Section index**: The ordered, maintained collection of section entries described above. It is static content owned alongside the Settings page — not derived from page content at runtime — and is the single source the rail, search, and floating list all render from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user seeking a known settings section (the reported example: Backup) reaches it in a single interaction from page load, with zero manual scrolling, on desktop.
- **SC-002**: Time from opening Settings to viewing a target section is under 3 seconds for a user who knows the section's name, using either the rail or search.
- **SC-003**: When the user stops scrolling at any point, the rail highlight names the section actually in view — correct in 100% of spot checks across the full page, including after content-height changes.
- **SC-004**: After any explicit jump, Back/Forward lands the intended section with its heading at the top of the viewport in every attempt; no history entry is created by scroll-driven highlight changes.
- **SC-005**: Opening a shared or bookmarked settings address that includes a valid section anchor lands on that section; anchors for absent sections never produce errors.
- **SC-006**: Searching a common synonym (e.g. "restore" for the Data/Backup area) surfaces the right section in the offered matches and lands there on selection.
- **SC-007**: No unsaved user state in Settings is lost across any jump, back/forward movement, or anchor load — verified by starting an edit, jumping away and back, and finding the edit intact.
- **SC-008**: On a small-screen viewport, a user can reach any section in two taps or fewer via the floating jump affordance.
- **SC-009**: Users familiar with the page report that finding a known section feels immediate rather than a scrolling hunt (qualitative check during review of the built feature).

## Assumptions

- The section set and order are frozen by earlier decision: the page's actual sections — Providers, MCP Servers, Learner profile, Expound Instructions, Lab generation prompt, Quiz generation prompt, Data (containing backup/restore), and the conditional Sandbox DB section — remain as-is; the navigation features mirror them rather than reorganize them. (Corrected during planning after code inspection; the original assumption listed only three of these.)
- "Flash the heading" means a brief (roughly 1–2 second) visual emphasis of the target heading that fades on its own and never blocks interaction.
- The floating jump affordance is decided as a small floating button in a lower corner of the Settings page, opening a compact overlay listing the sections (same order and labels as the rail); this reuses the same jump behavior and index.
- cmd-K is a progressive enhancement; the visible search field is the primary affordance because the application has no existing command-palette culture.
- The alias list is expected to stay small (a handful per section at most) and is maintained manually alongside the section index; the accepted cost is updating it when sections are added or renamed.
- Browser scroll-restoration conflicts are resolved by the rule: explicit navigation (jump, Back/Forward to a section anchor) always lands at the true section top, overriding any browser-remembered offset; plain reload restores the approximate position and the rail highlight self-corrects to whatever is in view.
- Rapid successive jumps behave simply: each explicit jump records history (subject to the duplicate-suppression rule in FR-006) and the last jump wins.
- Keyboard shortcut scope is Settings-only; no global shortcut behavior on other pages is introduced.
