# Research: Provider Request Settings (Feature 009)

**Date**: 2026-08-22 | **Status**: Complete — all clarifications resolved
**Sources**: `research/005-provider-request-settings.md` (authoritative dialect data, checked
2026-08-22), companion catalogs `research/003`, `research/004`; installed AI SDK sources
(`node_modules/@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`, `@ai-sdk/google`,
`ollama-ai-provider-v2`); repo ground truth (`sdk-factory.ts`, `agent/loop.ts`,
`ai/generate/*`, `ai/client.ts`, `ai/registry.ts`, `ai/types.ts`,
`components/ai/ProviderConfig.svelte`, `stores/chat.svelte.ts`).

---

## R1. openai-compatible namespace key — current code has a latent mismatch (CRITICAL)

**Decision**: the new resolver computes the namespace key exactly as the installed SDK
does: `nsKey = config.name.split('.')[0].trim()` — **case-preserved, no lowercasing,
truncated at the first dot**. This will be pinned by unit tests.

**Evidence** (installed `@ai-sdk/openai-compatible/dist/index.js`):

- Factory assembles the model's provider string as `` `${options.name}.${modelType}` ``
  (line ~1801) — e.g. name `"Z.AI"` → provider `"Z.AI.chat"`.
- The model's getter: `providerOptionsName = this.config.provider.split(".")[0].trim()`
  (line 476) → `"Z"`. A dot anywhere in the provider name truncates the key.
- The request builder merges `providerOptions[this.providerOptionsName]` **and**
  `providerOptions[toCamelCase(this.providerOptionsName)]` (lines 592–593), then
  **spreads every key not in the known zod schema verbatim into the JSON body**
  (lines 588–600) — confirming the research/005 passthrough mechanism. Known schema
  keys (`user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`) are parsed, not
  spread; `topK` is warned-unsupported and dropped (line 546).

**Why current code is broken**: `providerOptionsForReasoning` uses
`pKey = config.name?.toLowerCase() ?? 'openai'` (`sdk-factory.ts:77`). Templates assign
`name: t.label` (`ProviderConfig.svelte:85`) — `"Z.AI"`, `"Kilo Gateway"`, `"OpenAI"` —
so today the emitted namespace (`"z.ai"`, `"kilo gateway"`, `"openai"`) never matches the
SDK-consumed namespace (`"Z"`, `"Kilo Gateway"`, `"OpenAI"`), and zod silently strips the
unmatched namespace. **All reasoning parameters are silently dropped today for every
template-created provider.** Existing `sdk-factory.test.ts` never catches this because
it feeds a lowercase `pKey` into both sides.

**Rationale for the fix**: mirror the SDK, don't fight it. Emitting under the raw
`name.split('.')[0].trim()` key guarantees consumption.

**Alternatives considered**: (a) pass `providerOptionsName` explicitly to
`createOpenAICompatible` and use a fixed slug (e.g. provider `id`) as the namespace —
rejected: changes the wire-visible namespace users may already target in `extraBody`,
and `id` is a uuid (ugly); (b) lowercase both sides — rejected: cannot change the SDK's
case-preserving getter, and names with dots still truncate.

## R2. Baseline must invent nothing — coupled to R1 (behavior-change scoping)

**Decision**: the generic openai-compatible kind baseline emits **no** reasoning
parameters for any effort. Thinking/effort parameters come only from endpoint dialects,
model overlays, or user `extraBody`.

**Rationale**: today's code sends `thinking: {type:'enabled'|'disabled'}` for _every_
openai-compatible provider — junk for OpenAI-class endpoints (OpenAI 400s on unknown
args). It only "worked" (i.e. failed silently) because of the R1 namespace mismatch.
Fixing R1 while keeping the junk baseline would suddenly start forwarding `thinking` to
endpoints that reject it — a regression. Every endpoint that legitimately consumed
`thinking` before still receives it: Z.AI endpoint dialect, DeepSeek endpoint dialect,
Kimi/Qwen endpoint dialects, GLM/Kimi model overlays on routers (R4).

**Spec interplay**: spec SC-006 ("byte-identical for existing users") is satisfied in
spirit: for cased-name providers the wire was already bare (R1), and lowercase-named
Z.AI/Kimi/DeepSeek-class endpoints are re-served by their dialects. The only observable
change is the bug fix itself. Documented here; called out in plan risks.

