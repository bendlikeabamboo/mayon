# Phase 1 — Sidecar skeleton: workspace, server, discovery, packaging

Source of truth: `.kilo/plans/1783749811883-container-forward-web-transition.md` (Phase 1 section).
This plan is the implementation task list extracted and refined from the master plan.

> **Prerequisite:** Phase 0 must be landed (green) first. Phase 0 work is currently
> **uncommitted in the working tree** (`git status` shows Tauri deletions + collapsed
> runtime fork). Before starting P1, commit/verify P0: `rg '@tauri-apps' src` empty,
> `rg 'isTauri' src` returns only the def + re-export, `pnpm install && pnpm lint && pnpm
> check && pnpm test` green. P1 deletes the leftover `isTauri()`.

## Resolved decisions (from planning interview)

1. **Sidecar framework = Fastify + `@fastify/websocket`.** First-class per-connection
   WebSocket (needed for the P2 stdio relay) and clean HTTP+SSE streaming (P3 proxy) on
   Node. Hono's WS-on-node story was rejected (drops to raw `ws` on `upgrade`).
2. **Shared protocol package = source-only, no build.** `packages/shared` ships only
   `src/*.ts`; its `package.json` `exports` point at source. The web app (Vite) and the
   sidecar dev (`tsx`) import TS directly; the sidecar **production** build bundles
   `@mayon/shared` inline via **tsup**. No build-order coordination, HMR-friendly.
3. **Capability advertising = "landed caps only."** In P1 **no capability is implemented**,
   so `/api/health` returns `caps: []`. The badge shows "Sidecar: connected" (no caps).
   Each later phase appends its cap (`stdio-mcp`→P2, `llm-proxy`→P3, `sandbox-db`→P4,
   `backup`→P5). The UI gates strictly on `sidecarStatus.caps`, so advertising nothing
>  means nothing is wrongly enabled.
4. **Sidecar version** is read from `sidecar/package.json` at startup (via
   `node:fs`/`import.meta.url`, not a build-time define).
5. **Badge location** = the sidebar footer, immediately next to `DbStatus` (AppShell
   `:113-117`), not a top header. Mirrors the existing `DbStatus.svelte` styling.

## Seams this phase reuses (verify against these — don't reinvent)

- **Status store pattern:** `src/lib/stores/db.svelte.ts` — `$state` class with
  `markReady`/`markError`. Mirror it for `sidecarStatus`.
- **Badge pattern:** `src/lib/components/DbStatus.svelte` + its slot in
  `AppShell.svelte:113-117`.
- **Boot flow:** `src/routes/+layout.svelte:15` (`void bootstrapDb().then(...)`). Sidecar
  detection is a parallel fire-and-forget promise, non-fatal.
- **`isTauri()` to remove:** def at `src/lib/db/driver/client.ts:7-9`, re-export at
  `src/lib/db/index.ts:4`. **No other callers exist** (confirmed: `rg 'isTauri' src`).
- **Container scaffolding to extend:** `Dockerfile`, `docker/nginx.conf`,
  `docker-compose.yml`, `vite.config.ts`, `eslint.config.js`, `.dockerignore`.

## Hard rules (from AGENTS.md — non-negotiable)

- The sidecar **binds only to the internal docker network** — never a host `ports:` mapping
  in `docker-compose.yml`. nginx is the single same-origin entry point.
- `detectSidecar()` must treat **any** non-2xx / network error / timeout as `null` and
  **never** throw or spam the console (the app is fully functional without the sidecar).
- After `pnpm install` (which regenerates the lockfile), the lockfile is committed; both
  Dockerfiles use `--frozen-lockfile`.

---

## Task list (dependency-ordered)

### T1 — pnpm workspace + `@mayon/shared` package (source-only)

- **`pnpm-workspace.yaml`** (new):
  ```yaml
  packages:
    - '.'
    - 'sidecar'
    - 'packages/*'
  ```
