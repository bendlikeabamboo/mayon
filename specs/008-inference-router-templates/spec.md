# Feature Specification: First-Class Inference Router Templates

**Feature Branch**: `008-inference-router-templates`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "let's add these as well research/004-inference-routers.md"

## User Scenarios & Testing _(mandatory)_

Mayon already ships two inference routers — OpenRouter and Kilo Gateway — as first-class
entries. Research 004 (companion to research 003) shows four more routers that serve
audiences Mayon currently reaches only through the generic "OpenAI-compatible" escape
hatch: OpenCode Zen (curated coding-agent gateway with a free tier), a user's own
self-hosted LiteLLM gateway (which also unlocks enterprise-cloud models Mayon will never
integrate directly), Vercel AI Gateway (zero-markup hosted router), and Requesty
(routing-first gateway with an EU endpoint). This feature promotes those four to
one-click entries — selected by audience overlap and billing model so ~20% of integration
effort covers ~80% of router demand.

Each story is a standalone slice: any single router promoted to first-class already
delivers value, and stories can be delivered/tested in any order (priority order is the
recommended order).

### User Story 1 - Add OpenCode Zen as a first-class router (Priority: P1)

A user holding an OpenCode key opens Settings → Add provider, sees OpenCode Zen listed
alongside OpenRouter and Kilo Gateway, picks it, pastes their key, and immediately sees
the curated catalog (~50 models from OpenAI, Anthropic, Google, DeepSeek, xAI, Kimi,
Qwen, and others) fetched live. Tool calling is on by default. A user without any key can
still add the entry and browse free models to try Mayon at zero cost.

**Why this priority**: Zen is the default gateway of one of the most-used open coding
agents and is integrated across the coding-agent toolchain; its free tier is the
zero-cost onboarding path for Mayon's developer audience, and its curated catalog
matches how Mayon users pick models.

**Independent Test**: With a valid OpenCode key, a user completes a chat (including a
tool-calling turn) against a Zen-hosted model in under 2 minutes using only the Add
Provider dialog; without a key, a user can still add the entry and select a free model.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** OpenCode Zen
   appears as a first-class entry (not requiring "custom/OpenAI-compatible").
2. **Given** the Zen entry selected and a valid key pasted, **When** the user proceeds,
   **Then** the live model list is fetched and models are selectable.
3. **Given** no key is saved, **When** the user adds the Zen entry anyway, **Then** setup
   completes and free models remain usable without error.
4. **Given** a configured Zen provider, **When** the user sends a message in a chat with
   tools enabled, **Then** tool calls execute (tools default on, no hidden setting).
5. **Given** a Zen subscriber on the Go plan, **When** the user edits the entry's
   endpoint address to the Go variant, **Then** chat, discovery, and tool calling keep
   working with tools still defaulting on.

---

### User Story 2 - Add a self-hosted LiteLLM gateway as a first-class router (Priority: P1)

