# Feature Specification: First-Class Inference Provider Templates

**Feature Branch**: `007-inference-provider-templates`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "I've done my research on supporting more providers/endpoints in research/003-inference-providers.md let's support these models."

## User Scenarios & Testing _(mandatory)_

Mayon users currently reach six high-usage inference providers only through the generic
"OpenAI-compatible" escape hatch: they must know the provider's endpoint address, paste
it manually, and understand tool-calling implications. This feature promotes DeepSeek,
xAI (Grok), Moonshot Kimi, Qwen/DashScope, Groq, and Mistral to one-click, first-class
provider entries — selected by usage evidence (research 003) so that ~20% of integration
effort covers ~80% of provider demand.

Each story is a standalone slice: any single provider promoted to first-class already
delivers value, and stories can be delivered/tested in any order (priority order is the
recommended order).

### User Story 1 - Add DeepSeek as a first-class provider (Priority: P1)

A user holding a DeepSeek API key opens Settings → Add provider, sees DeepSeek listed
alongside OpenAI/Anthropic/Google, picks it, pastes their key, and immediately chooses
between `deepseek-chat` and `deepseek-reasoner` from a live-fetched model list. Tool
calling is on by default. No endpoint address is typed, no documentation is consulted.

**Why this priority**: DeepSeek is the #1 model author by usage share (~17.6% weekly on
OpenRouter — more than Google and OpenAI combined) with the cheapest frontier-class
pricing; it is the single largest unblocked user group.

**Independent Test**: With a valid DeepSeek key, a user completes a chat (including a
tool-calling turn) against a DeepSeek model in under 2 minutes using only the Add
Provider dialog.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** DeepSeek
   appears as a first-class entry (not requiring "custom/OpenAI-compatible").
2. **Given** the DeepSeek entry selected and a valid key pasted, **When** the user
   proceeds, **Then** the live model list is fetched and `deepseek-chat` /
   `deepseek-reasoner` are selectable.
3. **Given** a configured DeepSeek provider, **When** the user sends a message in a chat
   with tools enabled, **Then** tool calls execute (tools default on, no hidden setting).
4. **Given** the browser cannot reach DeepSeek directly (CORS), **When** the Mayon server
   is connected, **Then** requests route through the existing proxy automatically with no
   extra user configuration.

---

### User Story 2 - Add xAI (Grok) as a first-class provider (Priority: P1)

Same one-click flow as above for xAI: pick Grok, paste key from the xAI console, choose
from the live model list (flagship plus a cheaper tier as fallback), tools on by default.

**Why this priority**: xAI is a top-3 usage author and has led weekly/monthly usage
windows; developers hold direct xAI keys.

**Independent Test**: With a valid xAI key, a user completes a chat against a Grok model
using only the Add Provider dialog, with tool calling working by default.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** xAI (Grok)
   appears as a first-class entry.
2. **Given** the xAI entry selected and a valid key pasted, **When** the user proceeds,
   **Then** the live model list is fetched (fallback list shows first if discovery is
   unavailable).
3. **Given** a configured xAI provider, **When** tools are used in a chat, **Then** tool
   calls execute by default.

---

### User Story 3 - Add Moonshot Kimi as a first-class provider (Priority: P1)

Same one-click flow for Moonshot Kimi, shipping the international endpoint by default. A
user in mainland China edits the endpoint address to the China variant after adding —
and everything (tool calling, discovery) keeps working.

**Why this priority**: Kimi K2/K3 are the most-used agentic open models after DeepSeek;
K3 (2026-07) is frontier-class with aggressive pricing and a coding-agent focus matching
Mayon's audience.

**Independent Test**: With a valid Kimi key, a user completes a chat against a Kimi model
using only the Add Provider dialog; switching the endpoint to the China variant and
re-testing still works with tools on.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Moonshot Kimi
   appears as a first-class entry with the international endpoint prefilled.
2. **Given** a configured Kimi provider, **When** the user edits the endpoint address to
   the China regional variant, **Then** chat, discovery, and tool calling continue to
   work with tools still defaulting on.

---

### User Story 4 - Add Qwen / Alibaba DashScope as a first-class provider (Priority: P2)

Same one-click flow for Qwen via DashScope's OpenAI-compatible interface, international
endpoint by default, China variant editable. If live model listing turns out to be
unavailable on the compatible interface, the entry ships a curated model list instead of
discovery.

