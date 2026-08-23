# Research 004 — Inference routers: which to support first-class

**Date:** 2026-08-22
**Question:** Which inference routers/gateways (OpenRouter-style aggregators) should Mayon
ship as first-class Settings templates, applying Pareto — maximum provider coverage for
minimum effort? What do we already have, and what more is worth adding?

Companion to [003-inference-providers.md](./003-inference-providers.md) (direct
providers). This doc covers the router layer: one API key + one OpenAI-compatible
endpoint → many providers' models.

---

## TL;DR

A router's entire value proposition is "we speak the OpenAI wire format" — so **every
router is S-effort** for Mayon (registry template + `KNOWN_GATEWAY_BASEURLS` entry +
tests, ~15 lines each). No router needs a new provider kind, SDK, or transport work.

**We already ship the two highest-usage routers:**

| Shipped      | Base URL                          | Coverage                               | Markup                     |
| ------------ | --------------------------------- | -------------------------------------- | -------------------------- |
| OpenRouter   | `https://openrouter.ai/api/v1`    | 400+ models, ~all providers            | ~5% on credits, 0% on BYOK |
| Kilo Gateway | `https://api.kilo.ai/api/gateway` | 500+ models, BYOK across 20+ providers | 0% (BYOK bills you direct) |

Both verified correct against current docs (Kilo's `/models` is even public/no-auth).
Between them, every long-tail host from 003 Tier 2 (Together, Fireworks, DeepInfra,
Cerebras, Novita, MiniMax, Perplexity…) is already reachable **today** — routers are the
80/20 answer to long-tail provider coverage, which is why 003 could defer those.

**Recommendation — add 4 templates, each S-effort, ~half a day total:**

| Priority | Provider              | Why                                                                            |
| -------- | --------------------- | ------------------------------------------------------------------------------ |
| P1       | OpenCode Zen          | Default gateway of a top open coding agent; curated ~50 models; 7 free models  |
| P1       | LiteLLM (self-hosted) | THE self-hosted gateway — perfect audience match; unlocks Bedrock/Vertex/Azure |
| P2       | Vercel AI Gateway     | 0% markup hosted router; big existing-account base; provider failover          |
| P2       | Requesty              | Coding-agent router momentum; $10 free credits; EU endpoint                    |

Everything else (Chutes, NanoGPT, Cloudflare AI Gateway, Helicone, Portkey) already works
via **Add provider → OpenAI** with a custom base URL — document, don't template.
**GitHub Models is retired (2026-07-30) — do not add.**

---

## How "supporting a router" works today (the effort yardstick)

Identical to 003 §"How supporting a provider works" — a router is just an
`openai-compatible` provider whose catalog is other providers' models:

1. **A `ProviderTemplate`** in `src/lib/ai/registry.ts` — `baseUrl`, `defaultModel`,
   fallback `models[]`, `requiresKey`, `discoverable: true` (`GET <baseUrl>/models` via
   `model-discovery.ts`), `toolCapability: 'auto'`.
2. **Base URL in `KNOWN_GATEWAY_BASEURLS`** (`src/lib/agent/capability.ts`) so tools
   default on.
3. Nothing else. Bearer auth via the keychain shim; CORS-blocked routers stream through
   `POST /api/llm/proxy` automatically.

Router-specific facts that matter to us:

- **Model IDs are namespaced** (`openai/gpt-4o`, `anthropic/claude-sonnet-4.5`) — our
  model picker treats them as opaque strings, which is correct.
- **Discovery is the real catalog**; the shipped fallback list is first-paint only.
- **Catalogs are huge** (400–1000+ entries) and may include non-chat models (Vercel's
  `/v1/models` lists embeddings) — see "Discovery polish" in the checklist.

**Effort classes:** S = registry entry + capability set + fallback list (+ unit tests).
Every candidate below is **S**.

---

## Category map (what "router" means in 2026)

1. **Hosted multi-provider routers** — OpenRouter, Kilo Gateway, OpenCode Zen, Requesty,
   Vercel AI Gateway, NanoGPT. One key, one invoice, provider markup or BYOK.
2. **Self-hosted gateways** — LiteLLM proxy (the default), plus DIY (Bifrost, etc.).
   Keys never leave the user's machine; fronts anything incl. enterprise clouds.
3. **Dev-infra proxies** — Cloudflare AI Gateway, Helicone, Portkey. Observability/caching
   first, routing second; audience is teams, not single users.
4. **Decentralized/credit-wallet hosts** — Chutes (Bittensor SN64, TEE-attested),
   NanoGPT (no-signup wallet), Morpheus. Open models, crypto-adjacent billing.

Mayon's audience (single-user, self-hosted, developer-leaning) cares most about
(1) for convenience and (2) for control.

---

## Usage evidence

There is no OpenRouter-style public token-ranking for routers themselves, so signal is
qualitative but consistent:

- **OpenRouter** is the category default — the reference "change your base URL" target in
  every gateway's migration docs (Requesty, Vercel, Kilo all position against it).
- **Kilo Gateway** advertises 500+ models and (May–Jun 2026) BYOK across 20+ providers /
  24 plans — Anthropic, OpenAI, DeepSeek, xAI, Novita, Fireworks, MiniMax, Xiaomi,
  Perplexity, Ollama Cloud, plus subscription plans (Z.ai Coding, Kimi Code, BytePlus) —
  with 0% markup on BYOK.
- **OpenCode Zen** ships as the built-in/default inference route of OpenCode (one of the
  most-used open coding agents); Docker Agent, Bifrost, and community proxies (e.g.
  `jai-api`, `opencode-openai-proxy`) all carry first-class Zen integrations. Its
  deprecation table reads like a who's-who of 2025–26 frontier models.
- **Vercel AI Gateway** is the default global provider of the AI SDK itself (`ai`
  package), with 0% token markup and OIDC on Vercel deployments.
- **Requesty** self-reports 70k+ developers and ~90B tokens/day (marketing figure) and is
  a staple in Cline/Roo/Claude-Code configuration guides.
- **LiteLLM** is the de-facto self-hosted gateway (100+ providers, virtual keys/budgets;
  every platform doc — Onyx, Flowise, n8n, Open WebUI — has a "LiteLLM proxy" page).

**Caveats:** no hard usage numbers for Zen/Requesty; coding-agent-centric routers skew
toward Mayon's developer audience, which is the skew we want.

---

## Tier 1 — the shortlist, in detail

### 1. OpenCode Zen — P1

**Why:** the curated gateway of the OpenCode team; every model tested for coding-agent
performance; pay-per-use with a **7-model free tier** (zero-cost Mayon onboarding, same
role Groq's free tier plays in 003); heavily integrated across the coding-agent toolchain.

| Fact         | Value                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                            |
| Base URL     | `https://opencode.ai/zen/v1` ([docs](https://opencode.ai/docs/zen))                            |
| Auth         | `Authorization: Bearer` — key from opencode.ai/auth (free models tolerantly work keyless)      |
| Discovery    | `GET /v1/models` — yes (`curl https://opencode.ai/zen/v1/models` is the documented smoke test) |
| Tool calling | Yes (OpenAI tools shape; it exists to serve coding agents)                                     |
| Catalog      | ~50 curated models — GPT-5.x, Claude, Gemini, DeepSeek, Grok, Kimi, Qwen, MiniMax, GLM         |
| Also offers  | Anthropic-compatible endpoint at `https://opencode.ai/zen`; **OpenCode Go** subscription       |
|              | variant (`https://opencode.ai/zen/go/v1`, $10/mo, open models only, same key)                  |
| CORS         | Undocumented → proxy fallback                                                                  |
| Privacy      | US-hosted; zero-retention except some free-period models (flagged in their docs)               |

**Quirks:** aggressive model deprecation cycle (fallback list must be refreshed often —
their own deprecation table is the source); balance auto-reloads $20 below $5 unless
disabled (mention in description? no — keep template dumb). Fallback list: verify at
implementation from `/v1/models`; free models are good first-paint defaults.
**Effort: S.**

### 2. LiteLLM Proxy (self-hosted) — P1

**Why:** the standard self-hosted gateway — one OpenAI endpoint in front of 100+
providers (OpenAI, Anthropic, Google, **Azure, Bedrock, Vertex**, Mistral, Groq, Ollama,
vLLM…). Perfect alignment with Mayon's self-hosted audience, and it **indirectly unlocks
the enterprise clouds 003 Tier 3 rejected**: sigv4/gADC/deployment auth stays server-side
in the user's own proxy; Mayon just sees OpenAI wire. BYOK by construction — keys never
leave the user's machine.

| Fact         | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                         |
| Base URL     | `http://localhost:4000` (works with or without `/v1`)                                       |
| Auth         | Optional — `Authorization: Bearer <master or virtual key>` if `LITELLM_MASTER_KEY` is set   |
| Discovery    | `GET /v1/models` — yes; returns exactly the aliases the user configured (`{data:[{id}]}`)   |
| Tool calling | Passthrough to the configured backend                                                       |
| Catalog      | User-defined `model_list` aliases — discovery is the only real catalog                      |
| CORS         | **Off by default** (`ENABLE_CORS=true` + `CORS_ORIGINS` to enable) → our llm-proxy fallback |
| License      | MIT (proxy), optional paid enterprise features                                              |

**Quirks:**

- `requiresKey: false` (auth is optional) — first template besides Ollama with this.
- **Docker/localhost caveat:** when Mayon's server (Docker) proxies the request,
  `localhost:4000` resolves _inside the container_. Docker Desktop users need
  `http://host.docker.internal:4000`, Linux users the host LAN IP. Same preexisting
  caveat as the Ollama template (`localhost:11434`) — document, don't solve here.
- Model IDs are user aliases (`gpt-4o`, `anthropic/claude-sonnet-5`, whatever they
  configured) — ship a tiny generic fallback list, lean entirely on discovery.

**Effort: S.**

### 3. Vercel AI Gateway — P2

**Why:** the AI SDK's own default gateway; **0% markup** on tokens; provider failover and
observability; hundreds of models (`openai/…`, `anthropic/…`, `xai/grok-4.6`,
`alibaba/qwen3-max`…). Many developers already have Vercel billing.

| Fact         | Value                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                           |
| Base URL     | `https://ai-gateway.vercel.sh/v1` ([docs](https://vercel.com/docs/ai-gateway))                |
| Auth         | `Authorization: Bearer` — AI Gateway API key or Vercel access token                           |
| Discovery    | `GET /v1/models` — yes; the models list appears fetchable pre-auth (verify at implementation) |
| Tool calling | Yes (standard OpenAI tools)                                                                   |
| Also offers  | Anthropic-compatible Messages endpoint; BYOK with 0% markup                                   |
| CORS         | Undocumented → proxy fallback                                                                 |

**Quirks:** `/v1/models` includes **embedding models** (entries carry `"type":
"embedding"`) — our `parseModelIds` reads only `id`, so embeddings would pollute the
picker (see "Discovery polish" below). **Effort: S.**

### 4. Requesty — P2

**Why:** routing-first gateway (cost/latency/availability policies, fallback chains,
caching); 600+ models; $10 free credits; popular in coding-agent configuration circles;
EU endpoint for residency-minded users.

| Fact         | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                     |
| Base URL     | `https://router.requesty.ai/v1`; EU: `https://router.eu.requesty.ai/v1` |
| Auth         | `Authorization: Bearer` (app.requesty.ai)                               |
| Discovery    | `GET /v1/models` — yes                                                  |
| Tool calling | Yes; structured outputs too                                             |
| Also offers  | Anthropic-compatible endpoint at `/anthropic/v1/messages`               |
| CORS         | Undocumented → proxy fallback                                           |

**Quirks:** model IDs namespaced OpenRouter-style (`openai/gpt-4o`). Weakest audience
overlap of the four — first to drop if we want a minimal list. **Effort: S.**

---

## Tier 2 — document, don't template (works today via custom OpenAI-compatible provider)

| Router                | Base URL                                                  | Note                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chutes                | `https://llm.chutes.ai/v1`                                | Decentralized (Bittensor SN64), TEE-attested, $0–0.30/MTok open models; `cpk_` keys; public `/v1/models` with pricing; free tier ended Feb 2026                                   |
| NanoGPT               | `https://nano-gpt.com/api/v1`                             | 1,070-model catalog (611 text), pay-per-prompt wallet, no signup; Bearer or `x-api-key`; `/api/v1/models?detailed=true`; `:online` web-search suffixes; Anthropic-compat endpoint |
| OpenCode Go           | `https://opencode.ai/zen/go/v1`                           | Zen's $10/mo subscription variant (open models only) — Zen users just edit the base URL                                                                                           |
| Cloudflare AI Gateway | `gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat` | 0% markup + unified billing, but the URL is **account/gateway-specific** — templating buys nothing                                                                                |
| Helicone AI Gateway   | `https://ai-gateway.helicone.ai` (exact path: verify)     | Observability-first; routes to providers you configure                                                                                                                            |
| Portkey               | `https://api.portkey.ai/v1`                               | Same shape as Helicone; team-oriented guardrails/caching                                                                                                                          |

## Tier 3 — explicitly out of scope

- **GitHub Models** — **retired 2026-07-30** (closed to new customers 2026-06-16; GitHub
  changelog). Would have been a nice free-onboarding template; it is dead. Do not add.
- **Smart-routing startups (Unify, Not Diamond, Martian):** their product is
  model-selection logic, not a stable catalog; the OpenAI-compatible surface is
  secondary and model IDs are policy-dependent. Revisit if one wins.
- **DigitalOcean Inference Routers:** policies scoped to DO's GenAI platform; only
  meaningful inside that ecosystem.
- **Morpheus / crypto-wallet gateways:** accountless/on-chain billing is the wrong shape
  for a Settings-form + API-key app.
- **Enterprise clouds direct (Azure/Bedrock/Vertex):** still L-effort browser-side
  (unchanged from 003) — **route through LiteLLM instead**, which is exactly why the
  LiteLLM template is P1.

---

## Usage × ease cross-reference

| Router              | Usage tier       | Wire format | `/models` discovery | Tools | CORS-safe direct? | Effort | Priority  |
| ------------------- | ---------------- | ----------- | ------------------- | ----- | ----------------- | ------ | --------- |
| OpenRouter          | #1 (shipped)     | OpenAI      | yes (public)        | yes   | unverified        | —      | have      |
| Kilo Gateway        | top (shipped)    | OpenAI      | yes (public)        | yes   | unverified        | —      | have      |
| OpenCode Zen        | high (agents)    | OpenAI      | yes                 | yes   | no (proxy)        | S      | P1        |
| LiteLLM (local)     | high (self-host) | OpenAI      | yes (own aliases)   | pass  | off by default    | S      | P1        |
| Vercel AI Gateway   | high             | OpenAI      | yes (incl. embeds)  | yes   | unverified        | S      | P2        |
| Requesty            | mid              | OpenAI      | yes                 | yes   | unverified        | S      | P2        |
| Chutes / NanoGPT    | mid (open devs)  | OpenAI      | yes / yes           | yes   | no (proxy)        | S each | on demand |
| CF/Helicone/Portkey | team infra       | OpenAI      | varies              | yes   | n/a               | S each | on demand |
| GitHub Models       | —                | —           | —                   | —     | —                 | —      | retired   |

The Pareto shape: routers are _defined_ by OpenAI compatibility, so effort is uniformly S
and the ordering criteria are audience overlap and billing model — not integration work.

---

## Implementation checklist (Tier 1)

1. **`src/lib/ai/registry.ts`** — add four templates (suggested order: OpenCode Zen,
   LiteLLM, Vercel AI Gateway, Requesty — ahead of the existing OpenRouter/Kilo entries,
   which stay). All `kind: 'openai-compatible'`, `discoverable: true`,
   `toolCapability: 'auto'`. `requiresKey: true` except **LiteLLM `requiresKey: false`**.
   Ship 2–3 fallback models each (Zen: verify against live `/v1/models`, prefer free
   models; LiteLLM: generic aliases only — discovery is the catalog).
2. **`src/lib/agent/capability.ts`** — extend `KNOWN_GATEWAY_BASEURLS` with
   `https://opencode.ai/zen/v1`, `https://opencode.ai/zen/go/v1`,
   `http://localhost:4000`, `http://localhost:4000/v1`,
   `https://ai-gateway.vercel.sh/v1`, `https://router.requesty.ai/v1`,
   `https://router.eu.requesty.ai/v1`.
3. **Tests** — extend registry/capability unit tests to the new entries (template shape,
   tool-capability resolution per base URL, `requiresKey:false` path for LiteLLM).
4. **Discovery polish (optional, M):** teach `parseModelIds` to skip entries that carry
   `type: "embedding"` (Vercel) so non-chat models don't reach the picker; consider a
   size cap/search UX for 400+ entry catalogs.
5. **Docs** — update the provider line in `README.md`; note the LiteLLM Docker-localhost
   caveat (host.docker.internal) next to the existing Ollama note.
6. **Separate cleanup (not blocking):** existing router fallback lists are stale
   (OpenRouter: `gpt-4o-mini`, `claude-3.5-sonnet`, `gemini-flash-1.5`; Kilo:
   `openai/gpt-4o`) — refresh or lean on discovery (same as 003 checklist item 5).
