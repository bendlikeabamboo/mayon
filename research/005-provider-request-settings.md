# Research 005 — Provider request settings: what we can pass, per provider/router

**Date:** 2026-08-22
**Question:** What request-level parameters/settings can Mayon send to its configured providers and routers? Which small subset covers most user needs (Pareto — 80% of need with 20% of effort), and how should a future "advanced settings" per provider be shaped?

**Companions:** [003-inference-providers.md](./003-inference-providers.md) (which providers), [004-inference-routers.md](./004-inference-routers.md) (which routers). This doc covers the **request-body surface** — knobs sent per chat request.

**Motivating case:** a model expects an opt-in flag we don't send (e.g. xAI's historical `enable_prompt_tracing_key` for prompt tracing/sharing, OpenRouter's `allow_data_collection`, DashScope's `enable_thinking`). Today Mayon sends **only** reasoning/thinking `providerOptions` (`sdk-factory.ts:providerOptionsForReasoning`) — no sampling, no limits, no per-provider extras. Users have no way to opt in to these behaviors.

---

## 1. How settings reach the wire today (AI SDK v7 mechanics)

Everything flows through `streamText` (`src/lib/agent/loop.ts:319`). The AI SDK has exactly **two channels**:

1. **Standardized call settings** — top-level `streamText` params, mapped by every provider package into its native body:
   `temperature`, `topP`, `maxOutputTokens`, `stopSequences`, `seed`, `frequencyPenalty`, `presencePenalty`, `responseFormat`, `tools`, `toolChoice`, `abortSignal`. This is the provider-agnostic channel — one implementation covers all four of our provider kinds.
2. **`providerOptions`** — namespaced per provider (`{ [providerName]: {...} }`); only the active provider's namespace is consumed.

### The critical openai-compatible fact (verified in `vercel/ai` source, `openai-compatible-chat-language-model.ts`)

For `openai-compatible` models, the namespace key is **the `name` we pass to `createOpenAICompatible`** (Mayon passes `config.name`, e.g. `"z.ai (glm)"`; `providerOptionsName = name.split('.')[0]`). The provider then:

