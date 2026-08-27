<!--
  Appendix: preserved from specs/009-provider-request-settings/contracts/dialect-catalog.md @ commit a937edc24ff3fa71df06cb550f2697e1a1d8a092
  Copied: 2026-08-27 (verbatim, unmodified — load-bearing artifact referenced from living docs/code)
-->

# Contract: Dialect Catalog

**Feature**: 009-provider-request-settings | **Checked**: 2026-08-22
**Data source**: `research/005-provider-request-settings.md` §3/§4 (checked 2026-08-22)

Static, declarative tables in `src/lib/ai/dialects.ts`. Every entry carries
`source` + `checked: '2026-08-22'` so staleness is auditable (spec FR-007).
Fragments are merged per [request-settings-resolution.md](./request-settings-resolution.md).
`∅` = emit nothing for that effort. Model matching is against the last path segment of
the effective model id, lower-cased; `null` value = explicitly remove a key set by an
earlier layer.

## Kind baselines (layer 1)

| Kind                | off          | on                                                                   | deep                                                               | Notes                                                                                                                                                                        |
| ------------------- | ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic`         | `∅`          | `{thinking:{type:'adaptive',display:'summarized'}, effort:'medium'}` | `{thinking:{type:'adaptive',display:'summarized'}, effort:'high'}` | Adaptive form; **never emit `budget_tokens`** (rejected on Opus 4.7). `display:'summarized'` so reasoning is returned. Hazards: `thinking-rejects-sampling` when effort≠off. |
| `gemini`            | see overlays | see overlays                                                         | see overlays                                                       | Root-level `thinkingConfig` (never nested under `generationConfig` — bug fix).                                                                                               |
| `ollama`            | `∅`          | `{think:true}`                                                       | `{think:true}`                                                     | No deep distinction → `effortLevels: ['off','on']`.                                                                                                                          |
| `openai-compatible` | `∅`          | `∅`                                                                  | `∅`                                                                | Generic baseline invents nothing (research R2).                                                                                                                              |

## Endpoint dialects (layer 2 — openai-compatible, matched by baseUrl)

| id          | baseUrl regex                 | off                            | on                                                     | deep                                                  | Hazards                                                              |
| ----------- | ----------------------------- | ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `zai`       | `/api\.z\.ai/i`               | `{thinking:{type:'disabled'}}` | `{thinking:{type:'enabled'}, reasoning_effort:'high'}` | `{thinking:{type:'enabled'}, reasoning_effort:'max'}` | `thinking-ignores-sampling` (effort≠off); `reasoning-eats-token-cap` |
| `deepseek`  | `/api\.deepseek\.com/i`       | `{thinking:{type:'disabled'}}` | `{thinking:{type:'enabled'}, reasoning_effort:'high'}` | `{thinking:{type:'enabled'}, reasoning_effort:'max'}` | same as zai                                                          |
| `groq`      | `/api\.groq\.com/i`           | `∅`                            | `{reasoning_format:'parsed'}`                          | `{reasoning_format:'parsed'}`                         | Default `raw` leaks `<think>` tags → always `parsed` when reasoning  |
| `mistral`   | `/api\.mistral\.ai/i`         | `∅`                            | `∅`                                                    | `∅`                                                   | Base: nothing; reasoning models via overlay                          |
| `moonshot`  | `/api\.moonshot\.(ai          | cn)\|kimi\.moonshot\.cn/i`     | `∅`                                                    | `∅`                                                   | `∅`                                                                  | Base: nothing; kimi models via overlay |
| `dashscope` | `/dashscope\.aliyuncs\.com/i` | `{enable_thinking:false}`      | `{enable_thinking:true}`                               | `{enable_thinking:true}`                              | —                                                                    |

Routers (OpenRouter `openrouter.ai`, Kilo `api.kilo.ai`, Vercel `ai-gateway.vercel.sh`)
get **no endpoint dialect**: they forward provider-native extras to matching upstreams,
so model overlays (layer 3) do all the work.

## Model overlays (layer 3 — matched on last path segment, optional endpoint scope)

| id                        | model regex                        | endpoints           | off                                     | on                                                                | deep                                                            | Metadata                                                                                          |
| ------------------------- | ---------------------------------- | ------------------- | --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `glm-5.3`                 | `/^glm-5\.3/`                      | any                 | `∅` (never send disabled)               | `{thinking:{type:'enabled'}, reasoning_effort:'high'}`            | `{reasoning_effort:'max'}`                                      | `cannot-disable-thinking`; `locks-sampling` false but `thinking-ignores-sampling`                 |
| `glm-5.x`                 | `/^glm-5/` (5.2, 5-turbo, …)       | any                 | `{thinking:{type:'disabled'}}`          | `{thinking:{type:'enabled'}, reasoning_effort:'high'}`            | `{reasoning_effort:'max'}`                                      | 5.2 remaps medium→high, none/minimal→skip (toggle never emits those); `thinking-ignores-sampling` |
| `kimi-k2.6`               | `/^kimi-k2\.6/`                    | any                 | `{thinking:{type:'disabled'}}`          | `{thinking:{type:'enabled'}}`                                     | `{thinking:{type:'enabled'}}`                                   | `locks-sampling` (temperature/top_p/n fixed); `effortLevels:['off','on']`                         |
| `kimi-k3`                 | `/^kimi-k3/`                       | any                 | `∅`                                     | `{reasoning_effort:'high'}`                                       | `{reasoning_effort:'max'}`                                      | `cannot-disable-thinking`; `locks-sampling`                                                       |
| `deepseek-v4`             | `/^deepseek-(chat\|reasoner\|v4)/` | any (incl. routers) | `{thinking:{type:'disabled'}}`          | `{thinking:{type:'enabled'}, reasoning_effort:'high'}`            | `{reasoning_effort:'max'}`                                      | `thinking-ignores-sampling`; `reasoning-eats-token-cap`                                           |
| `groq-gpt-oss`            | `/^gpt-oss/`                       | groq                | `∅`                                     | `{reasoning_effort:'medium'}`                                     | `{reasoning_effort:'high'}`                                     | merges with endpoint `reasoning_format:'parsed'`                                                  |
| `groq-qwen3`              | `/^qwen3/`                         | groq                | `{reasoning_effort:'none'}`             | `{reasoning_effort:'default'}`                                    | `{reasoning_effort:'default'}`                                  | —                                                                                                 |
| `mistral-reasoning`       | `/^mistral-(small\|medium-3)/`     | mistral             | `{reasoning_effort:'none'}`             | `{reasoning_effort:'high'}`                                       | `{reasoning_effort:'high'}`                                     | `effortLevels:['off','on']`                                                                       |
| `dashscope-thinking-only` | `/^kimi-k2\.7-code\|^qwen3/`       | dashscope           | `∅` (cannot disable)                    | `{enable_thinking:true}`                                          | `{enable_thinking:true}`                                        | `cannot-disable-thinking`                                                                         |
| `gemini-3`                | `/^gemini-3/`                      | gemini kind         | `∅` (can't fully disable on some tiers) | `{thinkingConfig:{thinkingLevel:'medium', includeThoughts:true}}` | `{thinkingConfig:{thinkingLevel:'high', includeThoughts:true}}` | `cannot-disable-thinking` (3.1 Pro, 3 Flash)                                                      |
| `gemini-2.5-pro`          | `/^gemini-2\.5-pro/`               | gemini kind         | `∅` (cannot disable)                    | `{thinkingConfig:{thinkingBudget:2048, includeThoughts:true}}`    | `{thinkingConfig:{thinkingBudget:32768, includeThoughts:true}}` | `cannot-disable-thinking`                                                                         |
| `gemini-2.5`              | `/^gemini-2\.5/`                   | gemini kind         | `{thinkingConfig:{thinkingBudget:0}}`   | `{thinkingConfig:{thinkingBudget:2048, includeThoughts:true}}`    | `{thinkingConfig:{thinkingBudget:32768, includeThoughts:true}}` | —                                                                                                 |

Gemini overlays emit under the fixed `'google'` namespace (schema-confirmed:
`thinkingLevel: 'minimal'|'low'|'medium'|'high'`, `thinkingBudget`, `includeThoughts`).

## Hazard copy (UI strings, keyed by HazardId)

- `locks-sampling`: "This model fixes temperature/top_p — sampling settings are disabled."
- `thinking-ignores-sampling`: "Sampling parameters are ignored while thinking is on."
- `thinking-rejects-sampling`: "Anthropic rejects non-default sampling while thinking — expect an error."
- `cannot-disable-thinking`: "This model always reasons; effort 'off' cannot disable it."
- `reasoning-eats-token-cap`: "Reasoning tokens count toward max output tokens — low caps can return empty replies."

## Maintenance rule

The table is transcribed, not discovered: provider drift is handled by editing entries
and bumping their `checked` date. The escape hatch for anything missing is `extraBody`.
Do not add per-provider effort-mapping UI (spec non-goal).
