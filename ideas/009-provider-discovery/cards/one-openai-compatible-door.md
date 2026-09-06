---
card: 004
name: one-openai-compatible-door
origin: dealt
bet: Wins if local runtimes stay OpenAI-compatible (they almost all are) and the cost to avoid is an ever-growing provider list to maintain
played: yes
---

# Card 004 — One OpenAI-compatible door

## Story

You add no providers. Instead the generic custom OpenAI-compatible endpoint becomes the documented, first-class path for anything local: a recipe for LM Studio, one for vLLM, and a health-check button that pings the endpoint and lists its models. Users who want local inference follow two documented steps; Mayon's provider list stops growing altogether.

## Playthrough (2026-09-06)

- **What & why**: What — Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Why — local/self-hosted inference has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.
- **How it goes**: You register nothing. The generic `openai-compatible` kind already exists and is fully served (sdk adapter, dialect extra-body handling, `/v1/models` discovery, manual tool-capability override), so the work is making it _worthy_: a polished custom-endpoint form (name, base URL, explicit tools toggle, connection test, model-list fetch), and two recipes — LM Studio (start the server, enable CORS or `lms server start --cors`, base URL `localhost:1234/v1`) and vLLM (`vllm serve`, base URL `localhost:8000/v1`). Tool capability becomes an explicit user assertion for their own endpoint instead of URL-allowlist magic — which also retires the silent tools-off snag for any endpoint at all. A vLLM operator follows the recipe and is chatting in ten minutes. The provider list never grows by even one entry; the "long list" complaint is answered by refusing to feed it.
- **Snags**: Discoverability — the flow starts in docs, and the users who most need guidance are the ones least likely to read it; bites at adoption. The custom-endpoint form is where novices go to die if it exposes jargon (kind, baseUrl, toolCapability) — bites on first use. LM Studio's CORS-off default is still the first-run wall; the recipe coaches it but nothing in-product does. Perception cost — "supported via recipe" never feels as supported as a registry entry; bites in comparisons ("Ollama is one click, why is LM Studio a doc page?") and slowly in support load.
- **Trade-offs**: No first-class local onboarding, ever, for any runtime; findability for _today's_ ~18 entries unimproved (the answer is subtraction, not navigation); education burden shifts permanently to users and docs.
- **Delivers the what?**: Partially — local inference is reachable for everyone willing to read; "easy to find the provider" is answered by the list stopping its growth, not by helping anyone find anything.
- **Difficulty vs payoff**: difficulty S–M · payoff M · time-to-first-value days (docs) to ~1–2 weeks (form polish)
- **Your take**: (none during playthrough.) Its explicit per-endpoint tools toggle was adopted into the winning hybrid (Cards 001 + 003), 2026-09-06.
