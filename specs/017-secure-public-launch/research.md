# Phase 0 Research: Secure Public Launch

Resolves every open technical question for [spec.md](./spec.md). Format: Decision / Rationale / Alternatives considered.

## R1. Where the central gate lives

**Decision**: One Fastify `onRequest` hook registered at the root app inside `buildApp()` (server/src/server.ts:43), BEFORE the plugin that registers all routes. The hook checks security mode + session cookie against an explicit public allowlist; rejection is `reply.code(401).send({ error: 'unauthenticated' })`.

**Rationale**: All 8 existing `register*()` plugins register onto the same encapsulated instance, so one root hook covers every current and future route — the structural "unguarded endpoint" guarantee (FR-001, SC-002). A 401 in `onRequest` short-circuits before any handler, including `/api/llm/proxy` whose `reply.hijack()` streaming happens only inside the handler — the stream can never be corrupted by the gate. Per-request cost is one cookie read + one indexed session lookup.

**Alternatives considered**: per-route `preHandler` (rejected — per-route discipline is exactly the failure mode the spec bans); a reverse proxy that checks sessions (rejected — session validation needs the DB and app semantics); decorating every handler manually (same per-route problem).

## R2. Public allowlist

**Decision**: Exempt exactly: `GET /api/health`, `POST /api/auth/session` (read-only status), `POST /api/auth/login`, `POST /api/auth/setup`, `POST /api/auth/setup/confirm`, `POST /api/auth/enroll`, `POST /api/auth/logout` (harmless without session). Everything else — `/api/db/query`, `/api/sandbox/query`, `/api/backup/*`, `/api/import/sqlite`, `/api/llm/*`, `/api/auth/*` admin routes, `/ws/mcp` — requires a valid session when locked.

**Rationale**: `/api/health` must stay public because `detectServer()` treats any non-200 as "no server" and the SPA (and compose flows) rely on it; its payload (`ok`, version, caps, sandboxDbPath, restoring) contains no user data (FR-002 satisfied). Auth endpoints must be reachable pre-auth by definition. All actual data/capability surfaces stay gated.

**Alternatives considered**: gating health and teaching the SPA a new probe (rejected — touches boot/detect/BootGate paths for no security gain); exposing health detail only when locked (needless divergence).

## R3. Password hashing

**Decision**: argon2id via `@node-rs/argon2` (default cost parameters; 64-byte hash embedded with salt). Add `@node-rs/argon2` to `pnpm.onlyBuiltDependencies` (same pattern as `better-sqlite3`); it ships musl prebuilds so the alpine server image needs no toolchain.

**Rationale**: argon2id is the current best-practice password KDF and the deck's named intent ("argon2/bcrypt via a vetted library"); `@node-rs/argon2` is a maintained prebuilt-binding wrapper (no compile step, matches the existing native-addon precedent).

**Alternatives considered**: `bcryptjs` (pure JS, slower, dated KDF); Node built-in `crypto.scrypt` (vetted, zero-dep — strong fallback if musl prebuilds ever fail in CI); hand-rolled PBKDF2 (rejected — constitution prohibits hand-rolled crypto).

## R4. TOTP verification + QR

**Decision**: `otplib` (authenticator, SHA-1/6-digit/30s defaults — the compatibility baseline for authenticator apps), verify window ±1 time step (spec edge case). Enrollment issues a standard `otpauth://totp/mayon:<label>?secret=…&issuer=mayon` URI; the SPA renders it as a QR client-side with `qrcode` (SVG/dataURL). Replay prevention: store the last accepted timestep per identity and reject codes at or below it (FR-014).

**Rationale**: otplib is the established, vetted TOTP library for Node; ±1 window matches the spec's clock-drift tolerance; server-side secret generation keeps the client unable to choose its own secret; client-side QR render avoids shipping the URI through any third-party service.

**Alternatives considered**: `@epic-web/totp` (newer, less battle-tested for authenticator interop); rendering QR server-side as SVG (couples server to a render dep for no gain).

## R5. TOTP secret storage (FR-012)

**Decision**: TOTP secrets stored AES-256-GCM-encrypted in the identity row (random 12-byte IV per encryption, auth tag stored alongside). Key: `MAYON_AUTH_SECRET` env if set (normalized via SHA-256 to 32 bytes); otherwise auto-generated once (32 random bytes, base64) into `/data/auth-secret` on the `server-data` volume (chmod 600) and reused. Key material never touches Postgres. CLI `rotate-secret` re-wraps all secrets.

**Rationale**: satisfies "unusable if the database contents alone are compromised" — a stolen `pg_dump` lacks the key (it lives in env or on the volume, not in PG). GCM is a vetted authenticated mode via `node:crypto` (no new dependency, nothing hand-rolled). Auto-generated key file keeps enable-security a zero-setup in-app action (FR-024); env override serves infrastructure-minded owners.

