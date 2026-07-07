# Plan — M2: User-Defined MCP Servers (Browser HTTP · streamable-HTTP + SSE fallback)

> Status: implementation-ready. Authored 2026-07-07.
> Expands milestone **M2** of `refinement/2026-07-07_user-defined-mcp-servers-plan.md`
> into concrete, file-level tasks. **Read the design source first**
> (`refinement/2026-07-07_user-defined-mcp-servers.md`) — architecture, seams, security
> model, and locked decisions live there. This plan is the execution breakdown for the
> browser transport slice only; M3–M4 stay in the refinement doc.
>
> **Prerequisite:** **M1 is done.** This plan assumes M1's deliverables are merged and
> green: the `McpTransport` seam, `McpClient`, the registry mounter + risk mapping, the
> `repos.mcp` store, the keystore wrapper, trust hashing, the lifecycle orchestration, and
> the Settings MCP panel. M2 is a **transport swap + the one UI surface M1 stubbed** — it
> touches **no** agent-loop, registry, or mounter code.
>
> **Scope of THIS plan:** M2.1 → M2.3 (HTTP transport, runtime selection, the HTTP UI
> surface + CORS fallback). Ends with a remote streamable-HTTP MCP server's tools
> discoverable and callable from the **browser**, with a CORS-blocking server surfacing the
> "use the desktop app" notice instead of a raw error.

## Grounding (the patterns M2 copies — verify against these, don't reinvent)

M2 is almost entirely "do what the provider browser transport already does, but for MCP."
Verify each of these before writing new code — M2 should reuse, not reimplement.

- **The provider browser fetch transport (the template):** `createFetchTransport(store)`
  (`src/lib/ai/http-transport.ts:36-65`) — resolves a secret from a `BrowserKeyStore`
  into a request header, runs `fetch` with `cache:'no-store'`, and maps failures via the
  shared error helpers. `HttpMcpTransport` mirrors this posture exactly, but speaks
  JSON-RPC over the wire instead of a chat-completion body.
- **`BrowserKeyStore.get` (the secret-resolves-into-JS capability):** defined at
  `src/lib/ai/keystore/browser.ts:18-21`, impl `:110-117`. The browser has no secure
  enclave, so the key re-enters JS to set the header — this is the documented exposure
  posture M2 inherits verbatim (design doc §Security; plan M2.1).
- **Error mapping is shared and final — no new error type:** `classifyFetchError(err,
  url)` (`src/lib/ai/errors.ts:89-104`) maps a cross-origin `TypeError` →
  `CorsBlockedError` (`:97-99`); `httpStatusToError(res)` (`:122-140`) maps non-2xx →
  `ProviderHttpError` / `RateLimitError`. `formatProviderError(err)` (`:33-76`) renders
  `CorsBlockedError` → `{ title; message; hint: DESKTOP_FALLBACK_HINT }` (`:48-54`,
  `:26-27`). **M2 calls these directly; it does not define `CorsBlockedError` again.**
- **The fetch-transport test pattern (copy it):** `src/lib/ai/http-transport.test.ts` —
  `cannedResponse(body, init)` (`:18-23`), `collectStream` (`:26-41`), `makeFakeStore`
  (`:47-60`), and the cross-origin-`TypeError` → `CorsBlockedError` case
  (`:170-182`, which sets `g.location` so `isCrossOrigin()` treats the target as
  cross-origin). `http.test.ts` is this file adapted to JSON-RPC framing.
- **`McpTransport` interface M2 implements:** `src/lib/mcp/transport.ts:3-10` —
  `start() | request(method, params?) | notify?(...) | close() | onNotification?(...) |
  removeNotification?(...)`. `HttpMcpTransport` implements all six.
- **How the client drives the transport (do NOT re-handshake in `start()`):**
  `McpClient.initialize()` (`src/lib/mcp/client.ts:27-44`) calls `transport.start()` and
  *then* `transport.request('initialize', {...})`, overwriting `serverInfo` from the
  response (`:35-37`). So `HttpMcpTransport.start()` must **establish the session**
  (capture `Mcp-Session-Id`, open the notification stream) and return a placeholder
  `{ name: 'http-server', version: '0.0.0' }` — exactly as `StdioMcpTransport.start()`
  returns a dummy at `stdio.ts:35`. The real server info comes from `initialize`.
