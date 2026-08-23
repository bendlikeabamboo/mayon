# Feature Specification: Podman Compatibility for Installation & Stack Lifecycle

**Feature Branch**: `011-podman-support`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "I want to make this repository also compatible with podman. We started with docker already but I know they are highly compatible. I've already did alias docker with podman in my local machine so maybe let's just make the installation a lot more friendlier towards podman while maintaining compatibility with docker"

## Clarifications

### Session 2026-08-23

- Q: Which scope tiers does Podman support cover — install-only, install+dev, or install+dev+CI? → A: Installation-focused secondary support: CI, dev, and release packaging all stay Docker-based; Podman gets a friendly install experience. (Dev-workflow portion superseded later this session — dev is now secondary-supported; CI/release remain Docker-only.)
- Q: When both Docker and Podman are installed on a user's system, which engine should be preferred? → A: Docker remains primary; Podman is selected when Docker is absent or the user explicitly overrides.
- Q: Should the release pipeline itself run on Podman? → A: No — CI, dev workflow, and release packaging remain Docker-based; Podman compatibility matters only at end-user install time. (Dev-workflow portion superseded later this session.)
- Q: How should the dev commands (`pnpm dev`, `dev:up`, `dev:down`, `dev:build`) pick the container engine? → A: Hybrid — `MAYON_DEV_ENGINE` env override, else auto-detect preferring Docker (same policy as the installer).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install Mayon with Podman only, no Docker present (Priority: P1)

A self-hoster on a Linux machine that has Podman (rootless or rootful) but no Docker runs the one-line installer. The installer detects that Docker is absent and Podman is available, verifies Podman's compose capability, generates the secure Postgres password, writes the config, pulls the images, and brings the stack up. The user opens the web UI and starts using Mayon — with no Docker installed and no manual file edits.

**Why this priority**: This is the core of the request. Today the installer hard-fails with "Docker is not installed" on any Podman-only machine, blocking this entire class of users. Everything else builds on this slice.

**Independent Test**: On a clean environment with only Podman + a compose provider, run the one-line install; verify the stack comes up healthy and the web UI is reachable. Delivers the full end-user value of self-hosting Mayon without Docker.

**Acceptance Scenarios**:

1. **Given** a machine with Podman and a working compose provider but no Docker, **When** the user runs the one-line installer, **Then** the installer selects Podman, completes all steps, and reports the app URL — without instructing the user to install Docker.
2. **Given** a machine with neither Docker nor Podman, **When** the user runs the installer, **Then** it fails with a clear message explaining both options and where to get each.
3. **Given** a machine with Podman but no compose provider, **When** the user runs the installer, **Then** it fails early with engine-specific guidance on installing compose support for Podman.
4. **Given** the install completed under Podman, **When** the database container starts for the first time, **Then** it initializes with the generated password and the app connects to it (no authentication failures).
5. **Given** the stack starts under Podman, **When** the app waits for the database, **Then** startup ordering/health gating still delays the app until the database is ready.

---

### User Story 2 - Day-2 lifecycle management and upgrades under Podman (Priority: P2)

A user who installed with Podman manages the stack afterwards using the installer's saved copy and its subcommands: `start`, `stop`, `restart`, `logs`, `status`, `upgrade`, `uninstall`. Every command targets the same engine that performed the install (no re-detection that could silently switch engines), upgrades pin versions the same way, and uninstall preserves data volumes while removing the rest.

**Why this priority**: Installation is a one-time event; lifecycle use is recurring. If subcommands broke or silently targeted a different engine, the Podman install would be unusable in practice — and engine mismatch could strand data.

**Independent Test**: Install under Podman, then run every documented subcommand and an upgrade; verify each behaves as the Docker path does and that data survives an upgrade.

**Acceptance Scenarios**:

