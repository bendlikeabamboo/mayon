# Plan — Phase 3: LLM CORS Proxy (sidecar)

> Status: implementation-ready. Authored 2026-07-12.
> Parent plan: `.kilo/plans/1783749811883-container-forward-web-transition.md` (Phase 3).
> Depends on: **Phase 1** (sidecar skeleton + `sidecarStatus` + `/api/health` caps + vite/nginx proxies + docker-compose) — **already landed**.

## Goal

When the sidecar is connected, CORS-blocked providers (e.g. **Anthropic**) stream from
the **browser** in `/chat`, `/lab`, `/quiz`, and the agent loop — without
`dangerous-direct-browser-access` hacks and with **no key regression**. When the sidecar
is absent, the app behaves exactly as today (direct browser fetch; Anthropic shows a
clear "run the sidecar" notice). This is the **P3** capability of the container-forward
transition.

## Current state (already in place — do not rebuild)

- Phases 0, 1, 2 are landed: Tauri removed; `pnpm-workspace.yaml` + `packages/shared`
  (`@mayon/shared`) + `sidecar/` (Fastify + `@fastify/websocket`); web-side
  `src/lib/sidecar/{client,detect,status.svelte}.ts`.
- `sidecar/src/server.ts` boots Fastify on `:4319`; `GET /api/health` currently returns
  `caps: ['stdio-mcp']` (only landed caps advertised — **P3 must add `'llm-proxy'`**).
- `sidecar/src/mcp.ts` is the `/ws/mcp` stdio bridge (opaque relay, kill-on-close).
- Web proxies already route to the sidecar **same-origin**: `vite.config.ts:44-47`
  (`/api` + `/ws`, `ws:true` for dev) and `docker/nginx.conf:8-18` (`/api/` + `/ws/`
  → `sidecar:4319`) in prod. **No new routing needed for `/api/llm/proxy`.**
- `docker-compose.yml`: `web` (host `:8080`) + `sidecar` (`expose: 4319`, **no host port**),
  `sidecar-data` volume.
- `packages/shared/src/protocol.ts:1` — `SidecarCap` already includes `'llm-proxy'`
  (no type change needed; only the request shape is added).
- Sidecar tests use `app.inject` (`sidecar/src/server.test.ts`); web AI tests mock
  `globalThis.fetch` and seed a fake keystore.

## Key correction vs. the parent plan (verified against code)

The parent plan's P3.2 says "route `getHttpTransport()` through the proxy". That is
**insufficient by itself**: in the real code, **`/chat` streaming does not go through
`getHttpTransport()`**. The actual chat fetch seam is `createKeychainFetch`
(`src/lib/ai/sdk-fetch.ts:11`), passed as the `fetch:` option to every AI SDK provider in
`src/lib/ai/sdk-factory.ts:27,42,51`. `getHttpTransport()`/`createFetchTransport()`
(`src/lib/ai/http-transport.ts`) is used **only** by model discovery
(`src/lib/ai/model-discovery.ts:48`, the `/models` GET).

→ **Both seams must ride the proxy**, or Anthropic in `/chat` would not be fixed (the
stated P3 goal). This is the central design point of this plan.

## Resolved decisions (from planning interview)

1. **Seam = both.** Introduce one proxy-fetch helper and route **both**
   `createKeychainFetch` (chat: Anthropic / Gemini / OpenAI-compatible) **and**
   `createFetchTransport` (model discovery) through it when the cap is present. Live cap
   check per request (read reactively off `sidecarStatus`). Ollama is excluded by
   construction (no custom `fetch` is built for it in `sdk-factory.ts:59-63`).
2. **Scope = always proxy when the cap is present.** When
   `sidecarStatus.has('llm-proxy')`, every request on those two seams goes through
   `/api/llm/proxy`. All real providers are cross-origin to the app anyway, so
   "cross-origin only" would collapse to "all"; one uniform path wins.
3. **Error mapping = transparent pass-through.** The sidecar forwards upstream
   `status` + selected headers + **streaming body verbatim**. The **browser keeps all**
   typed-error mapping (`httpStatusToError` / `classifyFetchError` already in
   `errors.ts`). The sidecar stays provider-semantics-free (mirrors the opaque MCP relay).
