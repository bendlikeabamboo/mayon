# Research — 032 secure-image-url-fetch

Phase 0 output. All code references below were re-verified against the worktree on 2026-11-10.
The issue's evidence was accurate; two minor line-drift corrections are noted in the map.

## Verified code map (attack path, end to end)

1. `src/lib/ai/dialects.ts:29-36` — `wireImageToCandidate` accepts any `https?://` URL from
   wire `delta.images[].image_url.url` as an `{ url }` candidate (issue said 31-37; the
   function spans 29-36 — same substance).
2. `src/lib/stores/chat.svelte.ts:592` — `fetchImpl = providerFetchFor(config)`; and
   `chat.svelte.ts:1028` — `fetchImageCandidate(c.url, c.mediaType, fetchImpl)` inside
   `composeAssistantParts`. Both exactly as reported.
3. `src/lib/ai/sdk-factory.ts:29-48` — `providerFetchFor` returns `createKeychainFetch` for
   `openai-compatible` (`Authorization: Bearer`), `anthropic` (`x-api-key`), `gemini`
   (`x-goog-api-key`); `ollama`/`github-copilot` return `undefined` → plain fetch (issue said
   29-44; switch body ends at 47/48 — same substance).
4. `src/lib/ai/sdk-fetch.ts:24-37` — `createBrowserKeychainFetch` attaches
   `headers.set(auth.header, …)` whenever a key is stored, with **no host check**, then sends
   through `getLlmFetch(url)`.
5. `src/lib/services/llm-proxy-fetch.ts` — `getLlmFetch(url)`: proxied via `createProxyFetch()`
   unless `isLoopbackUrl(url)` (`src/lib/ai/llm-target.ts:2-9`: `localhost`/`127.0.0.1`/`::1`
   only), which deliberately goes browser-direct (local runtimes are unreachable from the server
   container — this must be preserved).
6. `server/src/llm-proxy.ts:43-48` — `fetch(body.url, { headers: body.headers, … })` forwards
   headers verbatim: no host allowlist, default redirect-following, no response-size bound
   while piping (lines 66-81 hijack + pipe).

### Credential-header producers into the relay (complete inventory)

`rg getLlmFetch|createKeychainFetch|Authorization|x-api-key|x-goog-api-key` over `src/`:

| Producer | Credential | Intended target |
| --- | --- | --- |
| `src/lib/ai/sdk-fetch.ts` (keychain; used by `providerFetchFor` → SDK chat fetch and finalize images) | `Authorization` / `x-api-key` / `x-goog-api-key` | provider `baseUrl` — **but accepts any URL handed to it** (the bug) |
| `src/lib/ai/http-transport.ts:33-62` (`createFetchTransport.request`, `req.auth` descriptor) | any `req.auth.header` | `req.url` |
| `src/lib/ai/model-discovery.ts:126` (`req.auth = { Authorization, Bearer }`) and `:158` (inline Copilot `Authorization`) | `Authorization` | provider `baseUrl` / Copilot session endpoint host |
| `src/lib/ai/copilot-fetch.ts:25-49` | `Authorization: Bearer <session token>` + `COPILOT_HEADERS` | host of retargeted `session.endpoint` (or `baseUrl`) — always self-consistent |

`connection-test.ts` / `registry.ts` produce no credentials of their own (they ride the fetches
above). Telemetry/MCP paths never send credential headers through the relay.

### Existing test seams (how tests inject fetch / stub the network)

- Client fetch stubs: `src/lib/ai/sdk-fetch.test.ts` mocks `./keystore/client` + replaces
  `globalThis.fetch`, then inspects `(init as RequestInit).headers`; `src/lib/chat/images.test.ts`
  injects a stub `fetchImpl` returning `new Response(bytes)`; `src/lib/services/llm-proxy-fetch.test.ts`
  mocks `serverStatus` and asserts on the JSON body POSTed to `/api/llm/proxy`.
- Server: `server/src/llm-proxy.test.ts` builds `buildApp(':memory:')`, `vi.stubGlobal('fetch', …)`,
  and asserts via `app.inject`. New guard code must keep `node:dns` mockable (import as
  `import { promises as dnsPromises } from 'node:dns'` and call `dnsPromises.lookup(...)` so
  `vi.spyOn` works).

## Decisions

### R-1 Gate credentials at the attachment seams, not at call sites