**Alternatives considered**: keychain/KMS (overkill for a hobby single-server app); plaintext with disk-level encryption only (rejected — violates FR-012's letter); key in the `settings` table (rejected — constitution I: no secrets in settings).

## R6. Sessions

**Decision**: Opaque 256-bit random token (base64url) in an HttpOnly cookie `mayon_session`; DB stores only SHA-256(token) + identity + created/expires/revoked. Lifetime: expires at end of calendar day, server-local (computed at login; lazy expiry check per request — SC-011). Flags: `HttpOnly; SameSite=Lax; Path=/; Max-Age=<until midnight>; Secure` — `Secure` on by default (browsers accept Secure cookies on localhost for dev); `MAYON_COOKIE_SECURE=false` escape hatch for plain-HTTP LAN testing. Logout deletes the row; revocation (single/all/invitee) sets `revoked_at` and is checked per request (FR-007 immediate effect). Mutation requests additionally validate the `Origin` header (SameSite=Lax already blocks cross-site POSTs; the check is belt-and-braces CSRF armor).

**Rationale**: random tokens mean a DB leak yields no usable cookies (hash-only storage, consistent with SC-006); calendar-day expiry is the ruled UX; per-request revocation check makes invites/rotate instant (SC-005). Same-origin `fetch` (current client, `src/lib/services/client.ts`) rides cookies automatically in dev (Vite proxy) and prod (nginx).

**Alternatives considered**: JWT (stateless — makes immediate revocation awkward); signed tokens (same revocation problem); sliding 30-day sessions (rejected — user ruled same-day).

## R7. Login rate limiting

**Decision**: Backed by `auth_login_attempts`. Policy per (source IP): count failures in a trailing 10-minute window — 0–4 failures: no delay; 5–9: response delayed `min(2^(failures−4), 60)` seconds; ≥10: refuse (429 `{"error":"too many attempts"}`) until the oldest failure exits the window (SC-004). Outcome values `bad_password`/`bad_code` are stored but never surfaced to the client (uniform generic failure, FR-014). Successes recorded for visibility (FR-015) but never throttled. Test clock injected via `BuildAppOptions`.

**Rationale**: progressive delay + hard lockout matches the spec's "progressive delay or temporary lockout"; DB-backed state survives restarts and works behind proxies; per-IP (not per-identity) prevents identity enumeration via differing lockouts.

**Alternatives considered**: in-memory counters (lost on restart, weak behind nginx); per-identity lockout (enables credential-stuffing oracle); CAPTCHA (out of scope, vendor gravity).

## R8. Identities, invites, roles

**Decision**: `auth_identities.role ∈ {owner, invitee}`; status machine `invited → active → revoked`. Owner created only through setup (password + MFA confirmed). Invite flow: owner (session, role=owner) creates a label → server generates a one-time password (shown once) → invitee logs in with label+password → server returns `mfa_enrollment_required` + otpauth URI under a short-lived enrollment cookie → invitee confirms a live code → status `active`, full session issued. Revocation: owner-only, sets `revoked`, deletes sessions (immediate, SC-005). No un-revoke (create a fresh invite instead). Gate-admin endpoints are owner-only; all app capabilities are role-blind (FR-008/FR-009/FR-010). Login label resolution: optional when exactly one active identity exists; required otherwise.

**Rationale**: keeps "no registration" absolute (identities are hand-created by the owner only); the invited→active machine implements "invitee completes their own MFA enrollment at first login" without any MFA-less session ever existing (FR-003/FR-017).

**Alternatives considered**: pre-enrolled invitee secrets handed by the owner (worse: owner handles invitee TOTP secrets); email/magic links (no mail infrastructure, out of scope).

## R9. Security mode toggle + first-run (FR-022/023/024)

**Decision**: Mode stored as `settings` key `security.mode` (`'open'` default | `'locked'`), read server-side (pool SQL, the existing settings-on-server pattern). `GET /api/auth/session` (public) returns `{mode, setupRequired, authenticated, identity?, session?}` — the SPA's boot gate consumes it BEFORE `bootstrapDb()`. First visit in open mode with no identities: setup prompt once (dismissable, no re-nag — the SPA remembers the dismissal locally, and the prompt condition is "no identities exist"); enabling later = the settings toggle → same setup flow. Setup is atomic: secret generated + encrypted + pending until one live code confirms; wrong code leaves nothing active (spec US1-4). Disabling (locked→open) requires an authenticated owner session + password re-entry (defense against drive-by toggles while a session is live). Hostile-enable risk on a public open deployment is accepted by ruling; CLI recovery (R10) is the way back.

**Rationale**: mode must be readable pre-auth to know whether to show login; settings-key storage keeps it visible/backupable without secrets; atomic setup honors the no-half-activated acceptance scenario.

**Alternatives considered**: separate `gate_state` table (needless — settings precedent exists); server-side tracking of "prompt dismissed" (would need pre-auth writes; localStorage is the right home for pure UX memory).

## R10. Recovery CLI (FR-016/FR-017)

**Decision**: New second tsup entry `server/src/auth/cli.ts` exposed as `pnpm --filter @mayon/server auth` (container: `docker compose exec server node dist/auth-cli.js …`). Commands: `status`, `reset-password --label <label>` (prompts for new password), `reenroll-mfa --label <label>` (prints fresh otpauth URI), `wipe-sessions`, `rotate-secret`. All operate over the same pool + crypto modules; nothing prints or writes TOTP secrets in plaintext; no command creates an MFA-less login path.

**Rationale**: server-side CLI is the ruled recovery channel; a dedicated entrypoint avoids server.ts growth and matches the argv-guard multi-entrypoint precedent (server.ts:159).

**Alternatives considered**: psql hand-edits (error-prone, bypasses hashing/encryption); a recovery web endpoint (recreates the banned bypass door).

## R11. Stage 1 floor (Caddy) — compose mechanics

**Decision**: Ship `docker-compose.override.yml.floor` + `Caddyfile.floor` templates (release assets alongside the existing compose copy). User copies the override into `~/.mayon/` (installer's compose auto-merges override files — no `-f` flags anywhere in install.sh) and edits `Caddyfile.floor` with their domain + bcrypt hash from `docker compose exec caddy caddy hash-password`. The override uses the compose spec `!override` YAML tag to REPLACE web's `ports` with `[]` (removing the host-published 8080 — the trap the card names) and adds `caddy:2` publishing `80:80`/`443:443` with a `Caddyfile` that sets `basic_auth` + `reverse_proxy web:8080` + `flush_interval -1`. Single-entrance check (FR-019): `docker compose port web 8080` errors / `docker compose ps` shows only caddy published. Streaming check (FR-020): run one streaming chat through the floor before trusting it.

**Rationale**: compose `ports` lists merge on override, so un-publishing REQUIRES `!override` (compose ≥ v2.24) — documented as a floor requirement, with the fallback "edit the downloaded docker-compose.yml directly" for podman-compose (whose merge fidelity is weaker; docker engine recommended for the floor). Caddy gives automatic TLS for the domain and battle-tested SSE/chunked passthrough (`flush_interval -1`; nginx in front of `/api/` already disables buffering).

**Alternatives considered**: standalone floor compose file replacing the base (breaks installer's auto-merge flow and `.env` pinning); nginx sidecar (manual TLS/certbot — more upkeep); Traefik (heavier label-based config, less one-evening).

## R12. Restore interplay + operational edges

**Decision**: Gate check order: 401 (auth) → 503 (restoring) → handler — auth never bypasses restore unavailability and vice versa. Restore is `--data-only` so `auth_*` rows ride backups: a restore can resurrect same-day sessions/invites — accepted (sessions die at midnight anyway; worst case ≤ 1 day), with `auth wipe-sessions` as the surgical cleanup. `security.mode` is a settings row, so restoring an old "locked" backup re-locks — CLI `reset-password` covers the stale-owner case. Docs: `docs/dev/seams.qmd` ("server never persists secrets") and `docs/dev/architecture.qmd` ("Non-goals: multi-user") get amendments in the same change set.

**Rationale**: reuses the documented restore semantics without special-casing auth; the mid-restore boot path (pg marked not-ready, boot without `pg` cap) is untouched — auth simply behaves as one more capability in front.

**Alternatives considered**: excluding auth tables from dumps (breaks the no-special-cases restore contract); auto-wiping sessions post-restore (hidden magic; explicit CLI is inspectable).

## R13. Testing strategy

**Decision**: Server tests use the existing `buildApp(...)` + `app.inject()` pattern with a real pglite-backed pool. Suite: (1) **gate sweep** — enumerate every registered route, assert 401-uniform when locked without a session and pass-through when open (SC-001/SC-002; this is the permanent unguarded-endpoint regression test); (2) setup/login/invite lifecycle incl. wrong code, replayed code, generic-error uniformity; (3) rate-limit ladder with injected clock; (4) session day-expiry with injected clock; (5) revocation immediacy incl. live session; (6) restore-503 ordering. Web: auth state store + login UI via existing component test conventions; shared: wire-type compile-time coverage.

**Rationale**: the sweep test converts the characteristic failure mode into a CI-enforced invariant; `BuildAppOptions` already exists as the injection point for clock/mode test doubles.

**Alternatives considered**: e2e-only coverage (slow, misses the structural guarantee); mocking the gate (tests the mock, not the seam).