4. **CORS error copy.** Update the `CorsBlockedError` hint to the actionable sidecar
   one-liner **and** rename `DESKTOP_FALLBACK_HINT` → `SIDECAR_FALLBACK_HINT` (the old
   name is a misnomer now that there is no desktop shell). When the sidecar is present we
   proxy, so the provider URL is never fetched cross-origin → `CorsBlockedError` only
   fires when the sidecar is **absent**, so the hint is always apt (no conditional on
   status needed).
5. **nginx streaming (prod SSE).** Belt-and-suspenders, standard SSE-over-nginx fix:
   add `proxy_buffering off; proxy_cache off;` to the `/api/` location in
   `docker/nginx.conf` **and** have the sidecar set `X-Accel-Buffering: no` on the proxy
   response. (Vite dev proxy streams by default; no dev change needed.) Without this, SSE
   tokens buffer in docker prod and `/chat` appears to hang.

## Grounding (seams this plan reuses — verify, don't reinvent)

- **Chat fetch seam:** `createKeychainFetch` → `createBrowserKeychainFetch`
  (`src/lib/ai/sdk-fetch.ts:11,15`); inner `fetch(url, {...init, headers})` at `:26-30`.
- **Discovery fetch seam:** `createFetchTransport` (`src/lib/ai/http-transport.ts:30`);
  inner `fetch(req.url, {...})` at `:42-48`; cached singleton `getHttpTransport()` `:68`.
- **Reactive cap store:** `sidecarStatus.has(cap)` (`src/lib/sidecar/status.svelte.ts:23`).
- **Error mapping (browser-side, unchanged):** `httpStatusToError` / `classifyFetchError`
  (`src/lib/ai/errors.ts:121,88`) + `formatProviderError` + `DESKTOP_FALLBACK_HINT`
  (`errors.ts:32,25`).
- **Proxy plumbing (unchanged):** `vite.config.ts:44-47`, `docker/nginx.conf:8-18`,
  `docker-compose.yml`, `SidecarClient.http` (`src/lib/sidecar/client.ts:2`).

## Hard rules (from AGENTS.md — non-negotiable)

- Components/stores call repositories only — never transports/drivers. The proxy-fetch
  helper lives in the `sidecar` infra layer (imported by `ai/`); `ai/` → `sidecar/` is a
  one-way edge (no cycle: `sidecar/` does **not** import `ai/`).
- **No secrets in `settings`.** Auth is resolved in the browser into the header **before**
  the proxy call; the sidecar never touches the `KeyStore` and never persists secrets.
- **Never `sh -c`** in the sidecar — N/A here (no subprocess), but keep the spawn rule in
  mind; this phase only does `fetch`.
- After `pnpm db:generate` always `pnpm bundle:migrations` (no schema change in P3 — N/A).
- Validate every phase: `pnpm lint && pnpm check && pnpm test` (root) **and**
  `pnpm test` (sidecar) / `pnpm test:all`.

---

## Tasks (in order)

### P3.1 — Wire protocol: add `LlmProxyRequest` to shared
- `packages/shared/src/protocol.ts` — add:
  ```ts
  export interface LlmProxyRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string; // JSON string for chat/discovery; undefined for GET
  }
  ```
- `packages/shared/src/index.ts` — re-export `LlmProxyRequest`.
- No `LlmProxyResponse` type — the response is **raw pass-through bytes + status**
  (transparent, no envelope).