- **The stdio transport is the sibling reference — but its framing differs (watch this):**
  `StdioMcpTransport.request` (`stdio.ts:38-49`) sends `{ method, params }` **with no
  `jsonrpc` and no `id`** — Rust assigns the id. **HTTP cannot do this:** the wire is
  pure JSON-RPC, so `HttpMcpTransport.request` must build the full envelope
  `{ jsonrpc:'2.0', id, method, params }` with a client-owned monotonic `id` and match the
  response by `id` (streamable-HTTP may interleave notifications and responses on one SSE
  stream). This is the single biggest behavioral difference from the stdio transport.
- **The factory M2 extends (one branch added, nothing else):**
  `createMcpTransport(config)` (`src/lib/mcp/client-factory.ts:5-20`) currently handles
  stdio and throws `'HTTP transport lands in M2'` for everything else. M2.2 adds the
  `http` branch. `spawnAndMount` / `testConnection` (`lifecycle.ts:23-54`) are already
  transport-agnostic, so they need **no** change to carry HTTP except the small CORS-flag
  addition in M2.3.
- **`McpServerConfig` already has the HTTP fields:** `transport:'stdio'|'http'`
  (`types.ts:54`), `url?` (`:59`), `headers?: Record<string, { secretRef?; value? }>`
  (`:60`), `callTimeoutMs?` (`:64`), `resultCapBytes?` (`:65`). **No type changes in M2.**
  A header is either a literal `value` (no secret) or a `secretRef` (resolved at request
  time) — both must work.
- **Trust already covers HTTP:** `computeTrustHash` hashes `transport|command|args|url|cwd`
  (`trust.ts:4-8`) — `url` is already in the hashed set, so an HTTP server's trust badge
  already clears on URL change and re-prompts. **No trust.ts change in M2.**
- **Protocol version is already pinned:** `MCP_PROTOCOL_VERSION = '2025-06-18'`
  (`types.ts:1`) — sent by `McpClient.initialize` (`client.ts:30`). M2 reuses it; the
  streamable-HTTP transport is the 2025-06-18 transport.
- **The keystore wrapper M2 extends:** `setMcpSecret/hasMcpSecret/deleteMcpSecret/
  deleteServerSecrets` (`keystore.ts:7-21`) wrap `createKeyStore()`. They have **no `get`**
  because the generic `KeyStore` (`keystore/types.ts:10-17`) has none. HTTP header secrets
  must be readable → see the open question below.
- **The UI surface M2 un-stubs:** `McpServers.svelte` already renders an HTTP branch with
  a URL input (`:457-466`) and a runtime-agnostic **Test Connection** button that calls
  `testConnection` (`:204-218`). It manages **env vars only** (`:469-536`) — M2 adds a
  **headers editor** for HTTP servers (the env-editor pattern, copied). The "Custom HTTP"
  template (`templates.ts:52-61`) says "support lands in M2"; M2 drops that line.

## Hard rules (from AGENTS.md + design doc — non-negotiable)

- Components/stores call repositories only — MCP clients/transports are reached via the
  `lifecycle`/`client-factory` seam, never imported directly into UI code (the panel's one
  sanctioned transport touch is `testConnection`, already isolated in `lifecycle.ts`).
- **Secrets never enter `settings`.** HTTP header secrets live in the runtime `KeyStore`
  under `mcp:<serverId>:<name>` — the `providerKey:<id>` posture, copied exactly. The
  `McpServerConfig.headers` value holds only the *name* + `secretRef` handle, never the
  value.
- Browser exposure is documented and best-effort: a header `secretRef` is read back from
  IndexedDB into the `fetch` header at request time (same posture as the browser-provider
  flow). The trust banner states this plainly.
- **CORS failure → `CorsBlockedError` → `formatProviderError` → "use the desktop app"
  notice. No new error type.** Never surface a raw `TypeError` / stack trace.
- MCP tool errors resolve to `ToolResult { ok:false }`, never a raw throw into the loop
  (the M1 mounter already wraps this; M2 changes no mounter code).
- `pnpm lint && pnpm check && pnpm test` green after every sub-phase. The HTTP transport
  is pure JS/`fetch` and fully unit-testable with a `fetch` mock — **no** desktop/manual
  dependency for `pnpm test`. The primary manual acceptance gate is browser-only; a short
  desktop parity check is included (acceptance item 6) since the transport runs on both
  runtimes.
- After `pnpm db:generate` always run `pnpm bundle:migrations` — **N/A for M2** (no schema
  change; M2 adds no columns).

**Effort legend:** S ≈ 0.5–1 day · M ≈ 1–2 days · L ≈ 2–4 days.

