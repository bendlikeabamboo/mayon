# Contract: Server Copilot Endpoints (016)

New same-origin endpoints on the server (Fastify), module `server/src/copilot-auth.ts`, registered alongside `registerLlmProxy` in `server/src/server.ts`. Shared request/response types are added to `packages/shared/src/protocol.ts` (the existing contract surface, home of `LlmProxyRequest`). Unauthenticated like the rest of the API (same-origin trust model — see `server/src/llm-proxy.ts`). Capabilities: covered by the existing `llm-proxy` cap in `BASE_CAPS`; no new `ServerCap`.

## Constants (server-owned, single module)

- OAuth client id: `Iv1.b507a08c87ecfe98` (ecosystem-standard; see research D2 risk note)
- Scope: `read:user`
- Endpoints: `POST https://github.com/login/device/code`, `POST https://github.com/login/oauth/access_token`, `GET https://api.github.com/copilot_internal/v2/token`
- Session refresh buffer: 120 s before `expires_at` (fallbacks: `refresh_in`, then 1500 s)

## POST /api/llm/copilot/auth/start

Begins a device-flow authorization. Creates a `CopilotAuthFlow`; the `device_code` never leaves the server.

**Request**: `{}`

**Response 200**:
```json
{
  "flowId": "string",
  "userCode": "XXXX-XXXX",
  "verificationUri": "https://github.com/login/device",
  "expiresAt": 1756473600,
  "interval": 5
}
```

**Errors**: `502` if GitHub is unreachable or the device-code request fails (`{ error: "upstream", message }`).

## POST /api/llm/copilot/auth/poll

Polls one flow. The server polls GitHub at most once per call (the browser drives cadence using `interval` / `slowDownAfter`).

**Request**: `{ "flowId": "string" }`

**Response 200** (one of):
```json
{ "status": "pending" }
{ "status": "pending", "slowDownAfter": 10 }
{ "status": "complete", "githubToken": "ghu_…", "user": { "login": "string" } }
{ "status": "expired" }
{ "status": "denied" }
```
- `slowDownAfter` present when GitHub said `slow_down` (new interval in seconds).
- `complete` is returned exactly once; the flow is dropped afterwards. `user.login` comes from the exchange response (`sku`/tracking fields are not exposed).
- The `githubToken` is the long-lived grant — the browser stores it in the KeyStore and never sends it anywhere except back to these same-origin endpoints and the token endpoint below.

**Errors**: `404 { error: "unknown_flow" }` (server restart or stale id); `400 { error: "bad_request" }` malformed body.

## POST /api/llm/copilot/token

Exchanges a grant for a short-lived session descriptor (cache + eager refresh server-side).

**Request**: `{ "githubToken": "ghu_…" }`

**Response 200**:
```json
{
  "token": "tid=…;exp=…;…",
  "expiresAt": 1756473600,
  "endpoint": "https://api.githubcopilot.com",
  "refreshInSeconds": 1500
}
```
- `endpoint` is authoritative for this account (Individual/Business/Enterprise hosts differ); clients must suffix-match `*.githubcopilot.com` before scoping Copilot headers.

**Errors** (map to the D4 error families):
| Upstream | Response | Client meaning |
|---|---|---|
| exchange 401 | `401 { error: "grant_invalid" }` | → `CopilotAuthRequiredError` (re-auth UI) |
| exchange 403 | `403 { error: "not_entitled" }` | → `CopilotSubscriptionError` |
| exchange 404 | `502 { error: "upstream", message }` | logged loudly; client-id/allowlist breakage (risk #1) |
| network/outage | `502 { error: "upstream", message }` | transient; retried next request |

## Streaming path (unchanged)

Chat/`/models` requests to `<endpoint>` continue through the **existing generic** `POST /api/llm/proxy` envelope (`{url, method, headers, body}` — `packages/shared/src/protocol.ts:45-50`). The Authorization header carries the **session token**, not the grant. No new streaming endpoint is introduced.

## Versioning / compatibility

Additive only: new protocol types, new routes, new `ProviderKind` union member. No existing request/response changes; older clients ignore the new kind (it only appears if the user adds the provider).