### P3.2 — Sidecar: streaming proxy route
- `sidecar/src/llm-proxy.ts` (new) — `registerLlmProxy(app: FastifyInstance)`:
  - `POST /api/llm/proxy` — parse body as `LlmProxyRequest`. Validate `url` (must be
    absolute `http(s):`; else 400).
  - Create an `AbortController`. Wire `req.raw.on('close', ...)` → `controller.abort()`
    so a client disconnect (or the browser's `Stop` button aborting the proxy fetch)
    aborts the upstream fetch.
  - `fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal,
    cache: 'no-store' })`. Redirects: **default follow** (opaque proxy; LLM APIs don't
    redirect meaningfully).
  - `reply.hijack()`; `reply.raw.writeHead(upstream.status, filteredHeaders)`; pipe the
    upstream web stream → Node stream:
    `Readable.fromWeb(upstream.body).pipe(reply.raw)` with an `on('error')` →
    `reply.raw.destroy()`.
  - **Hop-by-hop header filtering** (critical correctness): strip `content-encoding`
    (Node `fetch` already decompresses gzip; forwarding the header would corrupt the
    body), `content-length` (wrong for streaming), `transfer-encoding`, `connection`,
    `keep-alive`. Keep `content-type`, `retry-after`, etc.
  - Set `X-Accel-Buffering: no` on the response (nginx SSE hint — decision 5).
  - Upstream `fetch` throw / non-fetchable → `reply.raw` not yet written: write
    `writeHead(502, {'content-type':'application/json'})` + `{ error: 'upstream fetch
    failed', detail }`. (Browser maps the 502 via `httpStatusToError`; acceptable, rare.)
- `sidecar/src/server.ts` — `import { registerLlmProxy } from './llm-proxy'`; call
  `registerLlmProxy(fastify)` inside the registered scope (next to `registerMcpBridge`).

### P3.3 — Sidecar: advertise the cap (only landed caps)
- `sidecar/src/server.ts:16` — change `caps: ['stdio-mcp']` → `['stdio-mcp', 'llm-proxy']`.
- `sidecar/src/server.test.ts:22` — update the expected caps to
  `['stdio-mcp', 'llm-proxy']`.

### P3.4 — Web: shared proxy-fetch helper
- `src/lib/sidecar/llm-proxy-fetch.ts` (new) —
  - `createProxyFetch(): typeof globalThis.fetch` — returns a `fetch` that, given
    `(input, init)`, serializes `{ url, method: init?.method ?? 'GET', headers:
    Object.fromEntries(new Headers(init?.headers)), body: typeof init?.body === 'string'
    ? init.body : undefined }` and `POST`s it to `/api/llm/proxy` with
    `signal: init?.signal`, returning `new Response(proxyRes.body, { status:
    proxyRes.status, headers: proxyRes.headers })` (body stays a streaming
    `ReadableStream`). String-body only (LLM chat/discovery always send JSON strings).
  - `getLlmFetch(): typeof globalThis.fetch` — **live cap check per call**:
    `return sidecarStatus.has('llm-proxy') ? createProxyFetch() : globalThis.fetch`.
    (Reading `sidecarStatus.has(...)` synchronously in a fetch path is fine.)
  - Export a `__resetLlmFetchCache` (or none) — `createProxyFetch` builds a fresh fetch
    each call, so no caching to reset; the only "state" is `sidecarStatus`.

### P3.5 — Web: route both seams through the helper
- `src/lib/ai/sdk-fetch.ts` (`createBrowserKeychainFetch`, the chat seam) — replace the
  inner `fetch(url, {...init, headers, cache:'no-store'})` call (`:26-30`) with
  `getLlmFetch()(url, { ...init, headers, cache: 'no-store' })`. **Auth is resolved into
  `headers` first (unchanged) — then the (possibly proxied) fetch runs.** No key
  regression: the sidecar receives headers already containing the auth header; it never
  reads the `KeyStore`.
- `src/lib/ai/http-transport.ts` (`createFetchTransport`, the discovery seam) — replace
  the inner `fetch(req.url, {...})` (`:42-48`) with `getLlmFetch()(req.url, {...})`.
- Both modules `import { getLlmFetch } from '$lib/sidecar/llm-proxy-fetch'`.
- Error handling in both seams is **unchanged**: `classifyFetchError`/`httpStatusToError`
  operate on the (now proxied) `Response` whose status/headers come from upstream, so
  429→`RateLimitError`, 5xx→`ProviderHttpError`, etc. map identically. (Edge case noted
  below: a proxy-level failure classifies as same-origin `NetworkError` or a 502
  `ProviderHttpError` — rare and acceptable.)

### P3.6 — Web: CORS-error copy + rename
- `src/lib/ai/errors.ts` —
  - Rename the exported const `DESKTOP_FALLBACK_HINT` → `SIDECAR_FALLBACK_HINT`; set its
    value to the actionable one-liner, e.g.
    `'Browser calls to this provider may be blocked by CORS. Run the Mayon sidecar (docker compose up) for CORS-free access, or use a different provider.'`
  - In `formatProviderError`'s `CorsBlockedError` branch, use `SIDECAR_FALLBACK_HINT`.
- `src/lib/ai/errors.test.ts:2,24-28` — update the import + assertion to
  `SIDECAR_FALLBACK_HINT` (and keep the "Blocked by the browser" title assertion).

### P3.7 — nginx: disable buffering on `/api/` (prod SSE)
- `docker/nginx.conf` — in the existing `location /api/ { ... }` block (`:8-10`) add:
  ```nginx
  proxy_buffering off;
  proxy_cache off;
  ```
  (Sidecar's `X-Accel-Buffering: no` is the redundant second line of defense.)

### P3.8 — Tests
- `sidecar/src/llm-proxy.test.ts` (new) — using `app.inject` against `buildApp()` + a
  mocked upstream `fetch` (mock `globalThis.fetch` or use undici `MockAgent`):
  - 200 streaming body passes through with correct status + `content-type`.
  - Non-2xx upstream (e.g. 429 + `retry-after`) forwarded verbatim (status + headers +
    body) — assert the sidecar does **not** map errors (transparent).
  - Hop-by-hop stripping: `content-encoding`/`content-length` not forwarded.
  - `X-Accel-Buffering: no` present.
  - `AbortController` aborts upstream on client close — assert the upstream `signal`
    aborted (simulate via an inject that aborts, or assert the wiring by triggering
    `req.raw` 'close').
  - Invalid body (missing/non-absolute `url`) → 400.
- `src/lib/sidecar/llm-proxy-fetch.test.ts` (new) —
  - When `sidecarStatus.has('llm-proxy')` is false → `getLlmFetch()` calls
    `globalThis.fetch` directly with the original url (mock fetch; assert no `/api/llm/proxy`).
  - When `sidecarStatus.markConnected({ version:'x', caps:['llm-proxy'] })` → `getLlmFetch()`
    POSTs to `/api/llm/proxy` with the serialized body **including the resolved auth
    header**; the returned `Response` carries the proxied status/headers and a streaming
    body. `afterEach`: `sidecarStatus.markDisconnected()` to reset the singleton.
- `src/lib/ai/http-transport.test.ts` — extend: when the cap is present,
  `createFetchTransport(...).request(...)` POSTs via the proxy (cap present) vs direct
  (cap absent). Reset `sidecarStatus` in `afterEach`.
- (No new chat-store test needed — the seam change is covered by `sdk-fetch` + the
  helper; the existing `chat.svelte.test.ts` mocks `getActiveSdkProvider`, unaffected.)

### P3.9 — Docs (light)
- `AGENTS.md` — add a short **Manual acceptance gates (P3)** block: browser+sidecar →
  Anthropic streams with no CORS error; sidecar down → "run the sidecar" notice; other
  providers keep working either way; `BRAVE_API_KEY`/provider keys still IndexedDB-only.
- `docs/dev/architecture.qmd` (and `seams.qmd` if it lists the AI fetch seam) — note the
  `getLlmFetch()` proxy fork at the chat + discovery seams; mark `llm-proxy` as a landed
  sidecar cap. (Keep edits minimal; the P0 rewrite owns the broad doc restructure.)

---

## DoD (Phase 3)

- `docker compose up` → header badge shows **"Sidecar: connected"** with `llm-proxy` in
  the cap list; `GET /api/health` returns `caps: ['stdio-mcp','llm-proxy']`.
- `/settings` → configure **Anthropic** (key saved) → `/chat` streams an Anthropic reply
  with **no CORS error**; DevTools network shows the request going same-origin to
  `/api/llm/proxy`, not `api.anthropic.com`.
- **Stop** during an Anthropic stream aborts cleanly (upstream fetch aborted; no orphan).
- Model discovery (`/models` on OpenRouter / Z.AI / Kilo Gateway) still works, now also
  proxied when the cap is present.
- Stop the sidecar → same Anthropic request surfaces the **"run the Mayon sidecar
  (`docker compose up`)"** notice (was "use the desktop app"); OpenAI-compatible
  providers that allow browser CORS (Z.AI, OpenRouter, OpenAI) keep streaming via direct
  fetch.
- The provider API key is **not** in the `settings` table (IndexedDB only); the sidecar
  receives it only in the proxied request's headers (transient, internal network).
- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/sidecar
  test` green (i.e. `pnpm test:all` green). No `@tauri-apps` regressions.

**Depends on:** Phase 1 (landed). Independent of Phases 2/4/5 (can ship before/after).

## Risks & edge cases

- **`content-encoding` corruption (the classic proxy bug).** Node `fetch` auto-decompresses;
  forwarding `content-encoding` would make the browser try to gunzip plaintext → corrupt
  stream. Mitigation: strip hop-by-hop headers (P3.2). Covered by a test (P3.8).
- **SSE buffering in docker prod.** nginx buffers proxy responses by default → `/chat`
  appears to hang. Mitigation: `proxy_buffering off` + `X-Accel-Buffering: no` (decision 5).
- **Abort chain.** Browser `Stop` aborts the proxy `fetch` → connection closes → sidecar
  sees `req.raw` 'close' → aborts upstream. Both seams forward `init.signal`. Covered.
- **Proxy-level failure classification.** If the sidecar itself is unreachable mid-request
  (was up at boot, now down), the proxy `fetch` throws → `classifyFetchError` sees a
  same-origin URL (`/api/llm/proxy`) → `NetworkError` (not `CorsBlockedError`). If the
  sidecar returns 502 (upstream unreachable), `httpStatusToError` →
  `ProviderHttpError(502)`. Both are rare, non-silent, and acceptable; documented.
- **String-body assumption.** The proxy serializes `body` only when it's a string. The AI
  SDK always sends JSON-string bodies for chat/discovery, so this holds. If a non-string
  body ever appears, `body` is sent as `undefined` (→ treated as no body) rather than
  crashing; assert string in a test for the happy path.
- **Provider Origin/Referer checks.** Routing through the sidecar removes the browser's
    `Origin` (the browser-constructed headers don't include it). For providers that block
    browser origins this is a **benefit**, not a risk; no provider is known to require a
    browser `Origin`.
- **Capability-gating drift.** `llm-proxy` is advertised in `/api/health` only once P3.2's
  route exists; the UI gates strictly on `sidecarStatus.has('llm-proxy')`. No drift.

## Validation

- **Automated:** `pnpm test:all` green — new suites: `sidecar/src/llm-proxy.test.ts`,
  `src/lib/sidecar/llm-proxy-fetch.test.ts`; extended `http-transport.test.ts`; updated
  `server.test.ts` + `errors.test.ts`. CI runs `pnpm lint && pnpm check && pnpm test`.
- **Manual, browser + sidecar:** the Phase-3 DoD scenario above (Anthropic streams
  proxied; sidecar-down shows the new notice; OpenAI-compatible unaffected; key in
  IndexedDB only; Stop aborts).
- **No regression:** the existing browser gates (DB ready, theme persists, provider
  streaming for OpenAI-compatible, HTTP MCP servers) pass unchanged after P3.

## Out of scope

- TLS/HTTPS termination for the sidecar (localhost/internal network; nginx-layer concern
  for any future remote deployment).
- Caching, rewriting, or rate-limiting of proxied requests (transparent pass-through only).
- A sidecar-side secret vault (browser remains the single source of truth for keys).
- Proxying Ollama (local; no custom fetch is built for it — stays direct by construction).
- Retrying / failover between proxy and direct fetch on a per-request basis (the cap
  check is live; toggling the sidecar affects the *next* request, which is sufficient).
