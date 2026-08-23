# Data Model: First-Class Inference Provider Templates

**Feature**: specs/007-inference-provider-templates
**Date**: 2026-08-22

This feature introduces **no new entity types, no schema changes, and no migrations**.
It adds six instances of the existing `ProviderTemplate` entity and extends one
constant set. This document records the instances and their validation rules for
implementation.

## Entities

### ProviderTemplate (existing — `src/lib/ai/registry.ts`)

Compile-time catalog entry that prefills the Settings "Add provider" flow. Shape per
`registry.ts:20-41`:

| Field             | Type                      | Role                                                             |
| ----------------- | ------------------------- | ---------------------------------------------------------------- |
| `kind`            | `ProviderKind`            | Adapter family; all six use `'openai-compatible'`                |
| `label`           | `string`                  | Picker display name; unique key for `findTemplate(label)`        |
| `description`     | `string`                  | One-line picker subtitle                                         |
| `baseUrl`         | `string`                  | Prefilled provider endpoint (international default)              |
| `defaultModel`    | `string`                  | Pre-selected model                                               |
| `models`          | `string[]`                | Fallback list shown before/without discovery (2–3 entries)       |
| `requiresKey`     | `boolean`                 | Drives the keychain API-key prompt; `true` for all six           |
| `discoverable?`   | `boolean`                 | Live `GET <baseUrl>/models` refresh available                    |
| `toolCapability?` | `'auto' \| 'on' \| 'off'` | Seed for the created config's tool default; `'auto'` for all six |

### New instances (six)

| label            | baseUrl                                                  | defaultModel           | models (fallback, snapshot at impl — D5)         | discoverable                  |
| ---------------- | -------------------------------------------------------- | ---------------------- | ------------------------------------------------ | ----------------------------- |
| DeepSeek         | `https://api.deepseek.com`                               | `deepseek-chat`        | `deepseek-chat`, `deepseek-reasoner` (verified)  | `true`                        |
| xAI (Grok)       | `https://api.x.ai/v1`                                    | `grok-4.6`             | flagship + cheaper tier (verify)                 | `true`                        |
| Moonshot Kimi    | `https://api.moonshot.ai/v1`                             | Kimi K3 flagship       | K3 + K2 tier (verify)                            | `true`                        |
| Qwen (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen3-coder`          | coder + general tier (verify)                    | `true` / `false` per D6 probe |
| Groq             | `https://api.groq.com/openai/v1`                         | current flagship       | 2–3 current catalog IDs (rotates)                | `true`                        |
| Mistral          | `https://api.mistral.ai/v1`                              | `mistral-large-latest` | `mistral-large-latest` + magistral/devstral tier | `true`                        |

All six: `kind: 'openai-compatible'`, `requiresKey: true`, `toolCapability: 'auto'`.
Ordering within `PROVIDER_TEMPLATES`: the six above, in table order, then existing
entries unchanged (D2).

### ProviderConfig (existing — derived, not stored in registry)

Created when a user picks a template: `id`/`name` assigned, `kind`/`baseUrl`/
`defaultModel`/`models` copied from the template, `toolCapability: 'auto'` seeded. The
API key is **not** part of the config — it goes to the IndexedDB keychain. Editing
`baseUrl` post-creation (e.g. Kimi `.cn`, DashScope CN) keeps the config valid;
tool-defaulting for the edited URL is covered by the gateway set below.

### KNOWN_GATEWAY_BASEURLS (existing set — `src/lib/agent/capability.ts:3-8`, extended)

Nine additions (D4):

```text
https://api.deepseek.com
https://api.deepseek.com/v1
https://api.x.ai/v1
https://api.moonshot.ai/v1
https://api.moonshot.cn/v1
https://dashscope-intl.aliyuncs.com/compatible-mode/v1
https://dashscope.aliyuncs.com/compatible-mode/v1
https://api.groq.com/openai/v1
https://api.mistral.ai/v1
```

Matching rule (unchanged): exact string after stripping trailing slashes.

## Validation rules (→ tests)

From spec FR-001…FR-007; enforced by the new `registry.test.ts` and extended
`capability.test.ts`:

1. **Catalog integrity**: every entry in `PROVIDER_TEMPLATES` has a unique `label`,
   non-empty `description`, an HTTPS `baseUrl` (Ollama's localhost exempt), a
   `defaultModel` that is a member of `models`, and `requiresKey: true` unless the
   label is Ollama's.
2. **New-entry shape**: the six new labels exist with `kind: 'openai-compatible'`,
   `requiresKey: true`, `toolCapability: 'auto'`, `models.length` in 2–3, and
   `discoverable: true` except Qwen which follows the D6 probe outcome (test pins
   whichever ships).
3. **Ordering**: the first seven array positions are exactly
   `[DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral, Z.AI (GLM)]`
   (FR-007 / D2).
4. **Tool capability**: `resolveToolCapability` returns `true` for
   `openai-compatible` configs with each of the nine base URLs above (incl. trailing-
   slash variants) and remains `false` for an unknown URL (regression guard).
5. **No secrets**: templates contain no key/token fields (structural — nothing to
   enforce beyond field list in rule 1, but asserted via type shape).

## State transitions

None. Templates are immutable constants; the only stateful flow is the existing
template → ProviderConfig creation described above.
