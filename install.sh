#!/usr/bin/env bash
#
# install.sh — one-line installer & lifecycle helper for Mayon.
#
#   curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/latest/download/install.sh | bash
#
# It resolves the container engine (Docker or Podman), generates a secure
# Postgres password, writes docker-compose.yml + .env into ~/.mayon, and
# starts the stack. Run ~/.mayon/install.sh <command> to manage it afterwards:
#   install | start | stop | restart | logs | status | upgrade | uninstall
#
# The version is baked in at release time (CI replaces the placeholder below).
set -euo pipefail

# --- Release version (CI sed-replaces the placeholder when attaching to a release) ---
MAYON_INSTALLER_VERSION="@MAYON_INSTALLER_VERSION@"
if [[ "$MAYON_INSTALLER_VERSION" == @* ]]; then
	MAYON_INSTALLER_VERSION="latest" # unbaked / dev checkout → track latest
fi

REPO="bendlikeabamboo/mayon"
INSTALL_DIR="${MAYON_DIR:-$HOME/.mayon}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"
INSTALLER_FILE="$INSTALL_DIR/install.sh"

if [ -t 1 ]; then
	C_BOLD=$'\033[1m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'
	C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
	C_BOLD=""; C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

log() { printf '%s==>%s %s\n' "$C_BOLD$C_CYAN" "$C_RESET" "$*"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# Container engine used for every invocation (docker | podman), resolved by
# resolve_engine() per docs/history/appendices/011-engine-selection.md (preserved decision-history appendix)
# before any compose call.
ENGINE=""
ENGINE_SOURCE="" # "override" | "recorded" | "detected" | "fallback"

# True when the named engine binary exists. Shell aliases are invisible to
# scripts (FR-012), so this probes real binaries only.
engine_binary_ok() { command -v "$1" >/dev/null 2>&1; }

# True when the named engine has working compose support (plugin/provider).
compose_ok() { "$1" compose version >/dev/null 2>&1; }

# Resolve the version to install: explicit override wins, else the baked one.
resolve_version() {
	echo "${MAYON_VERSION:-$MAYON_INSTALLER_VERSION}"
}

is_semver() {
	[[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc[0-9]+)?$ ]]
}

# URL of docker-compose.yml for a given version (tagged source on raw; main for latest).
compose_url_for() {
	local v="$1"
	if is_semver "$v"; then
		echo "https://raw.githubusercontent.com/${REPO}/v${v}/docker-compose.yml"
	else
		echo "https://raw.githubusercontent.com/${REPO}/main/docker-compose.yml"
	fi
}

# URL of this installer for a given version (release asset; /latest/ otherwise).
installer_url_for() {
	local v="$1"
	if is_semver "$v"; then
		echo "https://github.com/${REPO}/releases/download/v${v}/install.sh"
	else
		echo "https://github.com/${REPO}/releases/latest/download/install.sh"
	fi
}

download() { # download <url> <dest>
	local url="$1" dest="$2"
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$url" -o "$dest"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$dest" "$url"
	else
		die "Neither curl nor wget is installed. Install one and retry."
	fi
}

# Engine-specific remediation copy (FR-004), shared by resolve_engine/preflight.
die_engine_missing() { # die_engine_missing <engine>
	case "$1" in
		docker) die "Docker is not installed. See https://docs.docker.com/get-docker/ (or use Podman: https://podman.io)" ;;
		podman) die "Podman is not installed. See https://podman.io (or use Docker: https://docs.docker.com/get-docker/)" ;;
	esac
}

die_compose_missing() { # die_compose_missing <engine>
	case "$1" in
		docker) die "The 'docker compose' plugin is missing. Update Docker Desktop / install the compose plugin." ;;
		podman) die "Podman compose support is missing. Install a compose provider: package 'podman-compose' or the docker-compose plugin, so 'podman compose' works. See https://github.com/containers/podman-compose" ;;
	esac
}

# A recorded engine whose binary is missing is a hard error (FR-003): volumes
# are engine-scoped, so never fail over to the other engine.
die_recorded_engine_missing() { # die_recorded_engine_missing <engine>
	die "This Mayon install was set up with '$1', but the '$1' binary is not available. Install $1, or edit MAYON_CONTAINER_ENGINE in $ENV_FILE to switch engines (your data stays in $1 volumes)."
}

