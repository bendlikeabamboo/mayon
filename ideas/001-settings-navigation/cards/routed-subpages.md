---
card: 004
name: routed-subpages
origin: dealt
bet: Wins if deep links and browser history matter and sections can split cleanly
played: yes
---

# Card 004 — Routed sub-pages (the boring standard)

## Story

Each settings section becomes its own route — /settings, /settings/providers, /settings/backup — with a compact picker linking between them. The back button works, and a URL like /settings/backup is bookmarkable and shareable, so "go to settings → backup" becomes a single link. This is the pattern nearly every web app settled on years ago; the long single page was the accident, not a decision.

## Playthrough (2026-08-28)

- **What & why (confirmed at deal time)**: What — reaching any specific settings area, like Backup, is quick and self-evident, without scrolling past everything else. Why — the settings page is one long scroll today; length plus the cognitive load of scanning every section makes finding a known section slow and frustrating.
- **How it goes**: The first stretch unwraps the slot hierarchy — the providers config currently wraps every other section — into a settings layout with a section nav and one route per section, components moving over unchanged. Then the URL delivers what nothing else in the deck can: /settings/backup is bookmarkable, shareable, and the back button works, so "go to settings → backup" collapses into a single link. The ongoing tax is direct entry: every section page must boot cold, without Providers ever having mounted.
- **Snags**: The unsaved-changes dilemma from Card 001 returns intact — navigating away unmounts a section's form state. Direct-entry correctness: sections that today ride inside the providers wrapper must stand alone when deep-linked or refreshed; any shared context moves to the layout or breaks. Cross-section flows become navigation ping-pong, and the whole-page audit scroll disappears, which quietly pushes a nav-rail decision back into the layout — Card 001 miniaturized tends to reappear.
- **Trade-offs**: The most structural work in the deck, spent partly on powers you didn't ask for; overload redistributes into the nav just as in Card 001; every future section needs a route, a nav entry, and a cold-boot check.
- **Delivers the what?**: Fully for finding — one hop from the section nav, and the only card that makes "open backup" a literal URL. Partially for overload — same redistribution as Card 001.
- **Difficulty vs payoff**: difficulty L · payoff M–H (H only if deep links matter) · time-to-first-value 1–2 weeks
- **Your take**: User is leaning toward this card; asked where the per-section click lives (dropdown on the settings button?). Answered: existing entry points (sidebar/AppShell nav item, "Open Settings" buttons on home/chat) already link to /settings and keep working; the section picker is a visible row of section links inside the settings layout rather than a hidden dropdown; deep links let other surfaces (chat nudges, bookmarks) target /settings/backup directly. Verdict pending.
