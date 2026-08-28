---
card: 001
name: github-style-side-tabs
origin: user
bet: Wins if sections stay roughly stable and people navigate by scanning section names
played: yes
---

# Card 001 — GitHub-style side tabs (your card)

## Story

You open Settings and a slim rail sits down the left side listing every section — Appearance, Providers, Backup, and so on. Looking for backup, you click the word and you're there in one click, no scrolling. On narrow screens the rail collapses into a chip row across the top. The page content itself stays exactly as it is today; only the way in changes.

## Playthrough (2026-08-28)

- **What & why (confirmed at deal time)**: What — reaching any specific settings area, like Backup, is quick and self-evident, without scrolling past everything else. Why — the settings page is one long scroll today; length plus the cognitive load of scanning every section makes finding a known section slow and frustrating.
- **How it goes**: The first days are layout work: a slim rail lists the real sections — Providers, MCP servers, Learner profile, Expound, Lab, Quiz, Data (backup/restore), Sandbox DB — with each section's existing component slotted into the active pane; mobile gets a chip row. Week one delivers the wanted moment: open Settings, click "Data", backup is right there. Then the work surfaces: each rail entry forces a "what counts as a section" ruling, and the page's lopsided groupings become visible, so grouping gets retuned to make the rail look honest.
- **Snags**: Unsaved changes across sections — edit a provider key, click Data in the rail: lose the edit, silently save, or block with a modal? Bites in week one; worst severity (data loss) unless sections save incrementally. Taxonomy drift — every future setting must justify a rail slot; congestion creeps over months (slow burn). Mobile chip row with eight entries gets fiddly about the active chip (cosmetic).
- **Trade-offs**: The full-page read disappears (no scroll-audit of every setting); direct URLs need a hash/param sync that will get deferred then needed; the rail is a permanent structural commitment whose removal would read as a regression; roughly 200px of width gone on laptop forever.
- **Delivers the what?**: Fully for finding — Backup is one click away in days. Partially for overload — scanning load shrinks but moves into parsing eight rail labels, and lopsided sections still read unevenly inside their panes.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value days
- **Your take**: User asked what the "tune-once vs. operational" split meant; explanation given (operational = sections you return to, like providers, MCP servers, backup; tune-once = set-once config like profile and prompt instructions). Card pick still pending.
