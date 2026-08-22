# Contract: Provider Template Catalog & Tool Capability

**Feature**: specs/007-inference-provider-templates
**Date**: 2026-08-22
**Consumers**: Settings "Add provider" UI, model picker/discovery flow, agent tool-capability resolver.

This feature's only externally observable surface is catalog data consumed through two
existing interfaces. No new endpoints, events, or wire formats are introduced.

## 1. Catalog contract — `PROVIDER_TEMPLATES` (`src/lib/ai/registry.ts`)

The Settings Add-provider picker lists `PROVIDER_TEMPLATES` **in array order**,
rendering `label` + `description`. Selecting an entry prefills `kind`, `baseUrl`,
`defaultModel`, and `models`; the picker prompts for an API key **iff** `requiresKey`
(and stores it in the keychain, never in provider config).

Guarantees after this feature:

- The catalog begins with the six new entries in this order: DeepSeek, xAI (Grok),
  Moonshot Kimi, Qwen (DashScope), Groq, Mistral — followed by the previous entries
  (Z.AI, Kilo Gateway, OpenRouter, OpenAI, Anthropic, Gemini, Ollama) unchanged.
- `labels` remain unique and stable (`findTemplate(label)` is the lookup key).
- Each new entry's concrete field values are pinned in
  [data-model.md](../data-model.md) (base URLs) with fallback model lists snapshotted
  at implementation (D5).
- Every new entry declares `kind: 'openai-compatible'`, `requiresKey: true`,
  `toolCapability: 'auto'`, `discoverable: true` — except Qwen, whose `discoverable`
  follows the D6 probe outcome (`false` + curated list if the compatible-mode `/models`
  endpoint is absent).

## 2. Tool-capability contract — `resolveToolCapability` (`src/lib/agent/capability.ts`)

For a provider config with `kind: 'openai-compatible'` and `toolCapability: 'auto'`
(the seeded default), tool calling resolves **on** when the config's `baseUrl`
(trailing slashes stripped) is a member of `KNOWN_GATEWAY_BASEURLS`. After this
feature the set includes the six new provider base URLs **plus** the regional variants
`https://api.moonshot.cn/v1`, `https://dashscope.aliyuncs.com/compatible-mode/v1`, and
the alias `https://api.deepseek.com/v1` (full list in
[data-model.md](../data-model.md)).

Guarantees:

- Tools default on for all six providers, including after the user edits the base URL
  to a covered regional variant (spec FR-004).
- Unknown base URLs continue to resolve tools **off** (unchanged default for custom
  OpenAI-compatible providers).
- Explicit `toolCapability: 'on' | 'off'` and the session safety-net continue to
  override the auto default (unchanged).

## 3. Discovery contract (existing, generic — restated for the six)

For templates with `discoverable: true`, the model picker fetches
`GET <baseUrl>/models` with the keychain `Authorization: Bearer` header and replaces
the shipped fallback list on success. Failure paths are unchanged: fallback list stays,
error surfaces through the existing discovery UX. Qwen with `discoverable: false`
(refer to contract §1) never fetches and always shows the curated list.

## 4. Transport/auth contract (existing, generic — unchanged)

Requests use the OpenAI wire format via the existing adapter; keys attach through the
keychain fetch shim; CORS-blocked providers stream through `POST /api/llm/proxy` when
the server is connected. Groq is expected to work with direct browser connections and
no server. No per-provider branches exist in this layer, and none may be added for
these six (spec SC-006).
