---
card: 001
name: lm-studio-and-vllm-onboarding
origin: user
bet: Wins if local-runtime users want a guided, first-class setup and the picker needs only moderate cleanup
played: yes
---

# Card 001 — LM Studio and vLLM onboarding (your card)

## Story

You pick LM Studio from the provider list and Mayon walks you through pointing at your local server; your local model answers in the same chat as every cloud model. A vLLM operator does the same with their inference endpoint. The provider picker also gets a findability pass so the growing list stays navigable instead of a wall of entries. Local and cloud models sit side by side, and neither feels like a second-class setup.

## Playthrough (2026-09-06)

- **What & why**: What — Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Why — local/self-hosted inference has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.
- **How it goes**: You register LM Studio and vLLM as OpenAI-compatible presets with a guided onboarding flow: pick provider → confirm base URL (localhost:1234 / localhost:8000/v1) → connection test → model list loads → chat. Day one teaches the architecture lesson: cloud providers ride the server's llm-proxy, but the proxy runs in a Docker container whose localhost is the container, not the user's machine — so local providers must go browser-direct. Browser-direct meets CORS: vLLM answers happily, LM Studio ships CORS off, so the flow grows a "we detected a CORS block — flip the toggle / run `lms server start --cors`" state. Week two adds the findability pass (search + a local section in the picker) and it lands well. Living with it: `/v1/models` on a loaded-down LM Studio returns a long list, and the length problem transplants itself one level down into the model picker; every future local runtime (Ollama, llama.cpp server, Jan) is another hand-built entry.
- **Snags**: CORS first-run wall (LM Studio default off) — bites on first connect for the flagship local runtime — bad if unhandled, mitigated by detect-and-coach UI. Docker llm-proxy can't reach host localhost — bites day one during architecture — forces a routing fork (cloud via proxy, local browser-direct) that must be maintained. Long local model lists — bites within weeks — re-creates the exact friction this idea set out to kill, one level down. Per-runtime maintenance — ongoing — each new local provider is bespoke work + docs.
- **Trade-offs**: Gives up generality (two bespoke entries instead of a scalable shape); local traffic bypasses whatever the server proxy does for cloud calls (centralized handling lost); documentation burden per runtime; the taxonomy problem is soothed by search, not solved.
- **Delivers the what?**: Partially-to-fully — first-class local onboarding delivered; findability improved for today's list size but the shape doesn't scale, and the model-list half of the friction is untouched.
- **Difficulty vs payoff**: difficulty M · payoff H · time-to-first-value ~1–2 weeks
- **Your take**: (none during playthrough.) Selected as part of the winning hybrid (with Card 003's picker and Card 004's tools toggle), 2026-09-06.
