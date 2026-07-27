# AGENTS.md

Operating guide for AI agents (and humans) working in this repo. This file
covers **how to operate** inside the codebase: stack, commands, release flow,
topology, and the invariants you must respect when editing.

- **Authoritative design (system _as it is today_):** `docs/dev/architecture.qmd` + `docs/dev/seams.qmd` (rendered in the Quarto docs site).
- **Development history / phase acceptance notes:** `docs/developer_notes/` — read these to recall why a subsystem is shaped the way it is or to avoid a past mistake. Not a spec.
- **Active implementation plans:** `.kilo/plans/`.

## Stack

- **SvelteKit** (Svelte 5 runes) as a static SPA via `@sveltejs/adapter-static` (no SSR).
- **Tailwind v4** (CSS-first, `@import "tailwindcss"`) + **shadcn-svelte** (bits-ui).
- **Postgres** is the primary store, behind one shared **drizzle** schema and a single
  `StorageDriver` seam (browser → server via `RemotePgDriver`; tests = pglite).
  The **server** container also hosts a sandbox SQLite for MCP tools.
- **Server** (Node/TypeScript, Docker): **required** for app function — Postgres
  primary store, stdio MCP runner, LLM CORS proxy, sandbox DB, backup/restore.
- **Toolchain pins:** Node 22 (`.nvmrc`), pnpm 10 (`packageManager`). No bun, no Rust.

## Commands

