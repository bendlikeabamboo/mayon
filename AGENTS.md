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
  sql.js). An optional local **sidecar** container adds a sandbox SQLite for MCP tools.
- **Optional sidecar** (Node/TypeScript, Docker): unlocks browser-impossible capabilities
  — stdio MCP runner, LLM CORS proxy, sandbox DB, backup. The app is 100% functional
  without it.
- **Toolchain pins:** Node 22 (`.nvmrc`), pnpm 10 (`packageManager`). No bun, no Rust.

## Commands

| Command                             | What it does                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install dependencies.                                                                                                      |
| `pnpm dev`                          | Run the SvelteKit SPA dev server (http://localhost:5173).                                                                  |
| `pnpm --filter @mayon/sidecar dev`  | Run the sidecar dev server (http://localhost:4319) in watch mode.                                                          |
| `pnpm build`                        | Build the SPA into `build/`.                                                                                               |
| `pnpm check`                        | Type-check with `svelte-check`.                                                                                            |
| `pnpm lint`                         | ESLint (flat config) + Prettier `--check`.                                                                                 |
| `pnpm format`                       | Prettier `--write`.                                                                                                        |
| `pnpm test`                         | Vitest (in-memory driver) — run once.                                                                                      |
| `pnpm test:watch`                   | Vitest in watch mode.                                                                                                      |
| `pnpm --filter @mayon/sidecar test` | Vitest for the sidecar package.                                                                                            |
| `pnpm db:generate`                  | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                              |
| `pnpm db:studio`                    | Open Drizzle Studio against the schema.                                                                                    |
| `pnpm bundle:migrations`            | Re-bundle `drizzle/` SQL + journal into `src/lib/db/driver/migrations.ts` (run after every `db:generate` before shipping). |
| `docker compose up`                 | Run the web SPA + sidecar together (web on :8080, sidecar internal-only).                                                  |

Always run `pnpm bundle:migrations` after `pnpm db:generate` so the SPA can run the
new migration offline (no runtime `fs`).

## Architecture boundaries (do not violate)

- **Components/stores call repositories only** — never import `db` directly. The drizzle
  `db` object is private to `src/lib/db/` (exposed via `getDb()` / `repos`).
- **`StorageDriver`** (`src/lib/db/driver/types.ts`) is the single storage seam:
  `query` / `batch` / `exec`. Drizzle + schema + repositories live on the main thread;
  drivers are dumb SQL executors (the OPFS worker literally just runs SQL over `postMessage`).
- **Runtime is browser-only.** OPFS SQLite + IndexedDB keys are the source of truth.
  The optional sidecar is detected at boot via `detectSidecar()` and progressively
  enables features (stdio MCP, LLM CORS proxy, sandbox DB, backup) based on advertised
  capabilities.
- **No secrets in `settings`.** Provider config holds non-secret handle fields only; API
  keys live in IndexedDB (the browser `KeyStore`). The sidecar never persists secrets —
  the browser resolves them locally and includes them in same-origin proxied requests.

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
  blocks the request, `/chat` shows the **"Run the Mayon sidecar (`docker compose up`)
  for CORS-free access"** notice (from `formatProviderError` on a `CorsBlockedError`)
  rather than a raw error.

> The streaming transport, adapters, error mapping, and context assembly are covered by
> the automated Vitest suite (`pnpm test`). Provider keys are never echoed back in the
> UI after save (the key field is masked with a "replace key" affordance).

## Manual acceptance gates (P2)

P2 ships the stdio MCP runner via the sidecar: when the sidecar is connected and
advertises the `stdio-mcp` cap, stdio MCP servers (Brave, Filesystem, GitHub, custom)
work in the browser over a WebSocket bridge. HTTP MCP servers work with or without the
sidecar.

- **Browser + sidecar:** `docker compose up` → header badge shows **Sidecar:
  connected** with `stdio-mcp` in the cap list → `/settings → MCP Servers → Add → Brave`
  → set key → Trust → **Test** shows the Brave tools in the browser → `/chat` "search
  the web for X" invokes `mcp.<id>.brave_web_search` and renders results.
- **Sidecar down:** stdio templates show "Requires the Mayon sidecar" and a
  `docker compose up` hint; HTTP MCP servers still connect.
- **Key security:** `BRAVE_API_KEY` is **not** in the `settings` table (IndexedDB only);
  the sidecar receives it only in the spawn env (transient, internal network).

> The WS bridge, `SidecarStdioMcpTransport`, transport picker wiring, and lifecycle
> gating are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/sidecar test` for sidecar).

## Manual acceptance gates (P3)

P3 ships the LLM CORS proxy via the sidecar: when the sidecar is connected and
advertises the `llm-proxy` cap, CORS-blocked providers (e.g. Anthropic) stream
from the browser through the sidecar's `POST /api/llm/proxy` route. When the
sidecar is absent, the app behaves as before (direct browser fetch; Anthropic
shows the sidecar fallback notice).

- **Browser + sidecar:** `docker compose up` → header badge shows **Sidecar:
  connected** with `llm-proxy` in the cap list; `GET /api/health` returns
  `caps: ['stdio-mcp','llm-proxy']`. Open `/settings` → configure **Anthropic**
  (key saved) → `/chat` streams an Anthropic reply with **no CORS error**;
  DevTools network shows the request going same-origin to `/api/llm/proxy`, not
  `api.anthropic.com`. **Stop** during a stream aborts cleanly.
- **Sidecar down:** stop the sidecar → Anthropic surfaces the **"Run the Mayon
  sidecar (`docker compose up`) for CORS-free access"** notice. OpenAI-compatible
  providers (Z.AI, OpenRouter, OpenAI) keep streaming via direct fetch.
- **Model discovery** (`/models` on gateways) still works, now also proxied when
  the cap is present.
- **Key security:** the provider API key is **not** in the `settings` table
  (IndexedDB only); the sidecar receives it only in the proxied request's
  headers (transient, internal network).

> The proxy route, web proxy-fetch helper, seam routing, and nginx buffering
> fix are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/sidecar test` for sidecar). Validate with `pnpm
lint && pnpm check && pnpm test` (root) and `pnpm --filter @mayon/sidecar
test`.

## Manual acceptance gates (P4)

P4 ships an isolated sandbox SQLite in the sidecar, exposed via `POST /api/db/query`
and a read-write inspector under `/settings`. OPFS remains the app's sole primary
store; this DB never holds app data or secrets.

- **Browser + sidecar:** `docker compose up` → header badge shows **Sidecar:
  connected** with `sandbox-db` in the cap list → `/settings` shows the
  **Sandbox DB** section with the path `/data/sandbox.sqlite` → run
  `CREATE TABLE notes(id INTEGER PRIMARY KEY, t TEXT)` then
  `INSERT INTO notes(t) VALUES('hi')` in the query box → `SELECT * FROM notes`
  renders a table with headers `id`/`t` and the row.
- **MCP integration:** copy the surfaced path; add a **custom stdio** MCP server
  whose args point at it → it reads the same `notes` row.
- **Persistence:** `docker compose restart sidecar` → data persists (volume).
- **Sidecar down:** stop the sidecar → the Sandbox DB section is hidden and the
  rest of the app is unaffected.
- **Security:** the sandbox DB holds no app data and no secrets; the inspector
  never touches app tables.

> The SQL endpoint, `SidecarDriver`, inspector client, and updated health caps
> are covered by the automated Vitest suites (`pnpm test` for root;
> `pnpm --filter @mayon/sidecar test` for sidecar). Validate with `pnpm
lint && pnpm check && pnpm test` (root) and `pnpm --filter @mayon/sidecar
test`.

## Manual acceptance gates (P5 — sandbox DB backup)

P5 ships server-side snapshot/restore of the sandbox DB (MCP-tool data at
`/data/sandbox.sqlite`) via two sidecar routes, surfaced as a "Sandbox DB backup"
affordance in Settings. The OPFS app-DB backup is unchanged.

- **Browser + sidecar:** `docker compose up` → header badge shows **Sidecar:
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
- **Sidecar down:** stop the sidecar → the "Sandbox DB" section is hidden; the
  OPFS Download/Restore buttons work exactly as before (no regression).
- **Persistence:** `docker compose restart sidecar` → sandbox data persists
  (`sidecar-data` volume).
