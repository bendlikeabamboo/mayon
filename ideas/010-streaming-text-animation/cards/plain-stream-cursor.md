---
card: 004
name: plain-stream-cursor
origin: dealt
bet: Wins if per-word effects threaten the expound/sourcemap invariants or performance more than they add delight
played: yes
---

# Card 004 — Plain stream cursor

## Story

You ship the boring standard every mainstream chat app converged on: no per-word animation at all. Streamed text renders plainly with a small blinking cursor (or subtle gradient) marking the in-flight block, and completed messages get at most one gentle fade-in. The markdown DOM keeps its exact current shape, so the source map, expound selection alignment, full-text search, and copy buttons work exactly as today — and nobody complains that the streaming looks unfinished.

## Playthrough (2026-09-08)

- **How it goes**: You ship it in a day or two: no animation on the text itself, a small blinking cursor (or a soft gradient edge) marking the in-flight block, and one gentle fade when a message completes. Every mainstream chat app converged here independently, and living with it you find out why: the streaming stops drawing attention to itself, the DOM never changes shape, and nothing in the pipeline — expound, search, copy, perf — has a new thing to break. The event of week one is the _silence_: no compliments, no complaints. The absence of complaint is the product.
- **Snags**: (1) The cursor is a genre marker — it reads instantly as "AI is typing," which is why everyone uses it, but it also reads as "default, unstyled, didn't try" to anyone who came here wanting visual character. (2) Even a humble cursor wants to sit inline at the end of the last text node; a `::after`-style placement avoids DOM changes entirely, but any inline element at the tail can nudge wrapping — a one-line fix, mentioned only because this deck's other cards make it look big. (3) The durable risk: if your underlying want was _delight_, this delivers none of it, and you're back in this idea folder within a month.
- **Trade-offs**: All expressive upside — no emergence, no blur, no configurability beyond maybe an on/off. It is the floor of the deck, not the ceiling.
- **Delivers the what?**: No — it refuses the what outright (no emergence, no effect, nothing to configure) while quietly serving the why's negative half: nothing feels cheap because nothing draws attention. This is the contrarian bet: that the whole idea is a want, not a need.
- **Difficulty vs payoff**: difficulty S · payoff L–M · time-to-first-value days
- **Your take**: (none — moved on with `next`)
