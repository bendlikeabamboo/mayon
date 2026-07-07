# Mayon — Packaging, Release, Docs & OSS Plan

> Status: implementation-ready. Authored 2026-07-07 after a planning interview.
> Scope: README, Quarto docs site, open-source community files, Dockerization, and
> CI/CD (GitHub Pages + GHCR + GitHub Releases). Mayon is feature-complete; this is
> shipping/polish work only — **no app feature changes**.
>
> Note: the user asked for this plan in `refinement/`, but the planning agent's edit
> permissions only cover `.kilo/plans/`. An implementer with broader permissions should
> move it to `refinement/2026-07-07_packaging-release-and-oss-plan.md` to match that
> directory's naming convention if desired.

## Context

Mayon is a local-first learning app (branchable chat graph + labs + quizzes) shipping as
a SvelteKit static SPA + a Tauri v2 desktop shell. There is **no backend server**: browser
uses OPFS + IndexedDB; desktop uses native SQLite + OS keychain. The `../argus` reference
project deploys a *Python backend* to a VPS via Docker → GHCR → self-hosted runner; that
"deploy-to-VPS" step does **not** map here (GitHub Pages + GHCR chosen instead).

Current state: `README.md` is a stub (`# mayon`); `docs/` is empty; no community files;
`ci.yml` (lint/check/test) and `release.yml` (Tauri multi-OS build on `v*` tag) exist.

## Resolved decisions (from interview)

1. **Posture:** Public OSS that accepts PRs, under the existing MIT LICENSE.
2. **Docker:** A single **multi-stage static-SPA image** (nginx serves `build/`). The
   Tauri desktop build is **not** containerized — it stays on native per-OS release runners.
3. **Deploy targets:** **GitHub Pages** (live SPA demo + Quarto docs at `/docs`), **GHCR**
   (self-host Docker image), **GitHub Releases** (Tauri binaries — already wired).
4. **Canonical repo:** `bendlikeabamboo/mayon`. The stale `mayon-app/mayon` auto-updater
   endpoint in `tauri.conf.json` is corrected.

## Out of scope

- VPS / self-hosted-runner deployment (Pages chosen instead).
- Containerized Tauri cross-compilation (fragile; native runners are correct).
- `.devcontainer` / Codespaces.
- Cloud sync, mobile/Android builds, `FUNDING.yml`, CLA/DCO tooling, Zenodo/CITATION.

## Prerequisites (manual, one-time — cannot be done via files)

- **GitHub repo Settings → Pages → Source = "GitHub Actions"** (deploys via workflow).
- **GHCR:** no setup needed — `GITHUB_TOKEN` with `packages: write` auto-pushes.
- **Secrets:** only the existing `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  (`release.yml` already gates on these). Pages + GHCR use the auto `GITHUB_TOKEN`.
- **Quarto** is installed in CI via `quarto-dev/quarto-actions/setup@v2` (no local install
  needed to author `.qmd`; only to preview locally — `brew install quarto` / download).

## Config changes (do these first — small, unblock everything)

1. **Fix updater endpoint** — `src-tauri/tauri.conf.json`: change
   `github.com/mayon-app/mayon` → `github.com/bendlikeabamboo/mayon` (in
   `plugins.updater.endpoints`).
2. **Env-driven SPA base path** — `svelte.config.js`: read `BASE_PATH` from env, default to
   `'.'` (relative) so Tauri `frontendDist`, the Docker/nginx image, and `vite preview` all
   work unchanged. The Pages build passes `BASE_PATH=/mayon/`. Wire it into the
   `adapter-static`/`paths.base` config. Confirm SPA routing fallback still works after the
   change.
3. **Refresh `AGENTS.md`** — the stale "treat `refinement/architecture.md` as authoritative"
   line: point at the new rendered **`docs/dev/architecture.qmd`** as the design source, and
   reframe `refinement/` as historical design notes. (The file is actually at
   `refinement/archive/architecture.md` today — the reference is already broken.)
4. **`.gitignore`** — add Quarto build output (`docs/_book/`); keep `build/` ignored.

---

## A. README.md (concise landing, public-OSS tone)

Rewrite the stub. Keep it short; link out to the docs site for depth.

- One-line tagline + 2–3 sentence "what/why" (port from `package.json` description +
  architecture §1).
- **What it is** bullets: branchable chat graph, labs, quizzes, local-first/offline,
  provider-agnostic, two runtimes (browser + desktop).
- **Get Mayon** — three parallel paths, each one short code block:
  1. **Desktop:** download from GitHub Releases (link `releases/latest`).
  2. **Web demo:** open the GitHub Pages link.
  3. **Self-host (Docker):** `docker pull ghcr.io/bendlikeabamboo/mayon` + a 3-line
     `docker run`/compose snippet.
- **Build from source** — prerequisites (Node 22, pnpm 10, Rust 1.95 + Linux GTK/WebKit
  deps per AGENTS.md), then `pnpm install && pnpm dev` / `pnpm tauri dev`.
- **Docs** — link to the Quarto site.
- **Contributing** — one line linking to CONTRIBUTING.md.
- **License** — MIT, link LICENSE.
- No screenshots required for v1 (add later if available).

## B. Quarto docs (`docs/`)

A Quarto **book** (`project: { type: book }`) rendering to HTML, deployed under `/docs` on
the Pages site. Authoritative content is **ported/written fresh here**, not just linked.

- `docs/_quarto.yml` — book config: `title`, `output-dir: ../build/docs`,
  `site-url: https://bendlikeabamboo.github.io/mayon/docs`, HTML with sidebar + search,
  a favicon, and repo link.
