# Data Model: Podman Compatibility for Installation

**Feature**: `011-podman-support` | **Date**: 2026-08-23

This feature has **no database schema impact** — no tables, columns, or migrations. The "data" it manages is the installer's on-disk configuration state and engine-scoped volumes. This file documents those entities so `/speckit-tasks` can generate verifiable tasks against them.

## Entities

### Install directory (`~/.mayon`, override via `MAYON_DIR`)

Filesystem directory owned by the installer.

| Field | Type | Notes |
|---|---|---|
| `docker-compose.yml` | file | Downloaded per release; engine-neutral; **unchanged by this feature** (FR-009). |
| `.env` | file | `chmod 600`; key-value config. **Gains one key** (below). |
| `install.sh` | file | Saved copy of the release installer; subcommands run through it. |

Lifecycle: created at install; `.env`/`install.sh` preserved across `upgrade`; all three removed by `uninstall` (volumes kept).

### Environment config (`.env`)

| Key | Existing/New | Type | Validation |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `MAYON_PORT`, `MAYON_VERSION` | Existing | string/int | Unchanged semantics. |
| `MAYON_CONTAINER_ENGINE` | **New** | `docker` \| `podman` | Written at install when absent (or rewritten on explicit override install); read by every lifecycle subcommand; only those two values; garbage/missing ⇒ fall back to detection (legacy installs) with a warning. |

Invariants: engine is recorded **once** at install; subcommands never rewrite it; uninstall removes it with the file.

### Container engine selection (runtime resolution)

Resolved per invocation, in order (FR-002):

1. `MAYON_CONTAINER_ENGINE` env var (export) — explicit override
2. `MAYON_CONTAINER_ENGINE` in `.env` — recorded engine
3. Auto-detect: Docker present ⇒ docker; else Podman present ⇒ podman
4. Preferred engine lacks compose ⇒ fall back to the other (warn); both lack it ⇒ die with engine-specific guidance (FR-004)

Explicit-override installs rewrite the recorded value; detected installs record what was used. Missing binary for a **recorded** engine = hard error naming engine + `.env` key (no failover).

### Data volumes (engine-scoped)

| Volume | Contents | Owner engine |
|---|---|---|
| `<project>_pg-data` | Postgres data dir | whichever engine created it |
| `<project>_server-data` | Mayon server data | same |

Invariants: never auto-migrated across engines (FR-006 + assumption); cross-engine presence is probed pre-install (other engine's `volume inspect`); SELinux rootless stores named volumes under the user's storage root — no bind-mount relabeling needed since the stack uses named volumes only.

### Release assets (unchanged shape)

`install.sh` + `docker-compose.yml` attached to GitHub Releases; `@MAYON_INSTALLER_VERSION@` sed-replaced by CI; single engine-neutral set serves both engines (FR-001).

### Dev-command engine dispatch (stateless, per-invocation)

Not an on-disk entity — the dev path persists **nothing** (deliberate contrast with the installer): `scripts/dev-compose.mjs` resolves `MAYON_DEV_ENGINE` env override → auto-detect (docker preferred) on every invocation and spawns `$ENGINE compose -p mayon-dev -f docker-compose.dev.yml <args>`. Engine-scoped dev resources (`mayon-dev_pg-data-dev`, `mayon-dev_server-data-dev`, image caches) belong to whichever engine created them; switching engines starts fresh — documented caveat, not gated (see [contracts/dev-engine-dispatch.md](./contracts/dev-engine-dispatch.md)).

## State transitions (engine selection)

```text
[fresh machine] --install--> detect(docker|podman) --record--> .env MAYON_CONTAINER_ENGINE
[recorded]     --subcommand--> read .env --> engine binary exists? --yes--> run
                                                   |no--> die (name engine + .env key)
[override]     --install MAYON_CONTAINER_ENGINE=X--> verify X(+compose) --> rewrite .env --> run
```