# Resolve the container engine per FR-002: explicit MAYON_CONTAINER_ENGINE
# override → value recorded in $ENV_FILE → auto-detect preferring Docker →
# compose-capability fallback to the other engine. Sets ENGINE/ENGINE_SOURCE.
# An explicit override with a missing/broken engine dies (never falls back).
resolve_engine() {
	ENGINE=""
	ENGINE_SOURCE=""
	local requested="${MAYON_CONTAINER_ENGINE:-}"
	if [ -n "$requested" ]; then
		case "$requested" in
			docker | podman) ;;
			*) die "Invalid MAYON_CONTAINER_ENGINE='${requested}'. Valid values: docker | podman." ;;
		esac
		engine_binary_ok "$requested" || die_engine_missing "$requested"
		compose_ok "$requested" || die_compose_missing "$requested"
		ENGINE="$requested"
		ENGINE_SOURCE="override"
		return
	fi
	if [ -f "$ENV_FILE" ] && grep -q '^MAYON_CONTAINER_ENGINE=' "$ENV_FILE"; then
		# Garbage/empty recorded values fall back to detection with a warning
		# (legacy .env files predate the key — data-model.md §Environment config).
		requested="$(sed -nE 's|^MAYON_CONTAINER_ENGINE=([^[:space:]]*).*|\1|p' "$ENV_FILE" | tail -n1)"
		case "$requested" in
			docker | podman)
				ENGINE="$requested"
				ENGINE_SOURCE="recorded"
				# A recorded engine that is no longer installed is a hard error:
				# volumes are engine-scoped, so never fail over to the other
				# engine (spec edge case + FR-003).
				engine_binary_ok "$ENGINE" || die_recorded_engine_missing "$ENGINE"
				;;
			*) warn "Ignoring invalid MAYON_CONTAINER_ENGINE='${requested}' in $ENV_FILE; auto-detecting instead." ;;
		esac
	fi
	if [ -z "$ENGINE" ]; then
		if engine_binary_ok docker; then
			ENGINE="docker"
		elif engine_binary_ok podman; then
			ENGINE="podman"
		else
			die "No container engine found. Install one of: docker (https://docs.docker.com/get-docker/) or podman (https://podman.io; also install a compose provider, e.g. the 'podman-compose' package)."
		fi
		ENGINE_SOURCE="detected"
	fi
	# Fallback (auto-detect only, FR-002; never for override or recorded —
	# engine-scoped volumes make silent switching a data hazard): the detected
	# engine has no working compose but the other one is fully usable → switch
	# with a warning. When neither has working compose, preflight() dies with
	# engine-specific guidance.
	if [ "$ENGINE_SOURCE" = "detected" ] && ! compose_ok "$ENGINE"; then
		local other="podman"
		[ "$ENGINE" = "docker" ] || other="docker"
		if engine_binary_ok "$other" && compose_ok "$other"; then
			warn "'${ENGINE} compose' is not working; falling back to ${other}."
			ENGINE="$other"
			ENGINE_SOURCE="fallback"
		fi
	fi
}

preflight() {
	resolve_engine
	engine_binary_ok "$ENGINE" || die_engine_missing "$ENGINE"
	compose_ok "$ENGINE" || die_compose_missing "$ENGINE"
}

# Recorded value wins over an ambient export on NON-install commands
# (contracts/engine-selection.md §Recording & reads). Legacy .env without a
# valid engine key falls back to ordinary FR-002 resolution (export → detect);
# the key itself is only ever written by install/upgrade, never here.
resolve_engine_for_lifecycle() {
	ENGINE=""
	ENGINE_SOURCE=""
	local recorded=""
	if [ -f "$ENV_FILE" ]; then
		recorded="$(sed -nE 's|^MAYON_CONTAINER_ENGINE=([^[:space:]]*).*|\1|p' "$ENV_FILE" | tail -n1)"
	fi
	case "$recorded" in
		docker | podman)
			ENGINE="$recorded"
			ENGINE_SOURCE="recorded"
			engine_binary_ok "$ENGINE" || die_recorded_engine_missing "$ENGINE"
			;;
		*) resolve_engine ;; # no key yet (legacy) or a garbage value → normal resolution
	esac
}

# Shared setup for lifecycle subcommands (start/stop/restart/logs/status/
# uninstall): bind to the resolved engine, then verify binary + compose with
# engine-specific guidance (FR-003/FR-004). Quiet on success — subcommand
# output stays byte-for-byte with the pre-engine baseline (SC-002).
require_engine() {
	resolve_engine_for_lifecycle
	engine_binary_ok "$ENGINE" || die_engine_missing "$ENGINE"
	compose_ok "$ENGINE" || die_compose_missing "$ENGINE"
}

