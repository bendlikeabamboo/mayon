# Implementation Plan: Podman Compatibility for Installation & Stack Lifecycle

**Branch**: `011-podman-support` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-podman-support/spec.md`

## Summary

Make the end-user installation path Podman-friendly (primary goal) and give the documented dev commands secondary Podman support, while Docker stays primary everywhere (detection default, dev default, CI, release packaging — per FR-010/FR-013). Two engine-resolution surfaces, one shared policy:

- **Installer** (`install.sh`): explicit override → engine recorded in the install's `.env` → auto-detection preferring Docker, with fallback to the other engine when the preferred one lacks compose support. The chosen engine is recorded as `MAYON_CONTAINER_ENGINE` in `~/.mayon/.env`, and every lifecycle subcommand (`start/stop/restart/logs/status/upgrade/uninstall`) binds to it — no silent engine switching, and cross-engine "stranded data volume" situations are detected and warned about before a fresh database can be presented as the user's data.
- **Dev workflow** (`scripts/dev-compose.mjs`, new zero-dependency Node script): `MAYON_DEV_ENGINE` env override (per invocation, never persisted) → auto-detect preferring Docker; the four `pnpm dev*` scripts dispatch through this single shared mechanism (FR-014).

The compose files stay engine-neutral (single artifact set, healthcheck gating intact); README install/upgrade/manual-run/gateway docs gain Podman notes, and CONTRIBUTING/AGENTS dev docs note the dev-engine override and its limits. The changes are `install.sh` (Bash), one tiny Node dispatch script, `package.json` script bodies, and docs — no app, server, or CI code changes.

## Technical Context

**Language/Version**: Bash (`install.sh`, `set -euo pipefail`, bash-4+ constructs already in use); Node 22 ESM for one zero-dependency dispatch script (`scripts/dev-compose.mjs`, `node:child_process` builtins only — Node is guaranteed since pnpm requires it, so no new dependency and the toolchain pins hold). Markdown for docs. **No app/server TypeScript or Svelte changes.**

**Primary Dependencies**: Docker CLI + compose plugin (primary engine); Podman ≥ 4 with a compose provider (`podman compose` delegating to `podman-compose` or `docker-compose` — secondary engine); Node 22 (guaranteed by pnpm 10) for the dev dispatch script — zero new package dependencies; existing release-asset pipeline (unchanged).

**Storage**: N/A for app code — the installer writes `~/.mayon/{docker-compose.yml,.env,install.sh}` and manages engine-scoped named volumes (`<project>_pg-data`, `<project>_server-data`).

**Testing**: `bash -n install.sh` and `node --check scripts/dev-compose.mjs` syntax gates; optional `shellcheck`; manual scenario matrix in [quickstart.md](./quickstart.md). No Vitest surface — constitution Art. II applies to `src/lib/` and `server/src/`; neither is touched (`scripts/dev-compose.mjs` is a dev toolchain dispatch wrapper, not app code — but it SHOULD still get a small smoke test via the Scenario matrix).

**Target Platform**: Linux x86_64/arm64 end-users; rootless Podman 4.x+ is the focus. macOS/Windows Podman machines tolerated, not tested.

**Project Type**: Distribution scripts + docs for a self-hosted web app.

**Performance Goals**: N/A (installer UX; SC-001's 10-minute bound is covered by the one-line flow, not code performance).

**Constraints**: single engine-neutral `docker-compose.yml` (no forks, FR-009); `@MAYON_INSTALLER_VERSION@` CI marker must be preserved verbatim; no secrets-handling changes (`.env` stays `chmod 600`); no shell-alias reliance (FR-012); RC-first release flow unchanged.

**Scale/Scope**: personal single-user installs; one install directory per machine (`MAYON_DIR`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I — Code Quality / layering | PASS | No `src/lib`, store, or route changes; the `StorageDriver` seam is untouched. |
| I — Toolchain pins | PASS | No new runtimes or packages: Bash + Node 22 builtins (guaranteed by the pnpm pin) + docs. `pnpm check` / `pnpm lint` must stay green, now covering `scripts/dev-compose.mjs`. |
| I — No secrets in settings | PASS | `.env` continues to hold the generated password, `chmod 600`; no new secret fields. |
| II — Testing standards | PASS (with rationale) | No `src/lib/` or `server/src/` changes ⇒ no Vitest obligation. Installer correctness is covered by the quickstart scenario matrix (constitution explicitly routes UI/script-only work to check + manual smoke). |
| II — FTS / restore invariants | PASS | Untouched. |
| III — UX consistency / progressive degradation | PASS | No app UI changes. |
| IV — Performance | PASS | No perf-sensitive surface. |
| Quality Gates | PASS | `pnpm check`, `pnpm lint`, `pnpm test` expected green — no app/server source changes; the new `scripts/dev-compose.mjs` is plain-ESM lint-covered with zero dependencies. Server tests unaffected. |
| Release contract | PASS | CI untouched (FR-010); installer flows through the existing `release-assets` job; `@MAYON_INSTALLER_VERSION@` marker preserved; RC-first flow applies when shipping. |

**Re-check after Phase 1**: PASS — design introduces no code outside `install.sh`, the stateless `scripts/dev-compose.mjs` dispatch wrapper, and docs; contracts below define behavior contractually so `/speckit-tasks` can generate verifiable tasks.

## Project Structure

### Documentation (this feature)

```text
specs/011-podman-support/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── engine-selection.md       # installer engine resolution (install.sh)
│   ├── lifecycle-commands.md     # installer subcommands (install.sh)
│   └── dev-engine-dispatch.md    # dev-command engine dispatch (scripts + package.json)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
install.sh               # Engine selection, engine-aware preflight/lifecycle (PRIMARY change)
scripts/dev-compose.mjs  # NEW — shared dev-command engine dispatch (MAYON_DEV_ENGINE | auto-detect)
package.json             # dev/dev:up/dev:down/dev:build script bodies dispatch through dev-compose.mjs
docker-compose.yml       # UNCHANGED — engine-neutral, healthcheck gating preserved (FR-009)
docker-compose.dev.yml   # UNCHANGED — engine-neutral by construction; only invocation dispatch changes
README.md                # Install/upgrade/manual-run/gateway docs gain Podman notes (FR-008/FR-011)
CONTRIBUTING.md          # Dev-workflow doc notes the MAYON_DEV_ENGINE override + limits (FR-010/FR-014)
```

**Structure Decision**: The feature is distribution/tooling-layer only. `install.sh` absorbs all installer engine logic behind a resolved `ENGINE` variable + `compose_cmd()` (see [contracts/engine-selection.md](./contracts/engine-selection.md)); the four dev commands share one dispatch script so FR-014's "single shared mechanism" is structural, not conventional — no per-script ad-hoc logic; both compose files are deliberately untouched; README is the end-user doc surface and CONTRIBUTING the contributor surface for the dev-engine note.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**
No violations — table intentionally empty.
