# Contract: Engine Selection (`install.sh`)

**Feature**: `011-podman-support` | **Date**: 2026-08-23
**Module**: `install.sh` (top-level constants + `preflight()` + new helpers)

## Public interface

```bash
# Resolved per invocation, before any compose call:
ENGINE            # "docker" | "podman" — the engine binary name
ENGINE_SOURCE     # "override" | "recorded" | "detected" | "fallback"

MAYON_CONTAINER_ENGINE   # user-facing env/.env key (docker|podman)

compose_cmd()            # (cd "$INSTALL_DIR" && "$ENGINE" compose "$@")
compose_ok()             # probe: "$ENGINE" compose version >/dev/null 2>&1
engine_binary_ok()       # probe: command -v "$ENGINE"
```

## Resolution order (FR-002)

1. `MAYON_CONTAINER_ENGINE` exported in environment (values: `docker|podman`; anything else dies with usage message) → `ENGINE_SOURCE=override`
2. `MAYON_CONTAINER_ENGINE` present in `$ENV_FILE` → `ENGINE_SOURCE=recorded`
3. Auto-detect: `command -v docker` succeeds → docker; else `command -v podman` → podman; neither → die (see Errors)
4. If the chosen engine's binary exists but `compose_ok` fails and the **other** engine is fully usable → switch with a `warn`, `ENGINE_SOURCE=fallback`
5. Explicit override with a broken/missing engine = **hard die** (no fallback), per "honor explicit intent"

After resolution on an **install** run, the resolved engine is persisted: `ensure_env` writes `MAYON_CONTAINER_ENGINE=$ENGINE` when the key is absent; an override install rewrites it (`sed` replace, same pattern as `ensure_version_pin`).

## Recording & reads (FR-003)

- Every subcommand resolves `ENGINE` from `.env` (recorded) before acting; the recorded value wins over export ONLY on non-install commands when both exist (install honors the export for the rewrite).
- Recorded engine binary missing → `die` naming engine + `$ENV_FILE` key; **never** fail over silently (spec edge case).
- Legacy installs (no key): subcommands fall back to detection and, on first successful lifecycle run, **do not** write the key (records happen at install/upgrade only — upgrade re-runs install, which records).

## Preflight (FR-004)

```text
engine_binary_ok "$ENGINE" || die <engine-specific install hint>
compose_ok      "$ENGINE" || die <engine-specific compose hint>
```

Error copy must be engine-specific, e.g.:

- docker: "install Docker Desktop / the compose plugin"
- podman: "install Podman ≥4 and a compose provider (`podman compose` — package `podman-compose` or the docker-compose plugin); see https://podman.io"
- neither: list both options with links.

## Cross-engine hazard check (FR-006)

On install, when the resolved engine differs from an engine that already holds `<project>_pg-data`:

```bash
other="${ENGINE}"==docker ? podman : docker
engine_binary_ok "$other" && "$other" volume inspect "${PROJECT}_pg-data" >/dev/null 2>&1
```

If found: `warn` that existing data lives under the other engine and will not be visible here; interactive `read -r -p "Start fresh under $ENGINE anyway? THIS BEGINS A NEW EMPTY DATABASE. [y/N]"` — default abort. Non-interactive (`! -t 0`) → abort with instructions. Probe failure of the other engine is non-fatal (warn + continue).

## Usage surface

`usage()` documents `MAYON_CONTAINER_ENGINE` under Environment alongside `MAYON_VERSION`/`MAYON_DIR`/`MAYON_PORT`.

## Invariants

- `docker-compose.yml` content is never modified by engine logic (FR-009).
- No reliance on shell aliases — all invocation via resolved `$ENGINE` binary (FR-012).
- `@MAYON_INSTALLER_VERSION@` marker untouched.
- Unchanged: password generation, `.env` permissions, version pinning, `save_self`.