**Why this priority**: Qwen is the largest open-source model family and `qwen3-coder` is
competitive for coding agents; high usage justifies the entry, the one open verification
question (model listing support) places it at P2.

**Independent Test**: With a valid DashScope key, a user completes a chat against a Qwen
model via the Add Provider dialog, with tools on by default.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Qwen
   (DashScope) appears as a first-class entry with the international endpoint prefilled.
2. **Given** the compatible interface does not expose a model listing, **When** the user
   proceeds, **Then** a curated fallback model list is offered and the flow completes
   without error.
3. **Given** a configured Qwen provider using a model that requires studio-side
   enablement, **When** the user sends a message, **Then** the provider's error is
   surfaced clearly to the user.

---

### User Story 5 - Add Groq as a first-class provider (Priority: P2)

Same one-click flow for Groq, whose free tier makes it the zero-cost way to start using
Mayon. Groq's hosted catalog rotates quickly, so live model discovery is the primary
mechanism and the curated fallback list is first-paint only. Groq is browser-friendly, so
it works even when the Mayon server is not connected.

**Why this priority**: Groq is the inference-speed specialist with a frictionless free
tier — the best onboarding path for new users — but its models are also reachable via
gateways Mayon already supports.

**Independent Test**: With a valid Groq key and no Mayon server connected, a user
completes a chat against a Groq-hosted model using only the Add Provider dialog.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Groq appears
   as a first-class entry.
2. **Given** no Mayon server is connected, **When** the user configures Groq and chats,
   **Then** it works via direct browser connection.
3. **Given** a model in the fallback list has been retired from Groq's catalog, **When**
   the user re-runs model discovery, **Then** the current catalog replaces the stale
   entry.

---

### User Story 6 - Add Mistral as a first-class provider (Priority: P2)

Same one-click flow for Mistral (La Plateforme): pick Mistral, paste key, choose from
the live model list (`mistral-large`, `magistral`, `devstral` and friends), tools on by
default.

**Why this priority**: Leading EU provider with strong small/mid models; EU data
residency appeals to self-hosters — Mayon's core audience.

**Independent Test**: With a valid Mistral key, a user completes a chat against a Mistral
model using only the Add Provider dialog, with tool calling working by default.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Mistral
   appears as a first-class entry.
2. **Given** the Mistral entry selected and a valid key pasted, **When** the user
   proceeds, **Then** the live model list is fetched and models are selectable.

---

### User Story 7 - Document the long tail of OpenAI-compatible providers (Priority: P3)

Users of providers beyond the six (LM Studio, Cerebras, Together, Fireworks, DeepInfra,
Hunyuan, MiniMax, NVIDIA NIM, …) learn from Mayon's documentation that these already
work today via Add provider → OpenAI-compatible with a custom endpoint address, without
dedicated templates.

**Why this priority**: Formalizes the Pareto boundary — everything else is deliberately
served by the generic path; documentation is cheap but not urgent.

**Independent Test**: The README provider list mentions the six new first-class
providers and explains the custom endpoint path for others.

**Acceptance Scenarios**:

1. **Given** the project README, **When** a reader checks the supported-provider list,
   **Then** DeepSeek, xAI, Moonshot Kimi, Qwen, Groq, and Mistral are listed.
2. **Given** the README, **When** a reader uses a Tier-2 provider, **Then** instructions
   for the "OpenAI-compatible + custom endpoint" path are available.

---

### Edge Cases

- **Discovery unavailable or network-blocked at setup** (any provider): the curated
  fallback model list is shown so setup always completes; discovery can be retried later.
- **Qwen compatible interface lacks a model listing**: entry ships with discovery off and
  a curated list (User Story 4, scenario 2).
- **Regional endpoint switch** (Kimi `.cn`, DashScope CN): after the user edits the
  endpoint address, tool calling must still default on for both regional variants.
- **CORS-blocked provider without a connected server**: existing behavior applies — the
  user is told the server proxy is needed; no new failure modes are introduced by these
  templates.
- **DeepSeek reasoning**: reasoning is selected by model choice (`deepseek-reasoner` vs
  `deepseek-chat`), not a toggle — the app's reasoning toggle must be inert (not error)
  for DeepSeek.
- **Catalog churn** (notably Groq): fallback models may be retired; picking one surfaces
  the provider's error and re-running discovery refreshes the list.
