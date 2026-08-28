---
card: 002
name: sticky-jump-rail
origin: dealt
bet: Wins if the only real problem is wayfinding, not the page's length itself
played: yes
---

# Card 002 — Sticky jump rail

## Story

Settings stays one long page, but a thin rail pins to the edge listing anchor links to each section; as you scroll, the current section highlights so you always know where you are. Looking for backup, you click the word instead of wheeling past everything above it. Nothing about layout, grouping, order, or routing changes — the page is exactly as long, only findable.

## Playthrough (2026-08-28)

- **What & why (confirmed at deal time)**: What — reaching any specific settings area, like Backup, is quick and self-evident, without scrolling past everything else. Why — the settings page is one long scroll today; length plus the cognitive load of scanning every section makes finding a known section slow and frustrating.
- **How it goes**: An afternoon ships it — sticky edge rail, eight anchor links matching the page's real sections, scroll-spy highlighting the current one; clicking "Data" whooshes down to backup and the page itself is untouched. The following weeks are quiet until the small stuff accumulates: the spy highlight drifts as the provider list and the conditional Sandbox section change page height, smooth-scroll races the highlight mid-flight, and anchor hashes clutter back-button history if deep links were wired in.
- **Snags**: Scroll-spy/offset drift as section heights change — continuous, low-severity, never-quite-done. Jumps land at section tops; scrolling within a tall section like Data is unchanged. Mobile: the rail hides under the breakpoint, so the worst-scrolling device loses the affordance unless a floating jump button is added (standing scope creep). Anchor hashes either pollute history or deep links don't exist.
- **Trade-offs**: Length and content overload are untouched — a map, not a smaller territory; no per-section focus; permanent edge chrome in an app that currently has none; the card's economics only work if wayfinding really is the whole problem.
- **Delivers the what?**: Partially, near-fully for the literal pain — finding a known section by name is one click within days. Overload remains: the page is exactly as long; the rail is a map of it.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days (one or two)
- **Your take**: User proposed a composite: keep the one-page rail (this card), add cmd-K search (Card 005), and sync the current section into the URL so links snap to a section — asking whether that amounts to Card 004. Answered: it buys 004's user-facing URL powers without 004's route surgery, keeps the unsaved-changes trilemma from ever arriving (nothing unmounts), but skips 004's structural separation. Verdict pending.
