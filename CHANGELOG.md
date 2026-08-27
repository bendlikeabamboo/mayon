# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-08-27

### Added

- **UI visual articulation pass** — actionable controls no longer blend into
  static text. One warm accent hue (terracotta) is reserved system-wide for
  actions (buttons, links, active nav, focus rings, focused composer); surfaces
  articulate through hairline borders and subtle shadows across a three-step
  hierarchy (canvas / panel / raised card). The composer is reborn as a centered
  rounded card whose launchers immediately create persistent artifacts —
  "branch here" creates a tree node, "quiz me" opens the quiz composer, the lab
  launcher starts a lab, each anchored to the conversation and reload-proof.
  Also included: a home page with a resume card, hover-revealed copy/branch/
  regenerate row actions, rotating tree carets with connector lines, one shared
  row-card grammar across chat/quiz/lab lists, stagger-fade motion honoring
  `prefers-reduced-motion`, compressed status chrome, and skeletons that appear
  only past ~300 ms.
- **Decision history** — `docs/history/index.qmd` condenses every shipped
  feature's decision story (goal / rationale / reversals / learnings) into one
  narrative; contract detail referenced from living docs and code is preserved
  verbatim under `docs/history/appendices/`, with `specs/history-map.md` as a
  tombstone for the retired specification archive.

### Fixed

- **Quiz generation retries hardened** — when the model's structured output
  fails schema validation, generation now attempts two corrective retries
  (previously one) and recovers when the second correction validates;
  the object-tool call path was slimmed accordingly.

## [0.4.0] - 2026-08-23

### Added

- **Podman support (secondary engine) for installation & lifecycle** — the
  one-line installer now selects a container engine per run: explicit
  `MAYON_CONTAINER_ENGINE=docker|podman` override → engine recorded in
  `~/.mayon/.env` → auto-detection preferring Docker, falling back to the
  other engine when the preferred one lacks compose support. The chosen
  engine is recorded once at install and every lifecycle subcommand
  (`start/stop/restart/logs/status/upgrade/uninstall`) binds to it; a
  recorded engine whose binary is missing is a hard error (never a silent
  switch — volumes are engine-scoped). Install prints `Using engine: …
(source: …)`, verifies the stack actually became reachable before
  reporting success, and cross-engine installs warn + require confirmation
  when the other engine already holds data volumes.
- **Podman support for the dev workflow** — the four dev commands
  (`pnpm dev`, `dev:up`, `dev:down`, `dev:build`) dispatch through a single
  shared mechanism (`scripts/dev-compose.mjs`): `MAYON_DEV_ENGINE` env
  override or Docker-preferring auto-detection. No shell-alias reliance.
- **Rootless-Podman compatibility fixes** — the web image now listens on
  8080 inside the container (nginx no longer binds privileged port 80), and
  the Postgres image is fully qualified (`docker.io/library/postgres:17-alpine`)
  so short-name resolution works under strict Podman registry policies.
  Docker behavior is unchanged.
- **Docs** — README self-host/install/upgrade/gateway/troubleshooting
  sections cover both engines (Podman notes: rootless ports, host gateway
  `host.containers.internal`, short-name resolution, docker→podman alias
  limits); CONTRIBUTING/AGENTS document the dev-engine selector and the
  engine-switch caveat (dev volumes/caches are engine-scoped).

## [0.3.0] - 2026-08-21

### Added

- **Chat timeline entry-kind model** — every timeline event now carries an
  explicit `kind` (user/assistant message, reasoning, tool call/result,
  approval, sampling, elicitation, choices, self-correction) with lanes
  (user / internal / external) derived from kind via a single
  kind→presentation registry. Permission asks, sampling requests,
  elicitations, and choice offers are durable: their options and resolved
  outcomes survive reload (undecided asks render as undecided, never as
  live cards). Reasoning persists per agent-loop iteration with correct
  attribution. A stamped schema-version migration backfills kinds for 100%
  of existing rows in place — no parallel table, all entry IDs preserved.
- **Honest tool-activity statuses** — tool rows derive
  awaiting/running/declined/aborted/failed/succeeded presentation (plus
  kept genuine-gap/terminal states) from approval outcomes, live pending
  approvals, and an additive `ok` flag on new tool-result metadata.
  Awaiting calls no longer render as failures; declined is visually
  distinct from failed.
