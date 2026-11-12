# Contract — LLM relay (`POST /api/llm/proxy`) after 032

Consumer(s): the browser's `createProxyFetch` (`src/lib/services/llm-proxy-fetch.ts`) — the
only sender. Changes are backward-compatible per-field; the client and server ship version-
locked in one release, so no compatibility window is required.

## Request

```json
POST /api/llm/proxy            (bodyLimit 16 MiB, auth-gated per server auth hook)
{
  "url": "https://api.provider.test/v1/chat/completions",
  "method": "POST",
  "headers": { "authorization": "Bearer sk-…", "content-type": "application/json" },
  "body": "{\"messages\":[]}",
  "authHost": "api.provider.test"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `url` | string | Required; must parse; `http:`/`https:` only (400 otherwise) — unchanged. |
| `method` | string | Default `GET` — unchanged. |
| `headers` | map | Forwarded **minus credential headers** unless the credential rule below passes. |
| `body` | string? | Optional request body — unchanged. |
| `authHost` | string? | NEW (032). Declares the host the credential headers target. Normalized compare against `url`'s hostname. |

## Credential-forwarding rule (NEW)

Let `target = normalizeHostname(url.hostname)` and
`declared = normalizeHostname(authHost)` when `authHost` is a non-empty string; otherwise
`declared = null`. The relay deletes `authorization`, `x-api-key`, `x-goog-api-key`
(case-insensitive) from `headers` **iff `declared === null || declared !== target`**. Stripping
is silent — the request still proceeds. Normalization: lowercase, strip trailing `.`, strip
IPv6 `[]`; ports never participate.

## Target-safety rule (NEW)

Before fetching, the relay validates the destination:

1. If `url.hostname` is an IP literal → validate the literal.
2. Else resolve via `dns.lookup(hostname, { all: true })` and validate **every** address.
3. Blocked classes (v4 & the v6 equivalents incl. IPv4-mapped): unspecified (`0.0.0.0/8`,
   `::`), loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`),
   CGNAT (`100.64.0.0/10`), link-local (`169.254/16`, `fe80::/10`), unique-local
   (`fc00::/7`), multicast (`224.0.0.0/4`, `ff00::/8`), reserved (`240.0.0.0/4`).

Responses:

| Outcome | Status | Body |
| --- | --- | --- |
| Any address in a blocked class | `403` | `{"error":"blocked target","detail":"<class>, e.g. loopback"}` — **no upstream fetch** |
| Hostname unresolvable / resolver error | `502` | `{"error":"upstream fetch failed","detail":"…"}` (fail-closed) |
| Upstream returns 3xx | `502` | `{"error":"upstream fetch failed","detail":"…"}` — redirects are **not followed** (`redirect: 'error'`) |

## Dev/test hostname exemption (merge fix, PR #79)

`MAYON_LLM_RELAY_ALLOW_HOSTS` (comma-separated exact hostnames, same
normalization as `authHost`) lets named hosts skip the IP-range check. The dev
compose file sets it to `mock-llm` — the e2e mock provider resolves to a
compose-network (private-range) address that the guard otherwise refuses with
`403 blocked target`, which breaks every relayed e2e flow (chat, discovery,
image materialization) and misclassifies in `testProviderConnection` as an
auth failure. Every prod artifact leaves the variable unset (strict deny). The
exemption skips only the IP-range check; the credential-forwarding rule above
still applies, and matching is exact-hostname (no wildcards, no subnets).

## Response streaming (amended)

Unchanged pass-through contract (status + filtered headers + `x-accel-buffering: no`, hop-by-hop
stripped) with one bound: if the streamed body exceeds `MAX_PROXY_RESPONSE_BYTES` (64 MiB) the
relay destroys the stream — the client observes a network error mid-body.

## Client-side seam contract (companion, not wire)

- `getLlmFetch(url, authHost?)` — same signature plus optional declared host; the value is
  copied verbatim into the proxy request body. Loopback targets keep going browser-direct
  (unchanged rule), and the credential gate below still applies to them.
- `createKeychainFetch({ header, scheme?, keyId, optionalKey?, authHost? })` / the streaming
  transport's `auth` — when `authHost` is set and the request URL's hostname does not match it,
  the credential is **not attached** and a missing key is **not** an error. `providerFetchFor`
  always supplies `authHost` from `config.baseUrl`.
