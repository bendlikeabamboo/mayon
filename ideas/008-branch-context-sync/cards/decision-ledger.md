---
card: 005
name: decision-ledger
origin: dealt
bet: Wins if branch conclusions need to reach more than one descendant and should outlive any single conversation
played: yes
---

# Card 005 — Decision ledger

## Story

Propagation stops being a push. Any chat in a tree — branch or parent — can pin a durable fact to a shared ledger for that chat tree: "error E is fixed by Y", "we decided Z". When the parent (or a sibling branch, or a future branch) composes its context, it reads the ledger automatically, so your fix reaches not just the parent but also the second branch you were about to start from the same wrong excerpt. Relevance still matters — the ledger is scoped per chat tree and entries are collapsible, much like tool calls, so the context stays auditable.

## Playthrough (2026-09-05)

- **How it goes**: Chats pin durable facts to a tree-scoped ledger; parents, siblings, and future branches read it automatically when composing context. Week one shows the quiet magic — reach no push card has, plus purely additive operation (no history alteration). Then the bill: reading the ledger every turn means either shipping every pin into every context (token-heavy reborn) or relevance selection (an LLM pass per turn — the expense rejected on Card 003, now recurring). Pins never age: superseded or reverted facts linger, producing staleness with a seal of approval. The parent's transcript still never shows the fix, and each propagation becomes a condensation/writing task with Card 001's summary-fidelity risk.
- **Snags**: (1) Per-turn relevance cost — bites from day one and forever — bad, it is the Card 003 expense on a subscription. (2) Pin lifecycle/drift — bites weeks in — bad, wrong-but-authoritative facts. (3) Invisible side channel (extra hop when debugging why the parent believes X) — bites when behavior surprises — moderate. (4) Authoring burden per pin — bites with every propagation — mild-moderate.
- **Trade-offs**: Gives up conversation-native placement (anchored artifact), transcript visibility, and one-time cost; cost shifts from propagation-time to composition-time. Buys unmatched reach (siblings + future branches) and strict non-alteration of history.
- **Delivers the what?**: Partially with inverted transport — the parent comes to know the outcome, but nothing is pushed into the parent's context as a persisted op; pull from a side channel, user-authored rather than user-triggered.
- **Difficulty vs payoff**: difficulty M–L · payoff M · time-to-first-value ~2–3 weeks
- **Your take**: Idea accepted in spirit, mechanism rejected — no separate ledger; prefers building on the existing artifacts/abstractions ("kind, etc.") so the back-propagated context becomes a new entry kind in the mix rather than a parallel store.
