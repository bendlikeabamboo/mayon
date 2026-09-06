---
card: 003
name: grouped-provider-picker
origin: dealt
bet: Wins if the real problem is the list's shape rather than its length, and every future provider then slots into a taxonomy that scales
played: yes
---

# Card 003 — Grouped provider picker

## Story

You stop treating the provider list as one flat directory and regroup it around what the user has in hand: local runtimes, cloud keys, custom endpoints. A user with LM Studio running finds "Local" at the top of the picker instead of scrolling a wall of entries. LM Studio and vLLM onboard as two new cards in the local group, search sits on top, and the next ten providers slot in without lengthening anyone's scan.

## Playthrough (2026-09-06)

- **What & why**: What — Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Why — local/self-hosted inference has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.
- **How it goes**: You give the picker a spine instead of more rows: Local (Ollama, LM Studio, vLLM), Cloud APIs (key required), Gateways/routers (OpenRouter, LiteLLM, Kilo, Vercel, Requesty), Custom. A search box cuts across all groups. LM Studio and vLLM ship as `openai-compatible` entries that *live* in the Local group with default base URLs, so their onboarding is "appear in the right place, two clicks to connect." The first thing a user with LM Studio running sees is the Local section with their runtime in it — no scrolling. The ~14-entry flat registry becomes four scannable groups, and provider #20 lands in a group instead of at the bottom of a wall. Presentation is the work here: the plumbing under LM Studio/vLLM is still Card 002's (`openai-compatible` kind, silent tools-off on unknown local URLs until the capability allowlist is handled), and CORS on LM Studio still needs its docs-and-coaching moment.
- **Snags**: Taxonomy boundary fights — routers that proxy hundreds of models (gateway or cloud?), a vLLM on a LAN box (local means *my machine* or *my network*?) — bite at design time and re-litigate with every future provider, though each fight is small. Grouping without capability/CORS plumbing means local entries look first-class but still hit Card 002's silent tools-off snag — bites when an agent runs, same as before. If the real complaint underneath "long list" was ever *model* length inside a provider, grouping touches none of it.
- **Trade-offs**: Category metadata on every registry entry becomes a permanent maintenance surface; "Local" group invites a detected/running status affordance that is Card 005's territory and must be resisted to keep this card's scope honest; guided per-runtime onboarding still shallow.
- **Delivers the what?**: Findability — yes, structurally: the shape scales so growth stops adding scan cost. Local onboarding — partially: right place, right defaults, shallow flow.
- **Difficulty vs payoff**: difficulty M · payoff M–H · time-to-first-value ~1–2 weeks
- **Your take**: User: "this one's nice. grouping along with search is good." — positive reaction; boundary questions (routers: Gateway vs Cloud; Local = my machine vs my network) left unanswered for now. Chosen as the spine of the winning hybrid (with Card 001's onboarding and Card 004's tools toggle), 2026-09-06.
