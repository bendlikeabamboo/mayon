# AGENTS.md

Guidance for AI agents (and humans) working in this repo. The authoritative
design source is `docs/dev/architecture.qmd` (rendered in the Quarto docs site).
Historical design notes live in `refinement/`. The active implementation plan lives
in `.kilo/plans/`.

## Stack

- **SvelteKit** (Svelte 5 runes) as a static SPA via `@sveltejs/adapter-static` (no SSR).
- **Tailwind v4** (CSS-first, `@import "tailwindcss"`) + **shadcn-svelte** (bits-ui).
- **Postgres** everywhere via one shared **drizzle** schema behind a single
  `StorageDriver` seam (browser → server via RemotePgDriver; tests = pglite).
  The **server** container also hosts a sandbox SQLite for MCP tools.
- **Server** (Node/TypeScript, Docker): required for app function
  — Postgres primary store, stdio MCP runner, LLM CORS proxy, sandbox DB, backup.
- **Toolchain pins:** Node 22 (`.nvmrc`), pnpm 10 (`packageManager`). No bun, no Rust.

## Commands

| Command                            | What it does                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm install`                     | Install dependencies.                                                         |
| `pnpm dev`                         | Run the SvelteKit SPA dev server (http://localhost:5173).                     |
| `pnpm --filter @mayon/server dev`  | Run the server dev server (http://localhost:4319) in watch mode.              |
| `pnpm build`                       | Build the SPA into `build/`.                                                  |
| `pnpm check`                       | Type-check with `svelte-check`.                                               |
| `pnpm lint`                        | ESLint (flat config) + Prettier `--check`.                                    |
| `pnpm format`                      | Prettier `--write`.                                                           |
| `pnpm test`                        | Vitest (pglite test driver) — run once.                                       |
| `pnpm test:watch`                  | Vitest in watch mode.                                                         |
| `pnpm --filter @mayon/server test` | Vitest for the server package.                                                |
| `pnpm db:generate`                 | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`. |
| `pnpm db:studio`                   | Open Drizzle Studio against the schema.                                       |
| `pnpm dev:deps`                    | Start db + server in Docker (deps for `pnpm dev`).                            |
| `docker compose up`                | Run the web SPA + server together (web on :8080, server internal-only).       |

## Architecture boundaries (do not violate)

- **Components/stores call repositories only** — never import `db` directly. The drizzle
  `db` object is private to `src/lib/db/` (exposed via `getDb()` / `repos`).
- **`StorageDriver`** (`src/lib/db/driver/types.ts`) is the single storage seam:
  `query` / `batch` / `exec`. Drizzle + schema + repositories live on the main thread;
  drivers are dumb SQL executors (RemotePgDriver sends SQL over the network to Postgres).
- **Runtime requires the server.** Postgres via the server is the primary store (P-pg-2). The server is detected at boot via `detectServer()` and progressively enables features (stdio MCP, LLM CORS proxy, sandbox DB, backup, PG) based on advertised capabilities.
- **No secrets in `settings`.** Provider config holds non-secret handle fields only; API
  the browser resolves them locally and includes them in same-origin proxied requests.
- **Expound offsets are raw-markdown offsets** resolved via the source map
  (`src/lib/markdown/sourcemap.ts`) + DOM alignment (`src/lib/chat/selection.ts`),
  wrapped by `src/lib/markdown/wrap-range.ts`. Do not re-introduce substring
  heuristics, `surroundContents`, or the `startChar=0` full-span fallback.
  Selections touching generated content (math, mermaid, copy-button chrome)
  disable the menu; stale rows self-heal in memory only (no DB write).

## Manual acceptance gates (P-pg-2)

P-pg-2 flips the browser's primary driver to Postgres via the server and makes the schema,
proxy, and migrations Postgres-native. The app is server-required for function in this phase.

