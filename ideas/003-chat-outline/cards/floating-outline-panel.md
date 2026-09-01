---
card: 001
name: floating-outline-panel
origin: user
bet: Wins if long replies are frequent enough that always-available navigation pays for its screen footprint
played: yes
---

# Card 001 — Floating outline panel (your card)

## Story

You open a long reply and a slim outline floats beside the message, built from its chapter headers. You click "Rollout plan" and the chat scrolls straight there; as you scroll, the outline shows where you currently are. When you don't want it, a toggle (per message or in settings) makes it disappear until you ask for it back.

## Playthrough (2026-09-02)

- **What/why checked against**: jump to the part of a long reply without scrolling all of it; long header-heavy replies are hard to search in the UI today.
- **How it goes**: Week one ships cleanly — headers harvested into a floating panel, click-to-scroll works, toggle in place. Streaming is the first snag: headers arrive while the reply is still generating, so the outline rebuilds under the cursor and jump targets move mid-click. Week two adds scroll-spy ("where am I"), which works until section edges jitter the active highlight. The app's selection-alignment machinery (expound) must be taught to ignore the panel's injected DOM or selections near it misalign. On narrow widths the panel competes with the text for horizontal space and collapses into a drawer — effectively a second UI to keep honest.
- **Snags**: streaming rebuilds — during generation, immediately — annoying but workaround-able (settle on completion); scroll-spy edge jitter — week two — medium, classic hysteresis problem; expound exclusion list — first selection near the panel — rare but high-confusion if missed; narrow-width squeeze — first mobile/small-window session — forces a drawer variant.
- **Trade-offs**: permanent screen real estate; a toggle surface to design (settings vs per-message vs both); ongoing obligations as injected chrome inside the markdown renderer.
- **Delivers the what?**: fully — the only card that answers "where am I" while scrolling in addition to jumps; the toggle covers the "didn't ask for chrome" objection.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value ~1–2 weeks
- **Your take**: Persistent panel might be distracting. User floated a pattern none of the cards cover: horizontal bars (scrollbar-like) that grow on hover, with a long-hover revealing a clickable preview of the content at that spot. Moved on to Card 002; candidate seed for a re-deal if no card delivers it.
