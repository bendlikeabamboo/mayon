# Research: GitHub Copilot Support (016)

**Date**: 2026-08-29 · Sources: codebase exploration (all file:line refs verified) + live web research on the 2026 Copilot platform surface, including measured CORS probes against `github.com`, `api.github.com`, and `api.githubcopilot.com`.

## D1 — Integration depth: new provider kind `github-copilot` (not a plain template)

**Decision**: Add a first-class `ProviderKind = 'github-copilot'`.

**Rationale**: The spec (FR-001/FR-002) requires account authorization without manual secrets, automatic renewal (FR-007), and provider-specific recovery states (FR-008). A template-only entry under `openai-compatible` can only serve static keys pasted by the user — exactly what the spec rejects. A new kind also gets: its own `providerOptions` namespace, its own tool-capability default, per-kind discovery auth, and per-kind error mapping.

**Alternatives considered**:
- *Template-only (`openai-compatible` + PAT)*: rejected — violates spec FR-002; no renewal story.
- *Template + hidden baseUrl-sniffing in the fetch seam*: rejected — invisible special-casing in a kind-agnostic seam; breaks when GitHub changes hosts.

**Touchpoint inventory** (complete list from code): `types.ts:12` (kind union), `sdk-factory.ts:25-64` (exhaustive switch), `dialects.ts:102-111` `KIND_BASELINES`, `:113-122` `KIND_DESCRIPTIONS`, `:44-66` `EXTRA_BODY_ALLOWLISTS` (exhaustive over non-openai-compatible kinds), `:381-392` `namespaceFor`, `agent/capability.ts:44-55` `defaultForKind`, `client.ts:74-76` `kindRequiresKey`, `registry.ts:47-243` template + `listProviderKinds`, `ProviderConfig.svelte` (kind label `:464`, key UI `:670-693`), `model-discovery.ts:41-46` (inline Bearer auth descriptor). DB is unaffected: agent traces persist `configKind` as a plain string (`chat.svelte.ts:602`).

## D2 — Auth architecture: server-side device flow, grant in browser KeyStore, server-side session minting

**Decision**:
- The GitHub **OAuth device flow runs on the server** (new module `server/src/copilot-auth.ts`), because `github.com/login/device/code` and `github.com/login/oauth/access_token` send **no CORS headers** (measured) — a browser SPA cannot read their responses. Server keeps per-flow state (device_code) in memory behind a flow id; the browser only ever sees `user_code` + `verification_uri`.
- The resulting **GitHub grant (`ghu_` token) is stored in the existing browser KeyStore** (IndexedDB, `keystore/browser.ts`) under the provider id — same store, same rule as every other provider secret (constitution: "no secrets in `settings`").
- The **short-lived Copilot session token is minted server-side** via `POST /api/llm/copilot/token`: server exchanges grant → session token (`GET api.github.com/copilot_internal/v2/token`), caches in memory keyed by grant hash, eagerly refreshes ~120 s before expiry (typical lifetime 1500–1800 s). The response `{token, expiresAt, endpoint}` goes back to the same-origin browser and lives only in an in-memory per-provider cache. Both secrets then ride the **existing same-origin `llm-proxy` envelope** exactly like all other provider keys today — no new secret-transport pattern.

**Rationale**: Matches the constitution's secret rule verbatim ("API keys live in IndexedDB and are sent only in same-origin proxied requests"); reuses the generic unauthenticated streaming proxy (`server/src/llm-proxy.ts`) and the capability detection already wired into both fetch seams (`sdk-fetch.ts:27`, `http-transport.ts:43`); no new `ServerCap` needed (routes sit under the `llm-proxy` concern, already in `BASE_CAPS`, `server/src/server.ts:29`).

**Alternatives considered**:
- *Browser-direct exchange + inference* (today `api.github.com`/`api.githubcopilot.com` return `ACAO: *`): rejected — undocumented CORS with no support commitment, and it would pin the whole feature to an accident.
- *Server-side grant storage*: rejected — introduces server accounts/state on disk; the KeyStore rule exists precisely to avoid this.
- *Official Copilot SDK / Extensions*: different product surface (build into Copilot, not use Copilot as a provider) — not applicable.

**ToS note (risk, accepted)**: `api.githubcopilot.com` is an undocumented IDE/CLI surface; there is no public third-party client program. The device-flow `client_id` used ecosystem-wide is the VS Code Copilot Chat id `Iv1.b507a08c87ecfe98` (scope `read:user`; no client_secret; exchange is client_id-gated — other ids get 404). Every OSS integration (copilot-api, nanobot, opencode, LiteLLM, hermes) uses this; GitHub tolerates it but has not formalized it. Mitigation: bake the client_id + header set in one constants module so a future official path is a one-file change.

## D3 — Serving: reuse `createOpenAICompatible` + custom session-aware fetch

**Decision**: The `github-copilot` branch of `buildSdkModel` uses `createOpenAICompatible` (AI SDK v7) with a Copilot-specific fetch wrapper that, per request:
1. reads the grant from the KeyStore (`MissingKeyError` if absent — pre-auth state),
2. obtains a fresh session descriptor from `/api/llm/copilot/token` (in-memory cache, 120 s early-refresh; on 401/403/404 from the exchange → typed auth errors, D5),
3. injects the mandatory header set: `Authorization: Bearer <session>`, `Copilot-Integration-Id: vscode-chat`, `Editor-Version: vscode/1.98.0`, `Editor-Plugin-Version: copilot-chat/0.35.0`, `User-Agent: GitHubCopilotChat/0.35.0`, `x-github-api-version: 2025-05-01` (400 without integration id; 403/"missing Editor-Version" without editor headers — ecosystem-measured),
4. targets `endpoint` from the exchange (`endpoints.api` is authoritative per plan; Business/Enterprise hosts come from there — suffix-match `*.githubcopilot.com` when deciding header scope), falling back to `config.baseUrl`,
5. delegates to `getLlmFetch()` so the existing proxy/direct decision, streaming, abort, and typed-error classification all apply unchanged.