- Maps standard call settings → `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `seed`, `response_format` (`topK` is _warned unsupported_ and dropped).
- Parses a small known schema from the namespace: `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`.
- **Spreads every other unknown key from `providerOptions[<name>]` verbatim into the JSON body.** Unknown keys are filtered only against the known schema keys — everything else passes through untouched.

That last point is the architecture answer to the motivating case: a **raw "extra body" passthrough field per provider** gives users access to _every_ current and future provider-specific parameter (thinking, `enable_thinking`, `search_parameters`, `prompt_cache_key`, router `provider` prefs, `safe_prompt`, …) with zero per-provider work from us. It's why Mayon's existing `thinking`/`reasoning_effort` sending through Kilo/Z.AI works today.

(`topK`: for OpenAI-shaped endpoints the SDK drops it; Anthropic/Gemini/Ollama map it natively. If we expose top-k for openai-compatible, it must ride the passthrough.)

### AI SDK provider-option shapes we'd map to (v7, current)

- `openai`: `reasoningEffort` (`minimal|low|medium|high|none` per docs), `reasoningSummary`, `strictJsonSchema`, `user` (Responses: camelCase variants).
- `anthropic`: `thinking: { type: 'enabled', budgetTokens } | { type: 'adaptive' }`, `effort` (`low|medium|high`), `speed: 'fast'|'standard'` (v7), `cacheControl` on messages.
- `google`: `thinkingConfig: { thinkingBudget | thinkingLevel }`, safety settings, etc.
- `gateway` (Vercel AI Gateway, see §4).

---

## 2. The universal core (the 80%)

Parameters understood (with varying support) by essentially every OpenAI-compatible endpoint — this is the set worth first-class UI. Confirmed against each provider's current docs (Aug 2026):

| Param                                    | Range/notes                                                                                                                                                                                                                                                            | Support                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `max_tokens` / `max_completion_tokens`   | Newer APIs want `max_completion_tokens`; most still accept `max_tokens` (DeepSeek, OpenRouter, Kimi). Reasoning tokens count inside it (DeepSeek hard-truncates reasoning silently).                                                                                   | Universal               |
| `temperature`                            | 0–2 (Z.AI: 0–1; Kimi k2/k3 & thinking-mode GLM/DeepSeek: **ignored/locked**).                                                                                                                                                                                          | Universal               |
| `top_p`                                  | 0–1. Kimi k2+: fixed 0.95, "cannot be modified".                                                                                                                                                                                                                       | Universal               |
| `stop`                                   | ≤4 sequences (some allow 16). Reasoning models often reject/ignore.                                                                                                                                                                                                    | Near-universal          |
| `seed`                                   | Best-effort determinism (OpenAI, xAI, Ollama, Gemini).                                                                                                                                                                                                                 | Common                  |
| `frequency_penalty` / `presence_penalty` | −2..2. Ignored by reasoning-mode DeepSeek; unsupported on some (Mistral accepts; Gemini has both in generationConfig).                                                                                                                                                 | Common                  |
| `top_k`                                  | **Not OpenAI**; native on Anthropic, Gemini, Ollama, Z.AI?, vLLM; OpenRouter accepts and forwards; via passthrough elsewhere.                                                                                                                                          | Common, via passthrough |
| `repetition_penalty`                     | Non-OpenAI family (Qwen/DashScope, Ollama `repeat_penalty`, vLLM, OpenRouter).                                                                                                                                                                                         | Via passthrough         |
| `response_format`                        | `json_object` / `json_schema` (+strict). Z.AI & some gateways silently ignore `json_schema` (why our lab gen uses tool-calling instead).                                                                                                                               | Common                  |
| Reasoning control                        | Converging on two dialects: `reasoning_effort` (OpenAI, xAI, DeepSeek, Groq, Mistral, Z.AI, GLM-5.2+, Kimi K3) and `thinking`/`think` objects (DeepSeek, Z.AI, Kimi K2.6, DashScope `enable_thinking`, Anthropic `thinking`, Ollama `think`, Gemini `thinkingConfig`). | See §3                  |

**Recommended first-class set** (one mapping each, SDK-standard, all kinds): `temperature`, `topP`, `maxOutputTokens`, `stopSequences`, `seed`, `frequencyPenalty`, `presencePenalty`. Reasoning effort already exists as our off/on/deep toggle.

---

## 3. Per-provider notes (direct providers)

### OpenAI (`api.openai.com/v1`, chat + Responses)

- Chat Completions: core set above + `logit_bias`, `logprobs`/`top_logprobs`, `n`, `parallel_tool_calls`, `user`, `reasoning_effort`, `service_tier` (`auto|default|flex|priority`), `store` + `metadata`, `prompt_cache_key`, `safety_identifier`, `web_search_options`.
- Responses API adds: `reasoning: {effort, summary}`, `text: {verbosity}`, `previous_response_id`, `background`, `include`, `prompt_cache_options.ttl` / `prompt_cache_retention` (GPT-5.5+/5.6+), compaction/context-management tools.
- Data controls: API data is **not** used for training unless org opts in; `store:false` + ZDR govern retention — users occasionally want to pin `store` explicitly.

### Anthropic (Claude)

- Native Messages params: `max_tokens` (required), `temperature`, `top_p`, `top_k`, `stop_sequences`, `system`, `metadata.user_id`, `service_tier`, `thinking`, `output_config: {effort}` (new), betas via `anthropic-beta` header.
- **Thinking API churn (important):** `thinking: {type:'enabled', budget_tokens}` (min 1024, < max_tokens) is **deprecated on 4.6/4.7 and rejected outright on Opus 4.7**; the new form is `thinking: {type:'adaptive'}` + `output_config: {effort: low|medium|high}`. Adaptive mode auto-enables interleaved thinking in tool loops. Our `providerOptionsForReasoning` still sends `budget_tokens` — mapping to `adaptive`/`effort` should ride the future settings work.
- Conflicts: thinking on ⇒ `temperature≠1`, `top_k`, `top_p<0.95`, forced `tool_choice`, and prefill are rejected/ignored.
- Explicit prompt caching via `cache_control` breakpoints (Vercel Gateway passes through; can also `caching:'auto'` there).

### Google Gemini

- `generationConfig`: `temperature`, `topP`, `topK`, `maxOutputTokens`, `candidateCount`, `stopSequences`, `presencePenalty`, `frequencyPenalty`, `seed`, `responseMimeType`, `responseSchema`, `responseLogprobs`, `mediaResolution`, `thinkingConfig`.
- **Thinking:** Gemini 3.x uses `thinkingConfig.thinkingLevel` (`minimal|low|medium|high`); 2.5 uses `thinkingBudget` (0=off, −1=dynamic; 2.5 Pro can't disable; 3.1 Pro can't disable; 3 Flash can't fully disable). Our current mapping sends only `thinkingBudget` (2048/32768) — should gain `thinkingLevel` for Gemini 3.
- `safetySettings[]` (category/threshold) — frequently requested by users hitting refusals.
- New Interactions API exists; generateContent remains the mainstream.

### xAI (Grok)

- Chat: core set + `reasoning_effort` (`none|low|medium|high`, grok-4.3+), `prompt_cache_key` (sticky routing/cache, plumbed to `x-grok-conv-id`), `search_parameters` (live search: `mode: off|on|auto`, `sources` incl. web+X, `return_citations`, date ranges), `service_tier` (`default|priority`), `deferred`, `n`. `max_completion_tokens` preferred (default cap 128k). `logprobs` silently ignored on grok-4.20+; penalties unsupported on reasoning models.
- Responses endpoint adds `top_k`, `min_p`, `store`, `/v1/responses/compact` (context compaction).
- **The motivating case:** xAI's older API exposed `enable_prompt_tracing_key` (+`prompt_tracing_key`) — an opt-in "prompt tracing/training" flag for grok-4-era models. It is **absent from the current reference** (superseded by `prompt_cache_key`), but the pattern is industry-wide and recurring; only a passthrough field future-proofs us.

### DeepSeek

- V4 unified the reasoner split: `thinking: {type:'enabled'|'disabled'}` (default **enabled** on v4-flash/v4-pro) + `reasoning_effort` (`low|high|max`; `medium`/`xhigh` map to `high`). Sampling params (temperature/top_p/penalties) accepted-but-ignored in thinking mode.
- Extras: chat prefix completion (beta base URL), FIM (beta), `reasoning_content` in replies; cache-hit/miss priced differently.

### Groq

- `reasoning_format: 'raw'|'parsed'|'hidden'` (default raw — `<think>` tags inline!), `include_reasoning` (gpt-oss models; mutually exclusive with reasoning_format), `reasoning_effort` (`low|medium|high` on gpt-oss; `none|default` on qwen3.6-27b), `max_completion_tokens` (preferred), Responses API beta with `reasoning.effort`. Compound models: `compound_custom` config for built-in tools.

### Mistral

- `reasoning_effort` (`high|none`) on mistral-small-latest / medium-3-5 (response becomes chunked content with `ThinkChunk`; replay full assistant message across turns); magistral reasoning deprecated. `safe_prompt` (guardrails on/off) — the classic per-provider toggle OpenRouter forwards. `tool_choice: auto|any|none`, `parallel_tool_calls`.

### Moonshot Kimi

- OpenAI-compatible + `thinking: {type:'enabled'|'disabled'}` on kimi-k2.6 via `extra_body`; **kimi-k3 always reasons** (`reasoning_effort` incl. `max`). **`temperature`/`top_p`/`n` are fixed ("cannot be modified") on k3/k2.6/k2.7-code** — exposing them for Kimi would mislead; hide or ignore per-template.
- `reasoning_content` output; K3 1M context.

### Qwen (DashScope compatible-mode)

- OpenAI-compatible + `enable_thinking` (bool; some models thinking-only, e.g. kimi-k2.7-code there is always-on), `top_k`, `repetition_penalty`, `vl_high_resolution_images` (vision). `reasoning_content` output.

### Z.AI (GLM)

- `thinking: {type:'enabled'|'disabled'}` (GLM-5.3 **cannot disable** — control depth via `reasoning_effort` only `low|high|max`), `reasoning_effort` enum `none|minimal|low|medium|high|xhigh|max` (default `max`; GLM-5.2 maps medium→high, none/minimal→skip), `do_sample` (false ⇒ temperature/top_p inert), `temperature` capped **0–1**, `top_p`, `max_tokens`, `stop`, tools, `response_format` (json_schema unreliable in practice — keep tool-based structured output).

### Ollama (local)

- Native `/api/chat`: `think: boolean | 'low'|'medium'|'high'` (levels for gpt-oss; deepseek-r1/qwen3 etc.), `format: 'json'`, `keep_alive`, `options`: `temperature`, `top_k`, `top_p`, `min_p`, `repeat_penalty`, `repeat_last_n`, `num_predict` (max tokens), `num_ctx` (context window — the classic Ollama gotcha, default small), `seed`, `stop`, mirostat family, `tfs_z`, `typical_p`, `num_keep`, `presence_penalty`/`frequency_penalty`.
- OpenAI-compat endpoint (`/v1`) accepts the core set; Ollama-specific ones (`num_ctx`, `top_k`, `repeat_penalty`) via extra body.

---

## 4. Routers / gateways

### OpenRouter (`openrouter.ai/api/v1`)

The richest request surface — all core params plus OpenRouter-only routing controls:

- Sampling extras beyond core: `top_k`, `min_p`, `top_a`, `repetition_penalty`, `logit_bias`, `top_logprobs`, `prediction` (predicted output), `seed`.
- `models: string[]` + `route: 'fallback'` — ordered model fallback.
- `provider: ProviderPreferences` — routing prefs: `order`, `only`/`ignore`, `allow_fallbacks`, `require_parameters` (only route to providers honoring all sent params), `allow_data_collection` (opt-in training/data collection — another instance of the motivating case), `quantizations`, `sort` (price/latency/throughput).
- `plugins: [{id}]` — `web`, `file-parser`, `response-healing` (JSON repair), `context-compression` (middle-out).
- `transforms` (legacy route for `middle-out`), `usage: {include: true}` accounting, headers for app attribution.
- **Key behavior:** absent params are **omitted upstream** (provider default applies) — sending a default explicitly can change provider cache keys. Also forwards select provider-native params (e.g. `safe_prompt` for Mistral, `raw_mode` for Hyperbolic) to matching upstreams.

### Kilo Gateway (`api.kilo.ai/api/gateway`)

- Documents the OpenAI core subset (max_tokens, temperature, top_p, stop, penalties, tools, response_format, user, seed) and, in practice, forwards provider-native extras (our `thinking`/`reasoning_effort` for GLM flows through). Tool-call repair happens gateway-side. FIM endpoint for Codestral.

### Vercel AI Gateway (`ai-gateway.vercel.sh/v1`)

- OpenAI-compatible + `providerOptions.gateway`: `order`, `only`, `sort`, `models` (fallback), `user`, `tags` (cost attribution), `byok` (per-request keys), `providerTimeouts`, `serviceTier: 'flex'|'priority'` (translated per provider). Per-provider namespaces (`openai`, `anthropic`, …) forwarded automatically to the target provider. `caching: 'auto'` injects cache markers for Anthropic-style providers. 0% markup, failover.

### OpenCode Zen / Requesty / LiteLLM (Tier-2, OpenAI-compatible)

- All accept the core set; provider-specific extras ride `extra_body`/passthrough (LiteLLM explicitly supports `extra_body` forwarding to 100+ providers). No Mayon-specific work needed beyond the passthrough field.

---

## 5. Common hazards to encode in UI copy/validation later

1. **Thinking mode disables sampling** — DeepSeek/Z.AI/GLM thinking: temperature/top_p/penalties ignored; Anthropic: non-default sampling **rejected**. If reasoning=on, gray out sampling or warn.
2. **Reasoning tokens eat `max_tokens`** (DeepSeek, Anthropic `budget_tokens < max_tokens` constraint) — small caps can return empty answers with HTTP 200.
3. **Kimi k2+/k3 locks sampling params** — hide them per template.
4. **Gemini 3 vs 2.5 thinking dialects** — `thinkingLevel` vs `thinkingBudget`; several Gemini 3 models cannot disable thinking at all.
5. **Anthropic budget→adaptive churn** — `budget_tokens` rejected on Opus 4.7; prefer `adaptive`+`effort`.
6. **Groq `reasoning_format` default `raw`** leaks `<think>` tags into content; `parsed` is what most UIs want.
7. **Multi-turn reasoning preservation** — DeepSeek/Kimi/GLM expect `reasoning_content` (or full assistant chunks) replayed; our context projection should keep persisting it (we already persist reasoning separately — keep it).
8. **Explicit defaults ≠ omitted** (OpenRouter) — advanced settings should omit-by-default, not send provider defaults.
9. **`json_schema` response_format is unreliable** on GLM/Z.AI-class endpoints — keep our tool-based structured output.

---

## 6. Pareto recommendation for the future "advanced settings" feature

Three tiers, cheapest coverage first:

**Tier A — Standard sampling block (covers ~most users):** additive `requestDefaults` on `ProviderConfig` (e.g. `{ temperature?, topP?, maxOutputTokens?, stopSequences?, seed?, frequencyPenalty?, presencePenalty? }`) passed straight into `streamText` top-level params. Zero per-provider branching — the SDK maps for all four kinds. UI: one "Advanced" section per provider with 6-7 inputs, omit-empty semantics.

**Tier B — Extend the existing effort toggle mapping:** update `providerOptionsForReasoning` for current dialects — Anthropic `adaptive`+`effort`, Gemini 3 `thinkingLevel`, Z.AI/GLM `reasoning_effort` tiers, DeepSeek `thinking`+`reasoning_effort`, Groq `reasoning_format`, Ollama `think`, Kimi/DashScope `thinking`/`enable_thinking`. Still one toggle in UI; pure mapping table maintenance.

**Tier C — Raw passthrough ("Extra request body JSON"):** one `extraBody?: Record<string, JSONValue>` field on `ProviderConfig`, spread into `providerOptions[config.name]` for openai-compatible (the SDK forwards unknown keys verbatim — verified) and merged into providerOptions for anthropic/gemini/ollama where mappable. This single field unlocks prompt caching keys, live search, router provider-preferences/plugins, data-collection opt-ins, prompt-tracing-class flags, `top_k`/`repetition_penalty` for the endpoints that want them — everything in §3/§4 — including flags that don't exist yet. Guard: JSON-only, never secrets (no headers/keys), surfaced in the request trace (we already log `providerOptions`).

Optionally later: per-template **curated toggles** over Tier C for the highest-ask flags (e.g. OpenRouter data-collection, xAI live search, Gemini safety settings, Ollama `num_ctx`) — each is just a typed overlay onto `extraBody`.

**Effort estimate:** Tier A ≈ S (type + UI + plumb into 3 call sites incl. lab/quiz/title generations), Tier B ≈ S (mapping table + tests), Tier C ≈ S–M (field, merge logic, validation, trace). Together they subsume ~80% of the per-provider request-settings surface documented above; the long tail (response_format/logprobs/n, server tools, caching break-points) stays reachable via Tier C passthrough without further work.

---

## Sources (checked 2026-08-22)

- xAI API reference (chat completions + responses, current): docs.x.ai/docs/api-reference
- OpenAI docs: developers.openai.com/api/docs (data controls, advanced usage, llms.txt index; Responses/prompt-caching guides; GPT-5.6 prompt_cache_options)
- Anthropic Messages API: platform.claude.com/docs/en/api/messages; extended-thinking guides (adaptive thinking, output_config.effort, Opus 4.7 behavior)
- Gemini: ai.google.dev/gemini-api/docs/thinking; generateContent reference (thinkingLevel/thinkingBudget, safetySettings, full generationConfig)
- DeepSeek: api-docs.deepseek.com (thinking mode guide, chat completions, V4 params; modelparams.dev cross-check)
- Z.AI: docs.z.ai/api-reference/llm/chat-completion (OpenAPI: thinking, reasoning_effort enum, do_sample, temperature range); zai-org/GLM-5 GitHub
- Moonshot Kimi: platform.kimi.ai/docs (model parameter reference, thinking parameter, fixed sampling on k2/k3)
- Qwen/DashScope: docs.qwencloud.com (kimi-on-DashScope guide: enable_thinking, reasoning_content; compatible-mode params)
- Groq: console.groq.com/docs/reasoning + API reference
- Mistral: docs.mistral.ai (reasoning_effort, ThinkChunk; safe_prompt via OpenRouter docs)
- Ollama: docs.ollama.com/capabilities/thinking; ollama API docs (options list); Spring AI Ollama options table (num_ctx et al.)
- OpenRouter: openrouter.ai/docs/api/reference/overview + /docs/api_reference/parameters (request schema incl. provider prefs, plugins, transforms)
- Kilo Gateway: kilo.ai/docs/gateway/api-reference
- Vercel AI Gateway: vercel.com/docs/ai-gateway/.../provider-options; ai-sdk.dev/docs/foundations/provider-options; @ai-sdk/gateway docs
- Vercel AI SDK source: github.com/vercel/ai `packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts` (providerOptions namespace resolution + unknown-key passthrough — the load-bearing implementation detail)
