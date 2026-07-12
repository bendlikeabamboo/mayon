# Plan — Phase 2: stdio MCP runner over the sidecar

> Parent plan: `.kilo/plans/1783749811883-container-forward-web-transition.md` (Phase 2).
> Goal: stdio MCP servers (Brave, Filesystem, GitHub, custom) run **in the browser** when the
> sidecar is connected, by spawning the child on the sidecar and relaying newline-delimited
> JSON-RPC over a WebSocket. This is the headline reason the sidecar exists.
> Status: implementation-ready.

## Grounding (current state — verified against the repo)

- **Phase 0 + 1 are complete.** `src-tauri/` is gone; `isTauri()` collapsed; the sidecar
  (`sidecar/`, fastify + `@fastify/websocket`) boots with `GET /api/health` → `{ok,version,caps:[]}`
  and a stub `/ws/mcp` that replies "not implemented" + closes (`sidecar/src/server.ts:18-23`).
- **Shared protocol** (`packages/shared/src/protocol.ts`): `SidecarCap`, `HealthResponse`,
  `McpSpawn` (`{serverId,command,args,env:Record<string,string>,cwd?}`), `McpFrame`
  (`{serverId,kind,data?,code?,spawn?}`), `McpFrameKind = 'spawn'|'stdin'|'stdout'|'stderr'|'exit'|'kill'`.
- **Web sidecar layer** exists: `SidecarClient` (`src/lib/sidecar/client.ts`, `ws()` →
  `new WebSocket('/ws/mcp')`), `sidecarStatus` store (`src/lib/sidecar/status.svelte.ts`, with
  `has(cap)`), `detectSidecar()` wired in `+layout.svelte:32`. Proxying is set up in both
  `vite.config.ts:43-48` and `docker/nginx.conf:8-18`.
- **MCP transport seam** (`src/lib/mcp/transport.ts:9`): `start/request/notify/close/onNotification
  /removeNotification/onRequest/removeRequest/respond`.
- **MCP client** (`src/lib/mcp/client.ts:73`): `initialize()` calls `transport.start()` **then**
  `transport.request('initialize', …)` — so `start()` must confirm the child is up before the
  client sends the `initialize` envelope. Servers emit nothing on stdout before receiving
  `initialize` (chicken-and-egg → requires an explicit spawn ack).
- **Transport picker** (`src/lib/mcp/client-factory.ts:7-9`): stdio currently always throws
  `'stdio MCP servers require the Mayon sidecar (coming soon)'`.
- **Lifecycle gate** (`src/lib/mcp/lifecycle.ts:68`): `if (config.transport === 'stdio') skip`
  (log "sidecar not connected").
- **Per-turn lifecycle** (`src/lib/stores/chat.svelte.ts:274`): `connectSession(...)` creates all
  transports per chat turn and `unmountAll()` tears them down at end of turn. → transports (and
  their WS) are created/destroyed together each turn.
- **Templates** (`src/lib/mcp/templates.ts`): stdio templates have `platforms:['desktop']`;
  `McpServers.svelte:60-66` gates on `const isDesktop = false` (so stdio is hidden today).
- **Env-secret convention** (`src/lib/mcp/keystore.ts`, `McpServers.svelte:413-429`):
  `config.env[name] = { secretRef }` where `secretRef` is the full keyId `mcp:<serverId>:<name>`;
  values live in IndexedDB via `createBrowserKeyStore().get(keyId)`.
- **Trust gate** (`src/lib/mcp/trust.ts`): unchanged — still enforced before spawn.
- **Stub fixture** exists: `tests/fixtures/stub-mcp-server.mjs` (initialize/tools-list/tools-call).
- **Old reference** (deleted): `StdioMcpTransport` (`git show effa73a:src/lib/mcp/stdio.ts`) used
  Tauri `invoke` and passed `envKeyIds` to Rust. **Not salvaged** — rewritten over the WS bridge.

## Resolved decisions

1. **One WS per transport instance** (not a shared multiplexed socket). Each
   `SidecarStdioMcpTransport` opens its own `/ws/mcp`, spawns exactly one child on it, and
   `close()` closes that one socket → the sidecar kills that one child. No refcounting. Aligns
   with the per-turn `connectSession`/`unmountAll` lifecycle. N stdio servers = N sockets/turn
   (typically 1–2). The master plan's "kill all children this connection owns" now maps 1:1 to
   `close()`.