## R3. Effective model id: `config.defaultModel`, threaded explicitly

**Decision**: resolver signature takes `modelId` explicitly; every call site passes the
id used to build the `LanguageModel`. Today that is always `config.defaultModel`
(`sdk-factory.ts:38`; chat model picker persists `defaultModel` via
`ProviderConfig.svelte:111-114` `onSelectModel`). No separate per-request override
channel exists; the explicit param makes future overrides trivial and makes router
prefixes (`z-ai/glm-5.2` on OpenRouter/Kilo/Vercel catalogs) naturally visible.

**Alternatives considered**: reading `config.defaultModel` inside the resolver —
rejected: hides the actual model used and blocks future per-request overrides
(spec FR-008).

## R4. Dialect catalog shape — endpoint dialects vs model overlays

**Decision**: two declarative tables, both static, both stamped
`source: research/005 §3, checked 2026-08-22`:

1. **Endpoint dialects** — matched by `baseUrl` regex (openai-compatible only):
   Z.AI, DeepSeek, Groq, Mistral, Moonshot Kimi, DashScope. Each maps
   `off|on|deep` → a providerOptions fragment under the R1 namespace key.
2. **Model overlays** — matched by regex against the **last path segment** of the
   effective model id (`id.split('/').pop()`), optionally scoped to endpoint dialects.
   These carry model-version splits the endpoint alone can't know: GLM-5.2 vs 5.3,
   Gemini 2.5 vs 3.x, kimi-k2.6 vs k3, gpt-oss on Groq, mistral-small/medium reasoning
   models — plus capability metadata (`locksSampling`, `effortLevels`, `hazards`).

Kind baselines (anthropic adaptive thinking, gemini thinkingConfig, ollama `think`)
are part of the kind layer (layer 1), not baseUrl tables. Routers (OpenRouter, Kilo
Gateway, Vercel AI Gateway) need **no dialect entries of their own**: they forward
provider-native params to matching upstreams (research/005 §4), so model overlays on
the last segment do the work (`z-ai/glm-5.2` → `glm-5.2` overlay).

**Alternatives considered**: one flat per-provider table keyed by provider id —
rejected: breaks the moment a user renames a provider or points a custom baseUrl at a
known API; baseUrl+model matching survives renames.

## R5. Exact dialect mappings (transcribed from research/005 §3, checked 2026-08-22)