## M2 design forks (resolved in the planning interview)

All three forks below were resolved during planning; they are recorded here so an
implementer understands the *why* behind each locked choice.

1. **HTTP header-secret resolution on desktop — RESOLVED: both runtimes, secrets
   browser-only.** The browser resolves header secrets via `BrowserKeyStore.get`
   (re-enters JS — documented, same as the provider flow). The desktop
   `DesktopKeyStore` has **no `get`** by P5 design ("plaintext never re-enters JS";
   `keystore/desktop.ts:1-8`). **Decision: `HttpMcpTransport` runs on BOTH runtimes**
   (honors the locked "both runtimes in v1" decision and the refinement M2.2 "either
   runtime" wording for the **transport surface**), with the secret resolver differing
   per runtime:
   - **Browser:** the factory injects `createBrowserKeyStore().get` — `secretRef` headers
     resolve normally (plaintext re-enters JS to set the header; documented in the trust
     banner). Literal-`value` headers pass through.
   - **Desktop:** the factory injects a resolver that **throws a clear error** when a
     `secretRef` header is actually used: *"MCP HTTP secret headers are browser-only in
     this build; use a stdio server or a literal header value on desktop."* Literal-`value`
     headers and no-auth servers **do work on desktop** — only `secretRef` headers fail
     loudly.
   - This is the lightest path that honors the locked decision: the transport is genuinely
     on both runtimes, M2 adds **no Rust** and changes **no** P5 security posture (desktop
     secrets stay out of JS; the desktop stdio path remains the secret-bearing story). The
     single limitation (no `secretRef` headers on desktop) is well-covered by stdio being
     the desktop story and is called out in the trust banner (M2.3b).
   - The injected-`secretResolver` seam (M2.1) keeps the transport byte-identical across
     runtimes, so upgrading later is a factory-only change. Future options if desktop
     secret-header demand materializes:
     - **(b) tiny desktop `key_get`.** A new trust-gated Rust `key_get(id) -> Result<String,
       String>` (modeled on `key_has` at `keys.rs:26-34`, which already calls
       `entry.get_password()`); the desktop resolver becomes `invoke('key_get')`. One
       documented, trust-gated P5 exception (plaintext returns to JS only for trusted MCP
       HTTP header secrets). Small Rust delta.
     - **(c) full Rust HTTP bridge.** Route desktop HTTP through a reqwest command that
       resolves headers from the keychain in Rust (mirror the provider
       `createTauriTransport`). Most secure; L-effort Rust; out of scope for M2.
   - **Both (b) and (c) are deferred** — M2 ships the both-runtimes / secrets-browser-only
     transport.

2. **Streamable-HTTP notification delivery — RESOLVED: piggyback on POST responses.**
   Server→client notifications (`notifications/tools/list_changed`) in streamable-HTTP
   arrive on the SSE stream of a POST response and/or a dedicated server-initiated GET
   stream (carrying `Mcp-Session-Id`). For M2's tool-only scope, the locked contract:
   **parse every SSE frame on each POST response** — deliver the frame whose `id` matches
   the pending request as the `request()` result, and forward any notification frames to
   the `onNotification` handler. Do **not** open a long-lived GET notification stream in
   M2 (needed only for unsolicited server pushes between requests; `tools/list_changed`
   reliably piggybacks on the next response). Known limitation: a server pushing
   `tools/list_changed` unsolicited *between* requests won't trigger a remount until the
   next call. The long-lived GET stream is an M3+ refinement when resources/prompts
   subscriptions land.

3. **Legacy SSE-transport fallback scope — RESOLVED: streamable-HTTP only, reject legacy
   loudly.** The 2024-11 / 2025-03 SSE transport uses a separate GET endpoint advertised
   via an initial `endpoint` event. **M2 targets streamable-HTTP (2025-06-18) only.**
   Feature-detect in `start()`/first response: if the `initialize` POST returns a non-SSE
   JSON body with a `result`, treat it as streamable-HTTP and proceed; if it fails in a way
   that looks like a legacy SSE server (e.g. the server demands a GET-first handshake),
   surface a clear `'legacy SSE MCP servers are not yet supported; use a streamable-HTTP
   (2025-06-18) server'` error rather than silently misbehaving. (**Note:** this narrows
   the refinement M2.1 wording of "SSE as a fallback" — full SSE fallback is deferred to
   M3+ so the negotiation is honest and M2 stays low-risk; flag the refinement doc for
   update.)

---

## M2.1 — `HttpMcpTransport` (M)

The centerpiece. Pure JS/`fetch`; fully unit-testable with a mocked `fetch`. Modeled on
`createFetchTransport` (`http-transport.ts:36-65`) + the fetch test
(`http-transport.test.ts`), speaking JSON-RPC.

### M2.1a — Transport skeleton + framing
- `src/lib/mcp/http.ts` (new) — `export class HttpMcpTransport implements McpTransport`:
  - Constructor takes `{ serverId; url; headers?: McpServerConfig['headers'];
    callTimeoutMs?; secretResolver: (keyId: string) => Promise<string | null> }`.
    `secretResolver` is **injected** (not imported) so the transport is runtime-agnostic
    and trivially testable — the factory supplies `createBrowserKeyStore().get` (M2.2).
  - Owns a monotonically-increasing JSON-RPC `id` (private `#nextId`), starting at 1. Every
    `request()` uses a fresh id. (Contrast stdio, where Rust owns the id — HTTP owns it in
    JS because the wire is pure JSON-RPC and responses arrive on a shared stream.)
  - Owns `#sessionId: string | null` (the `Mcp-Session-Id` header, captured in `start()`,
    echoed on every subsequent request per the 2025-06-18 spec).
  - Owns a single `#notificationHandler` (set by `onNotification`, cleared by
    `removeNotification`) — parallel to `StdioMcpTransport._notificationHandler`
    (`stdio.ts:10, 69-89`).
  - `async start(): Promise<McpServerInfo>`:
    - Validate `url` is an absolute `http(s)` URL (throw a clear `'MCP server URL is
      required'` otherwise — defense against the empty `Custom HTTP` template).
    - **Do NOT send `initialize` here** — the client does that via `request()` after
      `start()` resolves (`client.ts:27-44`). `start()` only validates the URL, primes the
      session, and returns `{ name: 'http-server', version: '0.0.0' }` (placeholder, like
      `stdio.ts:35`). The first `request('initialize', ...)` will capture the real
      `Mcp-Session-Id` from the response headers (see M2.1c).
  - `async close(): Promise<void>` — set a `#closed` flag; abort any in-flight fetch via
    the stored `AbortController`; clear the handler. HTTP has no persistent process to
    kill (unlike `mcp_close`), so this is mostly state cleanup.

### M2.1b — Header assembly (the secret-resolution seam)
- `private async buildHeaders(): Promise<Record<string, string>>`:
  - Start from `{ 'content-type': 'application/json', accept: 'application/json,
    text/event-stream' }` (the streamable-HTTP accept — lets the server pick JSON or SSE).
  - Echo `#sessionId` as `mcp-session-id` if set.
  - For each entry in `config.headers`:
    - `value` present → set the literal header value (no secret).
    - `secretRef` present → `const v = await secretResolver(secretRef)`; if `v == null`
      throw `new MissingKeyError(undefined, secretRef)` (reuse from `$lib/ai/types`, same
      as `http-transport.ts:42`); else set the header to `v`. **`fetch` must never be
      called when a referenced secret is missing** (mirror `http-transport.test.ts:106-117`).
  - This is the exact posture as `createFetchTransport`'s `auth` resolution
    (`http-transport.ts:40-44`), generalized to a header map. Plaintext re-enters JS to
    set the header — documented in the trust banner (M2.3).

### M2.1c — `request()` — JSON-RPC over streamable-HTTP
- `async request(method: string, params?: unknown): Promise<unknown>`:
  - Build the envelope `{ jsonrpc: '2.0', id: this.#nextId++, method, params: params ?? {} }`.
  - `const ac = new AbortController(); const t = setTimeout(() => ac.abort(),
    this.callTimeoutMs ?? 30000);` — the transport enforces its own per-call timeout on the
    fetch (the M1 mounter's outer `withTimeout` is the backstop; stdio enforces its timeout
    in Rust, HTTP enforces it here).
  - `let res: Response;` inside `try { res = await fetch(url, { method:'POST', headers:
    await buildHeaders(), body: JSON.stringify(envelope), signal: ac.signal, cache:
    'no-store' }) } catch (err) { throw classifyFetchError(err, url) } finally {
    clearTimeout(t) }` — `classifyFetchError` (`errors.ts:89-104`) maps cross-origin
    `TypeError` → `CorsBlockedError`, same-origin/offline → `NetworkError`, AbortError
    propagates. **No new error class.**
  - **Capture session id once:** if `!this.#sessionId`, read `res.headers.get('mcp-session-
    id')` and store it (the `initialize` response carries it; subsequent requests echo it).
  - `if (!res.ok) throw await httpStatusToError(res)` (`errors.ts:122-140`) — 429 →
    `RateLimitError`, else `ProviderHttpError` (body echoed).
  - **Branch on content type** (`private async readResponse(res, expectedId)`):
    - `application/json` (or any non-SSE): `const json = await res.json();` if `json.error`
      throw `new Error(json.error.message ?? JSON.stringify(json.error))` (parallel to
      `stdio.ts:45-47`); return `json.result`.
    - `text/event-stream`: parse SSE frames incrementally over `res.body.getReader()`
      (the `getReader()` + `TextDecoder` loop from `http-transport.test.ts:26-41` and
      `sdk-fetch.ts:65`). For each frame: parse the `data:` JSON; if it's a JSON-RPC
      **response** with `id === expectedId` → that's the result (capture, keep draining
      briefly for trailing notifications, then resolve); if it's a **notification** (no
      `id`, has `method`) → forward to `#notificationHandler?.({ method, params })`.
      Errors in a frame (`{ id, error }`) throw like the JSON branch.
  - Return the matched `result`. Never hang: the `AbortController` timeout guarantees the
    reader loop can't block forever.