- **`packages/shared/package.json`** (new) — `name: "@mayon/shared"`, `version: "0.0.1"`,
  `private: true`, `type: "module"`, `exports: { ".": "./src/index.ts" }`,
  `types: "./src/index.ts"`, `sideEffects: false`. **No build script, no deps.**
- **`packages/shared/tsconfig.json`** (new) — minimal: `{ "compilerOptions": {
  "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true,
  "skipLibCheck": true, "verbatimModuleSyntax": true } }`. (Not `composite` — there is no
  build step, so project references aren't needed; deviation from master plan, justified.)
- **`packages/shared/src/index.ts`** (new) — re-export from `./protocol`.
- **`packages/shared/src/protocol.ts`** (new) — the wire contract for **all** phases (only
  `HealthResponse` is exercised in P1; the rest are reserved, refined in their phase):
  ```ts
  // --- P1 (used) ---
  export type SidecarCap = 'stdio-mcp' | 'sandbox-db' | 'llm-proxy' | 'backup';
  export interface HealthResponse { ok: true; version: string; caps: SidecarCap[] }

  // --- P2 (reserved; refined in Phase 2) ---
  export interface McpSpawn { serverId: string; command: string; args: string[]; env: Record<string,string>; cwd?: string }
  export type McpFrameKind = 'spawn' | 'stdin' | 'stdout' | 'stderr' | 'exit' | 'kill';
  export interface McpFrame { serverId: string; kind: McpFrameKind; data?: string; code?: number; spawn?: McpSpawn }

  // --- P3/P4/P5 (reserved; shapes finalized in their phases) ---
  // DbQueryRequest/DbQueryResult, LlmProxyRequest/stream, BackupSnapshot/Restore
  ```
- **Root `package.json`** — add `@mayon/shared` (`workspace:*`) to `dependencies`. Add
  script `"dev:sidecar": "pnpm --filter @mayon/sidecar dev"` and
  `"test:all": "pnpm -r test"` (keeps `test` as web-only per AGENTS.md).

### T2 — Sidecar server (Fastify), health + WS stub

- **`sidecar/package.json`** (new) — `name: "@mayon/sidecar"`, `private: true`,
  `type: "module"`, `version: "0.0.1"`. Scripts: `dev` (`tsx watch src/server.ts`),
  `build` (`tsup src/server.ts --format esm --target node22 --out-dir dist`),
  `start` (`node dist/server.js`), `test` (`vitest run`).
  Deps: `fastify`, `@fastify/websocket`, `@mayon/shared` (`workspace:*`).
  DevDeps: `tsx`, `tsup`, `typescript`, `@types/node`, `vitest`.
- **`sidecar/tsconfig.json`** (new) — standalone (does **not** extend the SvelteKit root
  tsconfig): `target ES2022`, `module ESNext`, `moduleResolution bundler`, `strict`,
  `skipLibCheck`, `verbatimModuleSyntax`, `types: ["node"]`, `lib: ["ES2022"]`.
- **`sidecar/src/version.ts`** (new) — read version from `package.json` at startup:
  ```ts
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { dirname, resolve } from 'node:path';
  const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  export const VERSION: string = pkg.version;
  ```
  (After tsup bundles to `dist/`, the `../package.json` still resolves from `dist/` to
  `sidecar/package.json` — verify the runtime path matches; if tsup emits a single file at
  `dist/server.js`, `../package.json` = `dist/../package.json` = `sidecar/package.json`. ✓)
- **`sidecar/src/server.ts`** (new) — export `buildApp()` (returns Fastify instance, for
  tests) and `start()` (listens on `process.env.PORT ?? 4319`, host `0.0.0.0`):
  - Register `@fastify/websocket`.
  - `GET /api/health` → `return { ok: true, version: VERSION, caps: [] }` (`HealthResponse`;
    empty caps in P1 per decision #3).
  - WS route `/ws/mcp` → **P1 stub**: on connection, send one JSON frame
    `{ ok: false, error: 'stdio MCP bridge not implemented until Phase 2' }` then
    `socket.close(1001)`. (P2 replaces this with the real relay.)
  - `start()` logs `sidecar listening on :${PORT}`.
- **`sidecar/src/config.ts`** (optional helper) — `PORT`, host. Keep tiny; can inline in
  `server.ts`.

### T3 — Web: sidecar client + detection + reactive status (replace `isTauri`)

- **`src/lib/sidecar/status.svelte.ts`** (new) — mirror `db.svelte.ts`:
  ```ts
  import type { SidecarCap } from '@mayon/shared';
  class SidecarStatusState {
    connected = $state(false);
    caps = $state<SidecarCap[]>([]);
    version = $state<string | null>(null);
    error = $state<string | null>(null);
    markConnected(h: { version: string; caps: SidecarCap[] }) {
      this.connected = true; this.caps = h.caps; this.version = h.version; this.error = null;
    }
    markDisconnected(err?: string) {
      this.connected = false; this.caps = []; this.version = null; this.error = err ?? null;
    }
    has(cap: SidecarCap) { return this.caps.includes(cap); }
  }
  export const sidecarStatus = new SidecarStatusState();
  ```
- **`src/lib/sidecar/detect.ts`** (new) —
  ```ts
  import type { HealthResponse } from '@mayon/shared';
  export async function detectSidecar(): Promise<HealthResponse | null> {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const body = (await res.json()) as HealthResponse;
      return body && body.ok ? body : null;
    } catch {
      return null; // timeout / network / proxy error → sidecar absent, never throw
    }
  }
  ```
- **`src/lib/sidecar/client.ts`** (new) — `SidecarClient` with `http(path, init)` =
  `fetch(path, init)` (same-origin) and a `ws(): WebSocket` factory returning
  `new WebSocket('/ws/mcp')`. **Only `http` is used in P1** (by `detect`); `ws()` is the
  seam P2 consumes. Export a singleton `sidecarClient`.
- **`src/lib/db/driver/client.ts`** — **delete `isTauri()`** (lines 7-9).
- **`src/lib/db/index.ts`** — remove `isTauri` from the re-export on line 4
  (`export { bootstrapDb, getDb, getDriver, rebootstrapWith } from './driver/client';`).
- **`src/routes/+layout.svelte`** — add a parallel fire-and-forget detect alongside
  `bootstrapDb()`:
  ```ts
  import { detectSidecar } from '$lib/sidecar/detect';
  import { sidecarStatus } from '$lib/sidecar/status.svelte';
  // ...after the existing bootstrapDb() chain:
  void detectSidecar().then((h) => {
    if (h) sidecarStatus.markConnected(h);
    else sidecarStatus.markDisconnected();
  });
  ```
  Non-fatal; app works identically if it resolves null.

### T4 — Dev (Vite) + prod (nginx) reverse proxy

- **`vite.config.ts`** — add a `server.proxy` block (keep `crossOriginIsolation` plugin
  intact — same-origin proxying does not affect COOP/COEP on the HTML document):
  ```ts
  server: {
    proxy: {
      '/api': 'http://localhost:4319',
      '/ws': { target: 'http://localhost:4319', ws: true }
    }
  }
  ```
- **`docker/nginx.conf`** — add (before the regex `location` blocks):
  ```nginx
  location /api/ {
    proxy_pass http://sidecar:4319;
  }
  location /ws/ {
    proxy_pass http://sidecar:4319;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
  }
  ```
  (Docker Compose DNS resolves the `sidecar` service name.)

### T5 — Container packaging (multi-service)

- **`sidecar/Dockerfile`** (new, multi-stage, `node:22-alpine`):
  ```dockerfile
  FROM node:22-alpine AS build
  WORKDIR /app
  RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY packages/shared/package.json packages/shared/
  COPY sidecar/package.json sidecar/
  RUN pnpm install --frozen-lockfile --filter @mayon/sidecar...
  COPY packages/shared packages/shared
  COPY sidecar sidecar
  RUN pnpm --filter @mayon/sidecar build
  FROM node:22-alpine
  WORKDIR /app
  COPY --from=build /app/sidecar/package.json ./package.json
  COPY --from=build /app/sidecar/dist ./dist
  ENV PORT=4319
  EXPOSE 4319
  CMD ["node", "dist/server.js"]
  ```
  - Base is `node:22-alpine`: includes `npm`/`npx` (required for P2 stdio spawns via
    `npx -y ...`). Note: alpine = musl; **P4's `better-sqlite3`** may need alpine native
    build deps then — out of P1 scope, flagged in risks.
- **`docker-compose.yml`** — extend:
  ```yaml
  services:
    web:
      build: .
      ports: ['8080:80']
      depends_on: [sidecar]
      restart: unless-stopped
    sidecar:
      build: ./sidecar
      expose: ['4319']      # internal network only — NO ports:
      volumes: ['sidecar-data:/data']
      restart: unless-stopped
  volumes:
    sidecar-data:
  ```
  - `web.depends_on: [sidecar]` only orders startup; `web` still boots fine if sidecar is
    unhealthy (detect resolves null). The `sidecar-data` volume is mounted for P4/P5.
- **Root `Dockerfile`** — update the install step for the workspace (web needs
  `@mayon/shared`; lean filter avoids pulling the sidecar's fastify into the web image):
  ```dockerfile
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY packages/shared/package.json packages/shared/
  COPY sidecar/package.json sidecar/
  RUN pnpm install --frozen-lockfile --filter mayon...
  COPY . .
  RUN pnpm build
  ```
  (Pin corepack to `pnpm@10.15.0` to match `packageManager`; current `pnpm@10` drifts.)
- **`.dockerignore`** — no change needed (already ignores `node_modules/`, `build/`,
  `dist/`, `.svelte-kit/` everywhere; does not ignore `sidecar/` or `packages/`).
- **`eslint.config.js`** — add `'sidecar/dist/'` and `'packages/*/dist/'` to `ignores`.

### T6 — Sidecar status badge (UI)

- **`src/lib/components/SidecarStatus.svelte`** (new) — mirror `DbStatus.svelte` styling:
  - `sidecarStatus.connected` → emerald badge: icon + `Sidecar: connected` (+ `(v{version})`
    if version). Tooltip/title: `Mayon sidecar capabilities: ${caps.join(', ') || 'none yet'}`.
  - else → muted badge: `Sidecar: off` with title `Browser-only (run \`docker compose up\`
    for the sidecar)`. Accept the same `collapsed` prop as `DbStatus`.
- **`src/lib/components/AppShell.svelte`** — import + render `<SidecarStatus />` in the
  sidebar footer block at `:113-117`, immediately after `<DbStatus />`.

### T7 — Tests

- **`src/lib/sidecar/detect.test.ts`** (new, vitest) — mock `globalThis.fetch`:
  1. 200 + `{ ok:true, version, caps:[] }` → returns the `HealthResponse`.
  2. 500 / 404 → returns `null`.
  3. fetch rejects (network error) → returns `null`.
  4. timeout (`AbortSignal.timeout` elapses, use fake timers) → returns `null`.
  Assert it **never throws**.
- **`sidecar/src/server.test.ts`** (new, vitest under the sidecar package):
  1. `buildApp().inject({ method:'GET', url:'/api/health' })` → 200, body
     `{ ok:true, version, caps:[] }`.
  2. WS stub: connect a `ws` client to a started server on an ephemeral port → receives
     the `{ ok:false, error:'...not implemented until Phase 2' }` frame, then closes.

---

## Definition of Done (Phase 1)

- `pnpm install && pnpm lint && pnpm check && pnpm test` green; `pnpm -r test` (root
  `test:all`) runs both the web suite and the sidecar suite green.
- `rg 'isTauri' src` returns **nothing** (fully removed).
- **Dev (no Docker):** `pnpm --filter @mayon/sidecar dev` in one terminal, `pnpm dev` in
  another → badge shows "Sidecar: connected (v0.0.1)"; `GET http://localhost:5173/api/health`
  returns the health JSON (proxied). Stop the sidecar → reload → badge shows "Sidecar: off"
  and the app behaves exactly as after Phase 0.
- **Docker:** `docker compose up --build` → both services start; `web` healthcheck passes;
  `http://localhost:8080` shows "Sidecar: connected"; `GET http://localhost:8080/api/health`
  returns health JSON (nginx → sidecar). The sidecar port is **not** host-mapped.
- **Graceful absence:** with no sidecar reachable (dev or `docker compose stop sidecar`),
  the app boots, DB reaches ready, theme persists, `/chat` streams, `/settings` works —
  identical to Phase 0.

## Validation

- **Automated:** new vitest suites in T7. CI runs `pnpm lint && pnpm check && pnpm test`
  (web) + the sidecar suite. `pnpm -r test` covers all workspace packages.
- **Manual:** the DoD scenarios above. Canonical end-to-end: `docker compose up` → header
  badge "Sidecar: connected" → `curl localhost:8080/api/health` → `{ok:true,version,caps:[]}`.
- **No regression:** the Phase 0 browser gates (DB ready, theme persists, provider
  streaming, HTTP MCP) pass unchanged.

## Risks (P1-specific)

- **`AbortSignal.timeout` support:** fine in modern browsers; the catch-all returns `null`
  on any failure so older browsers degrade to "off" rather than throwing.
- **Workspace install in Docker:** `--filter <name>...` must match the exact package names
  (`mayon`, `@mayon/sidecar`); a typo silently installs nothing. Mitigation: pinned names +
  `--frozen-lockfile` fails loud if the lockfile is out of sync.
- **tsup runtime `package.json` path:** the version-read resolves `dist/../package.json`.
  Verify after a real `tsup` build that `dist/server.js` is at `sidecar/dist/server.js`
  (one level under `sidecar/`), so `../package.json` = `sidecar/package.json`. If tsup
  flattens differently, adjust the relative path or pass version via `define`.
- **Vite optimizing a source-only workspace dep:** Vite should bundle `@mayon/shared` TS
  source as part of the module graph. If it errors, add it to `optimizeDeps.include` —
  verify on first `pnpm dev`.
- **Sidecar image for P4 native deps:** `better-sqlite3` on alpine/musl may need native
  build tools. Out of P1 scope (no native deps yet); revisit in Phase 4.

## Out of scope (deferred)

- Any actual capability (`stdio-mcp`=P2, `llm-proxy`=P3, `sandbox-db`=P4, `backup`=P5).
  `/api/health` advertises `caps: []`.
- Sandbox DB volume contents (volume is created/mounted but unused until P4).
- Sidecar reconnection/retry (P1 detects once at boot; reactive re-probe can come later).
- TLS/HTTPS, single-instance, auto-update (N/A for a web app).
- Native (non-Node) stdio MCP runtimes in the sidecar image.

## What later phases plug into (the seams P1 establishes)

- `@mayon/shared/src/protocol.ts` — the wire contract (append caps + refine reserved types).
- `sidecar/src/server.ts` `buildApp()` — add the `/ws/mcp` relay (P2), `/api/llm/proxy`
  (P3), `/api/db/query` (P4), `/api/backup/*` (P5); each phase appends its cap to the
  `/api/health` `caps` array.
- `sidecarStatus` store + `sidecarClient.ws()` — P2's `SidecarStdioMcpTransport` and
  P3's proxy transport gate on these.
- Root Dockerfile / docker-compose / nginx proxy — already wired for `/api` + `/ws`.
