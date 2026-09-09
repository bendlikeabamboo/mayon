---
card: 002
name: streaming-edge-blur
origin: dealt
bet: Wins if the effect only needs to live at the arrival edge and per-word splitting is overkill
played: yes
---

# Card 002 — Streaming edge blur

## Story

You stream a reply, and the newest few words emerge out of a soft blur at the message's growing edge while everything already written sits as plain, stable text. Technically it is one small Svelte wrapper plus a CSS blur/fade mask pinned to the tail of the streamed block, driven by stream state — no per-token DOM churn, no span splitting. It ships in an afternoon and the message body underneath stays untouched.

## Playthrough (2026-09-08)

- **How it goes**: You ship the tail mask in a day: a blur/fade overlay pinned to the growing edge of the in-flight block, removed (with a short un-blur transition) on completion. The markdown DOM is byte-identical to today's, so nothing downstream notices — no completion swap, no sourcemap exposure. The effect reads as "text condenses out of a soft edge" and most reviewers genuinely can't name what changed, only that streaming stopped feeling abrupt. The work is all in the tail-chasing: the mask has to track text that re-wraps as chunks arrive, and it misbehaves when the stream ends mid-code-block or mid-list, where "the last few words" isn't a clean inline target.
- **Snags**: (1) Mask positioning across re-wrap — bites on long flowing replies; fiddly, cosmetic, fixable with iteration. (2) Non-paragraph content at the growth edge (code blocks, lists, tables) — bites the first time a reply ends in one; the mask looks odd or gets suppressed there. (3) Pointer/selection under the overlay — minor; `pointer-events: none` plus accepting that selection-under-blur looks strange mid-stream.
- **Trade-offs**: The configurability ceiling: this architecture offers a dial (intensity/width, on/off), not a menu of effects — no typewriter, no drop-in, no per-word anything. The wow factor is subtle by construction. In exchange: near-zero perf cost, near-zero maintenance, and total safety for the expound/sourcemap invariants.
- **Delivers the what?**: Mostly — "streaming replies emerge smoothly, no pop-in" is delivered honestly. "With the emergence effect configurable" is only partially: one effect, a dial, not a gallery.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days (an afternoon to first light; days to polish edge cases)
- **Your take**: "Ooh that's interesting" — spontaneous positive reaction after the playthrough; source of the interest (the effect itself vs. the safety/simplicity) not yet specified.