### M2.1d — `notify()` + notification handlers
- `notify(method: string, params?: unknown): void` — fire-and-forget POST of
  `{ jsonrpc:'2.0', method, params }` (no `id`); `.catch(() => {})` (one-way, mirror
  `stdio.ts:51-59`).
- `onNotification(handler)` → store `#notificationHandler = handler`. `removeNotification`
  → clear it (mirror `stdio.ts:87-89`). Notifications arrive as SSE frames during
  `request()` (M2.1c) — see open question 2 for the no-long-lived-GET-stream M2 scope.

### M2.1e — SSE frame parser helper
- `src/lib/mcp/sse.ts` (new, small + pure + unit-tested) — `parseSseFrames(chunk: string):
  Array<{ data?: string }>`, splitting on `\n\n` boundaries and extracting `data:` lines
  (joining multi-line `data:` per the SSE spec), tolerant of `\r\n`. Exported so
  `http.test.ts` can test framing independently of `fetch`. (No dep — a ~20-line parser;
  the SSE shape MCP uses is simple and we control both ends of the test.)

### M2.1f — Tests
- `src/lib/mcp/http.test.ts` (new) — modeled on `http-transport.test.ts`. Mock
  `globalThis.fetch` (`vi.fn()`), inject a fake `secretResolver` (the `makeFakeStore`
  pattern at `:47-60`, reduced to a `Record<string,string>` → `get`). Cover:
  - `start()` rejects an empty/non-absolute URL; otherwise returns the placeholder info
    and does **not** call `fetch` (the client sends `initialize`).
  - `request('initialize', {...})` POSTs a full JSON-RPC envelope (`jsonrpc:'2.0'`,
    numeric `id`, `method`, `params`); a JSON response `{ result: {...}, ...headers
    'mcp-session-id': 'S1' }` is returned as `result` and the session id is captured.
  - The **next** `request()` echoes `mcp-session-id: S1` in its headers (assert on the
    `fetch` call init).
  - A JSON response with `{ error: { message } }` throws that message.
  - **SSE branch:** a response with `content-type: text/event-stream` and a body of two
    frames — a `tools/list_changed` notification then the matching response `result` —
    returns the result AND fires `onNotification` with the list_changed method (assert
    order-independence: notification may precede or follow the result frame).
  - `request('tools/call', ...)` round-trips arguments in the envelope `params`.
  - **Header resolution:** a `secretRef` header is resolved via the injected resolver and
    set; a literal `value` header passes through; a resolver that throws (the desktop
    posture) propagates as a clear error and `fetch` is **not** called; a browser resolver
    returning `null` → `MissingKeyError` and `fetch` is **not** called.
  - **CORS:** set `g.location` to a known origin (`http-transport.test.ts:170-182`),
    reject `fetch` with a `TypeError` → `request()` rejects with `CorsBlockedError`.
    Same-origin `TypeError` → `NetworkError`.
  - **Timeout:** `callTimeoutMs: 50` + a `fetch` that never resolves → `request()` rejects
    (AbortError surfaces; the mounter maps tool-call aborts to `ToolResult{ok:false}` —
    assert the abort, not the exact class, since `classifyFetchError` propagates
    AbortError).
  - `notify()` issues a POST with no `id`. `close()` aborts in-flight and clears the
    handler.
