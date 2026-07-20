# Plan — Container-Forward Web Transition (shelve Tauri, add an optional local sidecar)

> Status: implementation-ready. Authored 2026-07-11.
> Goal: (1) remove the Tauri desktop shell entirely and collapse to a browser-only
> local-first web app; (2) introduce an **optional local Node/TypeScript sidecar
> container** that provides browser-impossible capabilities (stdio MCP, sandbox DB,
> LLM CORS proxy, backup). The browser stays 100% functional without it.

## Resolved decisions (from planning interview)

1. **Architecture: optional local sidecar.** The web app remains local-first
   (OPFS SQLite + IndexedDB keys are the source of truth). A *companion* container,
   run by power users via `docker compose up`, unlocks capabilities the browser
   can't provide. The app detects it at boot and progressively enables features.
   Rejected alternatives: always-on backend (abandons local-first), dynamic Docker
   orchestration (too complex, needs Docker socket access).
2. **Sidecar runtime: Node.js / TypeScript.** Single language for the repo, shares
   drizzle types where useful, no Rust toolchain to maintain (directly addresses the
   bandwidth/maintenance concern). The existing Rust logic is **not** salvaged.
3. **v1 sidecar capabilities (all four, phased):** stdio MCP runner (headline),
   sandbox DB for MCP, LLM CORS proxy, backup service.

## Decisions taken in this plan (call out if you disagree)

- **Tauri removal depth = full removal from the active build.** Delete `src-tauri/`,
  all `@tauri-apps/*` deps, the `tauri*` scripts, `rust-toolchain.toml`. Git history
  preserves it for future un-shelving. Keeping dead code is itself a maintenance cost.
- **Repo structure = minimal pnpm workspace.** The web app stays at repo root
  (unchanged location). Add `pnpm-workspace.yaml` with `packages: ['.', 'sidecar',
  'packages/*']`. New `sidecar/` package (Node server) and `packages/shared/`
  (the tiny sidecar wire-protocol types, imported by both). No moving of existing code.
- **Secret model = browser stays source of truth; sidecar is stateless re: secrets.**
  Keys live in IndexedDB (as today). When the browser asks the sidecar to spawn a
  stdio MCP server or proxy an LLM request, it resolves the secret locally and
  includes it in the same-origin request. The sidecar never persists secrets. Transit
  is same-origin over the internal docker network / localhost (no key regression vs.
  the current browser-fetch path, which already holds the key in JS).
- **Wire protocol.** WebSocket (`/ws/mcp`) for the stdio MCP bridge (it is
  bidirectional: client→server req, server→client notifications/requests). HTTP+SSE
  for the LLM CORS proxy (`POST /api/llm/proxy`), REST for health (`GET /api/health`),
  DB (`POST /api/db/query`), and backup. The **stdio MCP bridge is opaque**: the
  sidecar spawns a process and relays newline-delimited JSON-RPC frames between the
  WS and the child's stdin/stdout — it needs zero MCP-semantic knowledge.
- **Sandbox DB reuses the existing `StorageDriver` seam.** A new `SidecarDriver
  implements StorageDriver` wraps `POST /api/db/query`. It is **not** wired as the
  app's primary store (OPFS stays primary); it's a DB that MCP tools / sandboxed
  compute connect to, optionally browsable. (Wiring it as primary is explicitly
  out of scope.)
- **Discovery = `isSidecar()`.** At boot the SPA probes `GET /api/health`
  (same-origin via nginx/Vite proxy) with a short timeout. A reactive `sidecarStatus`
  store (mirrors `dbStatus`) records connected/absent. Every former `isTauri()`
  capability gate becomes an `isSidecar()` capability check.

## Grounding (the seams this plan reuses — verify against these, don't reinvent)

- **Runtime fork seam:** `isTauri()` (`src/lib/db/driver/client.ts:8`). The single
  point every capability branches on. This is the spine of the whole change.
- **`StorageDriver` seam:** `src/lib/db/driver/types.ts:18` — `query/batch/exec/
  snapshot/restore/dispose`. The sandbox DB slots in as one more driver.
- **`McpTransport` seam:** `src/lib/mcp/transport.ts:9` — `start/request/notify/
  close/onNotification/...`. A `SidecarStdioMcpTransport` implements it, replacing
  the Tauri `StdioMcpTransport` (`src/lib/mcp/stdio.ts`).
