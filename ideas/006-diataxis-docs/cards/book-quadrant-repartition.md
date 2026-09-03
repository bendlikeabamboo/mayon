---
card: 002
name: book-quadrant-repartition
origin: dealt
bet: Wins if the pain is chapter ordering and interleaved concerns, not the book format itself
played: yes
---

# Card 002 — Book quadrant repartition (smaller)

## Story

You touch only `_quarto.yml`: the four parts become Tutorials / How-to guides / Reference / Explanation, and existing chapters are re-filed into whichever quadrant they actually belong to — guide pages split where a single file mixes a walkthrough with reference tables. No `project.type` change, no new tooling, no URL redesign; the book still renders and publishes in one line. The first thing that happens is a reader opening the docs and seeing "Reference" as a top-level part they can jump straight into, instead of scrolling past tutorials to find it.

## Playthrough (2026-09-03)

- **How it goes**: Day one, `_quarto.yml` only: parts renamed to Tutorials / How-to guides / Reference / Explanation, with Development Notes and Decision History kept as their own dedicated non-Diátaxis sections (per user's Card 001 take). Diff is a few dozen lines; render and publish unchanged. Readers immediately see Reference as a top-level part and jump straight in. Then re-filing surfaces the real cost: mixed pages (e.g. guide/quizzes = walkthrough + reference tables) need the same splitting discipline as Card 001 — skipping a split makes the quadrant label overpromise. The book keeps prev/next arrows and one linear TOC, so the "fixed sequence" feel persists in the reading chrome. Six months out, quadrant discipline holds only as well as the splitting did; nothing in the format enforces it.
- **Snags**: Overlapping surgery cost — bites as soon as re-filing starts — 3/4-strict splitting is Card 001's cost without its payoff. Linear chrome persists — bites daily and quietly — prev/next + single TOC still signal a fixed order. No format enforcement — bites over months — new pages drift to wherever is easiest.
- **Trade-offs**: Gives up intent-first navigation, per-quadrant multi-sidebar layout, and website-style browsing; bets on manual discipline where a format/platform would enforce structure.
- **Delivers the what?**: Partially — quadrant organization yes (immediately, cheaply); "browsable documentation website" no — still book-shaped browsing with better shelf labels.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value ~1–2 days
- **Your take**: "Seems lazy" — read as a half-measure: right labels without the website feel the user wants.