- `src/lib/mcp/sse.test.ts` (new) — `parseSseFrames` on `\n`, `\r\n`, multi-line `data:`,
    blank-line boundaries.

**DoD:** `HttpMcpTransport` fully unit-tested against a `fetch` mock + injected resolver;
no Rust, no real network. CORS/timeout/secret-missing all map to typed errors.
**Depends on:** nothing new (M1's `McpTransport` interface + the shared error helpers).

---

## M2.2 — Runtime selection (S)

- `src/lib/mcp/client-factory.ts` — replace the `throw new Error('HTTP transport lands in
  M2')` (`:19`) with the `http` branch. **The transport runs on both runtimes** (locked
  decision); only the secret resolver differs:
  ```ts
  if (config.transport === 'http') {
    if (!config.url) throw new Error('MCP server URL is required');
    const secretResolver: (keyId: string) => Promise<string | null> = isTauri()
      ? // Desktop: no KeyStore.get (P5 posture). secretRef headers fail loudly; literal
        // value headers and no-auth servers still work.
        async (_keyId) => {
          throw new Error(
            'MCP HTTP secret headers are browser-only in this build; use a stdio server or a literal header value on desktop.'
          );
        }
      : async (keyId) => createBrowserKeyStore().get(keyId);
    return new HttpMcpTransport({
      serverId: config.id,
      url: config.url,
      headers: config.headers,
      callTimeoutMs: config.callTimeoutMs,
      secretResolver
    });
  }
  ```
  - Import `createBrowserKeyStore` from `$lib/ai/keystore/browser` and `isTauri` from
    `$lib/db`. Keep the stdio branch untouched. `buildHeaders` (M2.1b) only invokes the
    resolver for `secretRef` entries, so literal-`value` headers bypass it on desktop.
  - This is the **only** runtime-selection logic; `spawnAndMount`/`testConnection`
    (`lifecycle.ts`) need no change to carry HTTP — they already call
    `createMcpTransport(config)`.
- `src/lib/mcp/client-factory.test.ts` (new) — `createMcpTransport({ transport:'http',
  url:'https://x/mcp', headers:{...} })` returns an `HttpMcpTransport` in **both** a
  browser env (`isTauri()` false) and a forced-Tauri env (the transport exists on desktop;
  the resolver difference is exercised in `http.test.ts`); a stdio config still returns
  `StdioMcpTransport`; a missing URL throws.

**DoD:** an HTTP `McpServerConfig` produces a working `HttpMcpTransport` in the browser;
`testConnection(httpConfig)` and `spawnAndMount(httpConfig)` run end-to-end through it with
no lifecycle edits.
**Depends on:** M2.1.

---

## M2.3 — HTTP UI surface + CORS fallback (S)

M1 shipped the HTTP branch as a URL-only stub and gated it behind "lands in M2". M2 makes
it real: a headers editor, the trust-banner header-name disclosure, the dropped template
caveat, and the CORS → "use the desktop app" notice.

### M2.3a — Headers editor (mirror the env-vars editor)
- `src/lib/components/mcp/McpServers.svelte` — in the **HTTP branch** (`{:else}` at
  `:457-466`, the URL label), add a **Headers** section modeled on the Environment
  Variables block (`:469-536`):
  - Per header row: name input + a **masked secret** field OR a **literal value** field
    (toggle), `Replace`/`Save` affordance (copy `saveEnvSecret`/`secretDrafts` verbatim),
    remove button. `headers: { [name]: { secretRef?: 'mcp:<id>:<name>' } | { value?:
    '...' } }`.
  - `addHeader(id)` / `removeHeader(id, name)` / `saveHeaderSecret(serverId, name, raw)` /
    `saveHeaderValue(serverId, name, raw)` — copy the env helpers (`:162-202`), writing
    `config.headers` via `updateServer` + `persist`. `saveHeaderSecret` calls
    `setMcpSecret(serverId, name, raw)` (the existing wrapper — header secrets use the same
    `mcp:<id>:<name>` key namespace as env secrets; no new keystore function).
  - Extend `secretFlags` (`:34`, loaded at `:61`) to also enumerate header secretRef
    names: `secretFlags[s.id] = [...Object.keys(s.env ?? {}), ...headerSecretNames(s)]`
    where `headerSecretNames` returns header names whose entry has a `secretRef`.
  - **Remove must wipe header secrets too:** `removeServer` (`:239-247`) currently calls
    `deleteServerSecrets(id, envNames)` — extend the names list with header secretRef
    names so removing an HTTP server clears its header secrets from the KeyStore.

### M2.3b — Trust-banner header disclosure + exposure note
- In the trust banner (`:596-631`), alongside the existing env-vars line (`:617-622`), add
  a **Headers:** line listing header *names* (never values) for HTTP servers. Add a short
  exposure note for HTTP: *"Header secrets are read into the browser to send each request
  (same as provider API keys in the browser). Use a stdio server on desktop to keep
  secrets out of the page."* This is the documented posture (design §Security; plan
  open-question 1).

