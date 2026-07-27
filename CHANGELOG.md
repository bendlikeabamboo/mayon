# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Release Candidate (RC) workflow** — CI now accepts `vX.Y.Z-rcN` tags
  alongside stable `vX.Y.Z`. RC tags publish images tagged `:X.Y.Z-rcN` +
  `:rc` (never `:latest`) and create a prerelease GitHub Release with a
  functional baked `install.sh` + `docker-compose.yml`. Promoting to the
  stable release is a tag-only operation (`git tag vX.Y.Z`) with zero
  file edits.

## [0.1.1] - 2026-07-25

### Fixed

- **`password authentication failed for user "mayon"` on reinstall** — the
  one-line installer now detects a pre-existing Postgres data volume when no
  config is present and, rather than silently minting a fresh password that
  could never match the volume, prompts to wipe the volume (interactive) or
  aborts with explicit recovery instructions (piped). Postgres bakes
  `POSTGRES_PASSWORD` into the `pg-data` volume on first init and ignores it
  thereafter; previously a lost `~/.mayon/.env` (or running the no-script path
  with the default password) desynced the credential and made the server fail
  to authenticate on every boot.
- **First-run Postgres readiness** (defense in depth) — the `db` healthcheck
  now runs an authenticated `SELECT 1` (via `PGPASSWORD`) instead of
  `pg_isready` alone, with 20 retries at 3s and a 10s `start_period`, and the
  server's `probePg` budget is raised from 2.5s (5×500ms) to 20s (20×1000ms)
  to survive slow first-time PG initialization.

## [0.1.0] - 2026-07-23

The first stable release. Mayon is now server-required for function and ships
prebuilt web + server images on GHCR so `docker compose up` works from pure pulls.

### Added

- **Branchable chat graph** — highlight any excerpt of a dense AI response and
  branch a new conversation from that exact point; navigate a tree of branches
  with sidebar, breadcrumbs, and cross-links.
- **Highlight → expound → branch** — select markdown text to expand or fork;
  offset mapping is deterministic (mdast source map + DOM alignment), with
  generated content (Mermaid/KaTeX/highlight tokens) correctly excluded.
- **Hands-on labs** — step-by-step guides with interactive checklists generated
  from any chat.
- **Quizzes** — MCQ, flashcard, and short-answer questions with AI grading and
  score tracking.
- **Provider-agnostic AI** — OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and
  Z.AI/Kilo gateways; switch providers freely; searchable model discovery for
  gateways.
- **stdio MCP runner + WebSocket bridge** — browser-resident stdio MCP servers
  (Brave, Filesystem, GitHub, custom) over a WS bridge when the server is
  connected; HTTP MCP servers with or without the server.
- **LLM CORS proxy** — CORS-blocked providers (e.g. Anthropic) stream from the
  browser through the server's `POST /api/llm/proxy`.
- **Sandbox SQLite** — isolated, read-write SQL inspector for MCP-tool data via
  `POST /api/sandbox/query`.
- **PG-native full-text search** — `tsvector`/`GIN`/`ts_headline` with noise
  stripping; searchAvailable()`reflects the`'pg'` capability.
- **PG-native backup/restore** — `pg_dump -Fc` / `pg_restore` with a pre-restore
  safety dump and automatic rollback on failure.
- **Legacy SQLite → PG importer** — reads a legacy OPFS-era `.sqlite` backup and
  loads its rows into Postgres (replacing data) in a single transaction, with a
  dry-run preview and idempotent re-import.
- **Self-host via docker compose** — published `ghcr.io/bendlikeabamboo/mayon`
  (web) and `ghcr.io/bendlikeabamboo/mayon-server` (server) images; upgrade by
  bumping `MAYON_VERSION` and `docker compose pull && docker compose up -d`.
- **Versioned releases** — `vX.Y.Z` git tag is the release trigger, CI-enforced
  to equal all three `package.json` versions and a matching `CHANGELOG.md`
  section; GHCR publishes `:X.Y.Z` and `:latest` for both images.
- **Isolated all-Docker dev environment** — `pnpm dev` brings up the web SPA
  (Vite HMR), the server (`tsx watch`), and Postgres in a separate `mayon-dev`
  compose project with disjoint volumes/ports, achieving full dev/prod parity
  with no host-side workarounds.

### Changed

- **Postgres is the primary store** (P-pg-2): schema flipped to `pg-core`,
  browser driver to `RemotePgDriver`, server runs drizzle's native `migrate()`
  at boot, and the app is server-required for function.
- **Dev topology is fully Dockerized** — the server now runs in a container in
  dev too (matching prod), so `DATABASE_URL` is always `…@db:5432/mayon` via
  compose `environment:` and no host `.env`/`tsx --env-file` is needed.
- `sidecar-data` volume renamed to `server-data`; OPFS/SQLite-WASM dead code
  removed; COEP/crossOriginIsolation plugin removed.

### Removed

- OPFS / SQLite-WASM / sql.js client-side storage (superseded by Postgres via
  the server).
- `bundle:migrations`, `translatePlaceholders`, and cross-origin-isolation
  machinery.

## [Unreleased-pre-pg]

### Added

- README, Quarto docs site, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, and community files.
- Docker image for self-hosted SPA deployment.
- GitHub Pages deployment for live demo and docs.
- GHCR publishing on version tags.
- Env-driven `BASE_PATH` for GitHub Pages at `/mayon/`.
- Fixed auto-updater endpoint to `bendlikeabamboo/mayon`.
