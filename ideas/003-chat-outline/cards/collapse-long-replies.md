---
card: 005
name: collapse-long-replies
origin: dealt
bet: Wins if readers mostly consume long replies selectively, section by section, rather than top to bottom
played: yes
---

# Card 005 — Collapse long replies (accordion)

## Story

Long replies render with each section folded under its header, so the message itself becomes the outline. You read the header list, expand "Testing strategy" only, read it, and collapse it again; an "expand all" restores today's full-length rendering. Instead of navigating a long page, the length is never rendered in the first place.

## Playthrough (2026-09-02)

- **What/why checked against**: jump to the part of a long reply without scrolling all of it; long header-heavy replies are hard to search in the UI today.
- **How it goes**: You ship the accordion and scanning transforms — the reply's whole shape is visible as a header list, sections are one click away, nothing floats, nothing distracts. Then the classic accordion taxes arrive: browser find can't see folded sections, so "speed up searching" regresses exactly where the user feels it; copy-and-take-the-code needs an expand first; and top-to-bottom readers pay a click per section. The app's selection/highlight machinery (expound) also has to reckon with folded content — a highlight inside a collapsed section is invisible. Streaming complicates the fold structure live, and remembering which sections were open across re-renders is real work.
- **Snags**: find/copy regression — first time the user searches or copies — the core miss in a chat app where copying output is routine; folded highlights — whenever expound/highlight meets a collapsed section — silent invisibility; per-section clicking for sequential readers — always — friction that "expand all" only partially refunds; fold-state bookkeeping — ongoing — streaming, edits, and re-renders all poke it.
- **Trade-offs**: buys total orientation and the end of scrolling for selective readers; costs search fidelity, copy friction, and continuous-reading comfort.
- **Delivers the what?**: partially, inverted — "find the part" becomes trivial (it's always one click away) but "speed up searching" actively gets worse; strong only if reading is selective rather than sequential.
- **Difficulty vs payoff**: difficulty M–L · payoff M · time-to-first-value ~2–3 weeks
- **Your take**: (pending)