2. **Add a `'spawned'` ack frame** to the wire protocol. The sidecar sends
   `{kind:'spawned', serverId}` immediately after a successful `child_process.spawn()`;
   `start()` resolves on it and rejects on an `exit`/socket-error frame. This breaks the
   chicken-and-egg (servers are silent until `initialize`) and surfaces spawn failures (ENOENT)
   immediately instead of hanging the first request until `callTimeoutMs`.
3. **Secrets resolved in the browser before spawn.** `start()` resolves each
   `config.env[name].secretRef` via `createBrowserKeyStore().get(...)` into `McpSpawn.env`
   (`Record<string,string>`). Missing secret → throw `MissingKeyError` (matches the HTTP
   transport). The sidecar is stateless re: secrets; it only receives resolved values over the
   same-origin internal socket.
4. **Spawn hardening (hard rules from AGENTS.md).** `child_process.spawn(command, args, …)` with
   `stdio:['pipe','pipe','pipe']`, **never `sh -c`**. Warn (server log) if `command` isn't an
   absolute path, but **allow** it (templates use `npx`, which needs PATH resolution).
5. **Concurrency cap = global, env-configurable.** With one child per socket, a per-connection
   cap is trivially 1; the meaningful guard is the total live children across the sidecar process.
   `MCP_MAX_CHILDREN` (default `32`); over-limit `spawn` → reject with an `exit` frame
   (`code:-1`, `data:'too many children'`) before spawning.