### M2.3c — CORS → desktop-fallback notice
- `src/lib/mcp/lifecycle.ts` — extend `testConnection`'s error return to carry the CORS
  flag so the UI can render the right hint without string-matching:
  - Import `CorsBlockedError` from `$lib/ai/types` (the lifecycle layer is already the
    integration seam; this is the sanctioned coupling).
  - Change the catch (`:51-53`) to: `if (err instanceof CorsBlockedError) return { error:
    err.message, corsBlocked: true }; return { error: ... }`. Update the return type to
    `{ tools; serverInfo } | { error: string; corsBlocked?: boolean }`.
- `McpServers.svelte` — in `testServerConnection` (`:204-218`) and the result render
  (`:581-594`): when `result.corsBlocked`, render the `DESKTOP_FALLBACK_HINT` (import from
    `$lib/ai/errors`) as the hint, not the raw message. Reuse `formatProviderError(new
    CorsBlockedError())` if simpler — but since `testConnection` already classified it,
    just gate the hint copy on `corsBlocked`. **This is the M2 acceptance gate's "use the
    desktop app" notice.**
  - Note: a CORS failure during an actual **tool call** (not the test) surfaces through
    the M1 mounter's `run()` catch → `ToolResult { ok:false, summary }` and renders as a
    normal tool-error block. The explicit desktop-fallback notice is scoped to the
    **Test Connection** path (the gate's wording); the in-chat path is best-effort. Keep
    this scope explicit in the banner copy.

### M2.3d — Un-stub the template + import caveat
- `src/lib/mcp/templates.ts` — drop "HTTP transport support lands in M2" from the
  `Custom HTTP` description (`:55`); e.g. *"Add a custom HTTP MCP server (streamable-HTTP,
  2025-06-18) by specifying the URL and any headers."*
