# Local-first grouped provider picker (hybrid: 001 + 003 + 004)

**What**: Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing.

**Why**: Local/self-hosted inference (privacy, cost, offline) has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.

## The path

Give the provider picker a spine instead of more rows: **Local** (Ollama, LM Studio, vLLM), **Cloud APIs** (key required), **Gateways** (routers like OpenRouter, LiteLLM, Kilo), and **Custom**, with a search box cutting across all groups — so provider #20 lands in a group instead of at the bottom of a wall. Onboard LM Studio (`localhost:1234/v1`) and vLLM (`localhost:8000/v1`) as `openai-compatible` entries living in the Local group with default base URLs and a connection test, riding the existing adapter, model discovery (`GET <baseUrl>/models`), and `classifyFetchError` machinery. Replace the URL-allowlist tool-capability guess with an **explicit per-endpoint tools toggle** the user asserts for their own endpoint — retiring the silent tools-off bug class for every provider at once. Connection failures get classified and coached, not raw: LM Studio's CORS-off default produces a guided fix (flip the toggle / `lms server start --cors`), while connection-refused reads as "server not running."

## Known snags

- LM Studio ships CORS off by default — bites on first connect for every new local user — bad if unhandled; mitigated by classify-and-coach UI.
- Tool capability previously defaulted to off for unknown base URLs — bit silently on first agent run — eliminated by the explicit toggle, but the toggle's default (off vs on) needs a deliberate call.
- Taxonomy boundary fights (routers: Gateway vs Cloud; "Local" = my machine vs my network) — bite at design time and re-litigate with each future provider — small but recurring.
- Local model lists can be long (a loaded-down LM Studio serves dozens of models) — bites within weeks — re-creates the length friction one level down; adjacent problem, out of scope here.
- Pressure to add "detected/running" status in the Local group — auto-detection of local runtimes was explicitly rejected for scope (Card 005) — resist; sequel material.

## Accepted trade-offs

- No auto-detection of local runtimes; locals are found by grouping and search, not by probing.
- LM Studio/vLLM ride the generic `openai-compatible` kind rather than native APIs — first-class-per-runtime upgrades later mean config migration.
- Local traffic stays browser-direct (as Ollama already is), bypassing the server proxy's centralized handling; LM Studio's CORS toggle remains a user-side prerequisite.
- Category metadata on registry entries is a permanent maintenance surface.

## The bet

Wins if findability is fundamentally a shape problem — groups plus search scale as the provider registry grows — and local users want guided-but-simple onboarding, while explicit capability assertion removes the silent-tools-off class of bugs for all providers, local and cloud alike.