6. **Per-request timeout.** Each `request()` arms `config.callTimeoutMs ?? 30000`; on expiry the
   pending promise rejects (and is removed) but the child keeps running (matches the HTTP
   transport's AbortController behavior).
7. **Availability gating drives off the cap, not `platforms`.** `isTemplateAvailable(t)`:
   stdio → `sidecarStatus.has('stdio-mcp')`; http → always. The `platforms` array stays for the
   Monitor/Globe icon semantics only.
8. **Injectable `wsFactory`** on the transport constructor (defaults to `() => sidecarClient.ws()`)
   so the web test can inject a fake WebSocket without touching the network.

## Tasks

### P2.1 — Shared protocol: add `spawned` ack
- `packages/shared/src/protocol.ts` — extend `McpFrameKind` to
  `'spawn'|'spawned'|'stdin'|'stdout'|'stderr'|'exit'|'kill'`. Add a short doc-comment block
  defining the frame contract (client→server: `spawn`/`stdin`/`kill`; server→client:
  `spawned`/`stdout`/`stderr`/`exit`). `McpFrame` already has `data?`+`code?`, so `exit` can
  carry `data` as an error message for spawn failures.

### P2.2 — Sidecar: WS stdio bridge (opaque relay)
- `sidecar/src/mcp.ts` (new) — export `registerMcpBridge(app)`:
  - Per-connection `Map<serverId, Child>`; a module-level `Set`/counter for the global cap
    (`MCP_MAX_CHILDREN`, default 32).
  - On `{kind:'spawn', spawn}`: validate non-empty `command`; warn if `!path.isAbsolute(command)`;
    cap check (reject → send `{kind:'exit', serverId, code:-1, data:'too many children'}` and
    stop); `child_process.spawn(command, args, { env:{...process.env, ...spawn.env},
    cwd:spawn.cwd, stdio:['pipe','pipe','pipe'] })`. **No shell.**
    - On spawn success → send `{kind:'spawned', serverId}`.
    - On child `'error'` event (covers ENOENT) or sync throw → send
      `{kind:'exit', serverId, code:-1, data: err.message}`; clean up handle + global set.
  - stdout/stderr: line-buffer with a carry buffer; emit one `{kind:'stdout'|'stderr', serverId,
    data: line}` per line (MCP JSON-RPC is newline-delimited).
  - `{kind:'stdin', serverId, data}` → `child.stdin.write(data + '\n')` (swallow write errors).
  - `{kind:'kill', serverId}` → `child.kill()`; idempotent.
  - On socket close → kill **all** children this socket owns; remove from global set.
- `sidecar/src/server.ts` — replace the stub `/ws/mcp` handler with `registerMcpBridge(app)`;
  change `/api/health` `caps: []` → `caps: ['stdio-mcp']`.

### P2.3 — Sidecar: tests
- `sidecar/src/server.test.ts` — update: health now returns `caps:['stdio-mcp']`; delete the old
  "sends not-implemented then closes" WS test (replaced by the bridge suite below).
- `sidecar/src/mcp.test.ts` (new) — boot `buildApp()` on port 0; open a real `ws` client; spawn
  the stub fixture by absolute path
  (`fileURLToPath(new URL('../../tests/fixtures/stub-mcp-server.mjs', import.meta.url))`). Assert:
  - `spawned` frame received before any stdout.
  - initialize → tools/list → tools/call round-trip over stdin/stdout frames.
  - kill → `exit` frame; child handle removed.
  - spawn failure: spawn a non-existent binary → `exit` frame with `code`/`data`.
  - stderr captured: spawn `node -e 'process.stderr.write("boom\\n")'` → `stderr` frame.
  - over-limit rejected: set `MCP_MAX_CHILDREN=1` for the test, spawn a second → `exit` reject.
  - kill-on-disconnect: spawn, close the socket without `kill`, reopen, confirm a fresh spawn for
    the same `serverId` succeeds (previous child was reaped).

### P2.4 — Web: `SidecarStdioMcpTransport`
- `src/lib/mcp/sidecar-stdio.ts` (new) — `implements McpTransport`. Constructor
  `{ config: McpServerConfig; wsFactory?: () => WebSocket }` (default `() => sidecarClient.ws()`).
  Internal: `#pending = Map<id,{resolve,reject}>`, `#nextId=1`, notification/request handlers,
  `#closed=false`.
  - `start()`:
    - guard: `if (!sidecarStatus.has('stdio-mcp'))` throw
      `'stdio MCP servers require the Mayon sidecar (run: docker compose up)'`.
    - resolve env: for each `[name,{secretRef}]` of `config.env`, `v = await
      createBrowserKeyStore().get(secretRef)`; null → `throw new MissingKeyError(undefined,
      secretRef)`; build `env: Record<string,string>`.
    - open WS; attach `message`/`close`/`error` listeners. `onmessage` → `JSON.parse(frame)` →
      `stdout` frames JSON-parsed and routed (match `id` → pending resolve/reject; no `id` →
      `onNotification`; `id` unmatched → `onRequest`); `stderr` → `console.warn` (best-effort).
    - send `{kind:'spawn', serverId:config.id, spawn:{serverId:config.id, command:config.command,
      args:config.args??[], env, cwd:config.cwd}}`.
    - await `spawned` (resolve placeholder `{name:'stdio-server', version:'0.0.0'}`) or
      `exit`/`close`/`error` (reject).
  - `request(method, params)`: `id=#nextId++`; envelope `{jsonrpc:'2.0', id, method,
    params:params??{}}`; register pending; send `{kind:'stdin', serverId, data:
    JSON.stringify(envelope)}`; arm timeout (`config.callTimeoutMs ?? 30000`) → reject+remove
    pending; return the pending promise.
  - `notify(method, params)`: one-way stdin write of `{jsonrpc:'2.0', method, params}`.
  - `respond(id, result, error)`: write `{jsonrpc:'2.0', id, result|error}` to stdin.
  - `onNotification`/`onRequest`/`removeNotification`/`removeRequest`: store/clear single handler
    (same shape as `http.ts`).
  - `close()`: guard double-close; best-effort send `{kind:'kill', serverId}`; close WS; reject all
    pending; clear handlers; `#closed=true`. On WS `close`/`error` mid-life: reject all pending
    with a transport-closed error and mark closed.

### P2.5 — Web: wire picker + lifecycle + templates + stale copy
- `src/lib/mcp/client-factory.ts` — stdio branch: `if (sidecarStatus.has('stdio-mcp')) return new
  SidecarStdioMcpTransport({ config })`, else throw the "requires sidecar" error (keep the
  message). Pass the full `config` (command/args/env/cwd/callTimeoutMs).
- `src/lib/mcp/lifecycle.ts:68` — `if (config.transport === 'stdio' && !sidecarStatus.has('stdio-mcp'))`
  skip (keep the trace log). When connected, stdio flows through `createMcpTransport` normally.
- `src/lib/components/mcp/McpServers.svelte`:
  - rewrite `isTemplateAvailable` (lines 62-66): stdio → `sidecarStatus.has('stdio-mcp')`; http →
    `true`. Import `sidecarStatus`. Remove the dead `isDesktop` constant.
  - in the template picker, when the sidecar is down show a one-line hint above the grid:
    "Run `docker compose up` to enable stdio servers." (Keep the per-card disabled tooltip.)
  - fix the stale CORS copy (lines ~1156-1161: "Use the Mayon desktop app…") → "Run the Mayon
    sidecar (`docker compose up`) to route this request and avoid CORS." (The `formatProviderError`
    copy in `errors.ts` stays a P3 task.)
