# Phase 0 Research: First-Class Inference Provider Templates

**Feature**: specs/007-inference-provider-templates
**Date**: 2026-08-22
**Primary source**: [research/003-inference-providers.md](../../../research/003-inference-providers.md) (user-authored, dated 2026-08-22) — verified against current code (`src/lib/ai/registry.ts`, `src/lib/agent/capability.ts`, `src/lib/ai/model-discovery.ts`).

Technical Context contained no NEEDS CLARIFICATION markers; the unknowns below were
consolidated from the spec's assumptions and the research doc's "verify at
implementation" items. No subagent research was dispatched — research 003 already
answers every open question except three deliberately deferred verification steps
(D5/D6), which require live API calls at implementation time.

---

## D1 — Mechanism: existing `openai-compatible` kind, no new code paths

**Decision**: All six providers ship as `ProviderTemplate` entries with
`kind: 'openai-compatible'` in `PROVIDER_TEMPLATES` (`src/lib/ai/registry.ts`), served
by the existing adapter stack (`sdk-factory.ts`, `sdk-fetch.ts`, `model-discovery.ts`).

**Rationale**: Every shortlisted provider exposes an OpenAI-compatible Chat Completions
API with `Authorization: Bearer` auth (research 003 cross-reference table). The
openai-compatible kind + generic discovery + keychain auth + CORS proxy already absorb
all per-provider differences.

**Alternatives considered**: New provider kinds per vendor (effort L, new SDK packages —
rejected); using DeepSeek's/Kimi's Anthropic-wire endpoints (no benefit; would exercise
a different adapter for identical results); server-side credential plumbing (rejected —
wrong fit for a single-user self-hosted browser app, only needed for
Bedrock/Vertex-class auth which are out of scope).

## D2 — Catalog placement and ordering

**Decision**: Insert the six new templates at the **top** of `PROVIDER_TEMPLATES` in
usage order — DeepSeek, xAI (Grok), Moonshot Kimi, Qwen (DashScope), Groq, Mistral —
followed by the existing entries in their current order (Z.AI, Kilo Gateway, OpenRouter,
OpenAI, Anthropic, Gemini, Ollama). The Settings picker renders the array in order.

**Rationale**: Research 003 recommends "usage order, ahead of the existing
OpenAI/generic entries"; spec FR-007 requires demand-ordering with the P1 trio most
prominent. DeepSeek is the #1 usage author, so top placement is the honest ordering.

**Alternatives considered**: Appending after existing entries (buries the six
most-wanted templates — violates FR-007 intent); alphabetical or kind-grouped ordering
(no demand signal); a separate "new providers" section (UI change, violates the
no-new-UI constraint).

## D3 — Base URLs

**Decision**:

| Template       | Base URL (shipped)                                       | Regional variant (user-editable)                            |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| DeepSeek       | `https://api.deepseek.com`                               | — (a `/v1` suffix also works; see D4)                       |
| xAI (Grok)     | `https://api.x.ai/v1`                                    | —                                                           |
| Moonshot Kimi  | `https://api.moonshot.ai/v1`                             | `https://api.moonshot.cn/v1` (China)                        |
| Qwen DashScope | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://dashscope.aliyuncs.com/compatible-mode/v1` (China) |
| Groq           | `https://api.groq.com/openai/v1`                         | —                                                           |
| Mistral        | `https://api.mistral.ai/v1`                              | —                                                           |

**Rationale**: All verified in research 003 against provider docs; international
endpoints ship by default, mainland-China users edit the base URL post-creation
(existing edit flow — spec User Story 3, scenario 2).

**Alternatives considered**: Shipping regional selector UI (new UI surface, rejected);
shipping the `.cn` endpoints by default (wrong for the international default audience).

## D4 — Gateway set entries (`KNOWN_GATEWAY_BASEURLS`)

**Decision**: Add **9** URLs to the set in `src/lib/agent/capability.ts` (which
tool-defaults `openai-compatible` providers): the six shipped base URLs from D3, the
two regional variants (Kimi `.cn`, DashScope CN) per FR-004, **plus**
`https://api.deepseek.com/v1` as an alias because DeepSeek documents both forms as
valid and set-matching is exact-string (a user hand-editing the suffix would otherwise
silently lose tools-on-by-default).

**Rationale**: Research 003 implementation checklist item 2 (regional variants included
so tools default on regardless of region); DeepSeek alias is a one-line robustness
extension of the same rule.

**Alternatives considered**: Adding only the 8 canonical/regional URLs (leaves a
documented-valid DeepSeek URL variant tool-less for no reason); URL-prefix or
host-based matching (code change to the resolver — unnecessary for a static catalog).

## D5 — Fallback model lists and default models

