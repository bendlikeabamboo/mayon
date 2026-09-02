---
card: 005
name: mcp-pull
origin: dealt
bet: Wins if pull-based ingestion through the existing MCP runner covers most real needs with near-zero composer work
played: yes
---

# Card 005 — Model pulls, app doesn't push (wild card)

## Story

You push almost nothing: files live where they live, and the composer takes lightweight references — a paste, a drop that stores the blob in the sandbox storage the server already hosts. The existing MCP runner exposes an ingest tool (read-file, read-image), and the model pulls what it needs when it needs it, with vision-capable models receiving image parts only inside tool results. There is no per-modality composer UI to build; the capability lives in the tool layer Mayon already has.

## Playthrough (2026-09-02)

- **What & why** (recorded at play time, confirmed by user at deal time): Let users feed non-text input — images, video, audio/voice, files — into a chat when the connected model supports that modality. Why: composer and server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon.
- **How it goes** (condensed — card killed before full play): Data flow inverts — the model pulls files via read-file/read-image tools on the existing MCP runner; the composer only handles lightweight references; images reach vision models inside tool results. Full playthrough not performed at user request.
- **Snags**: (not explored — killed early) Likely ones flagged at deal time: tool-call latency per fetch, weaker UX for "look at this now" moments, and images-only-inside-tools depends on the provider supporting image parts in tool results.
- **Trade-offs**: Composer stays almost untouched, but the user loses direct control of what the model sees and when.
- **Delivers the what?**: Partially — indirect, pull-based delivery of material; no first-class "paste a screenshot" moment.
- **Difficulty vs payoff**: difficulty M · payoff M · time-to-first-value 2–3 weeks
- **Your take**: No-go before full play, together with card 004. Consistent with the session's signal: the user's why is vision-first (screenshots to be seen), and pull-based ingestion has no first-class paste-a-screenshot moment.