**Decision**: Add an optional `authHost` to the credential-attachment seams —
`KeychainFetchAuth` (`sdk-fetch.ts`) and `HttpStreamRequest` (`http-transport.ts`) — and attach
the key only when the request URL's hostname matches it. `providerFetchFor` supplies
`authHost` = hostname of `config.baseUrl`. `chat.svelte.ts` and `images.ts`'s signature are
unchanged: the same `providerFetchFor(config)` fetch, fed a foreign-host URL, simply carries no
credential (and does not demand a missing key).

**Rationale**: Protects every current and future consumer of the keychain fetch (finalize
images today, anything model-supplied tomorrow) and covers both the relayed and the
browser-direct (loopback) path. A call-site fix in `chat.svelte.ts` would leave the trap armed.

**Alternatives considered**: (a) fetch-per-URL selection at the image call site (weaker — one
forgotten caller re-arms the leak); (b) a URL-allowlist wrapper inside `fetchImageCandidate`
only (same weakness); (c) rejecting foreign-host image URLs outright (breaks legitimate CDN
image delivery — public links need no credential anyway).

**Semantics when `authHost` is absent**: legacy behavior (attach unconditionally) so the
existing `sdk-fetch.test.ts` cases and any direct `createKeychainFetch` uses stay valid; every
production caller passes it via `providerFetchFor`/`http-transport`.

### R-2 Allowlist = exactly the provider API host, exact-match, normalized

**Decision**: Credential allowlist per provider = hostname of its configured `baseUrl`.
Comparison: case-insensitive, trailing dot stripped, IPv6 brackets stripped (via URL parsing),
ports ignored, **no** subdomain wildcarding. New helpers `normalizeHostname()` / `sameHost()`
in `src/lib/ai/llm-target.ts` (already the URL-host utility module) so client and tests share
one definition.

**Rationale**: The issue allows "provider baseUrl host **or** an explicit CDN allowlist";
CDN links are public and need no key, so the conservative default is the singleton allowlist.
Exact match prevents suffix tricks (`api.provider.example` ≠ `evil-provider.example`,
`cdn.provider.example` gets no key).

**Alternatives considered**: suffix/host-suffix matching (breaks containment: `notprovider.example`);
a per-provider configurable CDN host list (YAGNI now; the seam — a constant list per kind in
`sdk-factory.ts` — can be added without protocol changes when a real provider needs it).

### R-3 The relay learns the intended host: `LlmProxyRequest.authHost?`, strip on absent/mismatch

**Decision**: `packages/shared/src/protocol.ts` — `LlmProxyRequest` gains
`authHost?: string`. `createProxyFetch` includes it; `getLlmFetch(url, authHost?)` threads it.
The relay forwards `authorization` / `x-api-key` / `x-goog-api-key` only when
`normalizeHostname(body.authHost) === normalizeHostname(parsed.hostname)`; otherwise (including
absent) those headers are deleted before `fetch`. The strip is silent (per the issue's wording:
"strip", not "reject") — the request proceeds; a credential that was genuinely needed surfaces
as an upstream auth error.

**Rationale**: The server cannot know each user's provider hosts (they live in browser
`settings`), so the trusted client must declare the intended host; the server then verifies
the claim against the actual target. Fail-closed default (absent → strip) contains unknown or
future producers.

**Producer updates required** (all in-repo, version-locked, ship together):
`sdk-fetch.ts` (pass `auth.authHost`), `http-transport.ts` (pass `req.authHost`),
`copilot-fetch.ts` (declare host of its retargeted `target`), `model-discovery.ts`
(`authHost` = baseUrl host at `:126`-style calls; endpoint host for the inline Copilot call at
`:158`).

**Alternatives considered**: (a) moving credentials out of the generic header bag into a
dedicated `auth: {header, value}` field attached only on host match — larger client rework for
equal safety; (b) server-side per-session host cache — stateful, breaks multi-provider;
(c) client-only fix with no server enforcement — fails the issue's explicit proxy-hardening
requirement and leaves no defense-in-depth.

### R-4 SSRF guard: resolve-then-validate all addresses, 403 blocked, fail-closed on DNS errors

**Decision**: New `server/src/url-target-guard.ts`: a pure IP-classification function
(`blockedAddressKind(ip: string): string | null` — v4: `0.0.0.0/8`, `10/8`,
`100.64.0.0/10` (CGNAT), `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224.0.0.0/4`
(multicast), `240.0.0.0/4` (reserved); v6: `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`,
and IPv4-mapped `::ffff:0:0/96` recursed into the v4 table) plus an async
`assertPublicHttpTarget(url)` that: takes the URL's normalized hostname; if it is an IP literal
(`net.isIP` after bracket-strip) validates it directly; otherwise resolves via
`dnsPromises.lookup(hostname, { all: true })` and validates **every** returned address. The
relay answers blocked targets `403 {"error":"blocked target", "detail": "<kind>"}` with no
upstream fetch; DNS/resolution failures propagate as the existing `502 upstream fetch failed`
(fail-closed — an unresolvable host cannot be proven public). The spec's FR-005 list is the
MUST-set; multicast/reserved are additional fail-closed classes (spec allows refusing more).