1. **Given** an install performed under Podman on a machine that later also has Docker installed, **When** the user runs any saved-installer subcommand, **Then** it operates on the Podman-managed stack (the engine recorded at install time), not on Docker.
2. **Given** a Podman install on an older release, **When** the user runs `upgrade`, **Then** the new release is pulled and deployed under Podman with the database and server data intact.
3. **Given** a running Podman install, **When** the user runs `stop` then `start`, **Then** the stack returns to a healthy state with all data preserved.
4. **Given** a Podman install, **When** the user runs `uninstall`, **Then** containers and files are removed while data volumes are kept, and the removal targets the correct engine's volumes.

---

### User Story 3 - Manual/self-managed compose deployment documented for Podman (Priority: P3)

A self-hoster who manages `docker-compose.yml` directly (the documented alternative to the installer) wants to run and upgrade the stack with Podman by hand. The repository's compose file and upgrade documentation work unchanged under Podman's compose tooling, and docs explain Podman-specific notes: reaching host services from containers, and rootless port constraints. A user whose shell aliases `docker` to `podman` can follow the existing Docker instructions verbatim.

**Why this priority**: The manual path already mostly works thanks to OCI compatibility, but undocumented Podman quirks (host gateway name, rootless ports) cause real failures. Documenting them is-cheap, high-clarity value after the installer work.

**Independent Test**: Follow the README's manual-run and upgrade instructions on a Podman-only machine (and with `docker` aliased to `podman`); verify bring-up, config handling, and version pinning behave as documented.

**Acceptance Scenarios**:

1. **Given** a copy of the release compose file, **When** the user brings the stack up with Podman's compose tooling and a local `.env`, **Then** it starts healthy, matching the documented Docker behavior.
2. **Given** Mayon running under Podman and an LLM gateway on the host, **When** the user follows the docs for host-reachable gateways, **Then** the documented hostname works under Podman (or the docs state the Podman-equivalent).
3. **Given** a rootless Podman setup, **When** the user chooses the default web port, **Then** the stack binds it successfully without root, and the docs state any low-port constraints.
4. **Given** a manually deployed Podman stack, **When** the user follows the documented pin-and-upgrade steps, **Then** the stack moves to the pinned release without data loss.

---

### User Story 4 - Developer workflow on a Podman-only workstation (Priority: P4)

A contributor whose machine only has Podman wants to run the documented developer commands — bring up the dev stack, rebuild images, and tear it down — without keeping Docker installed. The commands pick Podman automatically when Docker is absent, or via a one-time engine override when both are installed. Contributing/docs note this secondary support and its limits.

**Why this priority**: Directly serves the owner's own Linux Mint (Podman-only) workstation and any contributor in the same position; mechanics ride on the same engine-resolution pattern as the installer, so it's cheap relative to the install path while being a hard blocker for affected contributors.

**Independent Test**: On a Podman-only machine, run the full dev cycle (teardown → image build → bring-up) using the documented commands; verify web + server come up healthy with hot reload, then tear down cleanly.

**Acceptance Scenarios**:

1. **Given** a source checkout on a machine with only Podman (no Docker), **When** the contributor runs the documented dev bring-up command, **Then** it resolves Podman and starts the dev stack (web HMR, server, database) without a Docker-not-found error.
2. **Given** a machine with both engines, **When** the contributor sets the documented engine override to Podman, **Then** all four documented dev commands use Podman for that invocation.
3. **Given** the dev images need rebuilding (dependency/config/shared-package changes), **When** the contributor runs the documented build command under Podman, **Then** images build and the subsequent bring-up uses them.
4. **Given** a Docker-primary machine, **When** the contributor runs any dev command with no override set, **Then** behavior is identical to before this feature (Docker, no new prompts or output changes beyond engine identification).

---

---

### Edge Cases

