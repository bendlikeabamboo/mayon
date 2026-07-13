# AGENTS.md

Guidance for AI agents (and humans) working in this repo. The authoritative
design source is `docs/dev/architecture.qmd` (rendered in the Quarto docs site).
Historical design notes live in `refinement/`. The active implementation plan lives
in `.kilo/plans/`.

## Stack

- **SvelteKit** (Svelte 5 runes) as a static SPA via `@sveltejs/adapter-static` (no SSR).
- **Tailwind v4** (CSS-first, `@import "tailwindcss"`) + **shadcn-svelte** (bits-ui).
- **SQLite** everywhere via one shared **drizzle** schema behind a single
  `StorageDriver` seam (browser = sqlite-wasm + OPFS in a worker; tests = in-memory
  sql.js). An optional local **server** container adds a sandbox SQLite for MCP tools.
- **Optional server** (Node/TypeScript, Docker): unlocks browser-impossible capabilities
  — stdio MCP runner, LLM CORS proxy, sandbox DB, backup. The app is 100% functional
  without it.
- **Toolchain pins:** Node 22 (`.nvmrc`), pnpm 10 (`packageManager`). No bun, no Rust.

## Commands

| Command                            | What it does                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                     | Install dependencies.                                                                                                      |
| `pnpm dev`                         | Run the SvelteKit SPA dev server (http://localhost:5173).                                                                  |
| `pnpm --filter @mayon/server dev`  | Run the server dev server (http://localhost:4319) in watch mode.                                                           |
| `pnpm build`                       | Build the SPA into `build/`.                                                                                               |
| `pnpm check`                       | Type-check with `svelte-check`.                                                                                            |
| `pnpm lint`                        | ESLint (flat config) + Prettier `--check`.                                                                                 |
| `pnpm format`                      | Prettier `--write`.                                                                                                        |
| `pnpm test`                        | Vitest (in-memory driver) — run once.                                                                                      |
| `pnpm test:watch`                  | Vitest in watch mode.                                                                                                      |
| `pnpm --filter @mayon/server test` | Vitest for the server package.                                                                                             |
| `pnpm db:generate`                 | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                              |
| `pnpm db:studio`                   | Open Drizzle Studio against the schema.                                                                                    |
| `pnpm bundle:migrations`           | Re-bundle `drizzle/` SQL + journal into `src/lib/db/driver/migrations.ts` (run after every `db:generate` before shipping). |
| `docker compose up`                | Run the web SPA + server together (web on :8080, server internal-only).                                                    |

Always run `pnpm bundle:migrations` after `pnpm db:generate` so the SPA can run the
new migration offline (no runtime `fs`).

## Architecture boundaries (do not violate)

- **Components/stores call repositories only** — never import `db` directly. The drizzle
  `db` object is private to `src/lib/db/` (exposed via `getDb()` / `repos`).
- **`StorageDriver`** (`src/lib/db/driver/types.ts`) is the single storage seam:
  `query` / `batch` / `exec`. Drizzle + schema + repositories live on the main thread;
  drivers are dumb SQL executors (the OPFS worker literally just runs SQL over `postMessage`).
- **Runtime is browser-only.** Postgres via the server is the primary store (P-pg-2). The optional server is detected at boot via `detectServer()` and progressively enables features (stdio MCP, LLM CORS proxy, sandbox DB, backup, PG) based on advertised capabilities.
- **No secrets in `settings`.** Provider config holds non-secret handle fields only; API
  the browser resolves them locally and includes them in same-origin proxied requests.

## Manual acceptance gates (P-pg-2)

P-pg-2 flips the browser's primary driver to Postgres via the server and makes the schema,
proxy, and migrations Postgres-native. The app is server-required for function in this phase.

- **Browser + server + PG:** `docker compose up` → server logs `pg: ready` and `pg: migrations applied`; header badge reaches **DB ready (pg)**; `GET /api/health` returns `caps` including `'pg'`. Dev self-check passes (writes/reads/deletes a chats row via repos). Create a chat, append a message, and read it back — data round-trips through the browser against the PG primary.
- **Server-down:** `docker compose stop server` → reload → badge shows **DB error** (full-screen "Server unreachable" UX is P-pg-3). `POST /api/db/query` returns 503.
- **PG-down:** `docker compose stop db` → restart server → `'pg'` cap absent from `/api/health`; `/api/db/query` returns 503.
- **Sandbox regression:** Settings → Sandbox DB inspector still works (`/api/sandbox/query` untouched).
- **Migrations:** a single `drizzle/0000_*.sql` migration exists (dialect `postgresql`). The server runs drizzle's native `migrate()` at boot; migrations gate on pool connect + migrations applied (`'pg'` cap).
- **OPFS backup suspended:** the Settings → Data UI hides "Download backup" and "Restore from backup" buttons until P-pg-5. `backup.ts` throws "Backup/restore returns in P-pg-5 (pg_dump/pg_restore)."
- **Search stubbed:** `repos.search.search()` returns `[]`; `fts5Available()` returns `false`; `rebuildIndex()` is a no-op. (FTS port to `tsvector`/GIN/`ts_headline` is P-pg-4.)
- **Tests:** `pnpm lint && pnpm check && pnpm test` green with testcontainers PG; `pnpm --filter @mayon/server test` green. All tests now use a per-test-schema PG driver (`bootstrapTestDb`).

> The schema flip to `pg-core`, proxy flip to `pg-proxy`, server native `migrate()`, browser RemotePgDriver wiring, and testcontainer setup are covered by the automated test suites.

## Manual acceptance gates (P0)

There is no chat UI in P0 (lands in P2). The observable persistence signal is the
**theme toggle** (persisted to the `settings` KV) plus the **dev self-check**
(`DbStatus` badge). The self-check is dev-only (`import.meta.env.DEV`): on each boot it
writes/reads/deletes a `chats` row via the repository and shows pass/fail.

- **Browser (OPFS):** `pnpm dev` → open http://localhost:5173 → the header badge reaches
  **DB ready** (`browser`) and (in dev) self-check passes; toggle the theme and **reload
  the tab** → the theme survives (proving OPFS persistence). Storage lives in the origin's
  OPFS as `file:mayon.sqlite`.
- **First-run/empty DB:** migrations run clean (covered by the automated Vitest suite
  against the in-memory driver).
- **Unsupported browser:** if OPFS is unavailable, the badge shows a clear **DB error**
  with a "use a modern browser" message (never silent).

## Manual acceptance gates (P1)

P1 delivers the provider/AI layer: configure a provider, persist its config + key,
and stream a real reply. The `/chat` route is an **ephemeral streaming demo** (no
persistence — the real chat lands in P2); `/settings` has the provider config UI.

- **Browser:** `pnpm dev` → open `/settings` → **Add provider** → pick a template
  (Z.AI/GLM is OpenAI-compatible and the default; OpenRouter and Kilo Gateway are
  OpenAI-compatible gateways; OpenAI, Anthropic, Gemini, and a local Ollama server
  are also available) → edit base URL / default model if needed → paste the
  **API key** → **Save key** → **Set active**. The gateways (OpenRouter / Kilo
  Gateway / Z.AI) auto-discover their model catalog via the `/models` endpoint and
  offer a searchable model picker; **Reload the tab** → the provider config and key
  survive (proving settings-KV persistence). Then go to `/chat`, type a prompt, and
  tokens stream in live.
- **Provider switch:** add a second provider, **Set active** to it, stream again.
- **CORS fallback (best-effort):** configure Anthropic in the browser; if the provider
  blocks the request, `/chat` shows the **"Start the Mayon server (`docker compose up`)
  for CORS-free access"** notice (from `formatProviderError` on a `CorsBlockedError`)
  rather than a raw error.

> The streaming transport, adapters, error mapping, and context assembly are covered by
> the automated Vitest suite (`pnpm test`). Provider keys are never echoed back in the
> UI after save (the key field is masked with a "replace key" affordance).

## Manual acceptance gates (P2)

P2 ships the stdio MCP runner via the server: when the server is connected and
advertises the `stdio-mcp` cap, stdio MCP servers (Brave, Filesystem, GitHub, custom)
work in the browser over a WebSocket bridge. HTTP MCP servers work with or without the
server.

- **Browser + server:** `docker compose up` → header badge shows **Server:
  connected** with `stdio-mcp` in the cap list → `/settings → MCP Servers → Add → Brave`
  → set key → Trust → **Test** shows the Brave tools in the browser → `/chat` "search
  the web for X" invokes `mcp.<id>.brave_web_search` and renders results.
- **Server down:** stdio templates show "Requires the Mayon server" and a
  `docker compose up` hint; HTTP MCP servers still connect.
- **Key security:** `BRAVE_API_KEY` is **not** in the `settings` table (IndexedDB only);
  the server receives it only in the spawn env (transient, internal network).

> The WS bridge, `ServerStdioMcpTransport`, transport picker wiring, and lifecycle
> gating are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/server test` for server).

## Manual acceptance gates (P3)

P3 ships the LLM CORS proxy via the server: when the server is connected and
advertises the `llm-proxy` cap, CORS-blocked providers (e.g. Anthropic) stream
from the browser through the server's `POST /api/llm/proxy` route. When the
server is absent, the app behaves as before (direct browser fetch; Anthropic
shows the server fallback notice).

- **Browser + server:** `docker compose up` → header badge shows **Server:
  connected** with `llm-proxy` in the cap list; `GET /api/health` returns
  `caps: ['stdio-mcp','llm-proxy']`. Open `/settings` → configure **Anthropic**
  (key saved) → `/chat` streams an Anthropic reply with **no CORS error**;
  DevTools network shows the request going same-origin to `/api/llm/proxy`, not
  `api.anthropic.com`. **Stop** during a stream aborts cleanly.
- **Server down:** stop the server → Anthropic surfaces the **"Start the Mayon
  server (`docker compose up`) for CORS-free access"** notice. OpenAI-compatible
  providers (Z.AI, OpenRouter, OpenAI) keep streaming via direct fetch.
- **Model discovery** (`/models` on gateways) still works, now also proxied when
  the cap is present.
- **Key security:** the provider API key is **not** in the `settings` table
  (IndexedDB only); the server receives it only in the proxied request's
  headers (transient, internal network).

> The proxy route, web proxy-fetch helper, seam routing, and nginx buffering
> fix are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/server test` for server). Validate with `pnpm
lint && pnpm check && pnpm test` (root) and `pnpm --filter @mayon/server
test`.

## Manual acceptance gates (P4)

P4 ships an isolated sandbox SQLite in the server, exposed via `POST /api/sandbox/query`
and a read-write inspector under `/settings`. OPFS remains the app's sole primary
store; this DB never holds app data or secrets. (The sandbox inspector's route moved
from `/api/db/query` to `/api/sandbox/query` in P-pg-1; `/api/db/query` is now the
PG-backed primary-DB route. `GET /api/health` may also advertise a `'pg'` cap when the
server's Postgres pool is live.)

- **Browser + server:** `docker compose up` → header badge shows **Server:
  connected** with `sandbox-db` in the cap list → `/settings` shows the
  **Sandbox DB** section with the path `/data/sandbox.sqlite` → run
  `CREATE TABLE notes(id INTEGER PRIMARY KEY, t TEXT)` then
  `INSERT INTO notes(t) VALUES('hi')` in the query box → `SELECT * FROM notes`
  renders a table with headers `id`/`t` and the row.
- **MCP integration:** copy the surfaced path; add a **custom stdio** MCP server
  whose args point at it → it reads the same `notes` row.
- **Persistence:** `docker compose restart server` → data persists (volume).
- **Server down:** stop the server → the Sandbox DB section is hidden and the
  rest of the app is unaffected.
- **Security:** the sandbox DB holds no app data and no secrets; the inspector
  never touches app tables.

> The SQL endpoint, `RemotePgDriver`, inspector client, and updated health caps
> are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/server test` for server). Validate with `pnpm
lint && pnpm check && pnpm test` (root) and `pnpm --filter @mayon/server
test`.

## Manual acceptance gates (P5 — sandbox DB backup)

P5 ships server-side snapshot/restore of the sandbox DB (MCP-tool data at
`/data/sandbox.sqlite`) via two server routes, surfaced as a "Sandbox DB backup"
affordance in Settings. The OPFS app-DB backup is unchanged.

- **Browser + server:** `docker compose up` → header badge shows **Server:
  connected** with `backup` in the cap list; `GET /api/health` returns `caps:
['stdio-mcp','llm-proxy','sandbox-db','backup']`. Open `/settings` → scroll to
  the "Sandbox DB" section → **Download sandbox backup** yields a valid `.sqlite`
  file (opens in a SQLite client, contains current sandbox data).
- **Restore:** upload a previously downloaded backup via **Restore sandbox backup** →
  the sandbox DB is replaced; a subsequent download matches the restored bytes.
- **Non-SQLite rejection:** uploading a non-SQLite file shows a clear error; the
  live DB is untouched.
- **Consistency:** download a backup **while** an MCP tool is writing to the
  sandbox DB → the downloaded file is valid (not torn).
- **Server down:** stop the server → the "Sandbox DB" section is hidden; the
  OPFS Download/Restore buttons work exactly as before (no regression).
- **Persistence:** `docker compose restart server` → sandbox data persists
  (`sidecar-data` volume). Volume name `sidecar-data` is intentionally unchanged; its rename is deferred to P-pg-7.
