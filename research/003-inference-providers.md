# Research 003 — AI inference providers: which to support first-class

**Date:** 2026-08-22
**Question:** Which inference providers should Mayon ship as first-class Settings templates, applying Pareto — maximum user coverage for minimum effort? What exactly does each require?

---

## TL;DR

Mayon's architecture makes "supporting a provider" cheap when the provider speaks the
OpenAI wire format: a `PROVIDER_TEMPLATES` entry (`src/lib/ai/registry.ts`) plus a
base-URL addition to `KNOWN_GATEWAY_BASEURLS` (`src/lib/agent/capability.ts`). **Every
shortlisted candidate is OpenAI-compatible** — no new provider kinds, no SDK packages,
no transport work. Discovery (`GET <baseUrl>/models`), keychain auth
(`Authorization: Bearer`), and the CORS llm-proxy are all generic and already shipped.

Usage signal (OpenRouter token-volume rankings, the best public developer-usage proxy,
data through 2026-08-21): **DeepSeek is the #1 author (~17.6% weekly share — more than
Google + OpenAI combined)**, followed by Tencent, OpenAI, xAI, Google, Moonshot/Kimi,
and Qwen. Mayon already covers OpenAI, Anthropic, Google, Z.AI, Ollama, and two gateways
(OpenRouter, Kilo) that front nearly everything else.

**Recommendation — add 6 templates, each S-effort (~15 lines + tests), ~1 day total:**

| Priority | Provider       | Why                                                                   |
| -------- | -------------- | --------------------------------------------------------------------- |
| P1       | DeepSeek       | #1 by usage; cheapest frontier-class models; huge direct-API adoption |
| P1       | xAI (Grok)     | Top-3 author; has led OpenRouter weekly/monthly windows               |
| P1       | Moonshot Kimi  | K3 (2026-07) frontier-class; agentic/coding focus; aggressive pricing |
| P2       | Qwen/DashScope | Largest OSS model family; qwen3-coder competitive                     |
| P2       | Groq           | The speed specialist; free tier = frictionless Mayon onboarding       |
| P2       | Mistral        | Leading EU provider; EU-residency appeal for self-hosters             |

Everything else (Together, Fireworks, Cerebras, DeepInfra, LM Studio, Hunyuan, MiniMax,
NVIDIA NIM) already works today via **Add provider → OpenAI** with a custom base URL —
document them, don't template them. Explicitly defer enterprise clouds (Azure/Bedrock/
Vertex) and search-grounded APIs (Perplexity): their auth/UX models don't fit a
single-user self-hosted browser app.

---

## How "supporting a provider" works today (the effort yardstick)

Four kinds exist (`src/lib/ai/types.ts`): `openai-compatible`, `anthropic`, `gemini`,
`ollama`, all built on the Vercel AI SDK in `sdk-factory.ts`. A first-class provider is:

1. **A `ProviderTemplate`** in `registry.ts` — prefilled `baseUrl`, `defaultModel`,
   fallback `models[]`, `requiresKey`, `discoverable` (live `GET <baseUrl>/models` via
   `model-discovery.ts`), `toolCapability: 'auto'`.
2. **Tool-calling default-on** — add the `baseUrl` to `KNOWN_GATEWAY_BASEURLS` in
   `capability.ts` (openai-compatible kinds get tools only for known gateways).
3. Nothing else. Auth is `Authorization: Bearer` via the keychain fetch shim
   (`sdk-fetch.ts`); CORS-blocked providers stream through `POST /api/llm/proxy`
   automatically when the server is connected.

**Effort classes:** S = registry entry + capability set + fallback list (+ unit tests).
M = S + provider-specific quirk handling. L = new kind or SDK package. The entire Tier-1
shortlist is **S**.

---

## Usage evidence

