---
card: 004
name: promote-branch
origin: dealt
bet: Wins if users usually want the branch outcome to become the conversation, not an annotation pinned to a wrong one
played: yes
---

# Card 004 — Promote branch

## Story

You never back-propagate anything. The boring, standard answer — the git one — is that the branch that fixed things becomes the new mainline: a "promote to parent" action makes the branch continue from where the parent conversation lives, and the old parent path is kept as an archived sibling you can still visit. The fix, the reasoning, and every turn that led to it are already in context by construction; there is no summary to trust and no propagation step to forget.

## Playthrough (2026-09-05)

- **How it goes**: "Promote to parent" makes the branch's line the mainline; the old parent path archives as a sibling. Week one is eerily clean because context is consistent by construction — the fix and its reasoning are native turns, so nothing hedges and nothing is patched. Then the structural snags: promotion is total, turns can't interleave (no merge for conversations), so two diverged branches can never both promote and the parent's later life gets orphaned into the archive; conversation identity/references need indirection; and the operation is all-or-nothing — it cannot express "propagate this one finding while the parent continues."
- **Snags**: (1) Totality / no merge — bites the moment the parent keeps living or a second branch exists — bad, winner-takes-all in a multi-branch workflow. (2) Identity: links and references point at a different conversation — bites at build time — moderate, real work behind a small button. (3) No small correction — bites immediately in the user's actual step-aside-and-fix workflow — moderate.
- **Trade-offs**: Gives up non-destructive sync (a fork-lifecycle decision, not a context op); raw-vs-summarized irrelevant. Buys consistency-by-construction for the promoted line and mostly-lifecycle machinery.
- **Delivers the what?**: No — it replaces the parent instead of informing it; reaches the why by a side door only in the narrow world where the parent had nothing else going on.
- **Difficulty vs payoff**: difficulty M · payoff M · time-to-first-value ~1–2 weeks
- **Your take**: Passed — "I don't like history altering." Promotion's replace-the-mainline semantics are disqualifying regardless of its consistency-by-construction appeal.
