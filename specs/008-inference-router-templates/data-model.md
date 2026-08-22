# Data Model: First-Class Inference Router Templates

**Feature**: specs/008-inference-router-templates
**Date**: 2026-08-22

This feature introduces **no new entity types, no schema changes, and no migrations**.
It adds four instances of the existing `ProviderTemplate` entity, extends one constant
set, and adds one optional field-awareness rule to the existing discovery parser. This
document records the instances and their validation rules for implementation.

## Entities

### ProviderTemplate (existing — `src/lib/ai/registry.ts`)

Compile-time catalog entry that prefills the Settings "Add provider" flow. Shape per
`registry.ts:20-41`:

| Field             | Type            | Role                                                         |
| ----------------- | --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `kind`            | `ProviderKind`  | Adapter family; all four use `'openai-compatible'`           |
| `label`           | `string`        | Picker display name; unique key for `findTemplate(label)`    |
| `description`     | `string`        | One-line picker subtitle                                     |
| `baseUrl`         | `string`        | Prefilled router endpoint (LiteLLM: local root spelling)     |
| `defaultModel`    | `string`        | Pre-selected model                                           |
| `models`          | `string[]`      | Fallback list shown before/without discovery (2–3 entries)   |
| `requiresKey`     | `boolean`       | Drives the keychain API-key prompt; `false` for LiteLLM only |
| `discoverable?`   | `boolean`       | Live `GET <baseUrl>/models` refresh available                |
| `toolCapability?` | `'auto' \| 'on' | 'off'`                                                       | Seed for the created config's tool default; `'auto'` for all four |

### New instances (four)

| label                 | baseUrl                           | defaultModel              | models (fallback, snapshot at impl — D5)          | requiresKey | discoverable |
| --------------------- | --------------------------------- | ------------------------- | ------------------------------------------------- | ----------- | ------------ |
| OpenCode Zen          | `https://opencode.ai/zen/v1`      | free-tier model (verify)  | free model + flagship (2 entries, verify)         | `true`      | `true`       |
| LiteLLM (self-hosted) | `http://localhost:4000`           | placeholder alias         | 2 generic placeholder aliases                     | **`false`** | `true`       |
| Vercel AI Gateway     | `https://ai-gateway.vercel.sh/v1` | current flagship (verify) | 2 chat IDs from live listing, embeddings excluded | `true`      | `true`       |
| Requesty              | `https://router.requesty.ai/v1`   | current flagship (verify) | 2 namespaced IDs from live listing                | `true`      | `true`       |

All four: `kind: 'openai-compatible'`, `toolCapability: 'auto'`. Ordering within
`PROVIDER_TEMPLATES`: the four above, in table order, inserted at positions 6–9 —
after the six feature-007 providers, ahead of Z.AI / Kilo Gateway / OpenRouter (D2).
Full 17-entry order pinned in research.md D2.

### ProviderConfig (existing — derived, not stored in registry)

Created when a user picks a template: `id`/`name` assigned, `kind`/`baseUrl`/
`defaultModel`/`models` copied from the template, `toolCapability: 'auto'` seeded. The
API key is **not** part of the config — it goes to the IndexedDB keychain (optional for
LiteLLM and never requested at setup). Editing `baseUrl` post-creation (Zen Go variant,
Requesty EU, LiteLLM `/v1` spelling) keeps the config valid; tool-defaulting for every
edited spelling is covered by the gateway set below.

### KNOWN_GATEWAY_BASEURLS (existing set — `src/lib/agent/capability.ts:3-17`, extended)

Seven additions (D4), taking the set from 13 to 20 entries:

```text
https://opencode.ai/zen/v1
https://opencode.ai/zen/go/v1
http://localhost:4000
http://localhost:4000/v1
https://ai-gateway.vercel.sh/v1
https://router.requesty.ai/v1
https://router.eu.requesty.ai/v1
```

Matching rule (unchanged): exact string after stripping trailing slashes.

### Model-list entry shape (discovery parser — `src/lib/ai/model-discovery.ts`)

The `/models` response shape gains optional type-awareness (FR-008 / D7): entries may
carry `type` alongside `id`. `parseModelIds` keeps entries whose `type` is absent or
any value other than `'embedding'`; entries with `type === 'embedding'` are excluded,
in both the `{ data: [...] }` shape and bare arrays. Applies to **every** discoverable
provider (generic seam), not just the new routers.

## Validation rules (→ tests)

From spec FR-001…FR-008; enforced by the modified `registry.test.ts`,
`capability.test.ts`, and `model-discovery.test.ts`:

1. **Catalog integrity (extended)**: every entry in `PROVIDER_TEMPLATES` has a unique
   `label`, non-empty `description`, a `defaultModel` that is a member of `models`, a
   `baseUrl` that is HTTPS **or** one of the two localhost entries
   (`http://localhost:11434/api` — Ollama; `http://localhost:4000` — LiteLLM), and
   `requiresKey: true` unless the label is Ollama's or LiteLLM's.
2. **New-entry shape**: the four new labels exist at positions 6–9 with
   `kind: 'openai-compatible'`, `toolCapability: 'auto'`, `models.length` in 2–3,
   `discoverable: true`, and `defaultModel` ∈ `models`; LiteLLM additionally asserts
   `requiresKey: false`; the other three assert `requiresKey: true`.
3. **Ordering**: the first eleven array positions are exactly
   `[DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, OpenCode Zen,
LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Z.AI (GLM)]`; total catalog
   length is 17 (FR-007 / D2).
4. **Tool capability**: `resolveToolCapability` returns `true` for
   `openai-compatible` configs with each of the seven base URLs above (incl. trailing-
   slash variants) and remains `false` for an unknown URL (regression guard).
5. **Discovery filtering**: `parseModelIds` excludes entries with
   `type: 'embedding'` in the `{ data }` shape and bare arrays; keeps entries with no
   `type` field and entries with other `type` values (e.g. `'chat'`, `'language'`);
   existing behaviors (dedupe, sort, unparseable → `[]`) unchanged.
6. **No secrets**: templates contain no key/token fields (structural — field list in
   the entity table; asserted via type shape as today).

## State transitions

None. Templates are immutable constants; the only stateful flow is the existing
template → ProviderConfig creation described above.
