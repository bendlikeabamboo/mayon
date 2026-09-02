---
card: 003
name: stock-mock-server
origin: dealt
bet: Wins if the existing custom-endpoint provider path already works and test scaffolding should stay out of the product
played: yes
---

# Card 003 — Stock mock server (contrarian)

## Story

The boring standard: build nothing in-app. The test stack gains a tiny container that speaks the OpenAI chat-completions protocol and returns one static, content-rich completion for every request — an off-the-shelf mock server, config only. Playwright onboards it through the existing "openai-compatible / custom endpoint" provider kind, and the full chat path (settings → send → proxy → render) runs against it with the product codebase completely unchanged. If a future test needs a different reply shape, it's a fixture file in the mock server, not a product feature.

## Playthrough (2026-09-02)

- **Goal (what & why)**: run meaningful automated Playwright tests of the whole chat experience — onboarding, send/receive, rendering — with no real LLM, key, or network.
- **How it goes**: You add a `mock-llm` service to the test compose stack: a tiny OpenAI-protocol container serving one static kitchen-sink completion for every request (plus, if onboarding probes it, a `/models` endpoint). Playwright's setup onboards an openai-compatible custom endpoint pointing at it — dummy key stored, which incidentally exercises the real key path — and the first send/receive/render test is green within days, through the product's most-traveled provider path and the LLM proxy, with zero product commits. Over time the test suite grows against it; the mock lives and dies in the test stack where test concerns belong.
- **Snags**: (1) Protocol fidelity is the whole game — if the app streams and the stock mock only returns non-streamed JSON, confidence is false until the mock speaks SSE properly; may end up as a ~20-line custom fixture owned by tests rather than an off-the-shelf image. Bites day one; fixable. (2) Networking: the mock must be reachable from wherever the fetch executes (server container via the proxy in the all-docker stack) — one-time compose plumbing. (3) Same kitchen-sink rot as the other cards: new render elements don't auto-appear in the static reply. Slow drift. (4) Only the openai-compatible dialect is exercised — anthropic/gemini/ollama dialect quirks stay untested (acceptable; never the goal).
- **Trade-offs**: no product-owned mock capability (Card 001's optional-byproduct of a user-facing demo mode is foregone); reply variation limited by what the mock can script; test infra now owns a protocol-faithful fake.
- **Delivers the what?**: fully — onboarding (dummy key through the real path), send/receive through the proxy, and rendering of a content-rich deterministic reply, all with no real LLM and no network beyond the test stack.
- **Difficulty vs payoff**: difficulty S–M · payoff H · time-to-first-value days
- **Your take**: User asked whether this works on GitHub Actions CI. Answer: yes — and it's the card's strongest suit. CI runs one `ubuntu-latest` job with Docker available and no Playwright job yet; the mock joins the compose stack as a service (or runs as a plain node fixture, following the existing `tests/fixtures/stub-mock-server.mjs` precedent — actual file: `stub-mcp-server.mjs`, with the caveat that the server container must then reach the runner host). No LLM secrets in the repo, no per-run cost, no third-party flake — deterministic runs on every PR. **Picked as winner (2026-09-02)**: "the most complete and does the job well".
