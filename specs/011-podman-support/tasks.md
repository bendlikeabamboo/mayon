---
description: "Task list for feature 011-podman-support"
---

# Tasks: Podman Compatibility for Installation & Stack Lifecycle

**Input**: Design documents from `/specs/011-podman-support/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No automated test tasks — the spec does not request them, and the constitution routes script/docs-only changes to syntax gates + manual smoke validation (research.md R8). Each story instead ends with a **validation task** executed against [quickstart.md](./quickstart.md) scenarios.

**Organization**: Tasks grouped by user story (US1–US4 from spec.md, priority order). Changes are confined to: `install.sh`, `scripts/dev-compose.mjs` (new), `package.json`, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`. No app, server, CI, Dockerfile, or compose-file changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Repository root: `install.sh`, `scripts/`, `package.json`, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`
- Spec artifacts: `specs/011-podman-support/` (read-only for implementers)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the baseline that every later change is validated against.

- [x] T001 Verify clean baseline in `install.sh`: `bash -n install.sh` passes; capture current Docker-path install output (engine line absent) as the SC-002 regression reference, and confirm the four `pnpm dev` scripts in `package.json` still work with Docker present

---

## Phase 2: Foundational (Blocking Prerequisites for US1 & US2)

**Purpose**: The engine-resolution core in `install.sh` that both installer stories build on — per [contracts/engine-selection.md](./contracts/engine-selection.md).

**⚠️ CRITICAL**: US1 and US2 cannot begin until this phase is complete. (US4 is exempt — its mechanism is disjoint; see Dependencies.)

- [x] T002 Add engine globals and probe helpers to `install.sh`: `ENGINE` / `ENGINE_SOURCE` ("override"|"recorded"|"detected"|"fallback"), `engine_binary_ok()`, `compose_ok()` per contracts/engine-selection.md §Public interface
- [x] T003 Implement `resolve_engine()` in `install.sh` with the FR-002 order: `MAYON_CONTAINER_ENGINE` export (invalid value → die with usage) → key in `$ENV_FILE` (`ENGINE_SOURCE=recorded`) → auto-detect preferring Docker → compose-capability fallback to the other engine (warn + `ENGINE_SOURCE=fallback`); explicit override + missing engine = hard die, no fallback
- [x] T004 Rewrite `preflight()` in `install.sh` to probe the resolved engine with engine-specific remediation copy (FR-004): docker → compose plugin hint; podman → "install Podman ≥4 and a compose provider (`podman compose` — package `podman-compose` or the docker-compose plugin)"; neither engine → list both with links
- [x] T005 Route all engine interaction in `install.sh` through `$ENGINE`: rewrite `compose_cmd()` to `(cd "$INSTALL_DIR" && "$ENGINE" compose "$@")`, and replace the hard-coded `docker` calls in `compose_project_name()`, `pg_volume_exists()`, `guard_stale_volume()`; verify zero literal `docker compose` call sites remain (grep gate)
- [x] T006 Document the override in `usage()` in `install.sh`: add `MAYON_CONTAINER_ENGINE` under Environment alongside `MAYON_VERSION`/`MAYON_DIR`/`MAYON_PORT`
- [x] T007 Syntax gate on `install.sh`: `bash -n install.sh` passes; optional `shellcheck install.sh` review with findings addressed or triaged

**Checkpoint**: Engine core ready — installer user stories (US1, US2) can proceed; recorded-engine reads now have their resolution primitive.

---

## Phase 3: User Story 1 — Install with Podman, no Docker present (Priority: P1) 🎯 MVP

**Goal**: A Podman-only machine completes the one-line install to a reachable web UI with the engine selected, verified, recorded, and cross-engine data hazards gated (spec US1, FR-001/002/004/006/009/012).

**Independent Test**: quickstart.md Scenario A steps 1–2 + Scenario B steps 1–4 (Podman-only install, Docker-default preference, `MAYON_CONTAINER_ENGINE=podman` override, cross-engine hazard prompts).

### Implementation for User Story 1

- [x] T008 [US1] Implement `ensure_engine_recorded()` in `install.sh`: write `MAYON_CONTAINER_ENGINE=$ENGINE` into `$ENV_FILE` at install when absent, and rewrite it via `sed` (same pattern as `ensure_version_pin`) when installed under explicit override; garbage/missing values fall back to detection with a warning (data-model.md §Environment config)
- [x] T009 [US1] Implement the cross-engine hazard gate `guard_cross_engine_volume()` in `install.sh` (FR-006): when the resolved engine differs from an engine holding `<project>_pg-data`, warn that data will not be visible, prompt `[y/N]` interactively (default abort), abort with instructions when non-interactive; probe failure of the other engine is non-fatal; call it from `cmd_install` before `ensure_env` and before any `compose_cmd up`
- [x] T010 [US1] Update `cmd_install()` in `install.sh`: call `resolve_engine` before `preflight`, print `Using engine: <engine> (source: <override|recorded|detected|fallback>)` after preflight, call `ensure_engine_recorded` after `ensure_env`, and keep the existing pull/up/summary flow unchanged (contracts/lifecycle-commands.md §Command behavior matrix)
- [x] T011 [US1] Validate US1 per quickstart.md: run Scenario A steps 1–2 (Podman-only box: engine line `podman (detected)`, stack up on :8080, `MAYON_CONTAINER_ENGINE=podman` present in `~/.mayon/.env`) and Scenario B steps 1–4 (both-engines default = docker; override = podman; hazard prompt defaults abort; piped install aborts); record results in the PR description

**Checkpoint**: A Podman-only user can install and reach the web UI — MVP delivered (SC-001, SC-005).

---

## Phase 4: User Story 2 — Day-2 lifecycle & upgrades under Podman (Priority: P2)

**Goal**: Every saved-installer subcommand targets the recorded engine; upgrades stay on-engine with data intact; uninstall qualifies its guidance (spec US2, FR-003/005/007).

**Independent Test**: quickstart.md Scenario A steps 3–5 & 7 + B5/B7 (full subcommand sweep, upgrade data retention, uninstall volume preservation, recorded-engine-missing hard error, legacy `.env` migration).

### Implementation for User Story 2

- [x] T012 [US2] Bind lifecycle subcommands to the recorded engine in `install.sh` — `cmd_start`, `cmd_stop`, `cmd_restart`, `cmd_logs`, `cmd_status`: resolve `ENGINE` per contracts/engine-selection.md §Recording & reads (recorded value wins over ambient export on non-install commands); if the recorded engine's binary is missing, die naming the engine + the `$ENV_FILE` key — never fail over (FR-003); legacy `.env` without the key falls back to detection without writing the key
- [x] T013 [US2] Verify engine continuity through `cmd_upgrade()` in `install.sh`: the downloaded installer's `install` path re-reads and preserves the recorded engine via `ensure_env`/`ensure_engine_recorded`; add a comment pinning this invariant so future edits keep upgrades on-engine (FR-005)
- [x] T014 [US2] Engine-qualify `cmd_uninstall()` messaging in `install.sh`: volume guidance reads "remain in Podman"/"remain in Docker" from `$ENGINE` (FR-007); confirm uninstall still removes `MAYON_CONTAINER_ENGINE` with the file and never touches volumes
- [x] T015 [US2] Validate US2 per quickstart.md: Scenario A steps 3–5 & 7 (status/stop/start/restart/logs, upgrade with data intact per SC-003, uninstall keeps `<project>_pg-data` under `podman volume ls`) and B5/B7 (recorded-engine-missing dies naming podman + key; legacy no-key `.env` works via detection, key recorded only on next install/upgrade); record results in the PR description

**Checkpoint**: Install + full lifecycle work identically under Podman; Docker path byte-for-byte unchanged except the engine line (SC-002).

---

## Phase 5: User Story 3 — Manual/self-managed compose documented for Podman (Priority: P3)

**Goal**: README paths to running Mayon (one-line install, no-script compose run, upgrade, host gateway, troubleshooting) cover both engines and the Podman-specific notes (spec US3, FR-008/011/012).

**Independent Test**: quickstart.md Scenario C (manual `podman compose up -d`, `host.containers.internal` gateway, README sweep, alias note).

### Implementation for User Story 3

- [x] T016 [US3] Update the "Docker (self-host)" install section of `README.md`: retitle to cover both engines (e.g. "Docker / Podman (self-host)"), state both are supported with Docker the default, note the `MAYON_CONTAINER_ENGINE=podman` installer override, and make the "Prefer no install script?" flow engine-neutral (works verbatim with `podman compose` and for users whose `docker` aliases to `podman`) per FR-008/FR-011
- [x] T017 [US3] Add the Podman notes block to `README.md` (FR-008, research.md R6): default port 8080 is unprivileged (rootless works; ports <1024 need rootful Podman or `net.ipv4.ip_unprivileged_port_start`), host gateway from containers is `host.containers.internal` (LAN-IP fallback unchanged), and the shell-alias caveat from FR-012 (manual typing only — the installer/scripts probe real binaries)
- [x] T018 [US3] Make the "Upgrading" and "Build from source prerequisites" sections of `README.md` engine-neutral: keep Docker examples canonical, add the podman equivalents (`~/.mayon/install.sh upgrade` works as-is; manual `podman compose pull && podman compose up -d` pin/pull flow), referencing the Podman notes block instead of duplicating it
- [x] T019 [US3] Validate US3 per quickstart.md Scenario C: follow the README no-script flow with `podman compose` end-to-end on the Podman box, verify `host.containers.internal` reaches a host gateway, confirm every README run-path mentions both engines, and that a `docker`→`podman` alias user can follow Docker instructions verbatim; record results in the PR description

**Checkpoint**: All user-facing run/upgrade docs cover both engines; the manual Podman path is followable without external Mayon-specific resources (SC-004).

---

## Phase 6: User Story 4 — Developer workflow on a Podman-only workstation (Priority: P4)

**Goal**: The four documented dev commands run under Podman via one shared dispatch mechanism — `MAYON_DEV_ENGINE` override or Docker-preferring auto-detect (spec US4, FR-010/013/014).

**Independent Test**: quickstart.md Scenario E (Podman-only dev cycle, override across all four commands, Docker-default regression, invalid-override and no-engine errors, docs check).

**Note**: This phase has **no dependency on Phase 2** (disjoint files/mechanism) — it may start immediately after Phase 1 in parallel with US1–US3.

### Implementation for User Story 4

- [x] T020 [US4] Create `scripts/dev-compose.mjs` (new file, zero npm dependencies, `node:child_process` builtins only) per [contracts/dev-engine-dispatch.md](./contracts/dev-engine-dispatch.md): resolve engine (`MAYON_DEV_ENGINE` override with `docker|podman` validation → auto-detect preferring Docker → clear error naming both options), print `Using engine: <name> (source: override|detected)`, spawn `$ENGINE compose -p mayon-dev -f docker-compose.dev.yml <forwarded args>` with inherited stdio, forward the child's exit code, persist nothing
- [x] T021 [US4] Rewire the four dev scripts in `package.json` to dispatch through the shared mechanism (FR-014): `dev` → `node scripts/dev-compose.mjs up`, `dev:up` → `… up -d`, `dev:down` → `… down`, `dev:build` → `… build`; verify `node --check scripts/dev-compose.mjs` passes and `scripts/` is covered by the existing ESLint/Prettier config
- [x] T022 [P] [US4] Document the dev-engine selector in `CONTRIBUTING.md` (dev prerequisites section: `MAYON_DEV_ENGINE`, Docker-preferred detection default, and the switch caveat — dev volumes/image caches are engine-scoped, so switching engines resets the dev database and requires `dev:build`) and update the `pnpm dev`/`dev:up`/`dev:down`/`dev:build` rows of the command table in `AGENTS.md` to mention "(Docker or Podman via `MAYON_DEV_ENGINE`)"
- [x] T023 [US4] Validate US4 per quickstart.md Scenario E: Podman-only full cycle (down → build → up with HMR on :5173, foreground `pnpm dev` streams, clean teardown), all four commands under `MAYON_DEV_ENGINE=podman`, Docker-default output diff = engine line only, `MAYON_DEV_ENGINE=containerd` errors cleanly, no-engine error names both options; record results in the PR description

**Checkpoint**: Podman-only contributors can run the documented dev workflow; Docker-primary contributors see zero behavior change (SC-006).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide consistency, regression pass, release bookkeeping.

- [x] T024 Audit user-facing docs for leftover Docker-only phrasing where steps apply to both engines (FR-011): sweep `README.md` intro/troubleshooting ("`docker compose down -v`" fix snippet gains podman equivalence) and verify no forked/engine-specific compose variants exist (FR-009)
- [x] T025 Run the Docker regression pass per quickstart.md Scenario D (SC-002): fresh `bash install.sh` on a Docker-primary box prints `docker (detected)` and the full subcommand sweep matches the T001 baseline (only the engine line differs); `pnpm dev` family unchanged per T023
- [x] T026 Run all quality gates: `bash -n install.sh`, `node --check scripts/dev-compose.mjs`, `pnpm check`, `pnpm lint`, `pnpm test` (expected green — no app/server source changed)
- [x] T027 Add the feature to the `## [Unreleased]` section of `CHANGELOG.md` (Podman secondary engine support for install/lifecycle/dev; single engine-neutral artifact set; docs) per the repo's release conventions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. Baseline capture is cheap but makes SC-002 verification meaningful.
- **Foundational (Phase 2)**: Depends on Phase 1. **Blocks US1 and US2** (both build on `resolve_engine`/engine-routed helpers).
- **US1 (Phase 3)**: Depends on Phase 2.
- **US2 (Phase 4)**: Depends on Phase 2 + US1's recording (`ensure_engine_recorded`, T008) since lifecycle reads what install writes.
- **US3 (Phase 5)**: No code dependency — documents behavior fixed by [contracts/](./contracts/); can proceed in parallel with US1/US2 using the contracts as source of truth, but final validation (T019) should run after US1 lands so documented flows are real.
- **US4 (Phase 6)**: Depends only on Phase 1 — disjoint files (`scripts/dev-compose.mjs`, `package.json`, `CONTRIBUTING.md`, `AGENTS.md`); can run in parallel with Phases 2–5.
- **Polish (Phase 7)**: Depends on all user stories being complete (T025/T026 validate the whole feature).

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no other-story dependencies. MVP.
- **US2 (P2)**: After Phase 2 + US1's recording mechanism (T008). Independently testable once an install exists.
- **US3 (P3)**: Docs-only; source of truth is the contracts. No blocking code dependency.
- **US4 (P4)**: Fully independent of US1–US3 (different files, different mechanism).