- **Browser + server + PG:** `docker compose up` → server logs `pg: ready` and `pg: migrations applied`; header badge reaches **DB ready (pg)**; `GET /api/health` returns `caps` including `'pg'`. Dev self-check passes (writes/reads/deletes a chats row via repos). Create a chat, append a message, and read it back — data round-trips through the browser against the PG primary.
- **Server-down:** `docker compose stop server` → reload → full-screen "Server unreachable" with the `docker compose up` hint + Retry button; background auto-poll recovers after `docker compose start server`. `POST /api/db/query` returns 503.
- **PG-down:** `docker compose stop db` → restart server → `'pg'` cap absent from `/api/health`; `/api/db/query` returns 503.
- **Sandbox regression:** Settings → Sandbox DB inspector still works (`/api/sandbox/query` untouched).
- **Migrations:** a single `drizzle/0000_*.sql` migration exists (dialect `postgresql`). The server runs drizzle's native `migrate()` at boot; migrations gate on pool connect + migrations applied (`'pg'` cap).
- **OPFS backup superseded:** app-DB backup/restore is now PG-native (`pg_dump -Fc` / `pg_restore`). The Settings → Data "Download backup" / "Restore from backup" buttons are gated on `serverStatus.has('pg')` and download/restore custom-format `.dump` files via the server.
- **Search:** `repos.search.search()` uses native PG `tsvector`/`GIN`/`ts_headline` (P-pg-4); `searchAvailable()` returns `true` with `'pg'` cap; `rebuildIndex()` is a no-op (GENERATED columns self-maintain).
- **Tests:** `pnpm lint && pnpm check && pnpm test` green with testcontainers PG; `pnpm --filter @mayon/server test` green. All tests now use a per-test-schema PG driver (`bootstrapTestDb`).

> The schema flip to `pg-core`, proxy flip to `pg-proxy`, server native `migrate()`, browser RemotePgDriver wiring, and testcontainer setup are covered by the automated test suites.

## Manual acceptance gates (P-pg-4)

P-pg-4 ports full-text search from FTS5 to native Postgres `tsvector`/`GIN`/`ts_headline`,
with noise stripping via an `IMMUTABLE` SQL function and `GENERATED ALWAYS AS` columns.

- **Browser + server + PG:** `docker compose up` → server logs `pg: fts ready`; `/search`
  returns ranked hits with highlighted snippets across messages/chats/labs/quizzes; kind
  filter works; `searchAvailable()` returns `true`.