[OpenRouter rankings](https://openrouter.ai/rankings) (tokens through 2026-08-21, CC
BY 4.0): top models are DeepSeek V4 Flash (11.3T tokens), Tencent Hy3 (9.83T), OpenAI
GPT-5.6; [xAI's Grok has led](https://openrouter.ai/rankings) the weekly/monthly windows
at various points; [DeepSeek ranks #1 by author share (~17.6% weekly)](https://openrouter.ai/blog/insights/why-openrouter-for-deepseek/)
— more than Google and OpenAI combined (July 2026). Moonshot's
[Kimi K3 launched 2026-07](https://www.cnbc.com/2026/07/17/moonshot-ai-kimi-k3-model-openai-anthropic-china.html)
to frontier-class reception.

**Caveats:** these measure adoption-through-OpenRouter, not each provider's direct-API
traffic (Chinese providers' domestic volume is understated), and token volume ≠ user
counts. It is nonetheless the only large-scale public usage signal, and it correlates
well with "which API keys individual developers hold" — Mayon's actual audience.

---

## Tier 1 — the shortlist, in detail

### 1. DeepSeek — P1

**Why:** the most-used model author on OpenRouter; official API is
[OpenAI-compatible](https://api-docs.deepseek.com/) and heavily used directly
("switch by just changing the base URL and API key"). Cheapest frontier-class pricing,
with context-cache hit discounts — attractive for a chat app's repeated system prompts.

| Fact         | Value                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Kind         | `openai-compatible`                                                                                                                  |
| Base URL     | `https://api.deepseek.com` (a `/v1` suffix also works; it is unrelated to model version)                                             |
| Auth         | `Authorization: Bearer <key>` (platform.deepseek.com)                                                                                |
| Discovery    | `GET /models` — yes; ships `deepseek-chat`, `deepseek-reasoner`                                                                      |
| Tool calling | Yes — [OpenAI-compatible function calling](https://api-docs.deepseek.com/news/news0725/)                                             |
| Reasoning    | Via **model alias**, not a toggle: `deepseek-reasoner` thinks, `deepseek-chat` doesn't. Ignore our `thinking` provider-options here. |
| Also offers  | Anthropic-wire endpoint at `/anthropic` ([guide](https://api-docs.deepseek.com/guides/anthropic_api/)) — not needed; use OpenAI wire |
| CORS         | Not documented for browsers → expect blocked; llm-proxy fallback covers it (same path as Anthropic today)                            |

**Quirks:** none material. Fallback list: `deepseek-chat`, `deepseek-reasoner`.
**Effort: S.**

### 2. xAI (Grok) — P1

**Why:** top-3 OpenRouter author and recurring weekly/monthly leader; strong coding
models; developers hold direct xAI keys.

| Fact         | Value                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                                             |
| Base URL     | `https://api.x.ai/v1` ([quickstart](https://x.ai/api): "set base URL to https://api.x.ai/v1 and call grok-4.6") |
| Auth         | `Authorization: Bearer <key>` (console.x.ai)                                                                    |
| Discovery    | `GET /models` — yes                                                                                             |
| Tool calling | Yes; [structured outputs](https://docs.x.ai/overview) and Responses API also supported                          |
| Reasoning    | Grok reasoning models accept OpenAI-style effort params; defaults are fine                                      |
| CORS         | Undocumented → proxy fallback                                                                                   |

**Effort: S.** Fallback list: current flagship `grok-4.6` + one cheaper tier (verify at
implementation; discovery refreshes it).

### 3. Moonshot Kimi — P1

**Why:** Kimi K2/K3 are the most-used agentic open models after DeepSeek; K3 (2026-07)
is frontier-class per CNBC; API is
[OpenAI-compatible and aimed at coding agents](https://platform.kimi.ai/docs/overview).

| Fact         | Value                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                     |
| Base URL     | International `https://api.moonshot.ai/v1`; China `https://api.moonshot.cn/v1`          |
| Auth         | `Authorization: Bearer <key>`                                                           |
| Discovery    | `GET /v1/models` — yes (standard)                                                       |
| Tool calling | Yes — a headline capability (agent scenarios)                                           |
| Also offers  | Anthropic-compatible endpoint (`…/anthropic/v1/messages`, for Claude Code) — not needed |
| CORS         | Undocumented → proxy fallback                                                           |

**Quirks:** two regional endpoints — template ships the international URL; Chinese
users edit the base URL to `.cn`. **Effort: S.**

### 4. Qwen / Alibaba DashScope — P2

**Why:** Qwen is the largest OSS model family; `qwen3-coder` is competitive for coding
agents; [Model Studio exposes an OpenAI-compatible interface](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope).

| Fact         | Value                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                                                        |
| Base URL     | International `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; China `…dashscope.aliyuncs.com/compatible-mode/v1` |
| Auth         | `Authorization: Bearer <DashScope key>`                                                                                    |
| Discovery    | Compatible-mode `/models` — **verify at implementation**; if absent set `discoverable: false` and curate the fallback list |
| Tool calling | Yes (OpenAI `tools` shape)                                                                                                 |
| CORS         | Undocumented → proxy fallback                                                                                              |

**Quirks:** regional endpoints (same treatment as Kimi); some models require studio-side
enablement. **Effort: S** (with the one verify step).

### 5. Groq — P2

**Why:** the inference-speed specialist (LPU hardware) for open models; extremely
popular with developers; [free tier with daily token limits](https://infrabase.ai/blog/ai-inference-api-providers-compared)
makes it the zero-cost way to try Mayon.

| Fact         | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                       |
| Base URL     | `https://api.groq.com/openai/v1`                                                          |
| Auth         | `Authorization: Bearer <key>` (console.groq.com)                                          |
| Discovery    | `GET /models` — yes; large, rotating hosted catalog (Llama, GPT-OSS, Kimi, Qwen variants) |
| Tool calling | Yes                                                                                       |
| Reasoning    | `reasoning_effort`/`reasoning_format` params exist; defaults fine                         |
| CORS         | Browser-friendly (widely used client-side) — works with or without the proxy              |

**Quirks:** catalog churns — discovery is the real mechanism, fallback list is
first-paint only. **Effort: S.**

### 6. Mistral — P2

**Why:** leading EU provider (La Plateforme); strong small/mid models
(`mistral-large`, `magistral` reasoning, `devstral` coding); EU data residency appeals
to self-hosters. Chat Completions
[follows the OpenAI request structure](https://docs.mistral.ai/resources/migration-guides).

| Fact         | Value                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| Kind         | `openai-compatible`                                                                    |
| Base URL     | `https://api.mistral.ai/v1`                                                            |
| Auth         | `Authorization: Bearer <key>` (console.mistral.ai)                                     |
| Discovery    | `GET /models` — [yes](https://docs.haystack.deepset.ai/reference/integrations-mistral) |
| Tool calling | Yes                                                                                    |
| CORS         | Undocumented → proxy fallback                                                          |

**Effort: S.**

---

## GitHub Copilot — shipped as a first-class kind (feature 016, 2026-08-29)

The user's primary work AI provider: the feature exists so Mayon runs on a workplace
Copilot license with zero manual secret handling. Not on the shortlist above: Copilot
access isn't a pasted key, so the S-effort playbook didn't apply. Shipped via
[feature 016](../specs/016-github-copilot-support/research.md) as the fifth kind —
the L-effort case (new kind), though it reuses the OpenAI wire format and the AI SDK
path, so no new SDK package or transport work.

| Fact         | Value                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind         | `github-copilot` — first-class `ProviderKind` (`src/lib/ai/types.ts`), registered in dialects/capability like the others                             |
| Wire format  | OpenAI Chat Completions + SSE via `createOpenAICompatible` plus a session-aware fetch wrapper (`src/lib/ai/copilot-fetch.ts`)                        |
| Base URL     | The api host from the token exchange's `endpoints.api` is authoritative (Business/Enterprise hosts differ); fallback `https://api.githubcopilot.com` |
| Auth         | GitHub OAuth **device flow run on the server** — no key paste, no client_secret (three moving parts below)                                           |
| Discovery    | `GET /models` on the derived host with session-token auth; keep chat-capable entries, drop `policy.state === 'disabled'`                             |
| Tool calling | Yes (`toolCapability: 'auto'`, tools default-on like the openai-compatible gateways)                                                                 |
| CORS         | Designed around: device flow and token exchange run server-side; inference rides the same-origin llm-proxy                                           |

**Auth architecture** (three moving parts):

1. **Server-run device flow** (`server/src/copilot-auth.ts`, routes
   `/api/llm/copilot/auth/start|poll`) with client_id `Iv1.b507a08c87ecfe98`, scope
   `read:user` — the browser only ever sees `userCode` + `verificationUri`
   (`github.com/login/device/code` sends no CORS headers).
2. **Grant in the browser KeyStore** — the resulting `ghu_` token is stored under the
   provider id in the same IndexedDB KeyStore as every other provider secret ("no
   secrets in `settings`"; nothing persists server-side).
3. **Server-minted session tokens** — the server exchanges the grant for a ~30-min
   Copilot session token (`copilot_internal/v2/token`), cached by grant hash and
   refreshed eagerly ~120 s before expiry; the client wrapper fetches the descriptor
   per request and injects the header set below.

**Mandatory header set** (measured: 400 without the integration id, 403 without the
editor headers): `Authorization: Bearer <session token>` plus
`Copilot-Integration-Id: vscode-chat`, `Editor-Version: vscode/1.98.0`,
`Editor-Plugin-Version: copilot-chat/0.35.0`, `User-Agent: GitHubCopilotChat/0.35.0`,
`x-github-api-version: 2025-05-01`.

**Risk (accepted):** `api.githubcopilot.com` is an undocumented IDE surface — there is
no official third-party client program, and GitHub's tolerance of the shared VS Code
client_id is informal. If tolerance is revoked the feature breaks at the exchange (404).
Containment: the client_id and header constants are isolated in
`server/src/copilot-auth.ts` and `src/lib/ai/copilot-fetch.ts`, making a future official
path a one-file change. **Depth:** `specs/016-github-copilot-support/research.md`
(D2 auth rationale, D3 serving, D4 renewal/error mapping).

---

## Tier 2 — document, don't template (works today via custom OpenAI-compatible provider)

All OpenAI-compatible with Bearer auth and `GET /models`; add a template only on user
demand. The gateways (OpenRouter, Kilo) already front most of their catalogs.

| Provider          | Base URL                                | Note                                                                       |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| LM Studio (local) | `http://localhost:1234/v1`              | No key; complements Ollama for GGUF/MLX users; CORS open (local origin)    |
| Cerebras          | `https://api.cerebras.ai/v1`            | Wafer-scale speed rival; free tier                                         |
| Together AI       | `https://api.together.xyz/v1`           | Broad open-model catalog, serverless + dedicated                           |
| Fireworks AI      | `https://api.fireworks.ai/inference/v1` | Model IDs namespaced `accounts/fireworks/models/…`                         |
| DeepInfra         | `https://api.deepinfra.com/v1/openai`   | [Cheapest hosted open models](https://docs.deepinfra.com/chat/overview)    |
| Tencent Hunyuan   | Tencent Cloud endpoint (verify)         | Hy3 is OpenRouter's #2 model, but API is gated behind Tencent Cloud signup |
| MiniMax           | `https://api.minimax.io/v1` (intl)      | M2 agent models; Anthropic-compatible endpoint too                         |
| NVIDIA NIM        | `https://integrate.api.nvidia.com/v1`   | Free credits; broad catalog                                                |

## Tier 3 — explicitly out of scope

- **Perplexity** (`api.perplexity.ai`): search-grounded `sonar` models; redundant with
  our Brave MCP search and the wrong shape for a general chat engine.
- **Cohere**: OpenAI-compat endpoint exists, but its center of gravity is embed/rerank.
- **Azure OpenAI**: deployment-name indirection (`/openai/deployments/{name}/…`,
  `api-key` header) breaks our model-picker UX; org-context auth. Possible later via
  `openai-compatible` with mapping docs — not now.
- **AWS Bedrock / Google Vertex**: sigv4 / gADC auth — impossible browser-side, would
  need server-side credential plumbing. Wrong fit for a single-user self-hosted app;
  their models are reachable via the gateways we already support.

---

## Usage × ease cross-reference

| Provider             | Usage tier | Wire format         | `/models` discovery | Tools | CORS-safe direct? | Effort | Priority  |
| -------------------- | ---------- | ------------------- | ------------------- | ----- | ----------------- | ------ | --------- |
| DeepSeek             | #1         | OpenAI (+Anthropic) | yes                 | yes   | no (proxy)        | S      | P1        |
| xAI Grok             | top-3      | OpenAI (+Responses) | yes                 | yes   | unverified        | S      | P1        |
| Moonshot Kimi        | high       | OpenAI (+Anthropic) | yes                 | yes   | unverified        | S      | P1        |
| Qwen/DashScope       | high       | OpenAI              | verify              | yes   | no (proxy)        | S      | P2        |
| Groq                 | high       | OpenAI              | yes                 | yes   | yes               | S      | P2        |
| Mistral              | mid        | OpenAI              | yes                 | yes   | unverified        | S      | P2        |
| Tier 2 hosts         | mid        | OpenAI              | mostly              | yes   | varies            | S each | on demand |
| Azure/Bedrock/Vertex | enterprise | proprietary         | n/a                 | yes   | n/a               | L      | deferred  |

The Pareto shape: usage is concentrated in OpenAI-compatible APIs, and our
openai-compatible kind + discovery + proxy already absorb nearly all per-provider
differences — so effort is uniformly S and the only real ordering criterion is usage.

---

## Implementation checklist (Tier 1)

1. **`src/lib/ai/registry.ts`** — add six templates (suggested order: DeepSeek, xAI,
   Kimi, Qwen, Groq, Mistral — usage order, ahead of the existing OpenAI/generic
   entries). All: `kind: 'openai-compatible'`, `requiresKey: true`,
   `discoverable: true` (Qwen pending its verify), `toolCapability: 'auto'`.
   Ship 2–3 fallback models each; discovery supersedes them.
2. **`src/lib/agent/capability.ts`** — add all six base URLs to
   `KNOWN_GATEWAY_BASEURLS`, including the regional Kimi (`.ai` + `.cn`) and Qwen
   (intl + CN) variants so tools default on regardless of region.
3. **Tests** — extend the registry/capability unit tests to cover the new entries
   (template shape, tool-capability resolution per base URL).
4. **Docs** — update the provider list line in `README.md`.
5. **Separate cleanup (not blocking):** several existing fallback model lists are stale
   (`gpt-4o`, `o1-mini`, `claude-3.5-sonnet`, `gemini-1.5-flash`); refresh or lean on
   discovery.