| Dialect / overlay                                         | Match           | off                                                                         | on                                                                   | deep                        | Notes / hazards                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kind `anthropic`                                          | kind            | `{}`                                                                        | `thinking:{type:'adaptive',display:'summarized'}`, `effort:'medium'` | same, `effort:'high'`       | `budget_tokens` is rejected on Opus 4.7 — never emit. SDK schema confirms `adaptive` + `effort` (dist 1002–1031, 1099). Thinking rejects non-default sampling → hazard.                                                    |
| kind `gemini` + overlay `gemini-3.*`                      | model           | omit (can't fully disable on some tiers → hazard `cannot-disable-thinking`) | `thinkingConfig:{thinkingLevel:'medium',includeThoughts:true}`       | `thinkingLevel:'high'`      | Levels `minimal\|low\|medium\|high` confirmed in SDK schema (dist 887–893).                                                                                                                                                |
| kind `gemini` + overlay `gemini-2.5-*`                    | model           | `thinkingBudget:0` (2.5 Pro: cannot disable → omit + hazard)                | `thinkingBudget:2048,includeThoughts:true`                           | `thinkingBudget:32768`      | —                                                                                                                                                                                                                          |
| kind `ollama`                                             | kind            | `{}`                                                                        | `think:true`                                                         | `think:true`                | SDK chat schema: `think?: boolean`, `options?: {num_ctx, top_k, repeat_penalty, …}` (dist 820–840). No deep distinction → `effortLevels` hides Deep.                                                                       |
| endpoint `zai` (`api.z.ai`) + overlay `glm-5.*`           | baseUrl / model | `thinking:{type:'disabled'}`                                                | `thinking:{type:'enabled'}, reasoning_effort:'high'`                 | `reasoning_effort:'max'`    | GLM-5.2 remaps medium→high, none/minimal→skip (our toggle never emits those). Overlay `glm-5.3*`: cannot disable → off omits thinking, sends `reasoning_effort:'low'`; sampling ignored while thinking (hazard).           |
| endpoint `deepseek` + overlay `deepseek-*`                | baseUrl / model | `thinking:{type:'disabled'}`                                                | `thinking:{type:'enabled'}, reasoning_effort:'high'`                 | `reasoning_effort:'max'`    | v4 default-enabled; sampling accepted-but-ignored in thinking mode (hazard); reasoning eats `max_tokens` (hazard).                                                                                                         |
| endpoint `groq`                                           | baseUrl         | `{}`                                                                        | `reasoning_format:'parsed'`                                          | `reasoning_format:'parsed'` | Default `raw` leaks `<think>` tags — always send `parsed` when reasoning. Overlay `gpt-oss*`: adds `reasoning_effort` on→`'medium'`, deep→`'high'`. Overlay `qwen3.*`: off→`reasoning_effort:'none'`, on/deep→`'default'`. |
| endpoint `mistral` + overlay `mistral-(small\|medium-3*)` | baseUrl / model | `reasoning_effort:'none'`                                                   | `reasoning_effort:'high'`                                            | `reasoning_effort:'high'`   | Only reasoning-capable models get the overlay; others: nothing.                                                                                                                                                            |
| endpoint `moonshot` + overlay `kimi-k2.6*`                | baseUrl / model | `thinking:{type:'disabled'}`                                                | `thinking:{type:'enabled'}`                                          | `thinking:{type:'enabled'}` | `locksSampling` (temperature/top_p/n fixed).                                                                                                                                                                               |
| overlay `kimi-k3*` (any endpoint)                         | model           | `{}`                                                                        | `reasoning_effort:'high'`                                            | `reasoning_effort:'max'`    | **Always reasons** (`cannot-disable-thinking`), `locksSampling`.                                                                                                                                                           |
| endpoint `dashscope` + overlay `qwen*`                    | baseUrl / model | `enable_thinking:false`                                                     | `enable_thinking:true`                                               | `enable_thinking:true`      | Some models thinking-only (kimi-k2.7-code there) → hazard.                                                                                                                                                                 |
| generic openai-compatible baseline                        | kind            | `{}`                                                                        | `{}`                                                                 | `{}`                        | Invents nothing (R2).                                                                                                                                                                                                      |

Gemini fix note: current code nests under
`providerOptions.google.generationConfig.thinkingConfig` (`sdk-factory.ts:88,116`) but
the SDK schema expects `thinkingConfig` at the namespace root — zod strips unknown
`generationConfig`, so **Gemini thinking never reached the wire today either**. The
resolver emits `providerOptions.google.thinkingConfig` directly. Namespace keys
`anthropic` / `google` / `ollama` are fixed by the SDKs (dist 146, 559, 1467), not
derived from `config.name`.

## R6. Resolver: location, signature, layering

**Decision**: new pure module `src/lib/ai/dialects.ts`:

```ts
resolveRequestSettings(config: ProviderConfig, modelId: string, effort: ReasoningEffort)
  : { callSettings: SamplingCallSettings; providerOptions: Record<string, unknown>;
      droppedExtraKeys: string[] }
describeDialect(config: ProviderConfig, modelId: string)
  : { locksSampling: boolean; effortLevels: ReasoningEffort[]; hazards: HazardId[] } | null
```

Layering (later overrides earlier; per spec FR-005):

1. **Kind baseline** — anthropic/gemini/ollama/openai-compatible reasoning fragments (R5).
2. **Endpoint dialect** — baseUrl regex → fragment merge (shallow per-key).
3. **Model overlay** — last-segment regex → fragment merge + capability metadata.
4. **Tier A call settings** — `config.requestDefaults` spread into `callSettings`
   (omit-empty: only fields the user set).
5. **Tier C extraBody** — merged last into the namespace (openai-compatible: every key
   verbatim under `nsKey`, overriding dialect keys; anthropic/gemini/ollama: allowlist
   merge, non-forwardable keys collected into `droppedExtraKeys`).

Replaces `providerOptionsForReasoning` and `supportsReasoningEffort` entirely; the
latter's chat-UI consumer (`supportsDeep` at `routes/chat/[id]/+page.svelte:69-70`)
moves to `describeDialect(...).effortLevels.includes('deep')`.

**Rationale**: purity makes it unit-testable and lets the Settings preview render the
exact live output (FR-015/FR-016).

**Alternatives considered**: extending `sdk-factory.ts` in place — rejected: mixes model
construction with request-dialect data; the spec mandates a standalone declarative table.

## R7. All four call sites — how effort and settings thread

Verified call-site inventory:

| Path                                                                                                                                  | Model source                                 | Effort today             | After                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat (`loop.ts:319`)                                                                                                                  | `deps.model` (from `getActiveSdkProvider()`) | `deps.effort` threaded ✓ | resolver(deps.config, config.defaultModel, deps.effort); callSettings spread into `streamText`; trace both                                                                                             |
| Critic (`loop.ts:217`)                                                                                                                | same `deps.model`                            | **none sent**            | resolver with same deps (chat ambient effort)                                                                                                                                                          |
| Lab/Quiz (`object-tool.ts:145` via `generate.ts:94`, `generate-quiz.ts:194,245`; stores `labs.svelte.ts:97`, `quizzes.svelte.ts:178`) | `getActiveSdkProvider()`                     | none                     | stores read persisted `'reasoningEffort'` settings KV (the same key Composer persists, default `'on'`), run resolver, pass precomputed `{callSettings, providerOptions}` down through generate options |
| Title (`generate-title.ts:44`, called `chat.svelte.ts:702`)                                                                           | same                                         | none                     | caller runs resolver with effort pinned `'off'`, passes result down                                                                                                                                    |

**Decision**: generate/ helpers accept an optional precomputed
`requestSettings` param rather than importing `ProviderConfig` — keeps them decoupled
and unit-testable; stores own the config+effort. Lab/quiz ambient effort = the persisted
chat toggle (no separate lab effort setting — spec FR-010).

**Alternatives considered**: calling the resolver inside generate/ helpers — rejected:
would require threading config/modelId/effort anyway, duplicating store logic.

## R8. Tier A field set, ranges, and omit-empty

**Decision**: `requestDefaults?: { temperature?: number [0–2]; topP?: number [0–1];
maxOutputTokens?: integer ≥1; stopSequences?: string[] (non-empty items, ≤16);
seed?: integer; frequencyPenalty?: number [−2–2]; presencePenalty?: number [−2–2] }`
on `ProviderConfig`. Unset ⇒ key absent from the resolver output (never
`undefined`-valued keys). `topK` deliberately excluded (dropped by openai-compatible;
rides `extraBody` — research/005 §1). No per-provider range specialization (e.g. Z.AI
temperature cap 0–1) — surfaced as a hazard string instead; the provider remains the
authority.

**Rationale**: omit-empty is a hard requirement (OpenRouter cache-key semantics,
research/005 §4 / spec FR-002); ranges are the union of documented provider bounds
(research/005 §2).

## R9. Tier C extraBody validation and per-kind merge

**Decision**: `extraBody?: Record<string, JSONValue>` on `ProviderConfig`; a pure
`validateExtraBody(raw: string | unknown)` returns
`{ ok: true, value } | { ok: false, errors: string[] }` with rules:

- must be a JSON **object** (arrays/scalars rejected);
- serialized size ≤ **16 KiB**;
- **secret-like keys rejected** (constitution I: no secrets in settings): any top-level
  key matching `/^(authorization|api[-_]?key|x-api-key|apikey|headers?|cookies?|token|secret|password|bearer)/i`;
- prototype-pollution keys rejected: `__proto__`, `constructor`, `prototype`.

Merge semantics (pinned by contract `contracts/request-settings-resolution.md`):
openai-compatible — shallow per-key override into `providerOptions[nsKey]`, everything
forwarded verbatim (R1 evidence); anthropic allowlist (from installed schema, checked
2026-08-22): `thinking, effort, speed, taskBudget, inferenceGeo, disableParallelToolUse,
structuredOutputMode, toolStreaming`; gemini allowlist: `thinkingConfig,
safetySettings, responseModalities, cachedContent, structuredOutputs`; ollama allowlist:
`think, options, keepAlive`. Non-forwardable keys → `droppedExtraKeys` → UI warning
(never silent). Allowlists must be re-derived from the installed SDK zod schemas during
implementation (they drift with SDK upgrades) — the sets above are the verified
2026-08-22 snapshot.

**Alternatives considered**: forwarding unknown keys for anthropic/gemini/ollama too —
impossible: their zod schemas strip unknown keys (only openai-compatible spreads);
hence the explicit dropped-keys channel.

## R10. Settings UI placement

**Decision** (verified structure): per-provider "Advanced" section inside each
`<li>` in `ProviderConfig.svelte` (after tool capability/models, before API key),
using the existing `Collapsible` (`$lib/components/ui/collapsible`). Note: the project
has **no** shadcn `Input`/`Select`/`Textarea` primitives — forms use raw
`<input>`/`<select>` with the shared `inputClass` helper (`ProviderConfig.svelte:43-44`);
the Advanced section follows that pattern (a `<textarea>` for extraBody). Contents:
7 sampling inputs (numeric/text), extraBody JSON textarea with inline validation, and a
read-only resolved-request preview computed by the real resolver against the current
form state + `defaultModel` + a preview effort selector. `locksSampling` → inputs
disabled + hazard text; dropped-keys list rendered under the editor.

Persistence rides the existing whole-list `saveProviders` path (settings KV
`'providers'`) — no migration, no new store. API-key handling untouched.

## R11. Trace surface

**Decision**: the chat request trace event (`trace.ts` `'request'` variant, emitted
`loop.ts:309-315`) gains `callSettings`. `providerOptions` already flows there and
into `DiagnosticsPanel.svelte`'s Copy payload (line 367) — it gains a small visual
rendering of `providerOptions` + `callSettings`. Object-tool traces
(`buildObjectTrace`, `trace.ts:101-112`) gain optional `providerOptions`/`callSettings`
fields so lab/quiz requests are equally inspectable. This is what makes SC-001/SC-005 of
the spec verifiable end-to-end.

**Alternatives considered**: leaving object traces unchanged — rejected: four-site
parity is the point of the feature; cost is two optional JSON fields.

## R12. Tests replacing `sdk-factory` reasoning tests

**Decision**: new colocated `src/lib/ai/dialects.test.ts` (constitution II: new
`src/lib` behavior MUST ship tests):

- nsKey computation: case preservation, dot truncation (`"Z.AI"` → `"Z"`), trim;
  regression test that fails against the old lowercase behavior.
- Layer precedence: kind baseline vs endpoint dialect vs model overlay vs extraBody
  (extraBody wins, including dialect-key collisions).
- Router prefixes: `z-ai/glm-5.2`, `anthropic/claude-sonnet-4.5` (via router on
  openai-compatible), `deepseek/deepseek-chat`, `moonshotai/kimi-k3`.
- Every catalog entry: off/on/deep mappings exactly as R5 table.
- Omit-empty: unset `requestDefaults` ⇒ no keys; partial ⇒ only set keys.
- `validateExtraBody`: non-object, oversize, secret-like, proto keys, valid cases.
- `describeDialect`: `locksSampling` (kimi-k3/k2.6), `effortLevels` (deep hidden for
  plain ollama/generic), hazards.
- Gemini fix regression: `providerOptions.google.thinkingConfig` at root, not under
  `generationConfig`.

`sdk-factory.test.ts` keeps only model-construction coverage; the reasoning describes
are deleted (spec AC-6 / SC-007).

## Risk register

| Risk                                                                                | Mitigation                                                                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R1+R2 change wire behavior for providers that (accidentally) received nothing today | Both are strictly correctness fixes; every previously-_served_ endpoint is re-served by dialects; covered by tests; noted for release notes. |
| SDK schema drift (anthropic/gemini/ollama allowlists, openai-compatible known keys) | Allowlists re-derived from installed schemas at implementation; checked-date comments make staleness visible (FR-007).                       |
| Dialect data staleness (provider APIs churn, e.g. Anthropic budget→adaptive)        | Every entry carries `checked 2026-08-22`; escape hatch is extraBody.                                                                         |
| extraBody bypassing allowlists confuses users                                       | Dropped-keys warning is total (FR-014) and preview shows the final resolved request before saving.                                           |
