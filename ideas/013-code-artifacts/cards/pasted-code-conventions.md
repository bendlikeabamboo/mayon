---
card: 004
name: pasted-code-conventions
origin: dealt
bet: Wins if the architecture is already 90% there and the "massive shift" is really just pasted-code awareness
played: yes
---

# Card 004 — Pasted-code conventions

## Story

You change nothing about your habit: you paste code straight into the chat bar, like always. But Mayon now recognizes the paste as a code artifact — names it (`selection.ts · 214 lines`), collapses it, gives it a stable handle — and the model cites and reuses those handles in later turns instead of asking you to re-paste. The chat bar turns out to have been the artifact section all along; it just needed a memory. No new navigation, no new persistence — detection plus prompt conventions.

## Playthrough (2026-11-09)

- **How it goes**: Detection-only: pastes get named/collapsed/citable handles and week one feels free — but names are heuristic and a mislabel erodes the trust the card runs on; a re-paste mints a new handle so version ghosts accumulate unless the Card 002 latest-version-wins policy is bolted on; and the bytes still ride the transcript, so it pays Card 002's context bill without its chip UI. Really Card 002's little sibling with more guessing and less product.
- **Snags**: Heuristic naming — bites on first mislabel — mild/medium. Ghost handles on re-paste — medium; needs latest-wins imported from 002. No context relief — bytes ride as before — medium.
- **Trade-offs**: Gives up explicit user intent (detection guesses what an attachment would state); no working set, no scoping, no freshness; polish spent on a path the deck has better versions of.
- **Delivers the what?**: Partially, weakest of the deck — durable-ish in transcript, tracked heuristically, no consult-on-demand. The bet's "architecture already 90% there" is half true: transcript yes, identity and freshness no.
- **Difficulty vs payoff**: difficulty S · payoff M (fading) · time-to-first-value days.
- **Your take**: Asked for a condensed play and was already leaning to discard this card before hearing it; playthrough record supports that lean.
