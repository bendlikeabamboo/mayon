# Contract: Stage 1 Floor — Caddy basic-auth front door (deployment artifacts)

Two new release-asset templates (shipped alongside the existing baked `install.sh` + `docker-compose.yml`):

- `docker-compose.override.yml.floor` — compose override that (a) REPLACES the `web` service's `ports` with `[]` using the `!override` YAML tag (composes ≥ v2.24; this is what makes the app's own port unpublished — FR-019), and (b) adds the `caddy` service:

```yaml
services:
  web:
    ports: !override []
  caddy:
    image: docker.io/library/caddy:2
    ports: ["80:80", "443:443"]
    environment:
      MAYON_BASIC_AUTH_USER: ${MAYON_BASIC_AUTH_USER:?set in .env}
      MAYON_BASIC_AUTH_HASH: ${MAYON_BASIC_AUTH_HASH:?set in .env}
    volumes:
      - ./Caddyfile.floor:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: [web]
    restart: unless-stopped
volumes:
  caddy-data:
```

- `Caddyfile.floor` — site block for the owner's domain (edited once):

```caddyfile
mayon.example.com {
    basic_auth {
        {$MAYON_BASIC_AUTH_USER} {$MAYON_BASIC_AUTH_HASH}
    }
    reverse_proxy web:8080 {
        flush_interval -1        # SSE/chunked LLM streaming must not buffer (FR-020)
    }
}
```

## Activation flow (user, one evening)

1. `curl -fsSL …/install.sh | bash` as today (installs base stack, `~/.mayon/`).
2. Copy both templates into `~/.mayon/` (override auto-merges on every `compose` call — installer uses no `-f` flags).
3. `docker compose exec caddy caddy hash-password` (once caddy is up) or `caddy hash-password` locally → put user + bcrypt hash into `~/.mayon/.env` as `MAYON_BASIC_AUTH_USER` / `MAYON_BASIC_AUTH_HASH`.
4. Set the real domain in `Caddyfile.floor`; `docker compose up -d` — Caddy obtains TLS automatically (HTTP-01; ports 80/443 must reach the host).

## Single-entrance verification (FR-019; run BEFORE exposing publicly)

- `docker compose port web 8080` → errors/empty (port NOT published) — pass.
- `docker compose ps` → only `caddy` lists host ports 80/443; `web` shows none — pass.
- From an external network: `curl -I https://<domain>` → `401` until credentials; app's host IP :8080 → connection refused — pass.

## Streaming verification (FR-020; run before trusting)

With credentials in a browser through the domain: run one streaming chat end-to-end; tokens must appear progressively (no wall-then-burst buffering). Repeat after any Caddy/config change.

## Removal (FR-021)

Delete the two files from `~/.mayon/`, restore the base `ports` (override gone ⇒ base compose applies again), `docker compose up -d`. The in-app gate must already be proven (locked mode verified in daily use) before this step; the gate then stands alone.

## Known caveats (documented for users)

- `!override` needs Docker Compose v2.24+ (2023-12); podman-compose merge fidelity is weaker — docker engine recommended for the floor. Fallback for older engines: edit the downloaded `docker-compose.yml` directly (remove `ports` from `web`).
- Upgrades (`install.sh` upgrade / `compose pull && up -d`) preserve the override and `.env`; only the base compose file is re-downloaded.
- The floor's shared credential is the whole security (no MFA, no per-user identity, no logout) — by design a stopgap; rotation = changing the hash in `.env` + `up -d` (revocation rotates for everyone).