- **MCP transport picker:** `createMcpTransport` (`src/lib/mcp/client-factory.ts:8`)
  — the single function that chooses stdio vs http. The stdio branch swaps its impl.
- **MCP lifecycle gate:** `src/lib/mcp/lifecycle.ts:68` — `if (config.transport ===
  'stdio' && !isTauri()) skip`. Becomes `... && !isSidecar()`.
- **HTTP streaming transport seam:** `HttpStreamTransport` + `getHttpTransport()`
  (`src/lib/ai/http-transport.ts:27,75`). The CORS proxy slots in here.
- **Keystore runtime picker:** `createKeyStore()` (`src/lib/ai/keystore/client.ts:12`)
  — collapses to browser-only.
- **Template platform gate:** `McpServerTemplate.platforms: ('web'|'desktop')[]`
  (`src/lib/mcp/types.ts:119`) + `isTemplateAvailable` (`McpServers.svelte:62-66`).
  Becomes sidecar-availability-gated.
- **Existing container scaffolding:** `Dockerfile` (static nginx SPA),
  `docker/nginx.conf`, `docker-compose.yml`. Extend, don't replace.
- **Plan style reference:** `.kilo/plans/1783415268000-m1-mcp-desktop-stdio-tools.md`
  (file-level tasks + DoD + dependency graph).

## Hard rules (from AGENTS.md — non-negotiable)

- Components/stores call repositories only — never import transports/drivers directly
  (the one sanctioned UI→transport touch is `testConnection`, kept in `lifecycle.ts`).
- **No secrets in `settings`.** Keys stay in the runtime `KeyStore` (IndexedDB now).
- After `pnpm db:generate` **always run `pnpm bundle:migrations`** before shipping.
- The sidecar must **bind only to the internal docker network** (not exposed to the
  host directly); nginx is the single same-origin entry point. Never expose the raw
  sidecar port in `docker-compose.yml`.
- **Never `sh -c`** in the sidecar spawn — use `child_process.spawn(command, args)`
  directly, mirroring the Tauri hardening rule. Warn on non-absolute `command`.

---

## Phase 0 — Remove Tauri, collapse to browser-only (shippable on its own)

> Goal: the app builds, runs, and passes all tests with **no Tauri**, all
> `isTauri()` branches collapsed to the browser path, desktop-only features removed
> or gracefully disabled. No sidecar yet. This is a clean, independently shippable
> state and the prerequisite for every later phase.

### P0.1 — Strip Tauri from the build + manifests
- `package.json` — remove deps `@tauri-apps/api`, `@tauri-apps/plugin-dialog`,
  `@tauri-apps/plugin-process`, `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-updater`,
  and devDep `@tauri-apps/cli`. Remove scripts `tauri`, `tauri:dev`, `tauri:build`,
  `tauri:icon`.
- Delete `src-tauri/` and `rust-toolchain.toml`.
- `.dockerignore` — remove `src-tauri/` lines (`:5-6`, `:11`).

