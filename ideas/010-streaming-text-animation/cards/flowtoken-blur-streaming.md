---
card: 001
name: flowtoken-blur-streaming
origin: user
bet: Wins if the polish lift is worth per-token DOM overhead and leaves the markdown/expound machinery intact
played: yes
---

# Card 001 — FlowToken blur streaming (your card)

## Story

You send a prompt, and as tokens arrive Mayon splits the streamed markdown into word-level spans the way flowtoken does: each new word blurs in and sharpens over ~0.4s instead of popping in. The effect is configurable — animation name (blur-in being the headline, with fade and kin variants available), duration, and easing — exposed in appearance settings, with an "off" switch. Scrolling a generating reply feels like flowtoken's demo: text condensing out of a soft blur at the growth edge.

Source: https://github.com/Ephibbs/flowtoken (host github.com — fetched under the URL safe-list, no credentials in URL).

## Playthrough (2026-09-08)

- **What & why (deal-time)**: What — streaming chat replies emerge smoothly as the LLM generates them, no abrupt token pop-in, with the emergence effect configurable. Why — streamed text currently appears chunk-by-chunk as markdown re-renders, reading as flicker and making generation feel cheap; smoothing it makes streaming feel polished and intentional.
- **How it goes**: You build a streaming render mode: while a reply is generating, markdown is rendered through a flowtoken-style word-split path (per-word spans carrying a configurable animation — blur-in, duration, easing from appearance settings), and on completion you swap to the normal `Markdown.svelte` output. Week one the demo looks fantastic. The first real event is the completion swap: the DOM changes shape (spans collapse to plain nodes, injected chrome like copy buttons appears), so every finished message visibly re-lays-out at the exact moment the reader is looking at it. Living with it, the second cost emerges: selection/expound machinery now has two DOM shapes to agree with (the sourcemap must resolve through the span tree mid-stream), and the third is steady-state weight — hundreds of animated spans on long replies, which flowtoken's own README tells you to avoid by disabling animation on completed messages (see research.md).
- **Snags**: (1) Completion swap flash — bites on every message, right at the emotional peak; fixable only by unifying render paths, which is the expensive version. (2) Expound/selection alignment through the span tree — bites mid-stream; this is invariant-level work per the repo's own warnings, not styling. (3) Memory/perf of animated spans — bites on long replies and long chats; mitigated by dropping animations on completion, which quietly removes the effect from most of what's on screen.
- **Trade-offs**: Two render shapes for one markdown surface to maintain forever; a settings surface (effect, duration, easing, off) with an "off" that must reproduce today's rendering exactly; every future Markdown.svelte change gets checked twice.
- **Delivers the what?**: The configurable blur-in effect, fully — this is the most literal delivery in the deck. The "polished" half, partially: until the completion swap and mid-stream selection quirks are solved, polish flickers at the finish line.
- **Difficulty vs payoff**: difficulty M–L · payoff H · time-to-first-value ~1–2 weeks (demo-quality; expound-safe takes longer)
- **Your take**: (none)
