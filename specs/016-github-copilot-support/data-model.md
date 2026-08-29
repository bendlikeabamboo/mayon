# Data Model: GitHub Copilot Support (016)

**Schema changes: none.** All persistence reuses existing stores; new entities are ephemeral (server memory, browser memory). Secrets stay out of `settings` per constitution.

## Entities

### ProviderConfig (existing — new kind semantics, no shape change)

`src/lib/ai/types.ts:95-118`. Stored under the `providers` settings key.

| Field | Value for `kind: 'github-copilot'` |
|---|---|
| `id` | uuid, minted at add time; also the KeyStore key |
| `kind` | `'github-copilot'` (new union member) |
| `baseUrl` | template default `https://api.githubcopilot.com`; used only as fallback when the session descriptor has no endpoint |
| `defaultModel` / `models` | template fallback snapshot; replaced by discovery results (D5) |
| `discoverable` | `true` |
| `toolCapability` | `'auto'` → resolves `true` (D6) |
| Secrets | **none** — the grant lives in the KeyStore, the session token in memory |

Validation rules: inherits template invariants pinned by `registry.test.ts:209-242` (https baseUrl, `defaultModel ∈ models`, unique label).

### KeyStore record (existing shape — new occupant)

`keystore/browser.ts`: `{ id: providerId, key: <GitHub grant 'ghu_…'> }` in IndexedDB store `providerKeys`. Written by the device-flow dialog on success (replaces the manual paste box); deleted by provider removal (FR-005). No TTL, no metadata — the server derives freshness from exchange responses.

### CopilotAuthFlow (new, server memory only)

State for one device-flow attempt; created by `POST /api/llm/copilot/auth/start`, resolved by `/auth/poll`, discarded on completion/expiry.

| Field | Notes |
|---|---|
| `flowId` | opaque random id returned to the browser |
| `deviceCode` | from GitHub, never leaves the server |
| `userCode`, `verificationUri` | shown to the user |
| `expiresAt` | GitHub `expires_in` (900 s) |
| `interval` | poll cadence (default 5 s; `slow_down` adds 5 s) |
| `status` | `pending → complete \| expired \| denied \| gone` |

Transitions: `pending` on every poll until GitHub returns `access_token` (→ `complete`, flow then dropped) / `expired_token` / `access_denied`; `gone` when the server restarted or the id is unknown.

### CopilotSession (new, cached on both sides, memory only)

Derived from one exchange: `GET api.github.com/copilot_internal/v2/token` → `{ token, expires_at, refresh_in, endpoints.api }`.

- **Server cache** (`server/src/copilot-auth.ts`): keyed by hash of the grant; entry `{ sessionToken, expiresAt, endpoint }`; eager refresh at `expiresAt − 120 s`; single-flight refresh per key.
- **Client cache** (`src/lib/ai/`, per provider id): `{ sessionToken, expiresAt, endpoint }`; re-fetched when stale; invalidated on exchange errors.

Lifecycle: cold start re-exchanges from the KeyStore grant — nothing persisted, so FR-007's "works days later" holds as long as the grant does.

### CopilotModel (derived, not stored)

From `GET <endpoint>/models`: keep `object === 'model'` && `capabilities.type === 'chat'` && `policy.state !== 'disabled'`; expose `id` (+ `name`, `vendor`, preview flag) into the existing discovery merge (`ProviderConfig.svelte:173-193`). Never persisted beyond the normal `models` list on `ProviderConfig` (which today's feature already persists for all providers).

## Relationships

- `ProviderConfig 1 — 1` KeyStore record (id join) — grant for the provider.
- `ProviderConfig 1 — *` ChatConversation (existing) — serving provider, unchanged.
- `CopilotAuthFlow * — 1` KeyStore record (outcome) — one flow's completion writes one grant.
- `CopilotSession * — 1` KeyStore record — minted from a grant; multiple caches may hold the same descriptor.

## State machines

**Provider auth state (UI, derived)**: `not-connected` (no KeyStore entry) → `connecting` (flow active) → `connected` (grant + session OK) ⇄ `needs-reconnect` (exchange 401) → `connected`; `error` (403 subscription / network) from any state. Rendered per FR-014.

**Session token**: `fresh` → `stale` (within 120 s of expiry) → re-exchange → `fresh`; exchange 401 → surface `needs-reconnect`; 403 → `error`.
