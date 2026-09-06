# Branch back-propagation (anchored context artifacts)

**What**: Branched chats can push their outcomes back into the parent chat's context as user-controlled, anchored, collapsible artifacts, so the parent stays in sync with decisions and fixes made on the branch.
**Why**: The parent silently keeps stale assumptions — it still believes code it produced is correct even after the user fixed it on a branch — so resuming the parent produces answers based on a version of reality the user already moved past.

## The path

You branch off a parent chat to fix an error, and the fix works. From the branch you trigger an explicit, user-controlled back-propagate: you choose either the raw branch delta (the branch-only turns plus the anchored excerpt, verbatim) or a model-written summary of what happened. The payload lands in the parent as a persisted artifact — a new entry `kind` on the existing `messages` table (the same collapsible pattern as tool calls and reasoning), anchored exactly at the branch point in the parent thread. It reads as a real artifact of that moment: it sits where it was generated and scrolls up as new turns arrive, steering every future composition of the parent. Nothing existing is moved or rewritten — the operation is purely additive.

## Known snags

- **Raw delta definition** — the branch transcript shares its prefix with the parent, so "raw" must mean branch-only turns plus the anchored excerpt, with explicit policy for tool calls and mid-turn edits — bites during first build — moderate.
- **Stale middle** — parent turns generated between the anchor and the propagation still sit after the artifact and still ignore the correction — bites whenever the parent kept living during the branch — moderate (accepted: anchoring was chosen over history rewriting).
- **Summary fidelity** — the summarized option is an LLM call and can drop the crucial detail; needs a delete/re-generate affordance — bites around week three — moderate.
- **Deep branching** — branch-of-a-branch needs a rule for which ancestor receives propagation (start with: immediate parent only) — bites on first nested use — mild-moderate.

## Accepted trade-offs

- A new entry kind plus its rendering/collapse UI becomes a permanent part of the message model.
- The summarized option costs an extra LLM round-trip per propagation.
- No propagation to sibling or future branches — the ledger's reach was rejected together with its separate store.
- Rejected alternatives, on the record: plain sync notes (untrustworthy authority), divergence markers (LLM cost per branch, rejected as too expensive), branch promotion (history altering), tree-scoped decision ledger (separate store + per-turn relevance cost).

## The bet

This wins if branch decisions are usually self-contained and the only real cost is that the parent doesn't know about them — and if riding the existing `messages.kind` abstraction keeps the machinery cheap enough that an anchored, consistency-preserving artifact beats the flexibility of a shared context store.