### Within Each User Story

- Helpers/mechanisms before command wiring (T002–T005 → T008–T010; T020 → T021).
- Validation task (T011/T015/T019/T023) always last in its story; do not start the next story with a failing validation.
- Within `install.sh` tasks are sequential (same file, ordered edits) — no intra-phase `[P]` there.

### Parallel Opportunities

- **Phase 2 ⫽ Phase 6**: `install.sh` engine work and `scripts/dev-compose.mjs` touch disjoint files — run concurrently.
- **T022 ⫽ T020**: docs for the dev selector can be written from the contract while the script is implemented.
- **US3 (T016–T018)** can proceed alongside US1/US2 implementation (docs vs. code), gated only on T019 landing after US1.
- For a solo implementer, strict priority order P1 → P2 → P3 → P4 with US4 slotted whenever `install.sh` work pauses.

---

## Parallel Example: User Story 4

```bash
# These three touch disjoint files and can run together:
Task: "Create scripts/dev-compose.mjs"            (T020)
Task: "Document MAYON_DEV_ENGINE in CONTRIBUTING.md + AGENTS.md" (T022)

# Then, once T020 exists:
Task: "Rewire package.json dev scripts"           (T021)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline capture)
2. Complete Phase 2: Foundational engine core (CRITICAL — blocks US1/US2)
3. Complete Phase 3: US1 — Podman-only install works end-to-end
4. **STOP and VALIDATE**: quickstart Scenario A1–2 + B1–4
5. Ship-able increment: the core of the original request (US1 is the spec's stated core)

### Incremental Delivery

1. Setup + Foundational → engine core ready
2. + US1 → Podman install works (MVP)
3. + US2 → full lifecycle + upgrades on-engine; Docker path proven unregressed (SC-002)
4. + US3 → docs complete (SC-004); users on manual compose covered
5. + US4 → contributor workflow covered (SC-006)
6. Polish phase → repo-wide sweep, gates, CHANGELOG

### Parallel Team Strategy

With two streams: Stream A takes Phases 2→3→4→5 (`install.sh` + README); Stream B takes Phase 6 (dev dispatch, disjoint files), merging before Phase 7.

---

## Notes

- [P] tasks = different files, no dependencies; within `install.sh` tasks are deliberately unmarked (same file, ordered edits).
- [Story] labels map tasks to spec.md user stories for traceability; FR/SC references cite spec.md requirements.
- Validation tasks are manual scenario runs from quickstart.md — record outcomes in the PR description (research.md R8 rationale).
- Unchanged by design: `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.build.yml`, Dockerfiles, `.github/workflows/`, `@MAYON_INSTALLER_VERSION@` marker in `install.sh` (FR-009/FR-010; verify with a final grep before merge).
- Commit after each task or logical group; stop at any story checkpoint to validate independently.
