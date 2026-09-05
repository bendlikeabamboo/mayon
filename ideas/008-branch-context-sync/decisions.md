# Decisions: 008-branch-context-sync

- Created: 2026-09-05T17:52:28Z

## Verdict

- **Winner**: `cards/branch-back-propagation.md` (Card 001), refined through playthrough — back-propagation implemented as a new, anchored, collapsible entry `kind` on the existing `messages` table (no new persistence paradigm); anchored exactly at the branch point in the parent; user chooses raw branch delta vs model summary; purely additive, never history-altering.
- **Runner-up**: `cards/sync-note.md` (Card 002) — cheapest path (days to value), rejected on reliability: plain prose carries no authority over the parent's earlier claims.
- **Why**: Only card that fully delivers the what; every user take during the playthrough sharpened it rather than displacing it (anchored placement, no history alteration per Card 004's rejection, no separate store per Card 005's rejection); `research.md` grounding showed `messages.kind` already provides persisted, ordered, collapsible entries.
- **Date**: 2026-09-05
- **Spec seed**: `spec.md` (this folder)