# Human-readable engine name for user-facing copy (FR-007).
engine_display() {
	case "$ENGINE" in
		podman) echo "Podman" ;;
		*) echo "Docker" ;;
	esac
}

gen_password() {
	if command -v openssl >/dev/null 2>&1; then
		openssl rand -hex 24
	else
		head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
	fi
}

# Compose project name that the engine's compose will use for this install:
# the lowercased install-dir basename with characters outside [a-z0-9_-]
# stripped (~/.mayon -> "mayon", /tmp/tmp.AbC123 -> "tmpabc123"). This matches
# how podman-compose derives project names from the working directory. Docker
# compose prefers a `name:` in the config (docker-compose.yml has none), so both
# engines converge on the same normalized basename.
compose_project_name() {
	name="$(basename "$INSTALL_DIR" | sed 's/^\.//' | tr '[:upper:]' '[:lower:]' | tr -d -c 'a-z0-9_-')"
	echo "${name:-mayon}"
}

# True when a Postgres data volume already exists for this project.
pg_volume_exists() {
	"$ENGINE" volume inspect "$(compose_project_name)_pg-data" >/dev/null 2>&1
}

# A pg-data volume outlives its config: if ~/.mayon/.env is gone but the volume
# remains, the password baked into it on first init is unrecoverable. Minting a
# new password now would desync and trigger "password authentication failed" on
# every boot. Resolve (wipe or abort) before generating a new password.
guard_stale_volume() {
	local vol; vol="$(compose_project_name)_pg-data"
	warn "An existing database volume was found: $vol"
	warn "It was initialized with a password that is no longer available."
	if [ -t 0 ] && [ -t 1 ]; then
		cat >&2 <<'EOF'
  Generating a fresh password now would desync from the volume and cause
  "password authentication failed for user mayon" on every boot.
EOF
		read -r -p "Wipe the volume and start fresh? THIS DELETES ALL DATABASE DATA. [y/N] " ans </dev/tty
		case "$ans" in
			y | Y | yes | YES)
				compose_cmd down >/dev/null 2>&1 || true
				"$ENGINE" volume rm "$vol" >/dev/null 2>&1 \
					|| die "Could not remove volume $vol. Remove it manually and re-run: $ENGINE volume rm $vol"
				ok "Removed stale volume $vol."
				;;
			*)
				die "Aborted to protect existing data. Restore $ENV_FILE, or remove the volume: $ENGINE volume rm $vol"
				;;
		esac
	else
		cat >&2 <<EOF
! A Postgres data volume already exists ($vol) but no config was found.
  A fresh password would not match the one baked into the volume, so the
  server could not authenticate. Resolve one of these and re-run:

    - Reuse the original password: restore $ENV_FILE (or export POSTGRES_PASSWORD).
    - Start fresh (DELETES DATABASE DATA):  ${ENGINE} volume rm $vol
EOF
		exit 1
	fi
}

# Warn when the OTHER engine already holds a pg-data volume for this project
# (volumes are engine-scoped; data does not transfer across engines). Probing
# failure of the other engine is non-fatal (contracts/engine-selection.md §FR-006).
# Same-engine stale volume is guarded separately by guard_stale_volume.
guard_cross_engine_volume() {
	local other="podman"
	[ "$ENGINE" = "docker" ] || other="docker"
	local vol; vol="$(compose_project_name)_pg-data"
	engine_binary_ok "$other" || return 0 # other engine absent → nothing to probe
	"$other" volume inspect "$vol" >/dev/null 2>&1 || return 0 # not found → no hazard
	warn "Existing data found under $other: $vol"
	warn "Volumes are engine-scoped; it will NOT be visible under $ENGINE — proceeding starts a NEW EMPTY database."
	if [ -t 0 ] && [ -t 1 ]; then
		local ans=""
		read -r -p "Start fresh under $ENGINE anyway? THIS BEGINS A NEW EMPTY DATABASE. [y/N] " ans </dev/tty
		case "$ans" in
			y | Y | yes | YES) ok "Proceeding with a fresh database under $ENGINE." ;;
			*) die "Aborted. Your existing data is safe in $other volumes." ;;
		esac
	else
		cat >&2 <<EOF
