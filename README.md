# Mayon

Mayon — a local-first learning app built around a branchable chat graph.

Chat with an AI about any topic, highlight a dense response, and branch a new
conversation from that exact excerpt. From any chat, generate AI-powered
hands-on labs and mixed-format quizzes (MCQ, flashcard, short-answer with AI
grading). Everything stays on your machine — no account, no server, no
telemetry.

## What it is

- **Branchable chat graph** — highlight and fork conversations; navigate a tree
  of branches with sidebar, breadcrumbs, and cross-links.
- **Hands-on labs** — step-by-step guides with interactive checklists generated
  from any chat.
- **Quizzes** — MCQ, flashcard, and short-answer questions with AI grading and
  score tracking.
- **Local-first / self-hosted** — browser SPA backed by a Postgres primary
  store via a small local server. Self-host with `docker compose up` (or
  `podman compose up`); no account, no telemetry.
- **Provider-agnostic AI** — OpenAI, Anthropic, Gemini, DeepSeek, xAI (Grok),
  Moonshot Kimi, Qwen, Groq, Mistral, Ollama, OpenRouter, Kilo Gateway, OpenCode Zen,
  LiteLLM (self-hosted), Vercel AI Gateway, Requesty, and more — any
  OpenAI-compatible endpoint works with a custom base URL; switch providers freely.
  When Mayon runs in a container and you use a local gateway (LiteLLM, Ollama
  on the host), point at `http://host.docker.internal:<port>` under Docker or
  `http://host.containers.internal:<port>` under Podman (or the host LAN IP)
  instead of `localhost`.

## Get Mayon

### Web demo