- **Invalid or insufficient-permission key**: existing key-validation error path applies
  unchanged.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST offer first-class provider entries — selectable in the Add
  provider flow with no manual endpoint entry — for DeepSeek, xAI (Grok), Moonshot Kimi,
  Qwen/DashScope, Groq, and Mistral.
- **FR-002**: Each entry MUST prefill the provider's correct endpoint address and
  default model, requiring the user to supply only an API key.
- **FR-003**: Each entry MUST present a small curated fallback model list (2–3 models)
  immediately, and MUST refresh it with the provider's live model listing where the
  provider supports one (DeepSeek, xAI, Kimi, Groq, Mistral; Qwen pending verification —
  if unsupported, curated list only).
- **FR-004**: Tool calling MUST be enabled by default for all six providers, including
  when the user edits the endpoint address to a regional variant (Kimi China, DashScope
  China).
- **FR-005**: Providers that block direct browser connections MUST work automatically
  through the existing server proxy when the server is connected, with no extra user
  configuration; browser-friendly providers (at minimum Groq) MUST continue to work with
  no server connected.
- **FR-006**: API keys for the new providers MUST be stored and transmitted through the
  existing keychain mechanism — never in synced settings data.
- **FR-007**: The provider entries MUST order sensibly within the Add provider menu by
  expected user demand (research priority: DeepSeek, xAI, Kimi ahead of existing generic
  entries; Qwen, Groq, Mistral following).
- **FR-008**: The documentation MUST list all six new first-class providers and MUST
  explain that other OpenAI-compatible providers work via the custom-endpoint path.
- **FR-009**: The system MUST NOT add templates, integrations, or special handling for
  enterprise clouds (Azure OpenAI, AWS Bedrock, Google Vertex) or search-grounded /
  embedding-centric APIs (Perplexity, Cohere) as part of this feature — these are
  explicit non-goals.

### Key Entities _(include if feature involves data)_

- **ProviderTemplate** (existing concept, six new instances): the catalog entry shown in
  the Add provider flow — display name, endpoint address, default model, fallback model
  list, whether a key is required, whether live model discovery is available, and tool
  capability. No new entity types are introduced; the six providers are new instances of
  the existing template entity.
- **Provider configuration** (existing): what a user creates from a template — handle
  fields only (endpoint address, selected model); the API key remains in the local
  keychain, never part of provider configuration.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For each of the six providers, a user with a valid API key gets from "Add
  provider" to a first completed chat in under 2 minutes without typing an endpoint
  address or consulting external documentation.
- **SC-002**: All six providers appear in the Add provider menu after this feature ships
  (verifiable by inspection of the menu).
- **SC-003**: For the five providers with confirmed live listing support, the model
  picker shows the provider's current catalog after discovery (no stale dead-end model
  lists).
- **SC-004**: Tool calling succeeds by default on all six providers, verified per
  provider with at least one tool-using conversation scenario.
- **SC-005**: All existing provider templates and conversations continue to work — no
  regressions (existing provider-related test suite passes unchanged).
- **SC-006**: The six providers are delivered entirely through the existing
  OpenAI-compatible template mechanism: no new bundled dependencies, no new transport or
  authentication code paths (verifiable by dependency and code review).

## Assumptions

- Provider facts (endpoint addresses, Bearer-key auth, live model listing support, tool
  support) are as verified in research 003 on 2026-08-22; the single open question is
  Qwen's model listing on the compatible interface, resolved at implementation time
  (FR-003 covers both outcomes).
- International endpoints are the default for Moonshot Kimi and Qwen/DashScope; users in
  mainland China edit the endpoint address to the regional variant (existing edit flow).
- Existing mechanisms are reused as-is: keychain auth, live model discovery, server CORS
  proxy fallback, and tool-capability resolution. No new auth flows or transports.
- Curated fallback model names reflect each provider's catalog at implementation time and
  may go stale; live discovery supersedes them by design.
- Tier-2 providers (LM Studio, Cerebras, Together, Fireworks, DeepInfra, Hunyuan,
  MiniMax, NVIDIA NIM) remain template-free, served by the generic OpenAI-compatible
  path; a template is added only on demonstrated user demand.
- Refreshing the stale fallback lists of existing templates is desirable but out of scope
  for this feature (tracked separately in research 003's checklist).
