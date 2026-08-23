# Contract: Request Settings Resolution

**Feature**: 009-provider-request-settings | **Checked**: 2026-08-22
**Module**: `src/lib/ai/dialects.ts` (new, pure — no network, no storage, no side effects)

This contract defines how a provider configuration, an effective model id, and the
ambient reasoning effort combine into the parameters sent with every model call. It
replaces `providerOptionsForReasoning` and `supportsReasoningEffort`
(`src/lib/ai/sdk-factory.ts`), which are removed.

## Public API

```ts
type ReasoningEffort = 'off' | 'on' | 'deep'; // existing (types.ts:36)

interface ResolvedRequestSettings {
	callSettings: {
		temperature?: number;
		topP?: number;
		maxOutputTokens?: number;
		stopSequences?: string[];
		seed?: number;
		frequencyPenalty?: number;
		presencePenalty?: number;
	}; // omit-empty: only user-set keys
	providerOptions: Record<string, unknown>; // namespaced per kind (below)
	droppedExtraKeys: string[]; // extraBody keys not forwardable
}

function resolveRequestSettings(
	config: ProviderConfig,
	modelId: string, // effective id used to build the LanguageModel
	effort: ReasoningEffort
): ResolvedRequestSettings;

function describeDialect(
	config: ProviderConfig,
	modelId: string
): { locksSampling: boolean; effortLevels: ReasoningEffort[]; hazards: HazardId[] } | null;

function validateExtraBody(
	input: unknown
): { ok: true; value: Record<string, JSONValue> } | { ok: false; errors: string[] };

function namespaceKeyFor(config: ProviderConfig): string; // openai-compatible only
```

Callers: agent chat and critic pass (`src/lib/agent/loop.ts`), lab/quiz generation
(`src/lib/ai/generate/*` via stores), title generation (`chat.svelte.ts` caller, effort
pinned `'off'`), and the Settings Advanced preview (same function, no parallel logic).

## Namespace keys (per provider kind)

Load-bearing SDK facts (verified in installed sources, 2026-08-22):

