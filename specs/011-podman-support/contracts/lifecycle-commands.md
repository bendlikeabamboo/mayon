# Contract: Lifecycle Commands (`install.sh`)

**Feature**: `011-podman-support` | **Date**: 2026-08-23
**Module**: `install.sh` — `cmd_install`, `cmd_start`, `cmd_stop`, `cmd_restart`, `cmd_logs`, `cmd_status`, `cmd_upgrade`, `cmd_uninstall`, plus `compose_project_name()` / `pg_volume_exists()` / `guard_stale_volume()`.

All commands resolve `ENGINE` per **contracts/engine-selection.md** and route every engine interaction through `compose_cmd()` / `"$ENGINE" volume …`. No direct `docker …` strings remain.

## Command behavior matrix

| Command | Engine-aware behavior |
|---|---|
| `install` | Resolve + record engine; cross-engine hazard check; pull/up via `compose_cmd`. Output line names the engine: `Using engine: podman (source: detected)`. |
| `start` / `stop` / `restart` | `compose_cmd up -d` / `stop` / `restart`. Recorded engine required; missing binary → die naming engine. |
| `logs` | `compose_cmd logs -f --tail=200`. |
| `status` | `compose_cmd ps`. |
| `upgrade` | Downloads latest installer; the new installer's `install` re-reads the recorded engine from `.env` (preserved by `ensure_env`) — stack stays on the same engine across upgrades (FR-005, US2 scenario 2). |
| `uninstall` | `compose_cmd down`; volume guidance in success message becomes engine-qualified ("remain in Podman"), files removed incl. the engine key. |

## Helpers rewritten to `$ENGINE`

- `compose_project_name()` — `docker compose config` call becomes `"$ENGINE" compose config` (fallback heuristic unchanged).
- `pg_volume_exists()` — `"$ENGINE" volume inspect …`.
- `guard_stale_volume()` — `"$ENGINE" volume rm` + `compose_cmd down`; prompt copy unchanged (still engine-name-free), error hints may name `$ENGINE`.

## Success/failure output

- `cmd_install` prints one new line after preflight: `Using engine: <engine> (source: <override|recorded|detected|fallback>)`.
- All die-paths follow FR-004 engine-specific guidance; none mention installing Docker when running under Podman (US1 scenario 1).

## Invariants

- Behavior under Docker (recorded or detected) is byte-for-byte the existing flows (SC-002 "no Docker-path regressions") — the only new outputs are the engine line + docs.
- Interactive prompts keep `[y/N]` defaults; non-interactive pipes abort safely (existing pattern in `guard_stale_volume`).
- `uninstall` never removes volumes (FR-007).
