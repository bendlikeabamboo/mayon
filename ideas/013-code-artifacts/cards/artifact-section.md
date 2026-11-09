---
card: 001
name: artifact-section
origin: user
bet: Wins if a curated artifact workspace is the natural home for working code and the model reliably consults it before answering
played: yes
---

# Card 001 — Artifact section (your card)

## Story

You keep Mayon open beside your IDE, and instead of flooding the chat bar, you paste each file or snippet into a dedicated Artifacts section. Mayon records each paste as a tracked artifact — content, name, when it was added — and the section becomes your working set for the session. When you ask something about your code, the model looks through that section and answers grounded in what is actually there. You paste a file once, and every later turn can draw on it.

## Playthrough (2026-11-09)

_Goal — What: working code lives in Mayon as durable, tracked artifacts the model consults on demand, not disposable chat-bar pastes. Why: end repetitive IDE-content pasting and make code first-class context._

- **How it goes**: The section itself is quick CRUD (paste box, name, timestamp, highlighting) and feels right in week one. The cost hides in the model's side of the bargain: "looks through them when it needs to" means either injecting everything into every prompt (context bloat; working set effectively size-capped) or building retrieval (ranking, relevance, when-to-fetch) — that is the real architecture shift and most of the effort. Staleness then bites: pasted copies drift from the IDE, so keeping them current reintroduces the paste ferry-work the card exists to kill. Scoping (per-chat vs global working set) decides between re-pasting per conversation or leaking context across chats.
- **Snags**: Inject-vs-retrieve fork — bites the moment the model is wired in — this is the actual job. Staleness — bites at the first refactor — medium/bad; demands re-pasting or diff-and-update machinery. Scoping — bites at the second chat — medium. New top-level UI surface in a text-first app — mild but real weight.
- **Trade-offs**: Gives up the transcript as the single home of context; commits to solving freshness and retrieval eventually; a new entity and surface to maintain; working-set size capped under always-include.
- **Delivers the what?**: Partially. Durable and tracked: fully. "Consults on demand": only after inject-vs-retrieve is solved — the hidden bulk of the card. An always-include MVP with a small working set delivers most of the daily value.
- **Difficulty vs payoff**: difficulty L (M for an always-include-capped MVP) · payoff H · time-to-first-value ~2–3 weeks.
- **Your take**: Working set is ~5 files today but expected to grow fast — small enough for an always-include MVP now, but growth argues for designing the consult/retrieval path in from the start rather than after the set swells.
