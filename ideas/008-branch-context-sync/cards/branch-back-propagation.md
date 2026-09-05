---
card: 001
name: branch-back-propagation
origin: user
bet: Wins if branch decisions are usually self-contained and the only real cost is that the parent doesn't know about them
played: yes
---

# Card 001 — Branch back-propagation (your card)

## Story

You branch off the parent chat to fix the error, and the fix works. Before returning, you trigger an explicit "back-propagate" action on the branch: Mayon asks what to send back, and you choose either the raw context (the excerpt, your branch turns, verbatim — token-heavy but faithful) or a model-written summary of what happened. The result lands in the parent chat as a persisted, collapsible context operation — the same pattern as MCP tool blocks — so the parent's model reads the corrected reality from then on, while your transcript stays visually quiet.

## Playthrough (2026-09-05)

- **Goal (what & why)**: What — branched chats can push their outcomes back into the parent chat's context, user-controlled. Why — the parent keeps stale assumptions after you fix things on a branch, so resuming it produces answers based on outdated reality.
- **How it goes**: The branch view grows a "back-propagate" action; you pick raw or summarized, and the payload lands in the parent as a persisted collapsible context op above the composer. Day one feels right — the parent stops assuming the buggy code. Week one reveals the raw payload needs a "delta" definition (branch-only turns vs the shared parent prefix, plus tool calls and mid-turn edits — each a small owned policy). Week two exposes placement: the op appends at the end while the wrong claim sits mid-conversation, so the model hedges between its old claim and the correction. Week three brings housekeeping: bad summaries need delete/re-propagate UI, and branch-of-a-branch forces the "which ancestor receives it" question.
- **Snags**: (1) Defining the raw delta — bites during first build — moderate, a policy project in disguise. (2) Placement/recency: correction lands far from the wrong claim, model hedges — bites week two — moderate-to-bad, feature works mechanically but doesn't feel like it worked. (3) Summary fidelity + delete/re-propagate housekeeping — bites week three — moderate. (4) Deep branching: which ancestor? — bites on first real nested use — mild-to-moderate.
- **Trade-offs**: A second UI paradigm (collapsible ops) plus a persisted payload format maintained forever; an extra LLM round-trip per summary; the parent transcript stops being self-describing to humans skimming it (the correction is folded away).
- **Delivers the what?**: Fully — it is the what. The only card where the parent's context genuinely contains the branch's outcome; the open question is whether the machinery is proportionate.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value ~1–2 weeks
- **Your take**: Expects the op to steer the parent's future answers (yes, explicitly). Wants the propagated context anchored exactly where it was generated in the parent — a real artifact at its point in time that scrolls up as new turns arrive — not appended at the end. This takes aim at the placement/recency snag; residual wrinkle noted in play: parent turns generated *between* the anchor and propagation time stay where they are and still ignore the correction.