- What happens when both Docker and Podman are installed? Detection prefers Docker (primary engine); an explicit override lets the user force Podman; the choice is recorded so later subcommands never silently switch engines.
- What happens when a stack was previously installed and managed with Docker, and the user re-runs the installer where Podman is now selected/forced? The installer must not deploy a second, empty database under the other engine and present it as the user's data: existing data from the other engine must be detected (or clearly reported as out of scope) with an explicit warning, since volumes are engine-scoped and do not transfer automatically.
- What happens when the saved installer runs on a machine where the recorded engine (e.g. Podman) is no longer available? A clear error names the missing engine and the config that records it — never an attempt to auto-failover to the other engine.
- What happens under rootless Podman if the user sets a web port below 1024? The failure is explained (rootless cannot bind privileged ports) with guidance to use a port ≥1024 or rootful mode.
- What happens when the Podman machine/socket isn't running (rootless session or VM-based Podman not started)? The installer detects the unavailable backend and says how to start it, rather than emitting a raw engine error.
- What happens when image pulls from the container registry fail due to a registry policy configuration? The error surfaces the underlying cause enough for the user to adjust their registry trust settings.
- What happens when the compose provider translates health-gated startup differently? Startup ordering must still hold: the app never starts serving before the database accepts connections.
- What happens when a Linux distribution with SELinux enforcing runs rootless Podman? Data persists correctly (named volumes, not host bind-mounts, carry the data).
- What happens when a contributor flips the dev-command engine between Docker and Podman on the same checkout? The dev volumes are engine-scoped, so image layer caches and the dev database volume do not carry over; docs must state that switching engines mid-stream resets the dev database and requires a rebuild.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The installer MUST support Podman as a secondary container engine alongside Docker (which remains primary), with a single set of release artifacts (one installer, one compose file) serving both.
- **FR-002**: The installer MUST select the engine in this order: an explicit user override, then the previously recorded engine for the install directory, then auto-detection that prefers Docker when both are present (Docker remains primary; Podman is secondary support); when the preferred engine is installed but its compose capability is missing, the installer MUST fall back to the other engine rather than fail, preserving a working install.
- **FR-003**: The installer MUST record the engine it used alongside the install configuration, and every subsequent subcommand (`start`, `stop`, `restart`, `logs`, `status`, `upgrade`, `uninstall`) MUST use that recorded engine.
- **FR-004**: Pre-flight checks MUST verify the selected engine is installed and its compose capability is functional, and on failure MUST print engine-specific remediation guidance (including how to add compose support for Podman).
- **FR-005**: The full lifecycle — install, generate and persist the database credentials, pull images, deploy, and later upgrade — MUST behave functionally identically under Docker and Podman, including version pinning and post-upgrade data retention.
- **FR-006**: The installer MUST detect the "existing data under the other engine" hazard before deploying: when data volumes belonging to a different engine are found for this install directory, it MUST warn and require explicit confirmation; it MUST NOT present a freshly initialized empty database as the user's existing data.
- **FR-007**: Uninstall under Podman MUST match the Docker behavior: remove containers and files, keep data volumes, and clean up the correct engine's resources.
- **FR-008**: All user-facing documentation paths to running Mayon (quickstart, one-line install, manual compose run, upgrade, troubleshooting) MUST state that both Docker and Podman are supported and MUST cover Podman-specific notes: reaching host services from containers under Podman, and rootless port constraints.
- **FR-009**: The stack definition MUST remain engine-neutral — no forked or engine-specific compose file variants — and MUST preserve database-readiness gating (startup ordering) under both engines.
- **FR-010**: The developer workflow MUST support Podman as a secondary engine for the documented dev commands: a `MAYON_DEV_ENGINE` override selects the engine explicitly, and when no override is set the commands auto-detect (Docker preferred when present, else Podman). Docker remains the primary/default engine and the documented default path; the release pipeline (CI) remains Docker-based and untouched, and no Podman-based CI work is in scope.
- **FR-011**: Engine-neutral phrasing MUST replace Docker-only phrasing in user-facing docs where the step applies to both engines, without removing Docker-specific instructions where they are genuinely Docker-specific.
- **FR-012**: The installer and dev commands MUST NOT rely on shell aliases (e.g. a user-level `docker`→`podman` alias) for engine selection, since non-interactive invocations (npm scripts, `curl | bash`) do not load them; where docs suggest aliasing, they MUST note this limitation.
- **FR-013**: Podman support MUST span two tiers: (a) end-user installation and stack lifecycle — the one-line installer, saved-installer lifecycle commands, and user-facing run/upgrade documentation; and (b) the developer workflow — the documented dev commands must run under Podman via override or detection. CI and release packaging remain Docker-based; no Podman-specific pipeline work is in scope.
- **FR-014**: The dev-command engine resolution MUST be a single shared mechanism used by all four documented dev commands (bring-up, build, teardown, and the foreground variant), not per-command ad-hoc logic.