**Decision**: Ship 2–3 fallback models per template, snapshotted **at implementation
time** from each provider's live `/models` (discovery supersedes the list anyway):

- **DeepSeek** (verified in research): `deepseek-chat`, `deepseek-reasoner`; default
  `deepseek-chat`. Reasoning is model-alias-driven — the app's reasoning toggle must be
  inert for DeepSeek, never an error (spec edge case).
- **xAI**: flagship `grok-4.6` + one cheaper tier (exact ID captured from
  `GET https://api.x.ai/v1/models` at implementation).
- **Kimi**: K3 flagship + one K2 tier (exact IDs from `GET /v1/models`).
- **Qwen**: `qwen3-coder` family + one general tier (from compatible-mode listing, or
  DashScope docs if D6 lands on `discoverable: false`).
- **Groq**: 2–3 IDs from the current hosted catalog (rotates quickly; list is
  first-paint only).
- **Mistral**: `mistral-large-latest` + `magistral`/`devstral` tier.

**Rationale**: Spec FR-003 (fallback immediately, discovery refreshes); research 003
notes discovery is the real mechanism for churning catalogs (Groq especially). Exact
IDs are deliberately not frozen into this plan because they go stale — the
implementation task includes the snapshot step.

**Alternatives considered**: Freezing guessed IDs into the plan now (risks shipping
dead models); shipping empty fallback lists (breaks first-paint before discovery —
FR-003 requires immediate availability).

## D6 — Qwen discovery verification (the one open check)

**Decision**: At implementation, probe `GET https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models`
with a Bearer key. If it returns a model list → `discoverable: true`. If not →
`discoverable: false` and a curated fallback list only. Spec FR-003 explicitly covers
both outcomes; no clarification needed.

**Rationale**: Research 003 marks this "verify at implementation" — it cannot be
resolved from documentation alone.

**Alternatives considered**: Assuming it works (risks a broken discovery spinner for
every Qwen user); assuming it fails (loses live catalog for a provider that likely
supports it).

## D7 — Auth, CORS, and the proxy

**Decision**: Zero per-provider code. `requiresKey: true` on all six; the existing
keychain fetch shim attaches `Authorization: Bearer`; CORS-blocked providers stream
through `POST /api/llm/proxy` automatically when the server is connected (same path as
Anthropic today). Groq is browser-friendly and must keep working with no server
(spec User Story 5).

**Rationale**: These mechanisms are generic and already shipped (research 003 "How
supporting a provider works today"); reusing them is the entire Pareto argument.

**Alternatives considered**: None — any per-provider auth/proxy code would contradict
SC-006.

## D8 — Documentation scope

**Decision**: Update the README provider-list line (currently "OpenAI, Anthropic,
Gemini, Ollama, OpenRouter, and more") to name all six new providers and keep the "and
more" pointer for the Tier-2 custom-endpoint path (spec User Story 7).

**Rationale**: Research 003 checklist item 4; spec FR-008.

**Alternatives considered**: A dedicated providers doc page (no existing docs-site slot
for it; README line matches current convention); templating Tier-2 providers
(explicitly rejected — spec FR-009 / research Tier 2).

## D9 — Out of scope, confirmed

**Decision**: No templates or special handling for Azure OpenAI, Bedrock, Vertex,
Perplexity, Cohere, or Tier-2 hosts; no refresh of existing stale fallback model lists
(`gpt-4o`, `claude-3.5-sonnet`, `gemini-1.5-flash`, …) — tracked as a separate cleanup
in research 003.

**Rationale**: Spec FR-009 and Assumptions; research 003 Tier 3 rationale
(auth/UX model mismatch) and Pareto boundary.

---

## Resolution summary

| Unknown from spec/plan       | Resolved by                                       |
| ---------------------------- | ------------------------------------------------- |
| Provider mechanism & effort  | D1 (S-effort, catalog-only)                       |
| Catalog order                | D2                                                |
| Base URLs incl. regional     | D3                                                |
| Tools-on-by-default coverage | D4 (9 gateway URLs)                               |
| Fallback/default models      | D5 (implementation-time snapshot)                 |
| Qwen `/models` availability  | D6 (probe at implementation; both outcomes valid) |
| Auth/CORS/proxy              | D7 (existing generic paths)                       |
| Docs                         | D8                                                |
| Non-goals                    | D9                                                |

## D6 resolution (implementation, 2026-08-22)

**Outcome**: `discoverable: false`. Alibaba Cloud's OpenAI-compatible documentation
(https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions) documents only
`POST /chat/completions` and `POST /responses` — no `GET /models` endpoint is listed.
Evidence: no `/models` route appears in the API reference navigation or page content.
Curated fallback list is used instead.

---

All NEEDS CLARIFICATION resolved — none remain in Technical Context or the spec.