- `docs/index.qmd` — overview (what Mayon is, the two runtimes, the local-first promise).
- `docs/getting-started.qmd` — install (desktop download / web demo / Docker), first run,
  the P0 theme-toggle + DB-status badge as the "it works" signal.
- `docs/guide/` — end-user guide, one chapter each:
  - `chat-and-branching.qmd` (highlight → branch, tree sidebar, breadcrumb, cross-links).
  - `labs.qmd`, `quizzes.qmd` (generating, taking, AI grading).
  - `providers.qmd` (templates, base URL/model, keys; desktop keychain vs browser
    IndexedDB; CORS note → "use the desktop app").
  - `data-and-privacy.qmd` (OPFS / native SQLite, where keys live, no telemetry).
- `docs/dev/` — contributor/architecture section:
  - `architecture.qmd` — **port** `refinement/archive/architecture.md` (system diagram,
    the two seams, reference-based context assembly, schema tables). This becomes the
    authoritative design source referenced by AGENTS.md.
  - `building.qmd` — build/run/preview, the Tauri Linux deps, `db:generate` +
    `bundle:migrations` workflow.
  - `seams.qmd` — `StorageDriver` + `ProviderTransport` boundaries (the "do not violate"
    rules from AGENTS.md).
- `docs/contributing.qmd` — setup, conventions, PR flow, commit/branch style, the migration
  workflow; links to CONTRIBUTING.md and CODE_OF_CONDUCT.md.

Render locally with `quarto preview docs/`. Do **not** commit `docs/_book/` (gitignored).

## C. Open-source community files (standard set for PR-accepting OSS)