! Existing Mayon data was found under the '$other' engine (volume $vol).
  Container volumes are engine-scoped, so that data is NOT visible under
  '$ENGINE' — installing here would start a NEW EMPTY database.

  - To keep using your existing data, install/re-run the installer with the
    engine that holds it:  MAYON_CONTAINER_ENGINE=$other bash install.sh
  - To start fresh under $ENGINE, re-run the installer from an interactive
    terminal and confirm the prompt, or remove the other engine's volume:
    $other volume rm $vol
EOF
		exit 1
	fi
}

ensure_env() { # writes .env on first run, preserves it on upgrades
	if [ -f "$ENV_FILE" ]; then
		ok "Reusing existing config: $ENV_FILE"
		return
	fi
	# No config yet. Guard against a pre-existing volume whose password is
	# unrecoverable before minting a new (mismatched) one.
	if pg_volume_exists; then
		guard_stale_volume
	fi
	local pass; pass="$(gen_password)" || die "Could not generate a password."
	{
		echo "# Mayon configuration — generated by install.sh"
		echo "POSTGRES_USER=mayon"
		echo "POSTGRES_DB=mayon"
		echo "POSTGRES_PASSWORD=${pass}"
		echo "# Web port (host). Change and restart to move off 8080."
		echo "MAYON_PORT=8080"
	} >"$ENV_FILE"
	chmod 600 "$ENV_FILE"
	ok "Generated config: $ENV_FILE"
}

# Record the resolved engine into .env once at install: future subcommands
# bind to it (FR-003). Explicit-override installs rewrite the value; detected/
# recorded installs keep any existing line (resolve_engine already hard-dies
# when a recorded engine's binary is missing).
ensure_engine_recorded() {
	[ -f "$ENV_FILE" ] || return 0 # ensure_env runs first and creates it
	if grep -q '^MAYON_CONTAINER_ENGINE=' "$ENV_FILE"; then
		[ "$ENGINE_SOURCE" = "override" ] || return 0
		sed -i.bak -E "s|^MAYON_CONTAINER_ENGINE=.*|MAYON_CONTAINER_ENGINE=${ENGINE}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
		chmod 600 "$ENV_FILE" # GNU sed -i preserves the mode; BSD sed does not
	else
		printf 'MAYON_CONTAINER_ENGINE=%s\n' "$ENGINE" >>"$ENV_FILE"
	fi
}

# Pin the image tag into .env so upgrades stay on the chosen release unless changed.
ensure_version_pin() {
	local v; v="$(resolve_version)"
	if ! is_semver "$v"; then
		return # latest: let compose default to :latest, no pin
	fi
	if [ -f "$ENV_FILE" ] && grep -q '^MAYON_VERSION=' "$ENV_FILE"; then
		sed -i.bak -E "s|^MAYON_VERSION=.*|MAYON_VERSION=${v}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
	else
		echo "MAYON_VERSION=${v}" >>"$ENV_FILE"
	fi
}

save_self() { # keep a copy of the matching installer for later subcommands
	local v; v="$(resolve_version)"
	download "$(installer_url_for "$v")" "$INSTALLER_FILE"
	chmod +x "$INSTALLER_FILE"
}

compose_cmd() { (cd "$INSTALL_DIR" && "$ENGINE" compose "$@"); }

# Wait until the web UI answers. podman-compose 1.x exits 0 even when container
# creation failed, so `up -d` alone cannot be trusted to mean "stack is up"
# (FR-005: identical functional behavior under both engines). Timeout ~60s.
wait_for_web() {
	local url; url="$(web_url)"
	local i
	for i in $(seq 1 30); do
		if command -v curl >/dev/null 2>&1; then
			curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
		elif command -v wget >/dev/null 2>&1; then
			wget -q --spider "$url" 2>/dev/null && return 0
		else
			return 0 # no HTTP client available — skip verification
		fi
		sleep 2
	done
	return 1
}

web_url() {
	local port="8080"
	if [ -f "$ENV_FILE" ] && grep -q '^MAYON_PORT=' "$ENV_FILE"; then
		port="$(sed -nE 's|^MAYON_PORT=([0-9]+).*|\1|p' "$ENV_FILE" | tail -n1)"
		[ -n "$port" ] || port="8080"
	fi
	echo "http://localhost:${port}"
}