- **Shape-driven tool-result rendering** — expanded tool results render per
  their detected shape: URL-bearing JSON records (e.g. Brave web-search
  payloads) as a capped list of link cards with the sources row folded in,
  markdown through the timeline markdown renderer, other JSON
  pretty-printed, everything else in the existing bounded raw view. A pure
  classifier (`src/lib/chat/result-shape.ts`) is the single shape
  authority — detection never consults tool names or server identity.
  Stored payloads are read-only inputs; legacy chats render with zero data
  change.
- **Tappable pacing offers in the timeline** — choice chips moved out of
  the compose area (now user-input-only) onto their timeline offer; the
  taken choice links back to its offer and survives reload.
- **Spec-driven development tooling** — Spec Kit (`/speckit.*`) command
  suite with project constitution, spec/plan/tasks templates, and feature
  checklists under `.kilo/` and `.specify/`.

### Changed

- **Context assembly is an explicit projection** — the provider-visible
  message sequence is derived by one pure entries→messages projection with
  golden-test equivalence for pre-existing chats, replacing
  column-combination guessing; the request trace now mirrors the projected
  wire payload (single system prompt, tool identity preserved).
- **Live and persisted output share one presentation** — streaming text,
  reasoning, and pending asks flow through the same renderers as their
  durable counterparts, eliminating visual discontinuity on turn
  completion and the duplicated streaming markup.
- **Tool-result expander is the header row** — the icon + tool name +
  chevron header toggles the expanded body (`aria-expanded`, keyboard
  support); the floating Show/Hide control is gone.

### Fixed

- **No duplicated assistant text during approval waits** — a persisted text
  segment retires its live buffer in the same update, so the pre-tool
  sentence renders exactly once throughout the wait and after completion.
- **Exactly one ask surface per pending request** — a pending live ask
  replaces its durable row at the row's chronological position instead of
  rendering twice.
- **Quiz generation survives aliased question types** — models emitting
  variant discriminators ("multiple_choice", "short-answer", "flash_card", …)
  no longer fail quiz generation with "Structured result did not match the
  schema": the quiz schema canonicalizes known type aliases,
  structured-generation failures carry a machine-readable code, and quiz
  generation retries once with the validation error fed back to the model.

## [0.2.1] - 2026-08-09

### Fixed

- **Expound underline rendering robustness** — the highlight underline pass now
  distinguishes the observed DOM signature from the successfully-applied
  signature and retries via a capped `requestAnimationFrame` loop (10 attempts)
  when source-map alignment fails or range wrapping is incomplete, so underlines
  converge on late/async content instead of silently dropping. The "Branch from
  this" toolbar button now reflects its disabled state with a reason tooltip.
- **Expound alignment correctness** — `locateCanonical` was extracted into
  `src/lib/markdown/locate.ts` (now unit-tested); whitespace-only DOM text nodes
  are skipped during alignment rather than failing it; and the injected
  `.md-focusable-btn`, `.external-link-icon`, and `.mermaid-pending` chrome
  selectors were added to the excluded list so they no longer corrupt offset
  mapping.

## [0.2.0] - 2026-07-27

### Added

- **Release Candidate (RC) workflow** — CI now accepts `vX.Y.Z-rcN` tags
  alongside stable `vX.Y.Z`. RC tags publish images tagged `:X.Y.Z-rcN` +
  `:rc` (never `:latest`) and create a prerelease GitHub Release with a
  functional baked `install.sh` + `docker-compose.yml`. Promoting to the
  stable release is a tag-only operation (`git tag vX.Y.Z`) with zero
  file edits.
- **Schema versioning for backup/restore** — schema version is stamped into
  the settings table at server boot and backup time; restore refuses backups
  stamped newer than the running server and auto-migrates older additive
  backups via a gate registry.
- **Schema migration system** — extensible migration registry with optional
  per-version `migrate(client)` functions for forward schema evolution.

### Changed

- **Backup/restore is now in-place with no downtime** — restore uses
  `pg_restore --data-only --single-transaction` (truncate + reload) instead
  of the previous nuke-and-pave approach. A maintenance flag returns 503 on
  `/api/db/query` during restore with no server restart required.
- **Improved AGENTS.md** — consolidated operating guide with clearer stack,
  commands, release flow, topology, and invariant documentation.
- **Archived completed plans and refinement docs** — moved finished
  implementation plans and refinement notes to `archive/` subdirectories.

### Removed

- Legacy system prompts (`prompts/start.md`).

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
