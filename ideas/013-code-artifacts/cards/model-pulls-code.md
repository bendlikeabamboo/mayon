---
card: 005
name: model-pulls-code
origin: dealt
bet: Wins if the model knowing which code it needs beats you guessing what to share
played: yes
---

# Card 005 — Model pulls code

## Story

You ask why your build fails and, instead of guessing from prose, the model replies with a request: share `src/lib/chat/selection.ts`. You approve and paste just that one file, and it lands in the transcript as a tracked artifact at exactly that turn. The model ends up holding the right bytes because it asked for them — and the artifact trail becomes a record of what the conversation actually needed.

## Playthrough (2026-11-09)

- **How it goes**: The model requests exactly the file it needs, the user approves and pastes just that, and it lands tracked at that turn — context lean by construction, trail recording what the conversation actually needed. Round-trip stalls tax quick questions into ping-pong; cold-start blindness means the model can only request files it can name, so the first paste or a listing still comes from the user (quietly reinventing a slice of Card 003); approval fatigue sets in once requests stack up in a session.
- **Snags**: Latency choreography — bites on every quick question — medium. Cold-start blindness — bites at conversation start — medium; needs an initial listing or paste. Approval fatigue — bites in longer sessions — mild/medium.
- **Trade-offs**: Gives up push-based convenience (answering requests instead of preempting them); coverage bounded by the model's own awareness — it never sees what it didn't think to ask; depends on model discipline to request rather than guess.
- **Delivers the what?**: Partially-to-mostly — durable, tracked at turn granularity, literally consult-on-demand, but bounded by the model's awareness. Shape note: works best as the consult mechanism Card 001 wanted or the provenance layer Card 003 needed — a mechanism more than a destination.
- **Difficulty vs payoff**: difficulty M · payoff M–H (when the model's requests are sharp) · time-to-first-value ~1–2 weeks.
- **Your take**: (none yet)
