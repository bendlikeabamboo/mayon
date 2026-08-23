# Quickstart: Podman Compatibility for Installation

**Feature**: `011-podman-support` | **Date**: 2026-08-23

Runnable validation scenarios proving the feature end-to-end against spec Success Criteria. Shapes/semantics: [data-model.md](./data-model.md), [contracts/engine-selection.md](./contracts/engine-selection.md), [contracts/lifecycle-commands.md](./contracts/lifecycle-commands.md), [contracts/dev-engine-dispatch.md](./contracts/dev-engine-dispatch.md).

## Prerequisites

- A Linux test box (or VM/container) reachable for interactive use.
- Scenarios A: Podman ≥ 4 rootless + a compose provider (`podman compose version` works); **docker absent from PATH**.
- Scenarios B/C additionally: ability to install docker OR a second box for the both-engines/regression cases.
- Repo checkout; changed files: `install.sh`, `README.md`.

## Quality gates (constitution)

```bash
bash -n install.sh                      # syntax gate (must pass before any manual run)
node --check scripts/dev-compose.mjs    # dev dispatch script syntax gate
pnpm check && pnpm lint                 # trivially green; pnpm test unaffected
```

## Scenario A — Podman-only install + lifecycle (US1, US2; SC-001, SC-002, SC-003)

1. On the Podman-only box: `bash install.sh` (dev checkout — installs `latest`).
   Expect: `Using engine: podman (source: detected)`, compose pull/up finish, `Mayon is up → http://localhost:8080`, `~/.mayon/.env` contains `MAYON_CONTAINER_ENGINE=podman` (+ generated password, port).
2. Open http://localhost:8080 — app loads; create a chat or note current data.
3. `$HOME/.mayon/install.sh status` then `stop` then `start` → web UI reachable again; data from step 2 intact.
4. `restart` → healthy; `logs -f` output streams container logs (Ctrl-C to exit).
5. `upgrade` → new installer runs under Podman (same recorded engine); data intact after `up` (SC-003).
6. Re-install over the existing stack (`bash install.sh` again): reuses `.env` (recorded engine), no cross-engine prompt (same engine), stack recreated without data loss.
7. `uninstall` → confirm prompt; containers+files removed; `podman volume ls` still lists `<project>_pg-data` (kept).

## Scenario B — engine preference & hazards (edge cases; SC-005)

1. Both engines installed, no prior install: `bash install.sh` → `Using engine: docker (source: detected)` (SC-005 default). Abort before up (or uninstall after).
2. `MAYON_CONTAINER_ENGINE=podman bash install.sh` → override path; success line `source: override`; `.env` records `podman`.
3. Cross-engine hazard: with data existing under docker (from B1), run `MAYON_CONTAINER_ENGINE=podman bash install.sh` → warning that existing data is under docker; interactive `[y/N]` defaults to abort. Answer `N` → abort, nothing deployed. Re-run answering `y` → fresh empty DB under podman, explicitly confirmed.
4. Piped/non-interactive hazard: `curl … | MAYON_CONTAINER_ENGINE=podman bash` equivalent (or `bash install.sh </dev/null`) → aborts with instruction text (no fresh-DB surprise).
5. Recorded-engine-missing: after a podman-recorded install, `mv` podman off PATH → `~/.mayon/install.sh status` → clear die naming podman + the `.env` key (no silent docker failover).
6. Rootless port: `MAYON_PORT=80 ~/.mayon/install.sh restart` → clear failure explaining rootless privileged ports; guidance to use ≥1024. `MAYON_PORT=8080` again → healthy.
7. Legacy `.env` (no engine key, docker present): unset/`sed` the key out, run `status` → works via detection, no key written; then `upgrade` → key recorded during install.

## Scenario C — manual compose + docs (US3; SC-004)

1. On the Podman box, follow README's "Prefer no install script?" flow with podman: save release `docker-compose.yml`, create `.env` with `POSTGRES_PASSWORD`, `podman compose up -d` (or `podman-compose`) → stack healthy on :8080; `podman compose pull && up -d` after bumping `MAYON_VERSION` in `.env` → pinned version running, data kept.
2. Host-gateway docs: run an LLM gateway on the host (e.g. Ollama); in the app point the provider base URL at `http://host.containers.internal:<port>` per the README Podman note → requests succeed from containers. LAN-IP fallback documented and spot-checked.
3. README sweep: install, no-script, upgrade, and gateway sections each mention both engines; a `docker`→`podman` alias user can follow Docker instructions verbatim (alias note present, FR-012).

## Scenario D — Docker regression pass (SC-002)

On the docker-primary box (or restoring PATH in B): fresh `bash install.sh` → engine line `docker (detected)`, then full subcommand sweep (`status/start/stop/restart/logs/upgrade/uninstall`) behaves exactly as pre-feature (compare against `git stash` build if needed). No new prompts beyond the engine line.

## Scenario E — Dev-command engine dispatch (US4; SC-006)

Covers FR-010/FR-014 — the four `pnpm dev*` commands behind the single `scripts/dev-compose.mjs` mechanism.

1. **Podman-only workstation**: with docker absent from PATH, `pnpm dev:down` then `pnpm dev:build` then `pnpm dev:up` → each prints `Using engine: podman (source: detected)`; web HMR on http://localhost:5173, server + db healthy; `pnpm dev` (foreground) streams logs; teardown clean (`pnpm dev:down`) (US4 acceptance 1, 3).
2. **Both engines, override**: `MAYON_DEV_ENGINE=podman pnpm dev:up` → `Using engine: podman (source: override)`; repeat for `dev`, `dev:down`, `dev:build` — all four route through Podman for that invocation (acceptance 2).
3. **Docker-primary default regression**: with docker present, no override → all four commands print `Using engine: docker (source: detected)` and behave exactly as before this feature (acceptance 4; output diff is the engine line only).
4. **Invalid override**: `MAYON_DEV_ENGINE=containerd pnpm dev:up` → clear error listing valid values (`docker|podman`), non-zero exit, nothing spawned.
5. **Neither engine**: with both off PATH → clear error naming both options and where to get each; non-zero exit.
6. **Docs check**: CONTRIBUTING dev section documents `MAYON_DEV_ENGINE` + the switch caveat; AGENTS command-table rows for `dev/dev:up/dev:down/dev:build` mention the engine selector.

## Expected outcome

All scenarios pass ⇒ SC-001–SC-006 verified (A→SC-001/002/003, B→SC-005 + edge cases, C→SC-004, D→SC-002 regression, E→SC-006).