- `CONTRIBUTING.md` — dev setup (pull from `docs/dev/building.qmd`), code style
  (ESLint+Prettier, `pnpm lint`/`format`), branch/commit conventions, PR checklist, the
  mandatory `pnpm bundle:migrations` after `db:generate`, testing (`pnpm test`), and a note
  that AI-assisted contributors should read `AGENTS.md`.
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1 (standard text; maintainer contact = the
  repo's security contact).
- `SECURITY.md` — supported versions (current release line), how to privately report
  (GitHub "Report a vulnerability" / security advisory, **not** a public issue), and a short
  note on the secure-storage posture (keys in OS keychain / IndexedDB, never in `settings`).
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` — YAML form templates.
- `.github/ISSUE_TEMPLATE/config.yml` — `blank_issues_enabled: false`, contact links to the
  docs site + Discussions.
- `.github/PULL_REQUEST_TEMPLATE.md` — summary, motivation, changes, checks run
  (lint/check/test/build), migration note if schema touched.
- `.github/CODEOWNERS` — `* @bendlikeabamboo` (sole maintainer for now).
- `CHANGELOG.md` — Keep a Changelog format; seed with an `[Unreleased]` section and a first
  entry capturing the packaging/OSS milestone.

## D. Docker (static SPA image)

- `Dockerfile` — multi-stage:
  1. `node:22-alpine` → `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`
     (default relative base — works at nginx root).
  2. `nginx:alpine` → copy `build/` to `/usr/share/nginx/html`, copy a custom
     `nginx.conf` (SPA fallback `try_files $uri $uri/ /index.html;`), `EXPOSE 80`,
     a `HEALTHCHECK` hitting `/`.
  - Non-root user; minimal layers.
- `nginx.conf` (repo root or `docker/nginx.conf`) — serve the SPA with the fallback above
  and sensible caching headers for hashed assets.
- `docker-compose.yml` (repo root) — minimal: builds from the Dockerfile, maps a host port
  (e.g. `8080:80`), `restart: unless-stopped`. This is the documented self-host path.
- `.dockerignore` — `node_modules/`, `build/`, `.svelte-kit/`, `src-tauri/target/`,
  `src-tauri/gen/`, `.git/`, `.env*`, `docs/_book/`, `coverage/`, `refinement/`, test/build
  caches. (Model on `../argus/.dockerignore`.)

## E. CI/CD workflows

Refactor toward the argus pattern of a **reusable composite action** + thin trigger workflows.

- `.github/actions/ci/action.yml` (composite) — `pnpm install --frozen-lockfile`,
  `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` (catches SPA build breaks), and a
  `docker build` smoke (build only, no push). Reused by PR and release pipelines.
- `.github/workflows/ci.yml` — on `pull_request` + push to `main`/`master`: run the composite
  action. (Currently push-to-main + PR; consolidate onto the composite.)
- `.github/workflows/deploy-pages.yml` — on push to `main` (+ `workflow_dispatch`): build the
  SPA with `BASE_PATH=/mayon/`, render Quarto into `build/docs/`, copy `index.html` →
  `404.html` (SPA-routing fallback for GitHub Pages), upload `build/` via
  `actions/upload-pages-artifact@v3`, deploy with `actions/deploy-pages@v4` (after
  `actions/configure-pages@v4`). Keeps the live demo + docs current with `main`.
- `.github/workflows/docker-publish.yml` — on `v*` tag: run the CI composite (gate), then
  `docker/setup-buildx-action` → `docker/login-action` (GHCR via `GITHUB_TOKEN`) →
  `docker/metadata-action` (semver `{{version}}` + `latest`) → `docker/build-push-action`
  with GHA cache → pushes `ghcr.io/bendlikeabamboo/mayon:<v>` + `:latest`. (Mirrors
  `../argus/.github/workflows/docker-publish.yml` minus the VPS deploy step.)
- `.github/workflows/release.yml` — **keep as-is** (Tauri multi-OS build on `v*` tag), but
  add the composite CI as a prerequisite gate job and confirm the updater endpoint fix from
  §"Config changes" is in place so signed `latest.json` is reachable.

> Trigger summary: **PR/push → ci.yml**; **push to main → deploy-pages.yml**;
> **`v*` tag → release.yml (Tauri) + docker-publish.yml (image)**.

## Risks

- **SPA base path / Pages routing** is the highest-risk item: a wrong `paths.base` breaks
  asset loading under `/mayon/`, and missing `404.html` breaks deep-link refresh. Mitigation:
  env-driven `BASE_PATH` defaulting to relative; `404.html` copy in the Pages workflow;
  verify with a manual deep-link reload after first deploy.
- **Updater endpoint mismatch** would make auto-update silently fail post-release — the
  §"Config changes" fix is mandatory before tagging.
- **Quarto in CI** adds a render step that can fail on broken `.qmd`; run `quarto render docs/`
  locally before committing doc changes, and the Pages workflow will surface failures.
- **Tauri release still can't run in the sandbox** (per AGENTS.md) — release.yml correctness
  is verified only on a real tag push, not in local validation.

## Validation

- `pnpm lint && pnpm check && pnpm test` green.
- `pnpm build` succeeds with default (relative) base; `BASE_PATH=/mayon/ pnpm build` succeeds
  and emitted `index.html` references `/mayon/...` assets.
- `docker build .` succeeds; `docker run -p 8080:80 <image>` serves the app at `:8080/`,
  and a deep route reload (via the 404 fallback) works.
- `quarto render docs/` produces `build/docs/index.html` with working sidebar/search.
- After pushing to `main`: Pages site live at `bendlikeabamboo.github.io/mayon/` (app) and
  `.../mayon/docs/` (docs); deep-link refresh works.
- After tagging `vX.Y.Z`: GHCR image appears at `ghcr.io/bendlikeabamboo/mayon` with `:latest`
  + the version tag; GitHub Release holds the per-OS installers + signed `latest.json`.
- Community files render correctly on the repo tab (Issue templates, SECURITY policy link,
  CODEOWNERS triggers reviews).

## Open questions

None — all forks resolved in the interview. Implement in the order: §Config changes →
A (README) → B (docs) → C (community) → D (Docker) → E (workflows), then run Validation.
