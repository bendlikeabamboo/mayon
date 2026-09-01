---
card: 006
name: hover-peek-bars
origin: user
bet: Wins if navigation is bursty — you hunt when you need something and ignore the edge the rest of the time
played: yes
---

# Card 006 — Hover peek bars

## Story

A slim strip of horizontal bars runs along the edge of a long reply, one bar per section, sized to its length. At rest it's a hairline of ticks you barely register. Hover and the bars fatten; hold a moment and a preview floats in showing that section's heading and opening lines — click the preview to land there.

## Playthrough (2026-09-02)

- **What/why checked against**: jump to the part of a long reply without scrolling all of it; long header-heavy replies are hard to search in the UI today. Born mid-playthrough from the user's distraction concern about Card 001.
- **How it goes**: You ship the strip and the rest state is genuinely invisible — the distraction objection has nothing to hold onto. Hover fattens the bars; a deliberate dwell pops a preview with the section's heading and first lines; click lands you there. Then hover-intent tuning begins: a dwell too short fires previews while you're merely crossing the edge toward something else, and the pop-ups become the new distraction; too long and the strip feels dead. Preview content is the real engineering: live-rendered section markdown is expensive per hover and shifts during streaming, so excerpts get cached — and go stale on edit or regenerate. Small edge targets test precision, touch has no hover at all, and the preview card joins the expound exclusion list like every injected element before it.
- **Snags**: hover-intent tuning — from the first dogfood session, constantly — the line between delightful and noisy; preview freshness/cost — every hover, worse mid-stream — a steady engineering tax; touch parity — first small-screen session — the pattern is desktop-first and needs a fallback; target precision — always — small bars demand generous hit areas.
- **Trade-offs**: gives up ambient always-visible orientation (unless a position marker is added to the strip) and touch-first ergonomics; buys a near-invisible rest state and see-before-you-jump confidence no other card offers.
- **Delivers the what?**: largely — "see the shape, preview it, jump" speeds up searching without permanent chrome; falls short of Card 001 only on continuous "where am I" and mobile.
- **Difficulty vs payoff**: difficulty M · payoff M–H · time-to-first-value ~2 weeks
- **Your take**: "6 is goated" — chosen as the winner of the playthrough (2026-09-02).