A user running their own LiteLLM gateway (one endpoint in front of many providers —
including enterprise clouds whose keys must stay on the user's own infrastructure) opens
Settings → Add provider, sees a LiteLLM entry, picks it, and is connected to their local
gateway. If their gateway requires no key, the flow completes without one — the first
key-required-optional hosted entry besides Ollama. The model list shown is exactly the
set of model names the user configured on their own gateway.

**Why this priority**: LiteLLM is the de-facto self-hosted gateway, and Mayon's audience
is self-hosters. It is also the sanctioned path to enterprise-cloud models (Azure,
Bedrock, Vertex): their credentials stay server-side in the user's own gateway, so Mayon
sees only the standard wire format — no new auth flows, ever.

**Independent Test**: With a local LiteLLM gateway running, a user completes a chat
against one of their configured models using only the Add Provider dialog, whether or
not their gateway enforces a key.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** a LiteLLM
   (self-hosted) entry appears with the standard local gateway address prefilled.
2. **Given** the user's gateway requires no key, **When** the user adds the entry,
   **Then** the flow completes without demanding an API key and without error.
3. **Given** the user's gateway enforces a master or virtual key, **When** the user
   pastes it, **Then** chat and model listing work as with any keyed provider.
4. **Given** a configured LiteLLM provider, **When** the user opens the model picker,
   **Then** it shows precisely the model names the user configured on their gateway
   (live listing is the catalog; the shipped fallback names are placeholders only).
5. **Given** a configured LiteLLM provider, **When** tools are used in a chat, **Then**
   tool calls pass through to the configured backend and tools default on.

---

### User Story 3 - Add Vercel AI Gateway as a first-class router (Priority: P2)

A user with a Vercel AI Gateway key opens Settings → Add provider, picks the Vercel AI
Gateway entry, pastes their key, and chooses from hundreds of models (OpenAI, Anthropic,
Google, xAI, Alibaba, and others) at zero markup. Only chat-capable models appear — the
gateway's catalog also lists non-chat models (embeddings), which must not pollute the
picker.

**Why this priority**: zero-markup hosted routing with provider failover, backed by the
AI SDK's own default gateway — a large existing-account base — but overlapping catalogs
are already reachable via the routers Mayon ships today.

**Independent Test**: With a valid gateway key, a user completes a chat against a
gateway-hosted model using only the Add Provider dialog, with tool calling working by
default.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Vercel AI
   Gateway appears as a first-class entry.
2. **Given** the entry selected and a valid key pasted, **When** the user proceeds,
   **Then** the live model list is fetched and models are selectable.
3. **Given** the fetched catalog contains non-chat (embedding) entries, **When** the
   model picker renders, **Then** those entries are excluded from the list.

---

### User Story 4 - Add Requesty as a first-class router (Priority: P2)

A user holding a Requesty key opens Settings → Add provider, picks the Requesty entry,
pastes their key, and chooses from its 600+ model catalog. A residency-minded user edits
the endpoint address to the EU variant — and everything (discovery, tool calling) keeps
working.

**Why this priority**: routing-first gateway popular in coding-agent configuration
circles, with free starting credits and an EU endpoint; the weakest audience overlap of
the four, hence P2.

**Independent Test**: With a valid Requesty key, a user completes a chat against a
Requesty-routed model using only the Add Provider dialog.

**Acceptance Scenarios**:

1. **Given** the Add provider dialog, **When** the user opens it, **Then** Requesty
   appears as a first-class entry.
2. **Given** the entry selected and a valid key pasted, **When** the user proceeds,
   **Then** the live model list is fetched and models are selectable.
3. **Given** a configured Requesty provider, **When** the user edits the endpoint
   address to the EU variant, **Then** chat, discovery, and tool calling continue to
   work with tools still defaulting on.

---

### User Story 5 - Keep non-chat models out of the model picker (Priority: P3)

Discovered catalogs from large routers contain entries that cannot be used for chat
(embedding-only models). A user browsing the model picker for any provider sees only
models they can actually converse with, regardless of how large or mixed the upstream
catalog is.

**Why this priority**: a small, universally beneficial polish item surfaced by the
Vercel catalog but applicable to any router; it protects picker quality as router
support grows, but its absence today is not blocking.

**Independent Test**: A model listing response containing entries explicitly marked as
embedding-type yields a picker list without them, for every discoverable provider.

**Acceptance Scenarios**:

1. **Given** any provider whose listing includes entries marked as embedding-type,
   **When** discovery completes, **Then** the picker list excludes those entries.
2. **Given** a listing with no type information, **When** discovery completes, **Then**
   all entries appear as today (no over-filtering of untyped catalogs).

---

### User Story 6 - Document the long tail of inference routers (Priority: P3)

Users of routers beyond the six (Chutes, NanoGPT, OpenCode Go, Cloudflare AI Gateway,
Helicone, Portkey) learn from Mayon's documentation that these already work today via
Add provider → OpenAI-compatible with a custom endpoint address. The documentation also
explains the address caveat for self-hosted gateways when Mayon itself runs in a
container, and notes that GitHub Models was retired and will not be added.

**Why this priority**: formalizes the Pareto boundary — everything else is deliberately
served by the generic path; documentation is cheap but not urgent.

**Independent Test**: The README provider list mentions the four new first-class routers
and explains the custom-endpoint path for others, including the self-hosted gateway
address caveat.

**Acceptance Scenarios**:

1. **Given** the project README, **When** a reader checks the supported-provider list,
   **Then** OpenCode Zen, LiteLLM, Vercel AI Gateway, and Requesty are listed.
2. **Given** the README, **When** a reader uses a Tier-2 router, **Then** instructions
   for the "OpenAI-compatible + custom endpoint" path are available.
3. **Given** the README, **When** a reader runs Mayon in a container next to a local
   gateway, **Then** the documented address guidance covers that topology.

---

### Edge Cases

- **LiteLLM gateway not running or unreachable at setup**: the existing connection-failure
  path applies — setup shows the network error, and the user can retry; no new failure
  modes are introduced by the template.
- **Self-hosted address inside a container**: when Mayon's server component runs in a
  container and proxies requests, the prefilled local-gateway address resolves inside
  the container, not on the host. The prefilled address stays the simple default;
  documentation explains the container-specific alternative (same preexisting caveat as
  the local Ollama entry).
- **Keyless flows**: OpenCode Zen (free models) and LiteLLM (optional auth) must both
  complete setup without a key and must not nag the user for one afterwards; entering a
  key later must upgrade the connection seamlessly.
- **Endpoint variants**: OpenCode Go and Requesty EU are supported through the existing
  edit-the-endpoint flow — tool calling must still default on for every variant.
- **Local gateway with or without trailing version path**: both address spellings must
  resolve to the same tool-calling default.
- **Catalog churn** (Zen deprecates models aggressively; Vercel/Requesty rotate): curated
  fallback names may be retired; picking one surfaces the provider's error and
  re-running discovery refreshes the list.
- **Huge catalogs**: 400+ entry listings render in the existing picker; picker
  search/cap UX improvements are out of scope (tracked in research 004).
- **Invalid or insufficient-permission key**: existing key-validation error path applies
  unchanged.
- **CORS-blocked router without a connected server**: existing behavior applies — the
  user is told the server proxy is needed; self-hosted LiteLLM disables browser
  cross-origin access by default, so it typically uses the proxy path.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST offer first-class router entries — selectable in the Add
  provider flow with no manual endpoint entry — for OpenCode Zen, LiteLLM (self-hosted),
  Vercel AI Gateway, and Requesty.
- **FR-002**: Each entry MUST prefill the router's correct endpoint address and a default
  model, requiring the user to supply only an API key — except LiteLLM, which MUST
  complete setup without a key when the user's gateway does not enforce one.
- **FR-003**: Each entry MUST present a small curated fallback model list (2–3 models)
  immediately, and MUST refresh it with the router's live model listing; for LiteLLM the
  live listing (the user's own configured names) is the real catalog and the fallback
  names are placeholders.
- **FR-004**: Tool calling MUST be enabled by default for all four routers, including
  when the user edits the endpoint address to a variant (OpenCode Go, Requesty EU) or a
  spelling variant (local gateway address with or without the version suffix).
- **FR-005**: Routers that block direct browser connections MUST work automatically
  through the existing server proxy when the server is connected, with no extra user
  configuration.
- **FR-006**: API keys for the new routers MUST be stored and transmitted through the
  existing keychain mechanism — never in synced settings data.
- **FR-007**: The router entries MUST order sensibly within the Add provider menu by
  expected user demand (research priority: Zen and LiteLLM ahead of existing gateway
  entries; Vercel and Requesty following), and existing OpenRouter / Kilo Gateway
  entries MUST remain.
- **FR-008**: Model discovery MUST exclude entries explicitly marked as non-chat
  (embedding-type) from the picker list, for all discoverable providers, without
  filtering catalogs that carry no type information.
- **FR-009**: The documentation MUST list all four new first-class routers, explain the
  custom-endpoint path for other routers, cover the self-hosted-gateway address caveat
  for containerized deployments, and MUST NOT reference retired offerings (GitHub
  Models).
- **FR-010**: The system MUST NOT add templates, integrations, or special handling for
  retired offerings (GitHub Models), smart-routing selection startups, platform-scoped
  inference policies, or direct enterprise-cloud integrations (Azure OpenAI, AWS
  Bedrock, Google Vertex) as part of this feature — these are explicit non-goals;
  enterprise-cloud models are reachable through the user's own self-hosted gateway.

### Key Entities _(include if feature involves data)_

- **ProviderTemplate** (existing concept, four new instances): the catalog entry shown
  in the Add provider flow — display name, endpoint address, default model, fallback
  model list, whether a key is required, whether live model discovery is available, and
  tool capability. No new entity types are introduced; the four routers are new
  instances of the existing template entity, and LiteLLM is the first hosted entry
  marked key-optional.
- **Provider configuration** (existing): what a user creates from a template — handle
  fields only (endpoint address, selected model); the API key remains in the local
  keychain, never part of provider configuration.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For each of the four routers, a user with a valid API key (or, for
  LiteLLM, a running gateway) gets from "Add provider" to a first completed chat in
  under 2 minutes without typing an endpoint address or consulting external
  documentation.
- **SC-002**: All four routers appear in the Add provider menu after this feature ships,
  and OpenRouter and Kilo Gateway remain (verifiable by inspection of the menu).
- **SC-003**: For the three hosted routers, the model picker shows the router's current
  catalog after discovery; for LiteLLM it shows exactly the user's configured model
  names (no stale dead-end model lists).
- **SC-004**: Tool calling succeeds by default on all four routers, verified per router
  with at least one tool-using conversation scenario, including one endpoint-variant
  edit per router family (OpenCode Go or Requesty EU).
- **SC-005**: All existing provider templates and conversations continue to work — no
  regressions (existing provider-related test suite passes unchanged).
- **SC-006**: The four routers are delivered entirely through the existing
  OpenAI-compatible template mechanism: no new bundled dependencies, no new transport or
  authentication code paths (verifiable by dependency and code review).
- **SC-007**: Model listings that mark entries as embedding-type produce picker lists
  without those entries, and untyped listings are unchanged (verifiable by inspection of
  discovery behavior).

## Assumptions

- Router facts (endpoint addresses, Bearer-key auth, live model listing support, tool
  support, CORS posture) are as verified in research 004 on 2026-08-22; endpoint
  addresses and variant spellings live there, not in this spec.
- Curated fallback model names reflect each router's catalog at implementation time and
  are verified against the live listing then; Zen's fallback list prefers free models.
  Fallbacks may go stale; live discovery supersedes them by design.
- The self-hosted entry assumes the common default gateway address and port; users with
  custom deployments edit the endpoint address (existing edit flow). The
  container-topology address caveat is documented (User Story 6), not auto-detected.
- Keyless operation means setup does not demand a key and free/anonymous access works;
  when a router rejects a keyless paid request, the provider's error is surfaced through
  the existing error path.
- Existing mechanisms are reused as-is: keychain auth, live model discovery, server CORS
  proxy fallback, and tool-capability resolution. No new auth flows or transports.
- Tier-2 routers (Chutes, NanoGPT, OpenCode Go, Cloudflare AI Gateway, Helicone,
  Portkey) remain template-free, served by the generic OpenAI-compatible path; a
  template is added only on demonstrated user demand.
- Refreshing the stale fallback lists of the existing OpenRouter / Kilo Gateway entries
  is desirable but out of scope for this feature (tracked separately in research 004's
  checklist), as are picker search/capacity UX improvements for very large catalogs.
