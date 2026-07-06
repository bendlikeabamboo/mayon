# Reasoning Effort Control — Proposal

> **Status:** PROPOSAL — decisions not yet locked.
> **Source:** User request to support choosing reasoning level for LLM models, primarily for Z.AI's GLM Coding Plan.

---

## 1. The problem

Mayon currently has a binary **Thinking on/off** toggle in the Composer (`Brain` icon). When on, reasoning defaults to the provider's default behavior (typically `thinking: { type: 'enabled' }`). When off, reasoning is disabled entirely. There is no way to control the **depth** of reasoning — e.g. "think lightly for this quick question" vs. "think deeply for this complex problem."

For Z.AI's GLM-5.2 (the user's primary provider), the API supports a `reasoning_effort` parameter with distinct effort levels that control reasoning depth and token usage. Other providers (OpenAI, Anthropic, Gemini) also have reasoning-effort/depth controls, but they work differently.

---

## 2. Current state

### What exists
- **`ReasoningMode`** type: `'auto' | 'enabled' | 'disabled'` (`types.ts:33`).
- **`providerOptionsForReasoning()`** (`sdk-factory.ts:67-98`): converts `ReasoningMode` into per-provider `providerOptions` passed to `streamText()`.
  - `openai-compatible`: `{ [pKey]: { thinking: { type: 'enabled' | 'disabled' } } }`
  - `anthropic`: `{ anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } } }`
  - `gemini`: `{ google: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } }` (disabled only)
  - `ollama`: no-op
- **Composer toggle** (`Composer.svelte:6-48`): binary on/off Brain icon, persisted as `reasoningEnabled` boolean in settings KV.
- **Agent loop** (`loop.ts:213-219`): passes `providerOptions: pOpts as never` to `streamText()`.
- **Reasoning display**: `Reasoning.svelte` renders thinking content; `MessageRow.svelte` persists it in `message.metadata`.

### What's missing
- No `reasoning_effort` parameter is ever sent to any provider.
- The Z.AI API's `reasoning_effort` field (`max`/`high`/`medium`/`low`/`minimal`/`none`) is not wired.
- The UI has no affordance for reasoning depth control — only binary on/off.
- AI SDK 7 has a new `reasoning` option on `streamText`/`generateText` that standardizes effort control across providers.

---

## 3. Provider landscape — how reasoning effort works

### Z.AI (GLM-5.2, Coding Plan endpoint)

**API reference:** `https://api.z.ai/api/coding/paas/v4`

Z.AI's OpenAI-compatible endpoint supports two independent parameters:

| Parameter | Shape | Values | What it does |
|-----------|-------|--------|--------------|
| `thinking.type` | string | `enabled` / `disabled` | Binary: whether the model reasons at all. Default: `enabled` for GLM-5.2/5.1/5/4.7. |
| `reasoning_effort` | string | `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none` | Controls reasoning depth *when thinking is enabled*. Default: `max`. Only supported by **GLM-5.2**. `none`/`minimal` skip thinking; `low`/`medium` map to `high`; `xhigh` maps to `max`. |

**Key nuance:** The `thinking.type` and `reasoning_effort` are **independent** top-level parameters. `reasoning_effort` only works with GLM-5.2. For GLM-5.1/5-Turbo/4.7, only the binary `thinking.type` applies.

