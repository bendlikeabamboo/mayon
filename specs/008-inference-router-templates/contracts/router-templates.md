# Contract: Router Template Catalog & Tool Capability

**Feature**: specs/008-inference-router-templates
**Date**: 2026-08-22
**Consumers**: Settings "Add provider" UI, model picker/discovery flow, agent tool-capability resolver.

This feature's externally observable surface is catalog data consumed through existing
interfaces, plus the keyless-setup behavior for one entry. No new endpoints, events, or
wire formats are introduced.

## 1. Catalog contract — `PROVIDER_TEMPLATES` (`src/lib/ai/registry.ts`)

The Settings Add-provider picker lists `PROVIDER_TEMPLATES` **in array order**,
rendering `label` + `description`. Selecting an entry prefills `kind`, `baseUrl`,
`defaultModel`, and `models`; the picker prompts for an API key **iff** `requiresKey`
(and stores it in the keychain, never in provider config).

Guarantees after this feature:

- The catalog's first eleven entries are, in order: DeepSeek, xAI (Grok), Moonshot
  Kimi, Qwen (DashScope), Groq, Mistral (feature 007), **OpenCode Zen, LiteLLM
  (self-hosted), Vercel AI Gateway, Requesty** (this feature), Z.AI (GLM) — followed by
  the remaining previous entries (Kilo Gateway, OpenRouter, OpenAI, Anthropic, Gemini,
  Ollama) unchanged.
- `labels` remain unique and stable (`findTemplate(label)` is the lookup key).
- Each new entry's concrete field values are pinned in
  [data-model.md](../data-model.md) (base URLs) with fallback model lists snapshotted
  at implementation (D5).
- Every new entry declares `kind: 'openai-compatible'`, `toolCapability: 'auto'`,
  `discoverable: true`. OpenCode Zen, Vercel AI Gateway, and Requesty declare
  `requiresKey: true`; **LiteLLM (self-hosted) declares `requiresKey: false`** — the
  Add provider flow completes without prompting for a key, and a key saved later
  upgrades the connection through the existing provider key UI.

## 2. Tool-capability contract — `resolveToolCapability` (`src/lib/agent/capability.ts`)

For a provider config with `kind: 'openai-compatible'` and `toolCapability: 'auto'`
(the seeded default), tool calling resolves **on** when the config's `baseUrl`
(trailing slashes stripped) is a member of `KNOWN_GATEWAY_BASEURLS`. After this
feature the set includes the four new router base URLs **plus** the variant spellings
`https://opencode.ai/zen/go/v1`, `http://localhost:4000/v1`, and
`https://router.eu.requesty.ai/v1` (full list in [data-model.md](../data-model.md)).

Guarantees:

- Tools default on for all four routers, including after the user edits the base URL
  to a covered variant (spec FR-004) or the equivalent `/v1` spelling of the local
  gateway.
- Unknown base URLs continue to resolve tools **off** (unchanged default for custom
  OpenAI-compatible providers).
- Explicit `toolCapability: 'on' | 'off'` and the session safety-net continue to
  override the auto default (unchanged).

## 3. Discovery contract (existing, generic — restated for the four)

For templates with `discoverable: true`, the model picker fetches
`GET <baseUrl>/models` with the keychain `Authorization: Bearer` header **only when a
key is configured** (public catalogs — Zen pre-key, an open LiteLLM proxy — fetch
anonymously), and replaces the shipped fallback list on success. The embedding-type
exclusion applied to the parsed result is specified in
[discovery-filtering.md](./discovery-filtering.md). Failure paths are unchanged:
fallback list stays, error surfaces through the existing discovery UX. For LiteLLM the
listing returns exactly the model aliases the user configured on their own gateway.

## 4. Transport/auth contract (existing, generic — unchanged)

Requests use the OpenAI wire format via the existing adapter; keys attach through the
keychain fetch shim; CORS-blocked routers stream through `POST /api/llm/proxy` when the
server is connected (LiteLLM disables browser cross-origin access by default, so it
typically uses the proxy path). The local-gateway address caveat for containerized
deployments is documented in the README (user-editable base URL), not auto-detected.
No per-router branches exist in this layer, and none may be added for these four
(spec SC-006).
