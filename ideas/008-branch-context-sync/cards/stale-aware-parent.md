---
card: 003
name: stale-aware-parent
origin: dealt
bet: Wins if the real problem is knowing where the parent went wrong, not transporting branch content into it
played: yes
---

# Card 003 — Stale-aware parent

## Story

Nothing is ever pushed into the parent. Instead, when you reopen it, Mayon notices that a branch descended from one of its turns has concluded something different — your fix proved the parent's code wrong — and marks that turn with a quiet "branches diverged here" marker. Clicking the marker shows what the branch found and offers to re-anchor from that point: the parent continues its life with its outdated stretch explicitly flagged, rather than silently trusting its own earlier claims.

## Playthrough (2026-09-05)

- **How it goes**: No propagation exists; the parent instead grows an awareness layer — branch divergence marks the spawning turn, clicking reveals the branch's conclusion and offers re-anchoring. Week one feels mature ("git-blame for conversations": the chat admits where its knowledge ends). Week two exposes the trap: awareness is not knowledge — the model's context still holds the wrong claim uncorrected, so the parent answers from stale premises until the user acts. "Acting" (re-anchor = regenerate the stale tail) is expensive and history-changing; offering "click to inject the outcome" quietly rebuilds Card 001 behind a marker.
- **Snags**: (1) Detection: knowing a branch "concluded something different" needs an LLM pass per branch or heuristics — heuristics catch excerpt-editing fixes but miss approach-level conclusions (false negatives on the interesting cases) and flag exploratory branches (noise) — bites at build time and forever — moderate-to-bad. (2) Awareness-vs-knowledge gap — bites every time the user ignores a marker — moderate. (3) Re-anchor semantics (regenerate vs inject) — bites as soon as anyone clicks — moderate.
- **Trade-offs**: Gives up knowledge transfer entirely (nothing enters the parent's context unless the user acts); raw-vs-summarized never comes up. Buys zero pollution risk, no new persistence format, and composability (it's an annotation layer, orthogonal to any transport).
- **Delivers the what?**: Partially, less than Card 002 — the what says outcomes get into the parent's context; here nothing does. Serves the why only by replacing silent staleness with visible staleness.
- **Difficulty vs payoff**: difficulty M · payoff L–M · time-to-first-value ~2–3 weeks
- **Your take**: Rejected — "bad idea, very expensive." The LLM-per-branch detection and re-anchor regeneration costs are disqualifying.