cmd_install() {
	preflight
	log "Using engine: ${ENGINE} (source: ${ENGINE_SOURCE})"
	mkdir -p "$INSTALL_DIR"
	guard_cross_engine_volume
	local v; v="$(resolve_version)"
	log "Installing Mayon ${C_BOLD}${v}${C_RESET} into ${C_BOLD}${INSTALL_DIR}${C_RESET}"
	log "Downloading docker-compose.yml…"
	download "$(compose_url_for "$v")" "$COMPOSE_FILE"
	ensure_env
	ensure_engine_recorded
	ensure_version_pin
	save_self
	log "Pulling images…"
	compose_cmd pull
	log "Starting containers…"
	compose_cmd up -d
	log "Waiting for the stack to come up…"
	wait_for_web || die "The stack did not become reachable at $(web_url). Inspect logs with: $(basename "$0") logs"
	echo
	ok "Mayon is up → $(web_url)"
	printf '  Manage with:  %s{stop,start,restart,logs,status,upgrade,uninstall}%s\n' "$C_BOLD" "$C_RESET"
	printf '  Directory:     %s\n' "$INSTALL_DIR"
	if is_semver "$v"; then
		printf '  Pinned to:     v%s (edit %s to change)\n' "$v" "$ENV_FILE"
	fi
}

cmd_start() { [ -f "$COMPOSE_FILE" ] || die "Not installed. Run: $(basename "$0") install"; require_engine; compose_cmd up -d && ok "Started → $(web_url)"; }
cmd_stop() { [ -f "$COMPOSE_FILE" ] || die "Not installed."; require_engine; compose_cmd stop && ok "Stopped."; }
cmd_restart() { [ -f "$COMPOSE_FILE" ] || die "Not installed."; require_engine; compose_cmd restart && ok "Restarted → $(web_url)"; }
cmd_logs() { [ -f "$COMPOSE_FILE" ] || die "Not installed."; require_engine; compose_cmd logs -f --tail=200; }
cmd_status() { [ -f "$COMPOSE_FILE" ] || die "Not installed."; require_engine; compose_cmd ps; }

cmd_upgrade() {
	[ -f "$COMPOSE_FILE" ] || die "Not installed. Run install first."
	preflight
	log "Upgrading to the latest release…"
	# Fetch the latest (version-baked) installer and let its baked version pin the upgrade.
	local tmp; tmp="$(mktemp)"
	download "$(installer_url_for latest)" "$tmp"
	# Engine continuity (FR-005): the downloaded installer's `install` path
	# re-reads MAYON_CONTAINER_ENGINE from the preserved .env (ensure_env keeps
	# the file; resolve_engine + ensure_engine_recorded re-pin the value), so
	# upgrades stay on the recorded engine. Do not bypass the child installer.
	bash "$tmp" install
	rm -f "$tmp"
}

cmd_uninstall() {
	[ -f "$COMPOSE_FILE" ] || die "Not installed."
	require_engine
	warn "This stops and removes containers. Volumes (your data) are KEPT."
	read -r -p "Proceed? [y/N] " ans </dev/tty
	case "$ans" in
		y | Y | yes | YES) ;;
		*) die "Aborted." ;;
	esac
	compose_cmd down
	rm -f "$COMPOSE_FILE" "$ENV_FILE" "$INSTALLER_FILE"
	ok "Removed Mayon files. Data volumes remain in $(engine_display) (re-install to recover)."
}

usage() {
	cat <<EOF
Mayon installer — https://github.com/${REPO}

Usage (first run):   curl -fsSL <url>/install.sh | bash
       (afterwards): $(basename "$0") <command>

Commands:
  install     Install / re-deploy Mayon (default)
  start       Start a stopped stack
  stop        Stop the stack (keeps data)
  restart     Restart the stack
  logs        Follow container logs
  status      Show container status
  upgrade     Pull and deploy the latest release
  uninstall   Remove containers and files (keeps data volumes)

Environment:
  MAYON_VERSION   Pin a release (e.g. 0.1.0). Default: ${MAYON_INSTALLER_VERSION}
  MAYON_DIR       Install directory. Default: ~/.mayon
  MAYON_PORT      Web port (also writable in ~/.mayon/.env). Default: 8080
  MAYON_CONTAINER_ENGINE   Force the container engine (docker|podman). Default: auto (Docker preferred)
EOF
}

main() {
	local cmd="${1:-install}"
	case "$cmd" in
		-h | --help | help) usage ;;
		install) shift 2>/dev/null || true; cmd_install ;;
		start) cmd_start ;;
		stop | down) cmd_stop ;;
		restart) cmd_restart ;;
		logs) cmd_logs ;;
		status | ps) cmd_status ;;
		upgrade | update) cmd_upgrade ;;
		uninstall) cmd_uninstall ;;
		*) die "Unknown command '$cmd'. Run '$0 --help'." ;;
	esac
}

main "$@"