| Kind                | `providerOptions` namespace key                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-compatible` | `config.name.split('.')[0].trim()` — **case-preserved, truncated at first dot** (SDK: `config.provider.split(".")[0].trim()`, provider string = `` `${name}.chat` ``) |
| `anthropic`         | `'anthropic'` (fixed by SDK)                                                                                                                                          |
| `gemini`            | `'google'` (fixed by SDK)                                                                                                                                             |
| `ollama`            | `'ollama'` (fixed by SDK; Mayon passes no `name` to `createOllama`)                                                                                                   |

The openai-compatible rule is a **bug fix**: the previous code lowercased the full name
and never matched the SDK's case-preserving, dot-truncating key, so reasoning params
were silently dropped for template-created providers (names like `"Z.AI"`, `"Kilo Gateway"`).
Pinned by regression tests.

## Resolution algorithm

Inputs: `config`, `modelId`, `effort`. Five layers; each layer's keys override earlier
layers per-key (shallow merge at the namespace root; no deep merging of nested objects).

1. **Kind baseline** — reasoning fragment for the provider kind at this effort:
   `anthropic` (adaptive thinking + effort), `gemini` (thinkingConfig; further split by
   model overlay), `ollama` (`think`), `openai-compatible` (**nothing** — the generic
   baseline invents no parameters).
2. **Endpoint dialect** (openai-compatible only) — first catalog entry whose
   `baseUrl` regex matches `config.baseUrl`; merge its effort fragment.
3. **Model overlay** — catalog entries whose `model` regex matches the **last path
   segment** of `modelId` (`modelId.split('/').pop()`, lower-cased for matching) and
   whose optional `endpoints` scope (if present) matches the endpoint dialect id
   (or a router baseUrl). Overlay fragments override endpoint fragments; overlays may
   also _suppress_ a key by setting it to `null` (explicit removal).
   Router-prefixed ids (`z-ai/glm-5.2`, `deepseek/deepseek-chat`,
   `anthropic/claude-sonnet-4.5` on OpenRouter/Kilo/Vercel) resolve through this rule.
4. **Tier A call settings** — `config.requestDefaults` copied verbatim into
   `callSettings`, but **only keys that are defined**. No interaction with, or
   transformation of, `providerOptions`.
5. **Tier C extraBody — merged last (user wins)**:
   - `openai-compatible`: every key of `config.extraBody` is set into
     `providerOptions[nsKey]`, overriding any dialect key with the same name. All keys
     are forwarded verbatim by the SDK (unknown keys are spread into the JSON body;
     only `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema` are parsed by
     the SDK's known schema instead).
   - `anthropic` / `gemini` / `ollama`: only keys in the kind's **forwardable allowlist**
     are merged (the SDK zod schema strips everything else). Non-forwardable keys are
     collected into `droppedExtraKeys` — never silently ignored. Allowlists are
     re-derived from the installed SDK schemas at implementation time; verified
     2026-08-22 snapshot:
     - anthropic: `thinking`, `effort`, `speed`, `taskBudget`, `inferenceGeo`,
       `disableParallelToolUse`, `structuredOutputMode`, `toolStreaming`
     - google: `thinkingConfig`, `safetySettings`, `responseModalities`,
       `cachedContent`, `structuredOutputs`
     - ollama: `think`, `options`, `keepAlive`

If no dialect/overlay matches and no Tier A/C fields are set, output is
`{ callSettings: {}, providerOptions: {}, droppedExtraKeys: [] }` (modulo the two
documented bug fixes — see research.md R1/R2).

## Omit-empty wire contract

For a provider with no `requestDefaults` and no `extraBody`, the request body MUST NOT
gain any new key at any call site. For partially-set `requestDefaults`, only set keys
appear. Rationale: sending explicit provider defaults changes cache keys on OpenRouter
(research/005 §4) and can trip strict endpoints.

## Call-site integration

| Site                                                             | Effort                                                    | Resolver inputs                                |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Chat `streamText` (`loop.ts`)                                    | ambient `deps.effort`                                     | `deps.config`, `deps.config.defaultModel`      |
| Critic `streamText` (`runCriticPhase`)                           | same ambient effort (gains options it never sent)         | same                                           |
| Lab/quiz `generateText` (`object-tool.ts` via generate wrappers) | persisted `'reasoningEffort'` settings KV, default `'on'` | store-resolved config + `config.defaultModel`  |
| Title `generateText` (`generate-title.ts`)                       | pinned `'off'`                                            | caller-resolved config + `config.defaultModel` |

Generate helpers accept a precomputed `requestSettings` object (optional param) rather
than importing `ProviderConfig`, keeping them provider-agnostic. `callSettings` is
spread as top-level `streamText`/`generateText` params (SDK maps them for all four
kinds); `providerOptions` passed as-is; `droppedExtraKeys` surfaced to trace/UI.

## `describeDialect` (UI capability metadata)

Returns the capability metadata of the matched model overlay (or the kind default):
`locksSampling` disables sampling inputs in Settings; `effortLevels` drives the chat
Composer's Deep-option visibility (replacing `supportsReasoningEffort` usage at
`routes/chat/[id]/+page.svelte:69-70`); `hazards` drives warning copy. `null` when no
overlay matches (generic: nothing locked, all efforts, no hazards).

## Test obligations (enforced by `dialects.test.ts`)

1. Namespace key: case preserved; `"Z.AI"` → `"Z"`; trim; regression vs lowercasing.
2. Layer precedence incl. extraBody overriding a colliding dialect key.
3. Router prefixes: `z-ai/glm-5.2`, `deepseek/deepseek-chat`, `moonshotai/kimi-k3`.
4. Every catalog entry's off/on/deep fragments (dialect-catalog.md table, verbatim).
5. Omit-empty / partial `requestDefaults`.
6. `validateExtraBody` accept/reject matrix (object-ness, size, secret-like, proto).
7. `droppedExtraKeys` for non-forwardable keys on anthropic/gemini/ollama; empty for
   openai-compatible.
8. Gemini regression: `thinkingConfig` at namespace root, never under
   `generationConfig`.