Try the live demo at
[bendlikeabamboo.github.io/mayon](https://bendlikeabamboo.github.io/mayon).

### Docker / Podman (self-host)

Mayon runs as three containers (web SPA, server, Postgres) on Docker or Podman
with identical behavior; Docker is the default when both are installed. The
quickest way to run it — a single command that detects the engine, generates a
secure Postgres password, writes the files to `~/.mayon`, and starts the stack:

```bash
curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/latest/download/install.sh | bash
```

Then open http://localhost:8080. Files land in `~/.mayon`; use
`~/.mayon/install.sh` to manage the stack afterwards (`stop`, `start`,
`restart`, `logs`, `status`, `upgrade`, `uninstall`).

**Podman** works out of the box on Podman 4+ (rootless is supported). To force
Podman on a machine that also has Docker, prefix the install with
`MAYON_CONTAINER_ENGINE=podman`; the engine is recorded in `~/.mayon/.env`, so
the saved-installer subcommands keep using it too.

**Pin a release** (recommended for reproducible installs):

```bash
curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/download/v0.1.0/install.sh | bash
```

**Prefer no install script?** Run the compose file directly — but you
**must** provide `POSTGRES_PASSWORD` in a local `.env` or on the command
line (the install script generates a secure random password for you):

```bash
docker compose -f https://raw.githubusercontent.com/bendlikeabamboo/mayon/main/docker-compose.yml \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" up -d
```

For Podman, the same command works — `podman compose -f <url> ... up -d` with
identical flags.

Or save an `.env` next to your `docker-compose.yml`:

```
POSTGRES_PASSWORD=<your-password>
```

> **Important:** the password must be set the **first time** you start the
> stack. Postgres stores credentials in its data volume; changing the
> password after init requires deleting the volume (`docker compose down
-v`) and starting fresh (all data is lost).

All three paths accept `MAYON_PORT` (web port, default `8080`) and
`MAYON_VERSION` (image tag) via env. To move off port 8080, set
`MAYON_PORT=3000` in `~/.mayon/.env` and restart.

#### Podman notes

- Image refs in the compose file are fully qualified
  (`docker.io/library/postgres:17-alpine`), so hosts without
  unqualified-search registries work with no config changes.
- The default web port `8080` is unprivileged, so rootless Podman works out
  of the box; ports below 1024 require rootful Podman or
  `sysctl net.ipv4.ip_unprivileged_port_start`.
- To reach a host service (LiteLLM, Ollama) from containers, use
  `http://host.containers.internal:<port>` — Podman's equivalent of
  `host.docker.internal` — or the host LAN IP.
- Volumes are engine-scoped: switching engines starts a new, empty database.
  The installer warns before that happens.
- Aliasing `docker` → `podman` helps manual typing only; the installer and
  docs commands use real binaries — pass `MAYON_CONTAINER_ENGINE=podman`
  instead.

#### Optional: Brave Search (self-hosted web search for chats)

Mayon can add live web search to chats so answers can be validated and
refreshed with current sources. Get an API key at
[brave.com/search/api](https://brave.com/search/api/), then in the app:
**Settings → MCP servers → Add Server → Brave Search**, paste the key, and
complete the trust prompt.

The key is stored with the app's other credentials (browser secret store) —
never in the connection config, URLs, or logs — and rotating it is just
editing it in settings; no `.env` changes or stack restarts. The official
Brave Search MCP server runs on demand inside the Mayon server container, so
there is nothing to deploy: the feature is available whenever the server is.

### Upgrading

Upgrades are in-place: containers are recreated but the `pg-data` and
`server-data` volumes are kept, so your data survives (back up first with the
in-app backup/restore if you want a safety copy).

**Easiest** — pull and deploy the latest stable release:

```bash
~/.mayon/install.sh upgrade
```

This works the same under Podman — the engine recorded in `~/.mayon/.env` is
reused.

**Pin a specific version** (e.g. to stay on or roll back to a known release):

```bash
MAYON_VERSION=0.2.0 ~/.mayon/install.sh install
```

**No install script?** If you manage `docker-compose.yml` directly, pin
`MAYON_VERSION` in your `.env` (or pass it on the command line) and pull:

```bash
MAYON_VERSION=0.2.0 docker compose pull && MAYON_VERSION=0.2.0 docker compose up -d
```

Under Podman: `podman compose pull && podman compose up -d`.

To roll back, repeat with the previous version tag. If something goes wrong,
restore from a backup taken before the upgrade.

## Build from source

**Prerequisites:** Node 22, pnpm 10, and Docker or Podman (the dev engine is
selectable via `MAYON_DEV_ENGINE`; see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
pnpm install
pnpm dev          # all-Docker dev stack: web HMR (:5173) + server + db
```

## Troubleshooting

### `password authentication failed for user "mayon"`

This means the server container cannot authenticate with Postgres. Common causes:

- **Stale volume from a previous install.** If you deleted `~/.mayon/` and
  re-ran the installer, a new random password was generated but the old
  Postgres data volume still has the old password. Fix (substitute `podman`
  if installed under Podman):
  ```bash
  cd ~/.mayon && docker compose down -v   # removes volumes (data is lost)
  ~/.mayon/install.sh start               # reinitializes with the new password
  ```
- **First-run timing (fixed in recent versions).** On a fresh install
  Postgres can report "ready" before finishing user/password setup. The
  current images include a healthcheck that verifies authentication — if
  you see this on an older install, pull the latest images:
  ```bash
  ~/.mayon/install.sh upgrade
  ```

### Podman: short-name image resolution

If `podman compose up` fails with an error like `short-name "postgres:17-alpine"
did not resolve to a registry`, the host's registry policy blocks unqualified
image names. Current releases ship fully-qualified refs (`docker.io/library/...`)
in the compose file, so this is fixed — run `~/.mayon/install.sh upgrade` on an
older install.

### Podman rootless: web container fails to bind port 80

Older releases had the web container listen on port 80 inside the container,
which failed under rootless Podman. Current releases listen on 8080 inside
the container; run `~/.mayon/install.sh upgrade` if you see this.

## Documentation

Full docs: [bendlikeabamboo.github.io/mayon/docs](https://bendlikeabamboo.github.io/mayon/docs)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and PR flow.

## License

[MIT](LICENSE)
