---
card: 003
name: smoothed-streaming
origin: dealt
bet: Wins if the pain is chunk-rate jitter and re-render flicker, not the absence of a decorative effect
played: yes
---

# Card 003 — Smoothed streaming

## Story

You send a prompt, and raw network chunks land in a small buffer instead of hitting the renderer directly; a render loop releases buffered text to the markdown renderer at a steady cadence, catching up quickly when the stream goes idle. The reply flows in at a constant, calm speed — the burstiness and re-render flicker that made streaming feel rough simply stop existing. No blur, no extra spans; a visual effect could still layer on top later.

## Playthrough (2026-09-08)

- **How it goes**: You insert a small buffer between the network stream and the markdown renderer: raw chunks land in the buffer, and a render tick releases text at a steady cadence (ideally on word/safe boundaries), draining quickly when the stream ends or falls behind. Even with a bursty upstream, the reply now flows in at a constant, calm rate — the re-render flicker and chunk-burst jumps disappear entirely, and Mayon suddenly feels like the composed one in a tab full of twitchy chat apps. Living with it: the effect is pure absence — nobody can screenshot it, but everybody feels it — and you notice you are now deliberately withholding text the model already sent, which stretches time-to-last-token by however much pacing you choose.
- **Snags**: (1) Boundary awareness — releasing text at arbitrary ticks can split words or open markdown constructs mid-tick (half a link, an unclosed fence); bites on code-heavy replies; self-corrects as the buffer drains, and Mayon already renders partial markdown today, so this is "same as now, at a steadier rate" unless you add markdown-aware release points (small, worth doing). (2) Pacing is a product decision — cadence too slow makes a fast model feel throttled; you end up with adaptive release (drain faster as the buffer grows), which is where the real tuning time goes. (3) End-of-stream burst — the final drain can itself look like a chunk unless eased; minor.
- **Trade-offs**: Deliberate latency (a few hundred ms of hidden-but-arrived text); one more stateful component in the chat pipeline to test; and zero visual identity — no effect, nothing to configure except speed, Mayon looks like every other chat app, just calmer.
- **Delivers the what?**: Partially — it fully kills the "abrupt pop-in" half of the why (the flicker, the jumps), but delivers none of the "emergence effect configurable" half: nothing blurs, nothing animates. This is the reframe card: it bets the why (feels cheap/flickery) matters more than the what (an effect).
- **Difficulty vs payoff**: difficulty S–M · payoff M (H if the real pain is jitter, L if users want delight) · time-to-first-value days
- **Your take**: (none — moved on with `next`)
