# Data Model: Local-First Grouped Provider Picker

**Feature**: `021-local-provider-picker` | **Date**: 2026-09-06
Companion to [research.md](./research.md) (D1–D10) and [contracts/](./contracts/). All state lives in the existing `settings` KV (`providers` key) and in-memory view models; **no database schema change**.

## Entities

### `ProviderGroup` (new union type — `src/lib/ai/types.ts`)

```ts
type ProviderGroup = 'local' | 'cloud' | 'gateway' | 'custom';
```

Fixed four-value taxonomy (D2). Display order: `local`, `cloud`, `gateway`, `custom`. No user-defined groups; a value outside the union is treated as `custom` at render time.

### `ProviderTemplate` (extended — `src/lib/ai/registry.ts`)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `group` | `ProviderGroup` | **new, required** | Curated assignment (table below). Registry test asserts every template has one. |
| `toolCapability` | `'on' \| 'off'` | **narrowed** | Was `'auto' \| 'on' \| 'off'`; all templates now `'on'` (D8, Option C ruling). |
| `kind` | `ProviderKind` | unchanged | LM Studio/vLLM use `'openai-compatible'` (D3). |
| `label`, `description`, `baseUrl`, `defaultModel`, `models`, `requiresKey`, `discoverable?` | — | unchanged shape | LM Studio/vLLM: `requiresKey: false`, `discoverable: true`, `models: []`, `defaultModel: ''` (discovery-first; test invariant relaxed accordingly). |

**Template → group assignment** (20 entries):

| Group | Templates (registry order within group) |
|-------|------------------------------------------|
| `local` | Ollama (`kind: 'ollama'`), **LM Studio** (new), **vLLM** (new) |
| `cloud` | OpenAI, Anthropic (Claude), Google Gemini, GitHub Copilot, DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, Z.AI (GLM) |
| `gateway` | OpenCode Zen, LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Kilo Gateway, OpenRouter |
| `custom` | *(no built-in templates — user-defined endpoints land here)* |

### `ProviderConfig` (extended — `src/lib/ai/types.ts`)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `group` | `ProviderGroup` | **new, optional** | Copied from template at add. Effective group at read: `config.group ?? inferGroup(config) ?? 'custom'` (D1); matched value persists on next save. |
| `requiresKey` | `boolean` | **new, optional** | Copied from template at add. Effective value: `config.requiresKey ?? legacyKindDefault(kind)` where `legacyKindDefault = kind !== 'ollama'` (D4). |
| `toolCapability` | `'on' \| 'off'` | **narrowed at read** | Legacy `'auto'`/`undefined` normalized on read via the migration mapping below; explicit value written back on next save (D8). |
| `id`, `kind`, `name`, `baseUrl`, `defaultModel`, `models`, `discoverable?`, `vision?`, `requestDefaults?`, `extraBody?` | — | unchanged | Non-secret only; keys stay in IndexedDB `KeyStore`. |

### `ConnectionTestResult` (new — `src/lib/ai/connection-test.ts`)

```ts
type ConnectionFailureClass =
  | 'key-missing' | 'not-running' | 'cors-blocked' | 'insecure-blocked'
  | 'timeout' | 'auth' | 'not-found' | 'rate-limited' | 'http';

interface ConnectionTestResult {
  ok: boolean;
  models?: string[];                       // when ok
  failure?: {                              // when !ok
    class: ConnectionFailureClass;
    title: string;                         // short classification label
    message: string;                       // what happened, plain language
    hint?: string;                         // the coached remedy (per-runtime where known)
    status?: number;                       // HTTP status when applicable
    detail?: string;                       // truncated upstream body (≤500 chars), when applicable
  };
}
```

Shape mirrors `FormattedProviderError` (`{title, message, hint?}`) so the existing status-line rendering in `ProviderConfig.svelte` can display it unchanged.

### `TimeoutError` (new typed error — `src/lib/ai/types.ts`)

Joins `MissingKeyError`, `CorsBlockedError`, `NetworkError`, `RateLimitError`, `ProviderHttpError`, etc. Produced by `classifyFetchError` when the failure is a `DOMException` named `TimeoutError` (deadline expiry); user-initiated `AbortError` keeps its existing pass-through. `formatProviderError` maps it to coached copy (D6).

## Validation rules

- `group`: must be one of the four union values; unknown ⇒ `custom` (render-time fallback, never an error).
- `baseUrl`: non-empty `http(s)` URL (existing behavior; unchanged).
- `toolCapability`: after read-time normalization, only `'on' | 'off'`. Anything else (`'auto'`, `undefined`) is normalized before it reaches `resolveToolCapability` or the UI.
- `requiresKey`: absent ⇒ legacy kind default. Never persisted as secret material.
- Registry invariants (unit-tested): every template has a `group`; `toolCapability === 'on'`; discovery-first templates (`discoverable && group === 'local' && requiresKey === false`) may have `models: []` / `defaultModel: ''`; all other templates keep the existing "models contain defaultModel" invariant.

## Legacy normalization mapping (read-time, no schema migration)

Applied in `listProviders` (client) — pure function of the stored config (D8):

| Stored `toolCapability` | `kind` | Normalized to |
|---|---|---|
| `'on'` / `'off'` | any | unchanged |
| `'auto'` / absent | `anthropic` / `gemini` / `github-copilot` | `'on'` |
| `'auto'` / absent | `ollama` | `'off'` |
| `'auto'` / absent | `openai-compatible` | `'on'` iff `KNOWN_GATEWAY_BASEURLS.has(baseUrl w/o trailing slashes)`, else `'off'` |
| `'auto'` / absent | other/unknown | `'off'` |

The same read path fills `group` (template `kind`+`baseUrl` match → that group; else `custom`) — existing Ollama/OpenRouter/custom configs land in the right group without user action (FR-013).

## State transitions

```
ProviderTemplate ──add──▶ ProviderConfig ──activate──▶ active provider
        (group, requiresKey,        │  ▲
         toolCapability copied)     │  │ re-test / edit baseUrl / toggle tools
                                    ▼  │
                     ConnectionTest: {ok, models} → models merged into config
                                    │
                     failure → coached class (no state change; retryable)

Legacy config (first read after upgrade):
  toolCapability 'auto'/absent ──normalize──▶ explicit 'on'/'off' (prior behavior)
  group absent                 ──infer─────▶ 'local'|'cloud'|'gateway' (template match) | 'custom'
```

No transition mutates the stored record outside the existing save path; normalization becomes durable on the next user save (lazy write-back), which is sufficient for behavior (FR-013) and for the UI showing explicit values.

## Relationships

- `ProviderTemplate 1 ─▶ 0..n ProviderConfig` (each add instantiates; no stored link beyond `kind`+`baseUrl` used for inference).
- `ProviderConfig 1 ─▶ 1 endpoint configuration` (address, credential via `KeyStore`, tool assertion) — the spec's "Endpoint configuration" entity is these config fields, not a separate record.
- `ProviderConfig 1 ─▶ 0..n ConnectionTestResult` (ephemeral UI state; not persisted — the last result lives only in the settings view model).