**Rationale**: DNS-based validation is required — hostnames like `internal.corp` are the actual
SSRF vector; literal-only checks are cosmetic. `all: true` defeats multi-answer evasion (one
public + one private answer → blocked). WHATWG URL parsing already canonicalizes obfuscated
IPv4 forms (hex/octal/dword) into dotted literals.

**Alternatives considered**: (a) allowlist-only relay (only known provider hosts reachable) —
breaks model discovery of arbitrary custom providers and future image CDNs; (b) pinning the
connection to the validated IP (custom undici dispatcher with SNI/Host juggling) — out of
proportion; (c) blocking by hostname string patterns — trivially bypassed.

**Residual risk (documented, accepted)**: validate-then-connect TOCTOU / DNS rebinding — the
guard resolves once; undici's `fetch` resolves again. A attacker-controlled nameserver that
flips answers between the two resolutions can race the check. Accepted for this single-user,
self-hosted threat model (attacker = untrusted model output, not a rebind-capable adversary
controlling TTLs); recorded in the spec's Assumptions.

### R-5 Redirects are refused, not followed

**Decision**: The relay's upstream `fetch` gets `redirect: 'error'` — any 3xx throws → existing
502 path. (Node/undici already strips `Authorization` on cross-origin redirects, but custom
headers like `x-api-key`/`x-goog-api-key` **do** survive redirects; only refusal closes that.)

**Rationale**: No legitimate flow here relies on redirects (key-auth API endpoints don't
redirect; image CDNs that 302 to signed URLs degrade to the existing "image could not be
loaded" notice).

**Alternatives considered**: `redirect: 'manual'` + re-validating each hop server-side —
re-validation loop complexity for a case the product doesn't have today.

### R-6 Bounded transfers: 64 MiB relayed stream, 32 MiB image buffer

**Decision**: Relay: while piping the hijacked response, count bytes and destroy the stream
with an error past `MAX_PROXY_RESPONSE_BYTES = 64 MiB` (exported const; the client then sees a
network error, and `fetchImageCandidate` catches → notice). Client: `fetchImageCandidate`
replaces blind `res.arrayBuffer()` with a `res.body.getReader()` loop accumulating chunks and
bailing (`return null`) past `IMAGE_FETCH_MAX_BYTES = 32 MiB` (exported const; falls back to
`arrayBuffer()` + length check only if `res.body` is unavailable).

**Rationale**: The relay pipes (no server memory issue) but the *client* buffers — the issue's
"unbounded response … within the 15 s timeout" is exactly the client `arrayBuffer()`. 64 MiB
≫ any legitimate streamed reply (request-side ceiling is already 16 MiB at
`server/src/llm-proxy.ts:14`); 32 MiB generously covers any generated image (persisted rows
must fit the 16 MiB `/api/db/query` envelope anyway, and 030's output budget re-encodes).

**Alternatives considered**: cap only client-side (a malicious/robust server stream could keep
the pipe open indefinitely server-side); cap only server-side (direct loopback path bypasses
the relay entirely).

### R-7 No new dependencies

**Decision**: Hand-rolled IP parse + range table in `server/src/url-target-guard.ts`
(`ipv4ToLong`, BigInt-based v6 expansion; ~100 lines, fully unit-testable). No `ipaddr.js`, no
`private-ip`, no SSRF middleware package.

**Rationale**: Constitution IV bundle/dependency discipline; server-side-only dep would avoid
the SPA-bundle rule but adds supply-chain surface for logic this repo can own and test
exhaustively.

**Alternatives considered**: `ipaddr.js` (well-maintained, but an unnecessary dep for a fixed
range table); copying Node internals (not exported).

## Open items resolved here (no `[NEEDS CLARIFICATION]` existed)

All ambiguous choices were resolved with security-conservative defaults recorded in the spec's
Assumptions (CDN allowlist: none initially; caps 64/32 MiB; redirects refused; silent strip;
fail-closed DNS; TOCTOU accepted; loopback-direct preserved). See handoff Open questions for
the ones a human may want to revisit.