- `src/lib/mcp/import.ts` — the Claude Desktop importer only knows stdio (`command/args`).
  Add a clear error if a pasted config contains an HTTP-shaped entry (it won't in the
  Claude Desktop format, but guard anyway): unchanged behavior, just a documented
  limitation. (No real edit expected — verify and add a comment if needed.)

**DoD:** configure an HTTP server in the browser Settings panel → set a header secret →
**Trust** (banner shows header names + exposure note) → **Test Connection** discovers
tools; a CORS-blocking server shows the desktop-fallback hint; removing the server wipes
its header secrets.
**Depends on:** M2.1, M2.2.

---

## M2 — Acceptance gate (manual, browser)

1. `pnpm dev` → **Settings → MCP Servers → Add → Custom HTTP** → enter a streamable-HTTP
   MCP server URL (e.g. a remote `https://…/mcp` endpoint) → add a `secretRef` header
   (e.g. `Authorization`) → **Save** → **Trust** (banner shows the URL + header names +
   the "secrets read into the browser" note) → **Test Connection** → the server's tools
   are listed.
2. `/chat`: enable the HTTP server for the chat → ask the agent something that triggers a
   tool → the agent calls `mcp.<id>.<tool>` (readonly tools auto-run after trust; others
   hit the existing approval gate) → results render. **No per-call change vs M1** — the
   mounter/loop are untouched.
3. **Reload the tab** → the server config and the header secret survive (config in
   `settings` KV; secret in IndexedDB). The server reconnects on the next tool use.
4. **CORS fallback:** point the server URL at a known CORS-blocking endpoint → **Test
   Connection** surfaces the **"use the Mayon desktop app"** notice
   (`DESKTOP_FALLBACK_HINT`), not a raw `TypeError`/stack.
5. **Security check:** inspect IndexedDB (`mayon` → `providerKeys`) → the header secret is
   there under `mcp:<id>:<headerName>`; inspect the `settings` SQLite table → only the
   `headers` *names* + `secretRef` handles are present, **never** the value.
