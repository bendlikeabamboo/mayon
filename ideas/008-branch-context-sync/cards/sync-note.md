---
card: 002
name: sync-note
origin: dealt
bet: Wins if a plain message in the thread is enough for the model and the collapsible context-operation machinery is most of the cost
played: yes
---

# Card 002 — Sync note

## Story

You come back to the parent chat and a slim banner shows above the composer: "Branch 'fix parse error' finished — insert a note?" Clicking it drops a plain chat message into the parent thread — "From branch: replaced the retry loop with a backoff because it was timing out" (or the raw excerpt, if you pick that) — as a normal turn you can edit before sending. There is no new UI paradigm, no collapsible operation components, no persistence format: the note is just a message, and the model reads it like any other.

## Playthrough (2026-09-05)

- **How it goes**: A banner above the parent's composer offers to insert a note when a branch finishes; clicking drops an editable plain message (drafted summary or raw excerpt) into the thread. Week one is frictionless because it is built entirely from existing parts — messages, composer, editing — and ships in days. The snags arrive quietly: a note is prose with no authority, so whether the model weighs it over its own earlier confident claim is wording-dependent; each note is visible clutter that cannot collapse; and the note lands at the bottom where it was sent — it cannot anchor at the branch point without becoming history editing.
- **Snags**: (1) Authority/weight: plain prose vs the parent's earlier confident claims — bites whenever the parent resumes making assertions — moderate, wording-dependent. (2) Transcript clutter: one visible message per sync, no collapsing — bites with regular branching — mild but constant. (3) Placement: lands at the end by construction; the anchored-position idea from Card 001's take does not apply — bites immediately — moderate.
- **Trade-offs**: No structured op: no collapse, no typed payload, no machine-readable persistence, no lifecycle beyond normal message editing. Buys unmatched simplicity and fully honest transcripts (what the model knows is what a human sees).
- **Delivers the what?**: Partially — the parent does learn the outcome (raw-vs-summarized survives as "draft or paste"), but "persisted as a collapsible context operation" is explicitly not delivered.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days
- **Your take**: Feels unreliable as a context-propagation mechanism — the authority/weight snag landed; user would not trust a plain prose note to stick.