### P0.2 — Collapse the runtime fork to browser-only
- `src/lib/db/driver/client.ts` — `isTauri()` → return `false` permanently (keep the
  export as a no-op for now; it's removed in P1.3). Remove the `import('./tauri')`
  branch in `createDriver()` (`:22-25`); `bootstrapDb` runtime is always `'browser'`.
- Delete `src/lib/db/driver/tauri.ts`.
- `src/lib/stores/db.svelte.ts` — keep the `'browser'|'memory'` runtime values; the
  `'tauri'` value becomes unreachable (leave the type, it's harmless, or narrow it).

### P0.3 — Collapse the AI transport + keystore to browser-only
- `src/lib/ai/http-transport.ts` — `getHttpTransport()` (`:75-79`) always returns
  `createFetchTransport(createBrowserKeyStore())`. Delete the `createTauriTransport`
  import + branch.
- Delete `src/lib/ai/tauri-transport.ts` and `tauri-transport.test.ts`.
- `src/lib/ai/sdk-fetch.ts` (`:14`) — drop the `isTauri()` branch; always browser fetch.
- `src/lib/ai/keystore/client.ts` — `createKeyStore()` always returns
  `createBrowserKeyStore()`. Delete `desktop.ts` import.
- Delete `src/lib/ai/keystore/desktop.ts`.

### P0.4 — Disable stdio MCP gracefully (until the sidecar lands in P2)
- `src/lib/mcp/stdio.ts` — the Tauri `StdioMcpTransport` is now dead code; **delete it**
  and `stdio.test.ts`. (P2 replaces it with the sidecar variant.)
- `src/lib/mcp/client-factory.ts` — the stdio branch throws
  `'stdio MCP servers require the Mayon sidecar (coming soon)'` (do not silently
  no-op). The http branch's `isTauri()` secretResolver (`:25-31`) becomes the
  browser path only.
- `src/lib/mcp/lifecycle.ts:68` — the skip condition stays but reads `true` for stdio
  until P2 (stdio always skipped in browser-only state). Leave a clear comment.
- `src/lib/mcp/templates.ts` — stdio templates' copy changes from "Desktop only" to
  "Requires the Mayon sidecar". Keep the data; only the gate/copy changes. The
  `platforms` field is repurposed in P2 (`'desktop'` → means "needs sidecar").

### P0.5 — Remove desktop-only UI + updater
- Delete `src/lib/updater.svelte.ts` and `src/lib/components/UpdaterBanner.svelte`.
- `src/routes/+layout.svelte` — remove the `UpdaterBanner` import/usage (`:8,48`) and
  the `if (isTauri()) updater.check()` block (`:40`).
- `src/lib/components/mcp/McpServers.svelte` — `isDesktop = isTauri()` (`:60`) becomes
  `false`; `isTemplateAvailable` shows http templates only. (Re-wired in P2.)

### P0.6 — Collapse backup to browser-only
- `src/lib/db/backup.ts` — `createBackup()` (`:120`) keeps only the
  `downloadBlob(snapshot)` path. `restoreBackupFromPath` (`:149`) is desktop-only →
  delete it. Remove all `@tauri-apps/plugin-dialog` / `invoke` imports.
- `src/lib/components/settings/DataSection.svelte` — remove the `isTauri()` branches
  (`:19,32`); backup is always browser download/upload.

### P0.7 — Docs + cleanup
- `AGENTS.md` — remove the Tauri stack line, the `tauri*` command rows, the Linux
  GTK/WebKit + secret-service sections, and the P0/P1/P5 desktop manual gates.
  Rewrite the "Manual acceptance gates" to browser + sidecar (sidecar gates added in
  later phases). State clearly: **desktop shell is shelved; browser-only local-first
  is the runtime; an optional sidecar (phases 1–5) unlocks more.**
- `README.md` — drop the `pnpm tauri:*` instructions; lead with `pnpm dev` + the
  future `docker compose up`.
- `docs/dev/architecture.qmd` + `docs/dev/seams.qmd` — update the runtime/driver
  diagram: OPFS only; mark Tauri as removed and the sidecar as planned.

**DoD (Phase 0):** `pnpm install && pnpm lint && pnpm check && pnpm test` all green;
`pnpm dev` boots, DB reaches "ready (browser)", theme persists, `/chat` streams,
`/settings` provider flow works, HTTP MCP servers still connect, stdio servers are
hidden/disabled with a clear "requires sidecar" message. No `@tauri-apps` imports
remain (`rg '@tauri-apps' src` returns nothing).

**Depends on:** nothing. Do this first; it is independently shippable.

---

## Phase 1 — Sidecar skeleton: workspace, server, discovery, packaging

> Goal: a runnable sidecar container the web app can detect. The web app shows a
> "sidecar connected" badge but uses the sidecar for nothing yet. Establishes every
> seam later phases plug into.

### P1.1 — pnpm workspace + shared protocol package
- `pnpm-workspace.yaml` (new) — `packages: ['.', 'sidecar', 'packages/*']`.
- `packages/shared/` (new) — `package.json` (`@mayon/shared`, `type: module`), `tsconfig.json`,
  and `src/protocol.ts` defining the wire types used by **both** sides:
  - `HealthResponse` (`{ ok: true; version: string; caps: ('stdio-mcp'|'sandbox-db'|'llm-proxy'|'backup')[] }`).
  - `McpSpawn` (`{ serverId; command; args; env: Record<string,string>; cwd? }`).
  - `McpFrame` (the WS relay envelope: `{ serverId; kind: 'stdin'|'stdout'|'stderr'|'exit'; data: string; code?: number }`).
  - `DbQueryRequest`/`DbQueryResult`, `LlmProxyRequest`/stream shape, `BackupSnapshot`/`Restore`.
- Root `package.json` — add `"@mayon/shared": "workspace:*"` to dependencies.

### P1.2 — Sidecar server skeleton
- `sidecar/package.json` (new) — `type: module`, deps: `hono` (or `fastify`) + `ws`
  (or the framework's WS). Scripts: `dev` (tsx watch), `build`, `start`. A
  `Dockerfile` (see P1.5).
- `sidecar/src/server.ts` (new) — boot an HTTP server on `process.env.PORT ?? 4319`,
  bind `0.0.0.0` (docker network only — never host-exposed). Routes:
  - `GET /api/health` → `HealthResponse` with the v1 cap list (all four, since all
    ship across P2–P5; unused ones return errors until their phase lands, OR advertise
    only landed caps — recommend advertising only **landed** caps so the UI gates
    correctly).
  - A WS upgrade at `/ws/mcp` (handler stubbed in P1; implemented in P2).
- `sidecar/tsconfig.json` — extends root, `composite: true`, references `packages/shared`.

### P1.3 — Replace `isTauri()` with the sidecar capability model
- `src/lib/sidecar/` (new) —
  - `client.ts`: `SidecarClient` — lazy HTTP (`fetch('/api/...')`) + a shared WS
    factory. All requests are same-origin (proxied by nginx in prod, Vite in dev).
  - `detect.ts`: `detectSidecar(): Promise<HealthResponse | null>` — `GET /api/health`
    with a 1500ms `AbortController` timeout; returns `null` on any failure.
  - `status.svelte.ts`: a reactive store (mirror `dbStatus`) —
    `{ connected: boolean; caps: string[]; version?: string }`.
- `src/lib/db/driver/client.ts` — **delete `isTauri()`** entirely; remove the export
  from `src/lib/db/index.ts:4`. Update every importer (P0 already collapsed them to
  browser-only, so most `isTauri()` calls are already gone; sweep for stragglers).
- `src/routes/+layout.svelte` — after `bootstrapDb()`, call `detectSidecar()` and
  populate `sidecarStatus`. Non-fatal if absent.

### P1.4 — Web dev proxy + nginx proxy
- `vite.config.ts` — add `server.proxy`: `/api` and `/ws` → `http://localhost:4319`
  (with `ws: true` for `/ws`). So `pnpm dev` + `pnpm --filter sidecar dev` work
  together without CORS.
- `docker/nginx.conf` — add:
  - `location /api/ { proxy_pass http://sidecar:4319; ... }`
  - `location /ws/ { proxy_pass http://sidecar:4319; proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }`

### P1.5 — Container packaging (multi-service)
- `sidecar/Dockerfile` (new) — `FROM node:22-alpine`; install pnpm; copy workspace
  manifests + `packages/shared` + `sidecar`; `pnpm install --filter sidecar...`;
  build; `CMD ["node", "dist/server.js"]`. Base image **must include node+npx** so
  stdio MCP spawns (P2) work.
- `docker-compose.yml` — add a `sidecar` service (build `./sidecar`, no host `ports`
  — only the internal network), and make `web` (`depends_on: sidecar`). Add a named
  volume `sidecar-data` mounted at `/data` (for the sandbox DB + backups in P4/P5).
- Root `Dockerfile` — extend to build `packages/shared` too if the web build now
  references it (it does, transitively).

### P1.6 — Sidecar status badge (UI)
- `src/lib/components/SidecarStatus.svelte` (new) — small badge in the header (next to
  `DbStatus`): "Sidecar: connected (vX)" or "Sidecar: off (browser-only)". Tooltip
  lists available caps. No feature wiring yet.

**DoD (Phase 1):** `docker compose up` starts `web` + `sidecar`; the header badge shows
"Sidecar: connected"; `GET /api/health` returns the cap list; `pnpm dev` (with the
sidecar running separately) shows the same badge. With the sidecar down, the badge
shows "off" and the app behaves exactly as after Phase 0. `pnpm test` green; add a
vitest suite for `detectSidecar` (mock fetch, timeout, absent).

**Depends on:** Phase 0.

---

## Phase 2 — stdio MCP runner over the sidecar (the headline feature)

> Goal: stdio MCP servers (Brave, Filesystem, GitHub, custom) work in the **browser**
> when the sidecar is connected. This is the core reason the sidecar exists.

### P2.1 — Sidecar: WS stdio bridge (opaque relay)
- `sidecar/src/mcp.ts` (new) — handle `/ws/mcp`:
  - On `{kind:'spawn', ...McpSpawn}`: `child_process.spawn(command, args, { env:
    {...process.env, ...spawn.env}, cwd, stdio: ['pipe','pipe','pipe'] })`. Store the
    child in a `Map<serverId, Child>`. **No `sh -c`.** Warn (server log) if `command`
    isn't absolute.
  - Pipe: line-buffer the child's `stdout`, send each line as
    `{kind:'stdout', serverId, data: line}`. Same for `stderr` (`kind:'stderr'`).
    On `exit`, send `{kind:'exit', serverId, code}` and delete the handle.
  - On `{kind:'stdin', serverId, data}`: write `data + '\n'` to the child's stdin.
  - On `{kind:'kill', serverId}`: `child.kill()`; remove handle. Idempotent.
  - On WS close: kill **all** children this connection owns (no orphan leak).
  - Cap concurrent servers per connection (e.g. 16); reject over-limit spawns.

### P2.2 — Web: `SidecarStdioMcpTransport`
- `src/lib/mcp/sidecar-stdio.ts` (new) — `implements McpTransport`:
  - Opens (or reuses) the shared `/ws/mcp` connection via `SidecarClient`.
  - `start()` → send `spawn` (resolve env secrets locally via the `KeyStore`:
    `createBrowserKeyStore().get(\`mcp:<serverId>:<name>\`)` for each `envKeyId`, the
    same `mcp:<serverId>:<name>` keys P0/M1 already manage); await the first stdout
    line as the implicit readiness signal, then return a placeholder `McpServerInfo`
    (real info comes from the `initialize` handshake the `McpClient` issues next).
  - `request(method, params)` → assign JSON-RPC `id`, write the envelope to stdin via
    `{kind:'stdin', data: JSON.stringify(envelope)}`, await the matching `stdout`
    frame (by `id`) on a pending-promises map; reject on error frame.
  - `notify(method, params)` → one-way stdin write.
  - `onNotification` / `onRequest` → route `stdout` frames that are notifications
    (no `id`) or server-initiated requests (have `id`, unmatched) to handlers.
  - `respond(id, result, error)` → write the JSON-RPC response to stdin.
  - `close()` → send `{kind:'kill'}`, drop handlers. (Child is killed server-side.)
  - Constructable only when `sidecarStatus.connected` (guard like the old `isTauri()`).

### P2.3 — Wire the transport picker + lifecycle
- `src/lib/mcp/client-factory.ts` — the stdio branch returns `new
  SidecarStdioMcpTransport(...)` when `sidecarStatus.connected`, else throws the
  clear "requires sidecar" error (same message P0.4 introduced).
- `src/lib/mcp/lifecycle.ts:68` — `if (config.transport === 'stdio' &&
  !sidecarStatus.connected) skip` (+ trace info, unchanged behavior).
- `src/lib/mcp/templates.ts` + `McpServers.svelte` — `isTemplateAvailable` for a
  stdio template = `sidecarStatus.connected` (http templates = always). Repurpose the
  `platforms` field semantics: stdio templates are listed when the sidecar is up; show
  a "connect the sidecar" hint + the `docker compose up` one-liner when it's down.

### P2.4 — Tests
- `sidecar/src/mcp.test.ts` — spawn a tiny in-repo stub stdio server
  (`tests/fixtures/stub-mcp-server.mjs`, reused from the existing Tauri plan) via the
  WS bridge; assert initialize/tools-list/tools-call round-trip, kill-on-close,
  kill-on-WS-disconnect, stderr captured, over-limit rejected.
- `src/lib/mcp/sidecar-stdio.test.ts` — against a fake WS (inject a mock
  `SidecarClient`): JSON-RPC id matching, notification routing, env-secret resolution
  before spawn, the sidecar-connected guard.

**DoD (Phase 2):** with `docker compose up`, `/settings → MCP Servers → Add → Brave`
→ set key → Trust → **Test** shows the Brave tools **in the browser**; `/chat` "search
the web for X" invokes `mcp.<id>.brave_web_search` and renders results. With the
sidecar down, stdio templates show "requires sidecar" and HTTP MCP still works.
`BRAVE_API_KEY` is **not** in the `settings` table (IndexedDB only).

**Depends on:** Phase 1.

---

## Phase 3 — LLM CORS proxy

> Goal: CORS-blocked providers (e.g. Anthropic) stream from the browser when the
> sidecar is connected, without `dangerous-direct-browser-access` hacks.

### P3.1 — Sidecar: streaming proxy
- `sidecar/src/llm-proxy.ts` (new) — `POST /api/llm/proxy`:
  - Body: `LlmProxyRequest` (`{ url; method; headers; body }`) — the browser resolves
    the auth header/secret locally (as `createFetchTransport` already does) and sends
    it. The sidecar does an opaque server-side `fetch`, streams the upstream body back
    to the client as the HTTP response (pass-through `ReadableStream`), mapping
    non-2xx to the same error shapes the web app already parses (`httpStatusToError`).
  - Honor `AbortController` / client disconnect → abort the upstream fetch.

### P3.2 — Web: route through the proxy when available
- `src/lib/ai/http-transport.ts` — in `getHttpTransport()`, when
  `sidecarStatus.connected && sidecarStatus.caps.includes('llm-proxy')`, return a
  `createSidecarProxyTransport()` that POSTs to `/api/llm/proxy` instead of direct
  `fetch`. Otherwise direct fetch (unchanged). The `auth` resolution stays in the
  browser either way (no key regression).
- `src/lib/ai/errors.ts` — the `CorsBlockedError` path now only surfaces when the
  sidecar is **absent** and a provider blocks CORS; the "use the desktop app" message
  in `formatProviderError` becomes "run the Mayon sidecar (`docker compose up`)".

**DoD (Phase 3):** configure Anthropic with the sidecar up → `/chat` streams Anthropic
with no CORS error; with the sidecar down the same request shows the "run the sidecar"
notice (was "use the desktop app"). Other (OpenAI-compatible) providers keep working
either way.

**Depends on:** Phase 1.

---

## Phase 4 — Sandbox DB (for MCP tools)

> Goal: the sidecar hosts a SQLite instance MCP tools / sandboxed compute can use;
> exposed to the web app via the `StorageDriver` seam (browsable, not primary).

### P4.1 — Sidecar: SQL endpoint
- `sidecar/src/db.ts` (new) — open a `better-sqlite3` DB at `/data/sandbox.sqlite`
  (the `sidecar-data` volume). `POST /api/db/query` (`DbQueryRequest` → `DbQueryResult`)
  executes `query/batch/exec` against it. WAL mode, `busy_timeout`. No cross-DB
  access; this is an isolated sandbox DB, **not** the app's OPFS store.

### P4.2 — Web: `SidecarDriver`
- `src/lib/db/driver/sidecar.ts` (new) — `implements StorageDriver`; each method POSTs
  to `/api/db/query`. Satisfies the exact contract `opfs-driver`/`tauri` did, so the
  drizzle `proxy` + migrations could run against it if ever desired (not wired as
  primary in this phase).
- Expose a thin "Sandbox DB" inspector under `/settings` (read-only table list + a
  query box), gated on `sidecarStatus.caps.includes('sandbox-db')`. Reaches the driver
  directly (this is a dev/power tool, not chat data) — keep it isolated from `repos`.

**DoD (Phase 4):** an MCP server configured to connect to the sandbox DB (connection
info surfaced in the sidecar `/api/health` or a settings field) can read/write it; the
inspector shows its tables. Data persists across sidecar restarts (volume).

**Depends on:** Phase 1.

---

## Phase 5 — Backup service

> Goal: server-side snapshot/restore of the sandbox DB volume (lowest-value cap;
> folds in cleanly once the volume exists).

### P5.1 — Sidecar + web backup endpoints
- `sidecar/src/backup.ts` (new) — `GET /api/backup/sandbox` (stream the
  `/data/sandbox.sqlite` file), `PUT /api/backup/sandbox` (replace it).
- `src/lib/components/settings/DataSection.svelte` — when the sidecar is up, add a
  "Sandbox DB backup" affordance (download/upload) alongside the existing OPFS
  download/upload. The OPFS backup path is unchanged (still browser-local).

**DoD (Phase 5):** download/restore the sandbox DB via the sidecar; OPFS backup
unchanged.

**Depends on:** Phase 4.

---

## Scope vs. out-of-scope

**In scope**
- Full Tauri removal (Phase 0) — clean browser-only local-first runtime.
- Optional local Node/TS sidecar: discovery + packaging (P1), stdio MCP runner (P2),
  LLM CORS proxy (P3), sandbox DB (P4), backup (P5).
- `isTauri()` → `isSidecar()` capability model; OPFS + IndexedDB remain source of truth.

**Out of scope**
- Hosted / multi-user / multi-tenant deployment (this is local self-hosted, single user).
- Per-MCP-container orchestration or Docker Engine API access (rejected model).
- Replacing OPFS as the app's primary store (the sandbox DB is for MCP tools only).
- A sidecar-side secret vault (browser remains source of truth; sidecar stateless).
- TLS/HTTPS termination for the sidecar (localhost/internal network; add at the nginx
  layer later if a remote deployment is ever needed).
- Auto-updater / single-instance (N/A for a web app; updates happen by redeploying).
- Tauri mobile.
- stdio MCP servers requiring non-Node runtimes (python, etc.) — the sidecar image is
  Node-based; future work = custom sidecar images or per-server containers.
- Salvaging the existing Rust code (explicitly chose a TS rewrite).

## Risks

- **Secret transit to sidecar.** Resolved secrets cross to the sidecar over the
  internal network for MCP env vars and the LLM proxy. Mitigation: same-origin via
  nginx, internal-only bind, no host port; the browser-fetch path already holds keys
  in JS so there's **no regression** vs. today's browser runtime. Document the TLS
  option for any future remote deployment.
- **Subprocess orphaning on sidecar crash.** Mitigation: kill-all-children on WS
  disconnect (P2.1) + a boot sweep of stale children (best-effort).
- **npx supply-chain (stdio servers).** Unchanged from the desktop model: trust-on-spawn
  + absolute-path warning + the existing trust-hash gate (`trust.ts`). Document loudly.
- **Sidecar image runtime mismatch.** A stdio MCP server needing python/binaries won't
  run in the Node-alpine sidecar. Mitigation: surface the spawn error clearly; future
  custom images are out of scope.
- **Capability-gating drift.** If a cap is advertised but its route isn't implemented,
  the UI offers a broken feature. Mitigation: `/api/health` advertises **only landed**
  caps; the UI gates strictly on `sidecarStatus.caps`.
- **Discoverability confusion.** Browser-only users must understand why stdio MCP is
  hidden. Mitigation: every gated surface shows the one-line "run `docker compose up`"
  hint + the SidecarStatus badge.

## Validation

- **Automated (CI, every phase):** `pnpm lint && pnpm check && pnpm test` green. New
  vitest suites: `detectSidecar` (P1), sidecar MCP bridge + `SidecarStdioMcpTransport`
  against a fake WS (P2), proxy transport (P3), `SidecarDriver` against a fake HTTP
  (P4). The sidecar's own tests run under its package.
- **Manual, browser + sidecar:** per-phase DoD above. The canonical end-to-end gate:
  `docker compose up` → header shows "Sidecar: connected" → `/settings` adds a stdio
  MCP server (Brave) → key in IndexedDB only → `/chat` streams a real tool call →
  Anthropic streams with no CORS error → sandbox DB inspector works. With the sidecar
  stopped, the app degrades gracefully to the Phase-0 browser-only experience.
- **No regression:** the existing P0/P1 browser gates (DB ready, theme persists,
  provider streaming, HTTP MCP) pass unchanged after every phase.

## Dependency graph + recommended sequence

```
P0 (remove Tauri) ──┬─→ P1 (skeleton/discovery/packaging) ──┬─→ P2 (stdio MCP) ──→ P5 (backup)
                    │                                        ├─→ P3 (LLM proxy)
                    │                                        └─→ P4 (sandbox DB) ──→ P5
```

- **P0 first** (independently shippable; collapses the runtime cleanly).
- **P1 next** (establishes the workspace, sidecar, discovery, packaging — every later
  phase depends on it).
- **P2/P3/P4 in parallel** after P1 (independent capabilities, all plug into the P1
  seams). **P2 is the headline — prioritize it.**
- **P5 last** (lowest value; needs the P4 volume).

Ship Phase 0 alone as soon as it's green — it is a complete, valuable state (a leaner
browser-only app) regardless of whether the sidecar work continues immediately.
