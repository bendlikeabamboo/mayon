---
card: 002
name: jump-palette
origin: dealt
bet: Wins if navigation is occasional and keyboard-first users value zero permanent chrome
played: yes
---

# Card 002 — Summoned jump palette

## Story

You hit a shortcut while reading a long reply and a small palette pops up listing that reply's sections. You type "deploy", arrow down, press Enter, and the chat lands on that header. Nothing is on screen when you don't ask — no persistent panel, no toggle setting to manage.

## Playthrough (2026-09-02)

- **What/why checked against**: jump to the part of a long reply without scrolling all of it; long header-heavy replies are hard to search in the UI today.
- **How it goes**: You ship the shortcut-plus-filter palette; on desktop it feels instant — hit the key, type two letters, Enter, you're at the section. Then discoverability bites: nobody finds invisible shortcuts, so a small visible affordance appears on messages, and some chrome creeps back through that door. Section names turn out to be the weak link — replies grow multiple "Overview"/"Summary" headers and the filter returns ambiguous targets. On touch there is no keyboard, so mobile needs a tappable button anyway.
- **Snags**: discoverability — from day one, constant — the palette is only as good as its entry point; duplicate/generic header names — as soon as replies are filtered — medium, weakens trust in results; mobile affordance — first small-screen use — adds a button, eroding the zero-chrome claim.
- **Trade-offs**: no ambient orientation (never answers "where am I"); invisible until summoned, which trades distraction for discoverability tax; leans on keyboard habits desktop users may not have.
- **Delivers the what?**: partially — the jump is fast and distraction-free, and filter-as-you-type genuinely is "speeding up searching"; but orientation mid-read and visual scanning of what a reply contains are not covered.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days
- **Your take**: Not a favorite — user "doesn't like it that much". Moved on immediately to Card 003.
