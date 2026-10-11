# Mayon

Mayon — a local-first learning app built around a branchable chat graph.

https://github.com/user-attachments/assets/de10d77f-d369-4903-97b1-606cfa819cae

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
  LiteLLM (self-hosted), Vercel AI Gateway, Requesty, Z.AI (GLM), GitHub Copilot, and more — any
  OpenAI-compatible endpoint works with a custom base URL; switch providers freely.
  When Mayon runs in a container and you use a local gateway (LiteLLM, Ollama
  on the host), point at `http://host.docker.internal:<port>` under Docker or
  `http://host.containers.internal:<port>` under Podman (or the host LAN IP)
  instead of `localhost`.

## Get Mayon

### Before you start

You'll need three things in place before installing:

- **A container engine.** Mayon ships as three small programs (web app, helper
  server, database) bundled into _containers_, and a **container engine** is
  the app that downloads and runs them for you. Install
  [Docker Desktop](https://docs.docker.com/get-docker/) on macOS or Windows —
  a ~2–3 GB download, free for personal use (larger businesses need a
  [paid plan](https://www.docker.com/pricing)). On Linux, install
  [Docker Engine](https://docs.docker.com/get-docker/) or
  [Podman](https://podman.io/docs/installation) instead.
- **An AI provider.** Chat runs through an AI service of your choice, so you
  will need a key from one. Easiest is
  [OpenRouter](https://openrouter.ai/settings/keys) — one account, many
  models, pay-as-you-go with per-key spend caps. The free option is
  [Ollama](https://ollama.com/download), which runs models on your own
  machine. Both are walked through step by step in the
  [beginner guide](https://bendlikeabamboo.github.io/mayon/tutorials/getting-started.html).
- **A terminal.** The install step is one command typed into a terminal — the
  text window where commands are entered. macOS: the built-in
  [Terminal](https://support.apple.com/guide/terminal/welcome/mac). Windows:
  the Ubuntu terminal inside WSL2 (see
  [Windows: install inside WSL2](#windows-install-inside-wsl2) below). Linux:
  your distro's terminal.

### Install in three steps

1. Install [Docker Desktop](https://docs.docker.com/get-docker/) and open it
   once so it is running.
2. Paste this into a terminal:

   ```bash
   curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/latest/download/install.sh | bash
   ```

   The first run downloads Mayon's images, so expect a few minutes. The
   command detects your engine, generates a secure Postgres password, writes
   the files to `~/.mayon`, and starts the stack; afterwards
   `~/.mayon/install.sh` manages it (`stop`, `start`, `restart`, `logs`,
   `status`, `upgrade`, `uninstall`).

   > What that command does: it downloads Mayon's install script and runs it.
   > The script writes its settings to `~/.mayon`, generates a random
   > database password, and starts three containers on your machine —
   > nothing else.

3. Open http://localhost:8080 in your browser. Then connect an AI provider —
   required before chat works — by following
   [Getting started](https://bendlikeabamboo.github.io/mayon/tutorials/getting-started.html),
   the beginner guide that covers first run, provider setup, and your first
   chat step by step.

#### Windows: install inside WSL2

The installer is a bash script, so on Windows it runs inside
[WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) (a Windows
feature that provides an Ubuntu terminal), not PowerShell. This path has
been tested end to end on Windows 11 with Docker Desktop:

1. Install WSL2: in an administrator PowerShell run `wsl --install`, then
   restart. Current Docker Desktop needs WSL ≥ 2.1.5 — check with
   `wsl --version`, run `wsl --update` if older.
2. Install [Docker Desktop with the WSL 2 backend](https://docs.docker.com/desktop/wsl/)
   and enable WSL integration for Ubuntu. If you previously installed Docker
   Engine _inside_ the Ubuntu distro, uninstall that copy first.
3. Open **Ubuntu** from the Start menu and run the one-line installer above
   there, then open http://localhost:8080 in your Windows browser — Docker
   Desktop forwards the port automatically.

#### Podman instead of Docker

**Podman** works out of the box on Podman 4+ (rootless is supported). To force
Podman on a machine that also has Docker, prefix the install with
`MAYON_CONTAINER_ENGINE=podman`; the engine is recorded in `~/.mayon/.env`, so
the saved-installer subcommands keep using it too. Notes and caveats:
[Podman notes](#podman-notes).

### Optional: Brave Search (self-hosted web search for chats)

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

## Advanced

Everything above is the recommended path. The sections below are optional or
for special situations and assume some comfort with the terminal.

### Pin a release

Recommended for reproducible installs:

```bash
curl -fsSL https://github.com/bendlikeabamboo/mayon/releases/download/v0.1.0/install.sh | bash
```

### Prefer no install script?

Run the compose file directly — but you **must** provide
`POSTGRES_PASSWORD` in a local `.env` or on the command line (the install
script generates a secure random password for you):

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

### Port and version settings

All three paths accept `MAYON_PORT` (web port, default `8080`) and
`MAYON_VERSION` (image tag) via env. To move off port 8080, set
`MAYON_PORT=3000` in `~/.mayon/.env` and restart.

### Podman notes

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

### Launching publicly (stopgap floor)

By default the web port (`8080`) publishes straight to the host with no
authentication — fine on a private machine, not on the open internet.
Until you have enabled and proven Mayon's built-in security gate
(**Settings → Security**), you can put a password + HTTPS front door in
front of the stack using two template files attached to every release:

- `docker-compose.override.yml.floor` — a compose override that
  **un-publishes the web port** (via the compose `!override` tag) and adds
  a `caddy` service publishing `80`/`443` with automatic TLS.
- `Caddyfile.floor` — the Caddy config: one shared basic-auth credential
  and a reverse proxy to the app.

> **Important:** this floor is a **stopgap**. Its single shared credential
> has no per-user identity, no MFA, and no logout. It exists so you can
> launch publicly today; enable the in-app gate and remove the floor once
> the gate is proven in daily use.

**Prerequisites**

- A domain name pointing at the host, with ports `80` and `443` reachable
  (the TLS certificate is obtained automatically).
- Docker Engine with `docker compose` **v2.24+** (`docker compose version`
  to check) — the `!override` tag needs it. Docker Engine is recommended:
  podman-compose's override merging is less faithful. On an older engine,
  edit the downloaded `docker-compose.yml` directly instead (delete the
  `ports:` block from the `web` service).

**Activate** (after a normal install; substitute `podman` for `docker` in
the commands if installed under Podman):

1. Download both templates from the release assets into `~/.mayon/`.
2. Activate the override by renaming it — compose auto-merges every
   `docker-compose.override.yml` sitting next to the base file (no `-f`
   flags needed); the `.floor` suffix keeps the template inert until then:

   ```bash
   mv ~/.mayon/docker-compose.override.yml.floor ~/.mayon/docker-compose.override.yml
   ```

3. Generate a bcrypt hash for your shared credential (the command prompts
   for the password and prints the hash):

   ```bash
   cd ~/.mayon && docker compose run --rm caddy caddy hash-password
   ```

4. Add the credential and your domain to `~/.mayon/.env` — **single-quote
   the hash**: it contains `$`, which compose would otherwise read as a
   variable reference:

   ```
   MAYON_DOMAIN=mayon.example.com
   MAYON_BASIC_AUTH_USER=owner
   MAYON_BASIC_AUTH_HASH='$2a$14$<hash from step 3>'
   ```

5. `docker compose up -d` — Caddy obtains a certificate automatically and
   serves the app behind the credential.

**Verify the single entrance BEFORE sharing the URL** (ideally from an
external network):

```bash
cd ~/.mayon
docker compose port web 8080     # must error — the app's own port is unpublished
docker compose ps                # only caddy lists host ports (80/443); web lists none
curl -I http://<host-ip>:8080    # connection refused
curl -I https://<domain>         # 401 without credentials; loads with them
```

Then run **one streaming chat** in a browser through the domain before you
trust the floor: tokens must appear progressively, not in one burst at the
end (the Caddyfile disables response buffering for exactly this). Repeat
this check after any Caddy/config change.

**Remove the floor** once the in-app gate (**Settings → Security**) is
enabled and proven:

```bash
rm ~/.mayon/docker-compose.override.yml ~/.mayon/Caddyfile.floor
cd ~/.mayon && docker compose up -d
```

The base compose applies again unchanged. Upgrades preserve the override
and `.env` (only the base compose file is re-downloaded). To rotate the
shared credential, set a new `MAYON_BASIC_AUTH_HASH` in `.env` and run
`docker compose up -d` — it changes for everyone at once.

While the floor is active, login-attempt sources shown under
**Settings → Security** record the Caddy container's address rather than
each visitor's IP — the app's rate limiter trusts exactly one proxy hop.
The floor override sets `MAYON_TRUST_PROXY_HOPS=2` on the server so
per-visitor attribution and lockouts stay per-IP through both proxies
(rate-limit buckets remain per visitor; the caveat above applies only to
the label shown in the activity list).

### Security recovery (auth CLI)

The server image ships a recovery CLI for the built-in security gate
(**Settings → Security**). It is the only way back if the gate locks you out
(lost password, lost authenticator, hostile lock, stale locked backup
restore). Run it in the server container from the host running the stack:

```bash
cd ~/.mayon && docker compose exec server node dist/auth-cli.js <command>
```

| Command                          | Effect                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `status`                         | Mode, identities, active sessions, key presence                                                                      |
| `reset-password --label <label>` | Set a new password (hidden prompt ×2); revokes that identity's sessions; next login still requires a valid TOTP code |
| `reenroll-mfa --label <label>`   | Discard the old TOTP secret and print a fresh `otpauth://` URI to scan                                               |
| `wipe-sessions`                  | Revoke every session                                                                                                 |
| `rotate-secret`                  | Re-wrap all TOTP secrets under a new key; aborts without writing if any secret fails to decrypt                      |
| `set-mode --mode open\|locked`   | Set the security mode directly (escape hatch; revokes all sessions when leaving locked)                              |

Exit codes: `0` success, `1` refused/usage, `2` database unreachable. No
command creates an MFA-less login path. While developing:
`pnpm --filter @mayon/server auth <command>`.

### Troubleshooting

#### `password authentication failed for user "mayon"`

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

#### Podman: short-name image resolution

If `podman compose up` fails with an error like `short-name "postgres:17-alpine"
did not resolve to a registry`, the host's registry policy blocks unqualified
image names. Current releases ship fully-qualified refs (`docker.io/library/...`)
in the compose file, so this is fixed — run `~/.mayon/install.sh upgrade` on an
older install.

#### Podman rootless: web container fails to bind port 80

Older releases had the web container listen on port 80 inside the container,
which failed under rootless Podman. Current releases listen on 8080 inside
the container; run `~/.mayon/install.sh upgrade` if you see this.

## Build from source

**Prerequisites:** Node 22, pnpm 10, and Docker or Podman (the dev engine is
selectable via `MAYON_DEV_ENGINE`; see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
pnpm install
pnpm dev          # all-Docker dev stack: web HMR (:5173) + server + db
```

## Documentation

Full docs: [bendlikeabamboo.github.io/mayon](https://bendlikeabamboo.github.io/mayon)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and PR flow.

## License

[MIT](LICENSE)
