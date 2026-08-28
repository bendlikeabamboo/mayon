# Decisions: 001-settings-navigation

- Created: 2026-08-28

## Verdict

- **Date**: 2026-08-28
- **Winner**: `cards/sticky-jump-rail.md` — as the spine of a user-assembled composite, not the card as dealt
- **Runner-up**: `cards/jump-to-setting-search.md` (absorbed into the composite); `cards/routed-subpages.md` declined — its URL powers are captured by hash sync without route surgery
- **Why**: The user combined three cards after the playthrough: keep the single long settings page, add the sticky anchor rail (Card 002), add visible settings search with a cmd-K binding over a static section index (Card 005), and sync the current section into the URL hash so links/bookmarks snap to a section (Card 004's user-facing powers without its routes). Composite beats each parent on value-per-work: it covers both halves of the what (rail/search make any known section one click; the rail doubles as a visible map for browsing), and because nothing ever unmounts, the unsaved-changes trilemma that Card 001 and Card 004 both carry never arises. The taxonomy work Card 001 needed (grouping judgment) dissolves — the rail mirrors existing headings.

### Composite as decided

1. Settings stays one route and one page; sections keep their current order and content.
2. A thin sticky anchor rail mirrors the page's real section headings; scroll-spy highlights the current section (highlight updates replace history state, never push).
3. Clicking a rail entry smooth-scrolls and pushes a hash entry (`#data`, etc.) so back/forward walk through sections and `/settings#backup` is bookmarkable/shareable.
4. A visible search field at the top of settings (plus cmd-K binding) jumps to a section from a static index of section names/headings plus a small alias list; hits scroll and briefly flash the heading.
5. Mobile is an explicit open question: the rail hides under the breakpoint, so a floating jump button or equivalent must be decided in spec.

### Known snags carried into spec

- Hash history discipline: push on clicks only; scroll-spy must replace state or the back button becomes a scrolling slideshow.
- Scroll restoration will occasionally fight the snap on back/forward; needs a deterministic rule.
- Scroll-spy/offset drift as section heights change (provider list grows, conditional Sandbox DB section appears/disappears).
- Search serves known names only; discovery browsing relies on the rail, and the alias list needs maintenance as sections are added or renamed.
- No palette culture exists in the app yet — the search affordance must be visible, not gesture-only.
