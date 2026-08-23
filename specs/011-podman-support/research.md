# Research: Podman Compatibility for Installation

**Feature**: `011-podman-support` | **Date**: 2026-08-23
Source: spec.md clarifications (2026-08-23 session) + repository inspection + established Podman/Docker compatibility knowledge. No external network research was performed; findings below reflect verified behaviors of the tooling involved and should be spot-checked at implementation time.

## R1 — Compose provider under Podman

- **Decision**: Treat `podman compose` (the subcommand) as the compose entrypoint for Podman installs. It is Podman's official delegation wrapper: if `podman-compose` is installed it uses that; otherwise it can delegate to the `docker-compose` Python binary or plugin if present.
- **Rationale**: Works with either provider the user has (spec assumption: "either provider"), no need for the installer to pick one; `podman compose version` doubles as the compose-capability probe (mirrors today's `docker compose version` check).
- **Alternatives considered**: (a) Invoke `podman-compose` directly — breaks setups that only have the docker-compose provider; (b) require `podman compose` strictly with no fallback detection — fails machines with only standalone `podman-compose`; the wrapper subcommand covers both.

## R2 — Engine selection order and override

- **Decision**: Order = `MAYON_CONTAINER_ENGINE` env/`.env` override → engine recorded in existing `.env` → auto-detect (Docker preferred; both present ⇒ Docker; Docker absent + Podman present ⇒ Podman). If the preferred engine exists but lacks compose support, fall back to the other engine with a warning rather than failing (FR-002), unless overridden explicitly — explicit override + missing prerequisites = hard error with remediation.
- **Rationale**: Preserves today's behavior for existing Docker users (recorded `.env` wins), gives Podman-only machines a working default, honors explicit user intent for the SC-005 "one-setting change" flow.
- **Alternatives considered**: (a) Always re-detect on every run without recording — risks subcommands silently flip-flopping engines after a new engine is installed, violates FR-003; (b) persist a separate state file — unnecessary; `.env` is already the config-of-record the installer owns.

## R3 — Recording the engine and lifecycle binding

- **Decision**: Write `MAYON_CONTAINER_ENGINE=docker|podman` into `~/.mayon/.env` at install time (only when absent; explicit override rewrites it once at install). All subcommands read `.env` first, falling back to detection only when the key is missing (pre-existing installs); a missing binary for the recorded engine is a hard error naming the engine + the `.env` key (spec edge case), never a silent switch.
- **Rationale**: Single source of truth already loaded by compose for variable interpolation; avoids a new state file; upgrade (which re-runs `install` from the new release's installer) naturally preserves the recorded engine because `ensure_env` keeps existing `.env` and the new installer reads it.
- **Alternatives considered**: (a) Detect by inspecting which engine owns the running containers — fragile, requires a running stack; (b) record in a separate `engine.conf` — splits config across files.

## R4 — Compose command shim

- **Decision**: Centralize in one function — `compose_cmd() { (cd "$INSTALL_DIR" && "$ENGINE" compose "$@"); }` — where `ENGINE` is the resolved binary (`docker` or `podman`). Preflight probes compose capability with `"$ENGINE" compose version`. Under Podman, the `compose` subcommand delegates to whichever provider exists (R1).
- **Rationale**: `install.sh` today has ~7 direct `docker compose` call sites (`compose_cmd`, `pg_volume_exists`, `guard_stale_volume`, `compose_project_name`, `cmd_*` handlers) — all must route through the resolved engine; the shim is the minimal single seam. Both CLIs are argument-compatible for the operations used (`config`, `pull`, `up -d`, `stop`, `restart`, `logs -f`, `ps`, `down`, `volume inspect/rm`).
- **Alternatives considered**: Generate per-engine wrapper scripts — overkill; two compose files — violates FR-009.

## R5 — Cross-engine data hazard (FR-006)

- **Decision**: Before creating a fresh volume set in the *selected* engine, check the *other* engine (if its binary exists) for `<project>_pg-data`. If found: warn that data exists under the other engine and will not be visible under the selected one; require explicit interactive confirmation (`y/N`) to proceed with an empty database; in non-interactive mode abort with instructions. Existing same-engine stale-volume logic (`guard_stale_volume`) is unchanged and runs after the cross-engine check.
- **Rationale**: Volumes are engine-scoped store dirs (`/var/lib/docker/volumes` vs rootless `~/.local/share/containers/storage/volumes`); they do not transfer. The core risk in the spec is "empty DB presented as user's data" — an explicit confirm is the cheapest correct gate. Detection is best-effort (both engines probing) and failure to probe the other engine is non-fatal (warn + continue), since some systems alias/symlink the two.
- **Alternatives considered**: (a) Auto-migrate volumes across engines — out of scope (spec assumption); (b) refuse outright always — blocks the legitimate "I'm switching engines deliberately" flow the spec's edge case describes.

## R6 — Rootless Podman specifics surfaced in docs

- **Decision**: README notes: (a) default port 8080 is unprivileged so rootless binding works out of the box; ports <1024 need rootful Podman or a sysctl (`net.ipv4.ip_unprivileged_port_start`); (b) reaching a host gateway endpoint from containers: `host.containers.internal` is Podman's stable equivalent of `host.docker.internal` (works on 4.x+ for both rootless/rootful; on rootful Linux may need `--network` slirp4netns config or the host LAN IP); document `host.containers.internal` first, LAN-IP fallback same as the Docker docs.
- **Rationale**: These two are the real-world Podman trip-ups named in spec FR-008/US3; everything else (healthchecks on `postgres:17-alpine`, named volumes, `expose` vs `ports`, env interpolation) is OCI-compat and works unchanged.
- **Alternatives considered**: Documenting `--network=host` — changes security posture; rejected.

## R7 — Scope fence (FR-010/FR-013)

- **Decision**: `docker-compose.build.yml`, the CI workflow, Dockerfiles, and the release pipeline remain exactly as-is. The dev **compose definitions** stay engine-neutral and unchanged in substance — only **command dispatch** gains engine resolution (R9). User-facing doc changes: README install/upgrade/manual-run sections (end-user); CONTRIBUTING dev-commands section (contributor) notes the `MAYON_DEV_ENGINE` override and engine-switch caveat.
- **Rationale**: Spec scoping (2026-08-23 session, final state): CI and release packaging stay Docker-based; the dev workflow was promoted to secondary support after the initial scoping answer — the later clarification supersedes. Compose files ride OCI compatibility; only invocation needs to know the engine.
- **Alternatives considered**: Keep dev Docker-only and lean on the user's `docker`→`podman` alias — explicitly rejected by FR-012 (npm scripts don't load shell aliases) and by the owner's own Podman-only workstation (US4).

## R9 — Dev-command engine dispatch (FR-010/FR-014)

- **Decision**: One zero-dependency Node ESM script, `scripts/dev-compose.mjs`, owning resolution + execution for all four dev commands. Interface: `node scripts/dev-compose.mjs <up|up -d|down|build>` (the compose subcommand/flags are forwarded verbatim). Resolution: `MAYON_DEV_ENGINE` env (`docker|podman`, anything else → clear error) → else `command -v docker` → else `command -v podman` → else error naming both. It prints one `Using engine: <name> (source: override|detected)` line, then `spawn`s `$ENGINE compose -p mayon-dev -f docker-compose.dev.yml <args>` with stdio inherited (exit code forwarded). No state is written — the override is per-invocation only, by design (dev has no `.env`-of-record; re-detection each run is the documented behavior, with the README/CONTRIBUTING noting that switching engines resets the engine-scoped dev volumes/caches). The four `package.json` scripts become `node scripts/dev-compose.mjs up`, `… up -d`, `… down`, `… build`.
- **Rationale**: FR-014 demands a *single shared mechanism* — a script is enforceable structure; npm-script-level env-conditionals (`docker compose … || podman compose …`) would be four copies of ad-hoc logic and can't express "prefer docker, fall back only when absent" (a failing compose call would wrongly trigger fallback). Node (not bash) because the scripts already run under pnpm/Node on every contributor platform including macOS/Windows, where `/bin/bash` and `command -v` are not guaranteed; Node 22 is already a hard pin. Zero dependencies keeps the constitution's toolchain-pin spirit and adds nothing to install time.
- **Alternatives considered**: (a) npm `pre` script exporting an engine var — still needs cross-platform resolution logic somewhere, splits the mechanism across files; (b) a `compose-wrapper` npm package — new dependency for trivial logic; (c) leave scripts as-is and document the alias — violates FR-012/FR-014 and US4 acceptance 1; (d) just-envelope in package.json using `docker compose || podman compose` — mis-falls-back on any docker failure, and npm's default shell on Windows is cmd.exe.

## R8 — Testing approach

- **Decision**: `bash -n install.sh` as the automated gate (plus `pnpm check`/`pnpm lint` trivially). Functional validation is the manual scenario matrix in quickstart.md (Podman-only install, lifecycle+upgrade, manual compose bring-up, Docker regression pass). A shellcheck pass is recommended but not gated, matching how the rest of the repo scripts are managed.
- **Rationale**: Constitution Art. II mandates tests for `src/lib/` + `server/src/` — not distribution shell scripts; Art. III routes UI/script-only changes to check + manual smoke. No test framework for bash exists in the repo.
- **Alternatives considered**: bats-core — would add a new framework/toolchain for one script; rejected (constitution's toolchain-pin spirit).