**Rationale**: Wire surface is OpenAI Chat Completions + SSE; the AI SDK path gives tool calls, lab/quiz orchestration, and error mapping for free (generate orchestrators never switch on kind). Transparent renewal (FR-007) falls out of the per-request key-read design that already exists (`sdk-fetch.ts:21-23`).

**Alternatives considered**: hand-rolled SSE adapter — discarded; no benefit over AI SDK, loses dialect plumbing.

## D4 — Renewal, revocation, quota (FR-007/FR-008 mapping)

**Decision**:
- *Expiry*: server cache refreshes eagerly (120 s buffer, `expires_at`/`refresh_in` authoritative, 1500 s fallback); client refreshes its descriptor per request when stale.
- *Revoked/dead grant*: exchange returns **401** → new typed error `CopilotAuthRequiredError` → ProviderConfig UI shows the re-authorization state with one "Reconnect GitHub" action that reruns the device flow and overwrites the KeyStore entry (FR-008; conversation content untouched).
- *No subscription*: exchange **403** → `CopilotSubscriptionError` (clear message, no re-auth loop).
- *Quota*: inference **429** with `Retry-After` → map onto existing `RateLimitError` (constructor already takes `retryAfter`), surfacing the retry hint; known codes (`user_global_rate_limited:*`, `user_weekly_rate_limited`, `rate_limited`) render with their messages.

**Rationale**: These are the three observable failure families across reference implementations; mapping each to an existing or sibling typed error keeps chat-store handling unchanged.

## D5 — Models: session-authenticated discovery with policy filtering (FR-009/FR-011)

**Decision**:
- `GET /models` on the derived endpoint requires the **session token** (not the grant) plus the mandatory header set; `model-discovery.ts` gains a per-kind auth/header descriptor (today the inline descriptor at `:41-46` is Bearer-only) — for `github-copilot` it resolves the session descriptor first.
- Filter parsed entries: keep `object === 'model'` && `capabilities.type === 'chat'`; drop `policy.state === 'disabled'`; **do not** filter on `model_picker_enabled` (known 2026 regression reports false for working models). Merge discovered-first, preserve manual additions (existing `ProviderConfig.svelte:173-193` behavior).
- Pre-auth/discovery-failure → template fallback list (curated 2026-08 snapshot: GPT-5.x family, Claude Sonnet/Opus, Gemini Flash), satisfying FR-009.
- Missing selected model → existing invalid-model handling + a status hint pointing at the model picker (FR-011).

**Rationale**: Matches official client behavior (they hide `disabled`/`unconfigured`); policy-disabled invocation status is UNCERTAIN (400/403 family) — covered by the generic provider-error path and flagged as a spike in quickstart.

## D6 — Tool capability & dialect registration

**Decision**: `defaultForKind('github-copilot') → true` (catalog advertises `supports.tool_calls` broadly); template pins `toolCapability: 'auto'`. Register in the three exhaustive dialect structures mirroring `openai-compatible` semantics: `KIND_BASELINES` (same reasoning-fragment baseline), `KIND_DESCRIPTIONS` (no known sampling locks beyond the shared ones), `EXTRA_BODY_ALLOWLISTS` (minimal allowlist; empty set until a needed key is evidenced), `namespaceFor → 'github-copilot'`.

## D7 — UI: device-flow dialog replaces the paste box

**Decision**: `kindRequiresKey('github-copilot')` stays `true` (drives pre-flight and list badges) but `ProviderConfig.svelte` swaps the password input for a "Connect GitHub account" flow for this kind: button → dialog showing `user_code` + link (copy affordance) → poll `/auth/poll` at the server-given interval (honoring `slow_down`) → on success `setProviderKey(providerId, ghu_)` → status "Connected as <login>" where obtainable. States rendered: not-connected / connecting / connected / needs-reconnect / error (FR-014), light+dark via existing tokens. Removing the provider deletes the KeyStore entry (existing `remove()` path, `:338-371`) — FR-005 satisfied.

## D8 — No new dependencies, no DB changes

**Decision**: Device flow + exchange are hand-rolled `fetch` on the server (Fastify has no OAuth lib today; none added). No drizzle migration. Registry test pins (exact order `registry.test.ts:188-202`, length `:204-206`, https/invariants `:209-242`) are updated for the new template (length 17→18).

**Rationale**: Constitution gate — SPA bundle growth requires justification; adding zero client deps is the cheapest defensible position, and server code isn't bundle-sensitive.

## Open risks / spikes (carried into quickstart)

1. **client_id longevity** — exchange is client_id-gated and the allowlist is unofficial; if GitHub revokes tolerance the feature breaks at the exchange (404). Mitigation: single constants module; error mapping makes the failure legible.
2. **CORS flapping** on `api.github.com`/`api.githubcopilot.com` — irrelevant to this design (all traffic is server- or proxy-side); noted only to explain why browser-direct was rejected.
3. **Policy-disabled model invocation status** — UNCERTAIN (400/403 family); covered by generic provider errors; verify in quickstart if a restricted account is available.
4. **GHE Cloud (ghe.com) tenants** use different hosts for the whole dance (device flow + exchange + API). Out of scope v1; the endpoints-derived host design keeps the door open (documented, not built).
