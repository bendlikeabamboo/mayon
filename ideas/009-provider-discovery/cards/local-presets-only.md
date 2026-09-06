---
card: 002
name: local-presets-only
origin: dealt
bet: Wins if local users are comfortable pointing a custom endpoint at localhost and the findability pain is not yet acute
played: yes
---

# Card 002 — Local presets only

## Story

You ship two new presets — LM Studio (localhost:1234) and vLLM — built entirely on the existing custom OpenAI-compatible endpoint machinery. A local user picks the preset, pastes or confirms their base URL, and is chatting. The provider list itself is untouched; findability waits for a future idea of its own.

## Playthrough (2026-09-06)

- **What & why**: What — Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Why — local/self-hosted inference has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.
- **How it goes**: You open `src/lib/ai/registry.ts` and add two entries — LM Studio (`http://localhost:1234/v1`) and vLLM (`http://localhost:8000/v1`) — as `openai-compatible` kind, no key required. Existing model discovery (`GET <baseUrl>/models`) lists their models, and Ollama users now have company. Then the quiet catch: tool-capability auto-detection allowlists known gateway URLs and defaults everything else to tools-off, so agents pointed at `localhost:1234` silently lose tools until the allowlist (or a manual override) catches up. The preset is ten lines; the tool-capability decision for arbitrary localhost servers is the actual work. First-run CORS failures are at least classified by existing `classifyFetchError`, but there is no guided fix — docs carry it. The picker keeps its current shape; two more entries join a registry that already lists ~14 openai-compatible endpoints.
- **Snags**: Tools silently off on unknown local URLs — bites the first time an agent runs on LM Studio/vLLM — bad because it looks like a model problem, not a config problem. CORS wall with no coaching — bites first connect for LM Studio (default off) — mitigated only by classified error + docs. Findability untouched — bites immediately and persists — the card adds two entries to the long list while fixing none of the finding.
- **Trade-offs**: No guided onboarding (docs are the flow); LM Studio/vLLM registered as generic `openai-compatible` second-class citizens — adopting their native APIs later means migrating user configs; the harder half of the idea (findability) is deferred with no owner.
- **Delivers the what?**: Partially — shallow-but-real local onboarding in days; findability not at all, and marginally worsened by two more list entries.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value days
- **Your take**: User: "too small scope this card" — rejected as under-scoped; the findability half of the idea is where the weight is.