### Key Entities *(include if feature involves data)*

- **Install directory** (default `~/.mayon`): holds the compose file, environment config, and the saved installer copy; created by the installer, preserved across upgrades.
- **Environment config** (`.env`): database credentials, web port, optional release pin; gains a recorded engine selection so lifecycle commands target the right engine; secrets handling (permissions, generation) unchanged.
- **Data volumes** (database data, server data): named volumes scoped to the engine that created them; not automatically visible to the other engine — the entity behind the cross-engine data hazard.
- **Container engine selection**: the resolved runtime (Docker or Podman) plus how it was determined (override, recorded, auto-detected); consulted by every lifecycle command.
- **Release assets** (installer + compose file attached to releases): must remain engine-neutral so a single asset set serves both engines.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean Linux machine with only Podman (and compose support) installed, a user completes the one-line install to a reachable web UI in under 10 minutes with zero manual file edits and zero engine-related errors.
- **SC-002**: 100% of the documented installer subcommands complete successfully under a Podman install, and under a Docker install behave exactly as before this feature (no Docker-path regressions).
- **SC-003**: An upgrade performed under Podman brings the stack to the new release with 100% of pre-upgrade data (chats, settings) intact.
- **SC-004**: Every user-facing documentation path to running Mayon mentions both engines, and the Podman path can be followed end-to-end without consulting external resources for Mayon-specific steps.
- **SC-005**: A fresh install on a machine with both engines present defaults to Docker, while a one-setting change completes the same install under Podman.
- **SC-006**: On a Podman-only contributor machine, the documented dev cycle (teardown → build → bring-up, plus the foreground variant) completes successfully with zero Docker-dependent failures, and on Docker-primary machines the same commands behave exactly as before this feature.

## Assumptions

- Docker remains the primary engine everywhere (install detection, dev-workflow default, CI, release packaging); Podman is secondary support covering end-user installation and, per the later same-session clarification, the developer workflow via override/auto-detect. CI and release packaging stay Docker-only.
- The dev workflow's Podman support is contributor-facing only: the dev compose definitions stay engine-neutral and unchanged in substance; only command dispatch gains engine resolution. `docker`→`podman` shell aliases are documented as a non-mechanism (FR-012).
- The release pipeline (CI) stays Docker-based, unchanged by this feature; released images and installer are merely verified to work for Podman end users, not built with Podman.
- Target environment for Podman support is Linux rootless Podman, version 4.x or newer, with the stock compose integration (either provider); macOS/Windows Podman machines are not blocked but are not specifically tested or documented in this feature.
- The existing compose files are already substantially OCI-compatible; the work is detection, lifecycle plumbing, docs, and verification — not authoring engine-specific variants.
- Aliasing `docker` to `podman` in the user's interactive shell is a convenience for manually-typed commands only; the installer's engine selection works on real binaries and does not depend on aliases.
- Cross-engine migration of existing data (moving a Docker install's volumes into Podman) is out of scope for this feature; the installer's obligation is detecting and warning about the hazard, not migrating data.
- Existing Docker installs see no behavioral change: same recorded-engine lifecycle, same files, same command output, unless they explicitly opt into Podman.
