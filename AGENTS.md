# AGENTS.md

Operating guide for AI agents (and humans) working in this repo. This file
covers **how to operate** inside the codebase: stack, commands, release flow,
topology, and the invariants you must respect when editing.

- **Authoritative design (system _as it is today_):** `docs/explanation/architecture.qmd` + `docs/reference/seams.qmd` (rendered in the Quarto docs website).
- **Development history / phase acceptance notes:** `docs/dev-notes/` — read these to recall why a subsystem is shaped the way it is or to avoid a past mistake. Not a spec.
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

| Command                            | What it does                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                     | Install dependencies.                                                                                                                                    |
| `pnpm dev`                         | Bring up the all-Docker dev stack (web HMR on http://localhost:5173, server on :4319, db), project `mayon-dev`. Docker or Podman via `MAYON_DEV_ENGINE`. |
| `pnpm dev:up`                      | Same as `pnpm dev` but detached (`-d`). Engine selectable via `MAYON_DEV_ENGINE`.                                                                        |
| `pnpm dev:down`                    | Stop and remove the dev stack (keeps `pg-data-dev`/`server-data-dev` volumes).                                                                           |
| `pnpm dev:build`                   | Rebuild the dev images (after deps, config, or `@mayon/shared` changes). Engine selectable via `MAYON_DEV_ENGINE`.                                       |
| `pnpm dev:vite`                    | Run Vite directly — used **inside** the dev `web` container.                                                                                             |
| `pnpm --filter @mayon/server dev`  | Run the server (`tsx watch`) — used **inside** the dev `server` container.                                                                               |
| `pnpm build`                       | Build the SPA into `build/`.                                                                                                                             |
| `pnpm check`                       | Type-check with `svelte-check`.                                                                                                                          |
| `pnpm lint`                        | ESLint (flat config) + Prettier `--check`.                                                                                                               |
| `pnpm format`                      | Prettier `--write`.                                                                                                                                      |
| `pnpm test`                        | Vitest (pglite test driver) — run once.                                                                                                                  |
| `pnpm test:watch`                  | Vitest in watch mode.                                                                                                                                    |
| `pnpm --filter @mayon/server test` | Vitest for the server package.                                                                                                                           |
| `pnpm db:generate`                 | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                                                            |
| `pnpm db:studio`                   | Open Drizzle Studio against the schema.                                                                                                                  |
| `docker compose up`                | Run the prod stack from prebuilt GHCR images (web on :8080, server internal-only). `docker compose pull` first.                                          |

## Releasing & versioning

- **SemVer.** Versions are `MAJOR.MINOR.PATCH` (`0.x` is pre-1.0 instability).
- **RC-first is the default release path.** Every release — minor or patch —
  ships through the **Release Candidate (RC) cycle** below first: prepare the
  bump + changelog, tag `vX.Y.Z-rcN`, let CI publish `:rc` images, and only
  promote to a stable `vX.Y.Z` once the RC is accepted. Do **not** ask whether
  to use the RC cycle vs. a direct stable tag — assume RC-first. Use a direct
  stable tag **only** when the user explicitly asks for it (e.g. "release
  directly" / "skip the RC").
- **A `vX.Y.Z` or `vX.Y.Z-rcN` git tag triggers the pipeline.** Pushing it runs
  `.github/workflows/docker-publish.yml`, which publishes **both** GHCR images:
  - web SPA → `ghcr.io/bendlikeabamboo/mayon`
  - server → `ghcr.io/bendlikeabamboo/mayon-server`
  - stable `vX.Y.Z` tags: `:X.Y.Z` + `:latest`.
  - RC `vX.Y.Z-rcN` tags: `:X.Y.Z-rcN` + `:rc` (never `:latest`).
- **Release contract (CI-enforced):** the tag must be `X.Y.Z` or `X.Y.Z-rcN`.
  `package.json` versions in all three files (`package.json`,
  `server/package.json`, `packages/shared/package.json`) must equal the
  tag's **base** version (e.g. `0.2.0` for `v0.2.0-rc1`) **and**
  `CHANGELOG.md` must contain a `## [X.Y.Z]` section. The `verify-version`
  job fails the release otherwise.
- **Every GitHub Release body MUST contain curated release notes.** CI creates
  the release with `generate_release_notes: true` (auto-generated commit/PR
  titles only), which is far too sparse to publish. As a **required post-CI
  step**, edit the release body with `gh release edit vX.Y.Z... --notes ...`
  (or `--notes-file`) to paste the matching `## [X.Y.Z]` section from
  `CHANGELOG.md` (strip the `## [X.Y.Z] - date` header). This applies to **both**
  RC (`vX.Y.Z-rcN`) and stable (`vX.Y.Z`) releases. Do not leave a release with
  only auto-generated notes. Never mark a release "done" until its body is
  populated.
- **Release steps:**
  1. Set `"version": "X.Y.Z"` in all three `package.json` files.
  2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (keep a fresh
     empty `## [Unreleased]` above it).
  3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z` → CI publishes.
  4. **Populate the release body** — wait for the `release-assets` job to
     finish, then `gh release edit vX.Y.Z --notes "<CHANGELOG section body>"`.
     This is mandatory; see the rule above.
- **Release Candidate (RC) cycle:**
  1. After completing **Release steps 1–2** above (set `package.json` to base
     `X.Y.Z` and add the CHANGELOG section), tag `vX.Y.Z-rcN`.
  2. CI publishes images tagged `:X.Y.Z-rcN` + `:rc` (never `:latest`) and
     creates a **prerelease** GitHub Release (`make_latest: false`) with a
     baked `install.sh` + `docker-compose.yml`.
  3. **Populate the RC release body** with the same `## [X.Y.Z]` CHANGELOG
     section (the section is written in step 1; `package.json` stays at base,
     but the notes describe the upcoming release).
  4. Iterate: fix on `main`, then tag `vX.Y.Z-rc2`, `vX.Y.Z-rc3`, etc.
     (no file edits — `package.json` stays at the base version). Re-populate
     each RC's body (append "since rcN" deltas when useful).
  5. Promote: once the RC is accepted, `git tag vX.Y.Z && git push origin vX.Y.Z`
     — **no file edits.** CI tags `:X.Y.Z` + `:latest` and makes it the latest
     release. **Populate the stable release body** as Release step 4.
- **Release assets (CI attaches to the GitHub Release):** a version-baked
  `install.sh` (the `@MAYON_INSTALLER_VERSION@` placeholder is sed-replaced
  with the tag) and a copy of `docker-compose.yml`. These power the one-line
  install `curl -fsSL …/releases/latest/download/install.sh | bash`. Do **not**
  rename/remove the `@MAYON_INSTALLER_VERSION@` marker in `install.sh` — the
  `release-assets` job asserts the substitution succeeded.
  For RC releases, the GitHub Release is marked `prerelease` with
  `make_latest: false`, so `releases/latest/download/install.sh` keeps pointing
  at the last stable release.
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
`docs/reference/seams.qmd` has the full boundary rules.

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

- **As-is design / architecture:** `docs/explanation/architecture.qmd`, `docs/reference/seams.qmd`.
- **Build & test commands (user-facing):** `docs/how-to/building.qmd`, `CONTRIBUTING.md`.
- **Phase-by-phase build history & past decisions:** `docs/dev-notes/`.
- **Feature decision history (what/why/reversals/learnings per shipped feature):**
  `docs/history/index.qmd` — narrative record; consult it for rationale recall, while
  `architecture.qmd`/`seams.qmd` remain the authority on how the system works today.
- **Troubleshooting (Postgres password, etc.):** `README.md`.