- **Noise stripping:** a token that appears **only** inside a ` ```mermaid ` block or a
  `$$…$$` display-math block is **not** matched; the same token in plain text is matched.
- **Graceful degradation:** server-down or FTS failure → `search()` degrades to `[]` (no crash).
- **UI:** Settings "Rebuild search index" button is gone (GENERATED columns self-maintain).
- **Tests:** `pnpm lint && pnpm check && pnpm test` green; `pnpm --filter @mayon/server test`
  green. FTS bootstrap idempotency tested in `server/src/fts.test.ts`.

## Manual acceptance gates (P-pg-5)

P-pg-5 ships PG-native backup and restore using `pg_dump -Fc` and `pg_restore`. Download produces a custom-format `.dump`; restore always takes a
pre-restore safety dump (auto-downloaded to the browser), drops `public`+`drizzle` schemas,
restores, then restarts the server.

- **Browser + server + PG:** `docker compose up` → Settings → Data shows "Download backup"
  and "Restore from backup" (gated on `serverStatus.has('pg')`). Download yields a valid
  `mayon-YYYYMMDD.dump`; restoring it into a throwaway PG confirms validity.
- **Restore round-trip:** create a chat/message → download `.dump` → "Restore from backup" → a
  safety `.dump` auto-downloads → app reloads → chat/message is present → second download matches.
- **Non-PG file rejection:** uploading a non-`.dump`/non-PGDMP file shows a clear error; live data
  untouched.
- **Failed restore rollback:** a truncated/corrupt dump triggers a rollback to the safety dump and
  server restart; the UI shows the error.
- **Concurrent writes:** downloading an app-DB backup while MCP tools write to the **sandbox** DB
  produces a valid `.dump` (separate DB, `pg_dump` MVCC snapshot).
- **Server-down:** stop the server → app-DB backup buttons hidden; sandbox section also hidden;
  reload → full-screen "Cannot reach the Mayon server."
- **Docker image:** `docker compose build` installs `postgresql17-client`; `pg_dump --version` reports
  17.x in the server container.
- **Tests:** `pnpm lint && pnpm check && pnpm test` green; `pnpm --filter @mayon/server test`
  green (mocked spawns, `process.exit` mocked). Octet-stream parser registered exactly once.

## Manual acceptance gates (P-pg-6)

P-pg-6 ships a one-time importer that reads a legacy OPFS-era `.sqlite` backup and
loads its rows into Postgres, **replacing** all current data. Uses `TRUNCATE … CASCADE`

- `INSERT` in a single transaction (no server restart). `session_replication_role='replica'`
  disables FK triggers for the import (requires superuser — the dockerized `mayon` user
  is a superuser by default). FTS `GENERATED` columns self-maintain on insert; no rebuild.
  API keys are **not** imported (re-enter provider keys after import on a new origin).

* **Browser + server + PG:** `docker compose up` → Settings → Data → "Import from SQLite
  backup" → select a real legacy `.sqlite` → **dry-run** shows per-table counts (chats, messages,
  etc.) + skipped-table warnings → **Confirm** → a safety `mayon-pre-import-<ts>.dump`
  auto-downloads → app reloads → chats/labs/quizzes/messages present; row counts match the
  source; `quiz_answers.is_correct` round-trips as boolean; `search_vec` populated for
  imported content (FTS self-maintained); re-import is idempotent.
* **Rejection:** a non-SQLite file → "Not a valid SQLite file" error; a SQLite DB with no
  recognized Mayon tables → "no Mayon tables found" error; in both cases the live DB is
  untouched (no `TRUNCATE`).
* **Drift tolerance:** a legacy backup missing newer PG columns (`brief`, `mcp_config`,
  `tool_call_id`, `tool_name`, `metadata`, `model`, `tokens`) imports cleanly; omitted
  columns receive their default/NULL.
* **Server-down:** stop the server → import section hidden; the rest of the app is unaffected.
* **Replace semantics:** the import `TRUNCATE`s all 11 Mayon tables then inserts; no partial
  merge mode. A pre-import safety `pg_dump` always runs before any truncate; on failure the
  transaction rolls back (live DB unchanged).
* **Tests:** `pnpm lint && pnpm check && pnpm test` green; `pnpm --filter @mayon/server test`
  green (real pglite + better-sqlite3 round-trip; `pg_dump` spawn mocked).

## Manual acceptance gates (P-pg-3)

P-pg-3 adds boot gating and failure UX now that the app requires the server.

- **Browser + server + PG:** `docker compose up` → brief `Connecting…` screen → shell; badge shows **Server: connected** / **DB ready (pg)**; theme toggle persists across reload; dev self-check passes.
- **Server-down:** `docker compose stop server` → reload → full-screen **"Cannot reach the Mayon server."** with the `docker compose up` hint + working Retry; background auto-poll recovers after `docker compose start server` (reload fires automatically).
- **PG-down:** `docker compose stop db` (keep server up) → reload → fullscreen **"Database not ready."** variant (server connected, `'pg'` absent); recovers when db is healthy again.
- **Dev loop:** `pnpm dev:deps` then `pnpm dev` → SPA works against the Dockerized server+pg via the vite `/api` proxy.

## Manual acceptance gates (P0)

There is no chat UI in P0 (lands in P2). The observable persistence signal is the
**theme toggle** (persisted to the `settings` KV) plus the **dev self-check**
(`DbStatus` badge). The self-check is dev-only (`import.meta.env.DEV`): on each boot it
writes/reads/deletes a `chats` row via the repository and shows pass/fail.

- **Browser + server + PG:** `pnpm dev:deps` then `pnpm dev` → open http://localhost:5173 → the header badge reaches
  **DB ready (pg)** and (in dev) self-check passes; toggle the theme and **reload
  the tab** → the theme survives (proving persistence).
- **First-run/empty DB:** migrations run clean (covered by the automated Vitest suite
  against the pglite test driver).
- **Server unreachable:** if the server is not running, a full-screen error is shown
  with a `docker compose up` hint and a Retry button (never silent).

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
and a read-write inspector under `/settings`. This DB never holds app data or secrets.

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
affordance in Settings.

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
- **Server down:** stop the server → the "Sandbox DB" section is hidden.
- **Persistence:** `docker compose restart server` → sandbox data persists
  (`server-data` volume).

## Manual acceptance gates (P-pg-7)

P-pg-7 closes the Postgres-migration epic: all OPFS/SQLite-WASM dead code removed,
docs describe the server-required + PG-primary reality, and the `sidecar-data`
volume is renamed to `server-data`.

- **Clean build:** `pnpm install` (lockfile has no `sqlite-wasm`/`sql.js`);
  `pnpm lint && pnpm check && pnpm test` green; `pnpm --filter @mayon/server test`
  green.
- **Grep sweep:** zero hits for `sidecar|Sidecar|opfs|OPFS|sqlite-wasm|sql\.js|
bundle:migrations|bundle-migrations|translatePlaceholders|crossOriginIsolation`
  in `src/` and `server/` (historical refs in `refinement/` are allowed).
- **Docker:** `docker compose up` — volume is now `server-data` (not `sidecar-data`);
  sandbox DB is reset on upgrade (documented upgrade note).
- **Docs:** no file in `docs/`, `AGENTS.md`, or `CONTRIBUTING.md` references
  Tauri, OPFS, sqlite-wasm, `bundle:migrations`, or "browser-only".
- **COEP removal:** `vite.config.ts` has no `crossOriginIsolation` plugin;
  KaTeX math renders correctly in the browser (fonts in `static/fonts`).