| Command                            | What it does                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                     | Install dependencies.                                                                                           |
| `pnpm dev`                         | Bring up the all-Docker dev stack (web HMR on http://localhost:5173, server on :4319, db), project `mayon-dev`. |
| `pnpm dev:up`                      | Same as `pnpm dev` but detached (`-d`).                                                                         |
| `pnpm dev:down`                    | Stop and remove the dev stack (keeps `pg-data-dev`/`server-data-dev` volumes).                                  |
| `pnpm dev:build`                   | Rebuild the dev images (after deps, config, or `@mayon/shared` changes).                                        |
| `pnpm dev:vite`                    | Run Vite directly — used **inside** the dev `web` container.                                                    |
| `pnpm --filter @mayon/server dev`  | Run the server (`tsx watch`) — used **inside** the dev `server` container.                                      |
| `pnpm build`                       | Build the SPA into `build/`.                                                                                    |
| `pnpm check`                       | Type-check with `svelte-check`.                                                                                 |
| `pnpm lint`                        | ESLint (flat config) + Prettier `--check`.                                                                      |
| `pnpm format`                      | Prettier `--write`.                                                                                             |
| `pnpm test`                        | Vitest (pglite test driver) — run once.                                                                         |
| `pnpm test:watch`                  | Vitest in watch mode.                                                                                           |
| `pnpm --filter @mayon/server test` | Vitest for the server package.                                                                                  |
| `pnpm db:generate`                 | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                   |
| `pnpm db:studio`                   | Open Drizzle Studio against the schema.                                                                         |
| `docker compose up`                | Run the prod stack from prebuilt GHCR images (web on :8080, server internal-only). `docker compose pull` first. |

## Releasing & versioning

- **SemVer.** Versions are `MAJOR.MINOR.PATCH` (`0.x` is pre-1.0 instability).
- **The `vX.Y.Z` git tag is the release trigger.** Pushing it runs
  `.github/workflows/docker-publish.yml`, which publishes **both** GHCR images:
  - web SPA → `ghcr.io/bendlikeabamboo/mayon`
  - server → `ghcr.io/bendlikeabamboo/mayon-server`
  - each tagged `:X.Y.Z` and `:latest`.
- **Release contract (CI-enforced):** the tag must equal the `version` field in
  all three `package.json` files (`package.json`, `server/package.json`,
  `packages/shared/package.json`) **and** `CHANGELOG.md` must contain a
  `## [X.Y.Z]` section. The `verify-version` job fails the release otherwise.
- **Release steps:**
  1. Set `"version": "X.Y.Z"` in all three `package.json` files.
  2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (keep a fresh
     empty `## [Unreleased]` above it).
  3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z` → CI publishes.
- **Release assets (CI attaches to the GitHub Release):** a version-baked
  `install.sh` (the `@MAYON_INSTALLER_VERSION@` placeholder is sed-replaced
  with the tag) and a copy of `docker-compose.yml`. These power the one-line
  install `curl -fsSL …/releases/latest/download/install.sh | bash`. Do **not**
  rename/remove the `@MAYON_INSTALLER_VERSION@` marker in `install.sh` — the
  `release-assets` job asserts the substitution succeeded.
- **Upgrade flow** for end users: bump `MAYON_VERSION` (or rely on `latest`) →
  `docker compose pull && docker compose up -d`.

## Dev vs Prod topology

|                         | Prod (daily-driver)                                          | Dev                                                   |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Web                     | `ghcr.io/.../mayon:${MAYON_VERSION}`, host `:8080`           | Vite HMR (in container), host `:5173`                 |
| Server                  | `ghcr.io/.../mayon-server:${MAYON_VERSION}`, internal `4319` | `tsx watch` (in container), internal `4319`           |
| DB                      | `postgres:17`, volume `pg-data`, **no host port**            | `postgres:17`, volume `pg-data-dev`, **no host port** |
| Compose project         | `mayon` (default)                                            | `mayon-dev`                                           |
| Compose file            | `docker-compose.yml`                                         | `docker-compose.dev.yml`                              |
| Bring-up                | `docker compose pull && docker compose up -d`                | `pnpm dev`                                            |
| `DATABASE_URL` (server) | `…@db:5432/mayon` (compose `environment:`)                   | `…@db:5432/mayon` (compose `environment:`)            |

Both stacks use the internal docker network hostname `db`, so the server code
is identical across dev and prod — no host `.env` / `DATABASE_URL` workaround.
Host ports never collide (prod `8080` vs dev `5173`), so both run at once. Volumes
are disjoint (`pg-data` vs `pg-data-dev`, `server-data` vs `server-data-dev`).

## Invariants & operating conventions

Invariants to respect when editing. The architecture doc explains the _why_;
`docs/dev/seams.qmd` has the full boundary rules.

- **App code calls repositories only.** Components/stores/routes never import
  `db` directly — it is private to `src/lib/db/` (exposed via `getDb()` / `repos`).
- **`StorageDriver` is the only storage seam** (`src/lib/db/driver/types.ts`):
  `query` / `batch` / `exec`. Drizzle + schema + repositories live on the main
  thread; drivers are dumb SQL executors (`RemotePgDriver` → `POST /api/db/query`).
- **Runtime requires the server.** The server is detected at boot via
  `detectServer()` and progressively enables features (`stdio-mcp`, `llm-proxy`,
  `sandbox-db`, `backup`, `pg`) from advertised capabilities.
- **No secrets in `settings`.** Provider config holds non-secret handle fields
  only; API keys live in IndexedDB and are sent only in same-origin proxied requests.
- **Backup/restore is PG-native and in-place.** `pg_dump -Fc` download,
  `pg_restore --data-only --single-transaction` restore — **no server restart,
  no schema drop.** While a restore runs, `/api/db/query` returns 503 (module
  `restoring` flag) and `/api/health` reports `restoring: true`. The schema
  version is stamped into `settings`; restore refuses backups stamped newer
  than the server. Restore never reloads drizzle's `__drizzle_migrations`
  bookkeeping table.
- **Full-text search is self-maintaining.** `search_vec` columns are
  `GENERATED ALWAYS AS (...) STORED` — never write to them, and never add a
  "rebuild search index" affordance. They re-populate on INSERT after any data
  replacement.
- **Expound offsets are raw-markdown offsets** resolved via the source map
  (`src/lib/markdown/sourcemap.ts`) + DOM alignment (`src/lib/chat/selection.ts`),
  wrapped by `src/lib/markdown/wrap-range.ts`. Do not re-introduce substring
  heuristics, `surroundContents`, or the `startChar=0` full-span fallback.
  Selections touching generated content (math, mermaid, copy-button chrome)
  disable the menu; stale rows self-heal in memory only (no DB write).
- **SvelteKit reserves the `+` filename prefix** for routing; do not name
  tests or other non-route files with a leading `+`.
- **`@mayon/shared` is built before any consumer resolves its types** (tsup →
  `./dist`). On a fresh checkout, build shared first; after changing shared,
  rebuild the dev Docker image with `pnpm dev:build`.

## Perf debugging

The perf probe (`src/lib/perf/{probe,mark}.ts`) is an opt-in dev tool that measures
frame timing, longtasks, layout shifts, input latency, custom marks, and render counts.
It emits a JSON summary to the console every 3 seconds via `[mayon-perf]`.

**Enable:** set `window.__MAYON_PERF__ = 1` in the browser console before or after page load.
**Scenario tag:** set `localStorage.mayon_perf_scenario = 'idle-scroll'` (or any label) to tag
summary output. The probe imports at `+layout.svelte:6` but is inert without the flag.

## Where to look

- **As-is design / architecture:** `docs/dev/architecture.qmd`, `docs/dev/seams.qmd`.
- **Build & test commands (user-facing):** `docs/dev/building.qmd`, `CONTRIBUTING.md`.
- **Phase-by-phase build history & past decisions:** `docs/developer_notes/`.
- **Troubleshooting (Postgres password, etc.):** `README.md`.