- `src/lib/mcp/client-factory.test.ts` — update the stdio case: with the store mocked to
  `has('stdio-mcp')===true` it returns `SidecarStdioMcpTransport`; when `false` it throws
  (matching the current assertion). Mock `sidecarStatus` (and `createBrowserKeyStore`) as needed.

### P2.6 — Web: tests
- `src/lib/mcp/sidecar-stdio.test.ts` (new) — inject a fake `wsFactory` returning a mock WebSocket
  (EventTarget + `send`/`close` that the test drives by dispatching `message`/`close`/`error`).
  Assert:
  - `start()`: env secrets resolved before the `spawn` frame is sent (mock
    `createBrowserKeyStore().get`); missing secret → `MissingKeyError`; `spawned` → resolves;
    `exit`/close → rejects; the sidecar-connected guard throws when cap absent.
  - JSON-RPC id matching: `request()` writes the envelope to `stdin`, a matching `stdout` frame
    resolves; an error frame rejects.
  - notification routing (no `id`) → `onNotification`; server request (`id`, unmatched) →
    `onRequest`; `respond()` writes the JSON-RPC reply to stdin.
  - `callTimeoutMs` expiry → pending rejects.
  - `close()` sends `kill`, closes the fake WS, rejects remaining pending.

## Risks
- **Per-turn spawn latency.** `connectSession` creates transports (and now spawns `npx …`)
  every chat turn — same as the old desktop model, but now over a socket + real process start.
  Acceptable for v1 (1–2 servers); warming servers across turns is explicitly out of scope.
- **Secret transit to sidecar.** Resolved env values cross to the sidecar over the same-origin
  internal socket only. No regression vs. the current browser-fetch path (which already holds keys
  in JS). Mitigated by nginx-only entry, internal-only bind, no host port (already enforced in
  `docker-compose.yml`).
- **Subprocess orphaning on sidecar crash.** kill-all-on-socket-close (P2.2) handles clean WS
  teardown; a hard crash can still orphan. Best-effort only; documented.
- **`npx` supply-chain.** Unchanged trust model: `requiresTrust` + `trust.ts` hash gate +
  absolute-path warning. Surface clearly in the trust banner (already present).
- **Image runtime mismatch.** A stdio server needing python/binaries won't run in the Node-alpine
  sidecar → spawn `exit` frame surfaces the error to the UI. Custom sidecar images are out of scope.
- **Capability-gating drift.** `/api/health` advertises **only** `'stdio-mcp'` (the one landed cap);
  the UI gates strictly on `sidecarStatus.has('stdio-mcp')`.

## Definition of Done
- **Automated:** `pnpm lint && pnpm check && pnpm test` green at the repo root; `pnpm --filter
  @mayon/sidecar test` green. New suites: sidecar `mcp.test.ts`, web `sidecar-stdio.test.ts`;
  updated `client-factory.test.ts` and `server.test.ts`. No `@tauri-apps` imports; no new
  secrets in the `settings` table (IndexedDB only).
- **Manual (browser + sidecar):** `docker compose up` → header shows "Sidecar: connected" with the
  `stdio-mcp` cap. `/settings → MCP Servers → Add → Brave Search` → set `BRAVE_API_KEY` → Trust →
  **Test** discovers the Brave tools **in the browser**. `/chat` "search the web for X" invokes
  `mcp.<id>.brave_web_search` and renders results. Stop the sidecar → stdio templates show
  "requires sidecar" with the `docker compose up` hint; HTTP MCP and provider streaming still work.
  `BRAVE_API_KEY` is **not** in `settings` (IndexedDB only).

## Dependencies & sequence
- **Depends on:** Phase 1 (done).
- **Order:** P2.1 → P2.2 → P2.3 (sidecar, independently testable) and P2.4 → P2.6 (web transport,
  testable with a fake WS) can proceed in parallel; **P2.5** (wiring) last, after both halves
  compile. DoD is the end-to-end manual gate.
- **Does not block:** P3 (LLM proxy) and P4 (sandbox DB) — they plug into the same P1 seams and
  can ship independently after P1.
