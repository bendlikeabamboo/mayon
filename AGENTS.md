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

| Command                                   | What it does                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                            | Install dependencies.                                                                                                                                    |
| `pnpm dev`                                | Bring up the all-Docker dev stack (web HMR on http://localhost:5173, server on :4319, db), project `mayon-dev`. Docker or Podman via `MAYON_DEV_ENGINE`. |
| `pnpm dev:up`                             | Same as `pnpm dev` but detached (`-d`). Engine selectable via `MAYON_DEV_ENGINE`.                                                                        |
| `pnpm dev:down`                           | Stop and remove the dev stack (keeps `pg-data-dev`/`server-data-dev` volumes).                                                                           |
| `pnpm dev:build`                          | Rebuild the dev images (after deps, config, or `@mayon/shared` changes). Engine selectable via `MAYON_DEV_ENGINE`.                                       |
| `pnpm dev:shard:up 1/4`                   | Boot a per-shard e2e stack (project `mayon-dev-shard-1`, web :5201) incl. readiness waits; used with `pnpm dev:shard:test`/`:down` for sharded e2e runs. |
| `pnpm dev:vite`                           | Run Vite directly — used **inside** the dev `web` container.                                                                                             |
| `pnpm --filter @mayon/server dev`         | Run the server (`tsx watch`) — used **inside** the dev `server` container.                                                                               |
| `pnpm build`                              | Build the SPA into `build/`.                                                                                                                             |
| `pnpm check`                              | Type-check with `svelte-check`.                                                                                                                          |
| `pnpm lint`                               | ESLint (flat config) + Prettier `--check`.                                                                                                               |
| `pnpm format`                             | Prettier `--write`.                                                                                                                                      |
| `pnpm test`                               | Tiers 1+2 (Node + Chromium), capability-gated; the local merge gate. Use `test:low-spec` per the profile rule below.                                     |
| `pnpm test:unit`                          | Tier 1 only: in-process Node logic, repositories, and server-handler tests; no browser process.                                                          |
| `pnpm test:browser`                       | Tier 2 only: real-Chromium component tests (`*.browser.test.ts`).                                                                                        |
| `pnpm test:e2e`                           | Tier 3 Playwright against a running stack (`E2E_BASE_URL`, default http://127.0.0.1:5173).                                                               |
| `pnpm test:ci`                            | CI wrapper for Tiers 1+2 + server; writes `test-results/tier-durations.json` and enforces budgets.                                                       |
| `pnpm test:e2e:ci -- --shard=<n>/<total>` | Shard-aware Tier 3 CI wrapper; writes `test-results/tier3-shard-<n>.json` and enforces that shard's budget.                                              |
| `pnpm test:integration`                   | Opt-in live-provider and other environment-dependent checks (excluded from the default suite).                                                           |
| `pnpm test:low-spec`                      | Forces serial mode (`MAYON_TEST_PARALLEL=off`) with a 500 MB V8 heap; still selects every test.                                                          |
| `pnpm test:watch`                         | Vitest in watch mode (Tiers 1+2).                                                                                                                        |
| `pnpm check:tests`                        | Tier guardrails (`TT-001`–`TT-008`); exits 2 on violation.                                                                                               |
| `pnpm check:budget`                       | Enforces per-tier time budgets from `test-budgets.json` for the tiers the current job owns.                                                              |
| `pnpm --filter @mayon/server test`        | Server-package Tier 1 suite (Fastify `inject`), unchanged.                                                                                               |
| `pnpm db:generate`                        | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                                                            |
| `pnpm db:studio`                          | Open Drizzle Studio against the schema.                                                                                                                  |
| `docker compose up`                       | Run the prod stack from prebuilt GHCR images (web on :8080, server internal-only). `docker compose pull` first.                                          |

### Test tiers and the capability gate

The suite has three enforced tiers. `pnpm test` runs Tiers 1+2; the server package
keeps its own command.

| Tier              | Environment                          | File pattern                                  | Command                                               | Budget (8-CPU/8-GiB reference) |
| ----------------- | ------------------------------------ | --------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| 1 — logic/handler | Node, in-process; pglite for storage | `src/**/*.test.ts`, `server/src/**/*.test.ts` | `pnpm test:unit` / `pnpm --filter @mayon/server test` | 100 s (server 120 s)           |
| 2 — component     | Real Chromium via Vitest browser     | `src/**/*.browser.test.ts`                    | `pnpm test:browser`                                   | 120 s                          |
| 3 — integration   | Full stack via Playwright            | `tests/e2e/**/*.spec.ts`                      | `pnpm test:e2e`                                       | 120 s (single run)             |

- `*.browser.test.ts` is the only Tier 2 suffix. `*.svelte.test.ts` is a rune-module
  test and stays Tier 1; do not reclassify it by accident.
- Tier 1 must not import `@vitest/browser*`, `vitest-browser-svelte`, Playwright, or
  `@testing-library/*`, and must not start a browser, build, or HTTP listener
  (transport-subject tests excepted).
- Tier 2 renders the real component and queries by accessible role or test id.
  Navigation, environment, and store dependencies come from `tests/mocks/app/*`
  and `vi.mock` at the module boundary; it must not need the app server, Postgres,
  docker compose, or the `tests/e2e` stack.
- Tier 3 keeps only flows that need the real browser plus real server and
  persistence/streaming. Provider/session setup runs once in
  `tests/e2e/global-setup.ts`; specs consume `tests/e2e/fixtures/session.ts`,
  never replay onboarding, never use fixed waits, and block third-party traffic
  through `tests/e2e/fixtures/network.ts`.
- Component-level network calls are mocked with MSW at the `fetch` boundary.
  Shared handlers live in `tests/mocks/handlers.ts`; `tests/mocks/node.ts` and
  `tests/mocks/browser.ts` are the two entry points. The worker asset under
  `tests/mocks/public/` is served only by the test Vite server and is never
  copied into `build/`.
- Every removed or migrated source-text/end-to-end case is recorded in
  `specs/032-test-suite-tiering/migration-ledger.md` with a replacement path or a
  retirement rationale. Do not delete a test without a ledger row.
- `pnpm check:tests` enforces the tier boundaries (`TT-001`–`TT-008`); CI runs it
  as part of `pnpm test:ci`. `pnpm check:budget` enforces `test-budgets.json` for
  the tiers owned by the current job.

#### Choosing the test profile (low-spec vs normal)

Before running any test, determine which profile the machine can take — never
assume `pnpm test` is safe. The capability gate reads CPU and usable memory from
the host and any cgroup limit (whichever is lower) and uses the same boundary as
the profile:

- **Low-spec / unknown** → `pnpm test:low-spec` (or `MAYON_TEST_PARALLEL=off pnpm test`):
  **2 or fewer logical CPUs** **or** less than **8 GiB usable RAM**, or an
  unreadable/contradictory reading. Serial: one worker, no file parallelism.
- **Capable** → `pnpm test`: **more than 2 logical CPUs** **and** at least
  **8 GiB usable RAM**. A GitHub-hosted standard runner (4 vCPU / 16 GiB) is
  capable. Without an explicit cap the Vitest configs omit `maxWorkers`, so
  Vitest sizes its pool from the available cores.

`pnpm test:low-spec` sets `MAYON_TEST_PARALLEL=off` and
`NODE_OPTIONS=--max-old-space-size=500`; it still selects every test. The gate
never changes selection and never skips a test. Overrides:
`MAYON_TEST_PARALLEL=auto|on|off` (`on` requires an explicit
`MAYON_TEST_MAX_WORKERS`), `MAYON_TEST_MAX_WORKERS=<n>` caps workers, and
`MAYON_TEST_MAX_OLD_SPACE_MB=<n>` caps each test worker's V8 heap. Both runners
print a `[test-capacity]` line at startup.

Tier 3 uses the same gate for its default Playwright worker count.
`MAYON_E2E_WORKERS=<n>` overrides it (CI runs one stack with
`MAYON_E2E_WORKERS=4`); local sharding via
`pnpm dev:shard:up|test|down <n>/<total>` still works for splitting the suite
across stacks.

## Worktrees

Worktrees are the user's setup for parallel work, and they carry a strict
workflow assumption: **each worktree is an independent git branch tracked
against the remote (`origin`)**, created by the user. Worktree work is **not
destined for `main`** — never merge, rebase, cherry-pick, or open a PR into
`main` from a worktree unless the user explicitly asks. Commit and push to
the worktree's own remote branch and leave any integration into `main` to
the user.

`node_modules/` is gitignored, so every new git worktree starts without
dependencies and with no built `@mayon/shared`. Before running, checking, or
testing anything in a fresh worktree:

1. `pnpm install` — fast in worktrees (pnpm's global store is shared across checkouts, so packages hard-link instead of re-downloading).
2. `pnpm --filter @mayon/shared build` — consumers resolve `@mayon/shared` types from its `dist/`, which is gitignored too (see the invariant below).

If the worktree's work touches deps, config, or `@mayon/shared`, also rebuild
the dev images with `pnpm dev:build`.

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
- **Do not hard-wrap GitHub release bodies.** `CHANGELOG.md` is
  Prettier-wrapped, but that wrapping is for the file only. When pasting the
  section into a release body — or composing any GitHub description (PR body,
  comment) — join each wrapped paragraph and each list item into a single
  line and let GitHub wrap the text itself; preserve code fences and
  list/nesting structure verbatim.
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
- **Agent's map (feature placement, text-first proving, browser allowance):**
  `docs/reference/agent-map.qmd`.
- **Tool map (agent tool inventory + availability rules):** `docs/reference/tool-map.qmd`.
  Update it in the same change when touching agent/MCP tools.
- **Build & test commands (user-facing):** `docs/how-to/building.qmd`, `CONTRIBUTING.md`.
- **Phase-by-phase build history & past decisions:** `docs/dev-notes/`.
- **Feature decision history (what/why/reversals/learnings per shipped feature):**
  `docs/history/index.qmd` — narrative record; consult it for rationale recall, while
  `architecture.qmd`/`seams.qmd` remain the authority on how the system works today.
- **Troubleshooting (Postgres password, etc.):** `README.md`.