**Earlier empirical data (glm-for-copilot issue #7, June 16):** The `reasoning_effort` parameter was initially a no-op on the coding plan endpoint. The official Z.AI API docs now document it, suggesting it was enabled subsequently. **We should verify this empirically before relying on it.**

### OpenAI (GPT-5.5, GPT-5.4, etc.)

**AI SDK 7 approach:** `reasoning: 'high'` (standardized top-level option) or `providerOptions: { openai: { reasoningEffort: 'high' } }`.

| Effort levels | Models |
|---------------|--------|
| `none`, `low`, `medium`, `high`, `xhigh` | GPT-5.5, 5.4, 5.2, 5.1 |
| `minimal`, `low`, `medium`, `high` | GPT-5, 5-mini, 5-nano |
| `low`, `medium`, `high` | o3, o3-mini, o4-mini |

### Anthropic (Claude 4.6, 4–4.5)

**AI SDK 7 approach:** `reasoning: 'high'` or `providerOptions: { anthropic: { thinkingBudget: <tokens> } }`.

Claude uses a **token budget** for thinking rather than named effort levels. In AI SDK 7, the standard `reasoning` option maps to appropriate budget values.

### Gemini (Gemini 3.1, 3, 2.5)

**AI SDK 7 approach:** `reasoning: 'high'` or `providerOptions: { google: { thinkingConfig: { thinkingBudget: <tokens> } } }`.

Gemini 3+ supports `thinkingLevel` (text effort levels); Gemini 2.5 uses `thinkingBudget` (token budget).

---

## 4. Proposed approach

### Decision: three-tier reasoning control

Replace the binary on/off with a **three-tier selector** in the Composer:

| Tier | Label | Maps to | Behavior |
|------|-------|---------|----------|
| **Off** | "Think off" | `reasoning_effort: 'none'` (or `thinking.type: 'disabled'`) | No reasoning. Fastest, cheapest. |
| **On (default)** | "Think" | `reasoning_effort: 'high'` (or provider default) | Normal reasoning depth. Good for most tasks. |
| **Deep** | "Think deep" | `reasoning_effort: 'max'` / `reasoning: 'high'` (or provider max) | Maximum reasoning. Slower, more tokens. For complex tasks. |

**Why three tiers, not the full effort spectrum:**
- The full Z.AI spectrum (7 levels: none/minimal/low/medium/high/xhigh/max) is too granular for a tutor app — the differences between `low` and `medium` are imperceptible in a learning context.
- Three tiers map cleanly across all providers: Off = disabled, On = moderate/default, Deep = maximum.
- The current binary Brain icon becomes a **cycle button** (off → on → deep → off), which is compact and discoverable.

### How it maps per provider

| Provider | Off | On | Deep |
|----------|-----|-----|------|
| **Z.AI (GLM-5.2)** | `thinking: { type: 'disabled' }` | `reasoning_effort: 'high'` | `reasoning_effort: 'max'` |
| **Z.AI (GLM-5.1/4.7, no effort)** | `thinking: { type: 'disabled' }` | `thinking: { type: 'enabled' }` | `thinking: { type: 'enabled' }` (best available) |
| **OpenAI (GPT-5.x)** | `reasoningEffort: 'none'` | `reasoningEffort: 'medium'` | `reasoningEffort: 'xhigh'` |
| **Anthropic (Claude)** | `thinkingBudget: 0` / disabled | `thinkingBudget: 2048` (current default) | `thinkingBudget: 10000` (or max) |
| **Gemini** | `thinkingBudget: 0` | `thinkingBudget: 8192` (default) | `thinkingBudget: 32768` (max) |
| **Ollama** | no-op | no-op | no-op |

### Storage

Extend the `reasoningEnabled` settings KV from a boolean to a string:

```ts
// settings KV key: 'reasoningMode'
type ReasoningEffort = 'off' | 'on' | 'deep';
// Default: 'on' (preserve current behavior for existing users)
```

The old `reasoningEnabled` boolean is migrated on first read: `true` → `'on'`, `false` → `'off'`.

---

## 5. Implementation plan

### Type changes (`types.ts`)
```ts
export type ReasoningMode = 'auto' | 'enabled' | 'disabled';  // keep for backward compat
export type ReasoningEffort = 'off' | 'on' | 'deep';      // new user-facing control
```

### `providerOptionsForReasoning()` extension (`sdk-factory.ts`)

The function signature grows to accept `ReasoningEffort` instead of just `ReasoningMode`:

```ts
export function providerOptionsForReasoning(
  kind: ProviderConfig['kind'],
  effort: ReasoningEffort,
  providerName?: string,
  modelId?: string  // needed to detect GLM-5.2 vs older GLMs
): Record<string, unknown>
```

For `openai-compatible` with Z.AI:
- `off`: `{ [pKey]: { thinking: { type: 'disabled' } } }`
- `on`: `{ [pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } }` (only add `reasoning_effort` for GLM-5.2)
- `deep`: `{ [pKey]: { thinking: { type: 'enabled' }, reasoning_effort: 'max' } }` (only add `reasoning_effort` for GLM-5.2)

For other `openai-compatible` (OpenRouter, etc.): pass `reasoning_effort` as-is and let the upstream provider handle it (or no-op for providers that don't support it).

For `anthropic`:
- `off`: `{}` (no thinking)
- `on`: `{ anthropic: { thinking: { type: 'enabled', budget_tokens: 2048 } } }` (current)
- `deep`: `{ anthropic: { thinking: { type: 'enabled', budget_tokens: 10000 } } }`

For `gemini`:
- `off`: `{ google: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } }`
- `on`: `{}` (default)
- `deep`: `{ google: { generationConfig: { thinkingConfig: { thinkingBudget: 32768 } } } }`

### Z.AI GLM-5.2 detection

The `reasoning_effort` parameter is only documented for GLM-5.2. For older GLM models, it should be omitted to avoid confusing the endpoint. Detection:

```ts
function supportsReasoningEffort(modelId: string): boolean {
  return modelId === 'glm-5.2' || modelId.startsWith('glm-5.2');
}
```

This is a simple prefix check; if Z.AI adds effort support to newer models, the check can be widened.

### Composer UI (`Composer.svelte`)

The Brain icon becomes a **cycle button** with three states:

| State | Icon appearance | Tooltip |
|-------|----------------|---------|
| `off` | Brain with a slash/outline | "Thinking: off" |
| `on` | Brain (filled, secondary) | "Thinking: on" |
| `deep` | Brain + sparkles/bolt | "Thinking: deep" |

Click cycles: `on → deep → off → on` (default starts at `on`). The current `thinkingOn` boolean state becomes `effort: ReasoningEffort`.

### Settings persistence

- Replace the `reasoningEnabled` boolean KV with `reasoningMode` string KV (`'off' | 'on' | 'deep'`).
- Migration: on first load, if `reasoningEnabled` exists and is boolean, convert to `'on'`/`'off'` and delete the old key.
- Persisted in `onMount` (same as current pattern).

### Agent loop (`loop.ts`)

No structural change — `providerOptionsForReasoning()` is called with the new `ReasoningEffort` type and produces the appropriate `providerOptions` dict. The existing `pOpts` flow is unchanged.

### Structured generation (`object-tool.ts`)

The `generateObjectViaTool` path also calls `streamText` with reasoning options. It should respect the same `ReasoningEffort` (currently it doesn't pass reasoning options at all — this is an improvement to wire it through).

---

## 6. Edge cases

- **Z.AI `reasoning_effort` is a no-op on non-5.2 models:** We only send it for GLM-5.2. For older models, only the binary `thinking.type` applies, and the `deep` tier falls back to `thinking: { type: 'enabled' }` (best available).
- **OpenRouter passes effort through:** OpenRouter's `/chat/completions` is a passthrough — if the upstream model supports `reasoning_effort`, it works; if not, it's silently ignored (no error). Safe to send always for `openai-compatible`.
- **Token cost awareness:** `deep` mode on Claude can use up to 10000 thinking tokens per turn, which costs ~3x more output tokens. The UI tooltip should mention this. But we don't need a budget limit — the user controls cost by choosing the tier.
- **`generateObjectViaTool` doesn't use reasoning today:** This is a separate improvement; for now, structured generation (labs/quizzes/briefs) stays without reasoning effort control (it may use the binary `on/off` if we wire it).

---

## 7. Open questions (for decision before implementation)

1. **Three tiers vs. full spectrum.** Is `off / on / deep` sufficient, or do you want the full `none / minimal / low / medium / high / xhigh / max` spectrum (7 levels)? Three tiers is simpler and maps across providers; the full spectrum is Z.AI-specific and doesn't map cleanly to Anthropic's token-budget model or Gemini's levels.

2. **Default tier.** Should the default be `on` (current behavior preserved) or `off` (no reasoning unless explicitly requested)? The current app defaults to thinking on. Changing the default to `off` would reduce token usage but change existing behavior.

3. **Verification required.** Before shipping Z.AI `reasoning_effort`, we should empirically verify it actually works (the June 16 glm-for-copilot data suggested it was a no-op). Should we do a quick probe test first, or trust the updated docs?

4. **Should the tier affect `generateObjectViaTool`?** Currently structured generation (labs, quizzes, briefs, titles) doesn't pass reasoning options. Should `deep` mode also apply to these, or should they always use the provider default? Reasoning during structured generation could improve output quality but increases cost and latency.

5. **Per-provider tier labels.** Should the labels be generic ("off / think / think deep") or provider-specific (e.g., showing "max" for Z.AI, "high" for OpenAI)? Generic labels are simpler; provider-specific labels are more precise.

---

## 8. Scope exclusion

- **AI SDK 7 `reasoning` top-level option.** AI SDK 7 added a standardized `reasoning` parameter to `streamText`/`generateText` that maps to provider-native effort. We could use this instead of `providerOptions`. However, since we're on AI SDK 6.x (locked per AG1 decision), we'll use `providerOptions` for now and upgrade to the standardized option when we migrate to SDK 7.
- **Preserved thinking (`clear_thinking`).** Z.AI supports `clear_thinking: false` to preserve reasoning content across turns. This is an optimization for long coding sessions, not relevant to a learning tutor. Excluded.
- **Interleaved thinking.** Z.AI's interleaved thinking (thinking between tool calls) is the default behavior and requires no configuration. Excluded.