6. **Desktop parity regression:** `pnpm tauri dev` → the M1 Brave stdio gate still passes
   unchanged. An HTTP server with **no secret headers** (or literal-`value` headers)
   **works on desktop** too (transport is both-runtimes). An HTTP server with a `secretRef`
   header shows the clear "browser-only" error on Test Connection (locked decision:
   desktop keeps secrets out of JS; stdio remains the secret-bearing desktop story).

`pnpm lint && pnpm check && pnpm test` green. Re-run the existing P1 `/chat` streaming
gate and the M1 Brave gate — both unchanged with no MCP servers configured / with a stdio
server configured.

---

## Dependency graph + recommended sequence

```
M2.1 (http transport + sse parser + tests) ──→ M2.2 (factory http branch) ──→ M2.3 (UI + CORS)
```

- **M2.1** is independent of everything else in M2 (depends only on M1's interface + the
  shared error helpers). Start here; it's the bulk of the work and is fully CI-green on
  its own (pure JS + fetch mock).
- **M2.2** is a ~10-line factory extension + a tiny test; lands once M2.1's transport
  exists. At this point `testConnection(httpConfig)` already works end-to-end in the
  browser dev server (manual probe before the UI lands).
- **M2.3** is the UI/header-editor/CORS-notice layer; lands last. None of M2 touches
  `loop.ts`, `mount.ts`, `risk.ts`, `registry.ts`, or `schema.ts`.
- Land in order **M2.1 → M2.2 → M2.3**, keeping the tree green after each. The whole phase
  is `pnpm test`-covered (no manual/desktop dependency for CI).

## Risks (M2-specific)

- **Streamable-HTTP framing drift.** The 2025-06-18 transport is young; servers vary in
  whether they return JSON or SSE, whether they send `Mcp-Session-Id`, and whether they
  push notifications on the POST stream vs a GET stream. Mitigation: branch on
  `content-type` (M2.1c), feature-detect in `start()`/first response, and fail loudly on a
  legacy-SSE server (open question 3) rather than misbehaving. The injected resolver +
  `fetch` mock make the framing logic cheap to harden against real servers later.
- **No long-lived notification stream in M2.** `tools/list_changed` piggybacks on the next
  POST response (open question 2); a server that pushes it unsolicited between requests
  won't trigger a remount until the next call. Acceptable for the tool-only scope; flagged
  for M3 when subscriptions matter.
- **Browser secret exposure.** A `secretRef` header re-enters JS to be set (same as the
  browser-provider flow). Mitigation: documented in the trust banner (M2.3b); the desktop
  secret posture is preserved — `secretRef` headers throw on desktop (no `key_get`), and
  the desktop stdio path keeps secrets in Rust. Literal-`value` headers are non-secret and
  work on both runtimes.
- **CORS is fundamental, not fixable client-side.** Most public MCP HTTP endpoints won't
  send permissive CORS headers. Mitigation: the `CorsBlockedError` → desktop-fallback
  notice (M2.3c) is the honest UX; the desktop app is the real path for cross-origin
  servers (future Rust HTTP bridge, option (c)).
- **Header/secret namespace collision.** Env vars and headers share the `mcp:<id>:<name>`
  key namespace (an env var and a header with the same name would collide). Mitigation:
  acceptable — names are user-chosen and server-scoped; document that header/env names
  must be unique within a server. (A future `mcp:<id>:env:<name>` /
  `mcp:<id>:header:<name>` split is possible but not needed for v1.)
- **Timeout double-enforcement.** The transport aborts its own fetch at `callTimeoutMs`
  (M2.1c) and the M1 mounter races an outer `withTimeout`. They compose (first to fire
  wins); no deadlock. Documented so a future reader doesn't think it's a bug.

## Out of scope for M2 (defer)

- Desktop HTTP secret resolution / a Rust HTTP bridge (open-question 1 options b/c).
- Legacy SSE transport (2024-11 / 2025-03) full support (open-question 3) — M2 detects and
  rejects it clearly.
- A long-lived GET notification stream for unsolicited server pushes (open-question 2).
- Resources + Prompts surfaces (M3), sampling + elicitation (M4).
- `roots` (filesystem scoping); the lazy `search_mcp_tools` meta-tool.
- `docs/guide/mcp.qmd` HTTP walkthrough (fold in after the M2 gate passes; the Brave
  walkthrough lands after M1 per the cross-cutting table).
