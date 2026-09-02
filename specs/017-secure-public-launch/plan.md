# Implementation Plan: Secure Public Launch

**Branch**: `017-secure-public-launch` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-secure-public-launch/spec.md`

## Summary

Make mayon safe to expose publicly via an opt-in security gate (password + TOTP MFA, same-day sessions) enforced centrally at the server's Fastify API seam, plus a deployment-level Caddy basic-auth "floor" as the launch-time stopgap. Default posture stays open (skippable first-run prompt); when locked, every server capability refuses unauthenticated requests uniformly, with no way to register a new ungated route. Owner + hand-created invitee identities share the one dataset; revocation, login-attempt rate limiting, CLI-only recovery, and credential storage (argon2id hashes, AES-256-GCM-wrapped TOTP secrets under a key held outside Postgres) round out the gate.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10 workspaces; SvelteKit (Svelte 5 runes) SPA via `@sveltejs/adapter-static` (no SSR) for web; tsup-built ESM for server + `@mayon/shared`.

**Primary Dependencies**: Fastify 5 + `@fastify/websocket` (server HTTP), drizzle-orm + `pg` (Postgres 17), `better-sqlite3` (sandbox), Tailwind v4 + shadcn-svelte/bits-ui (UI). NEW (research.md): `@node-rs/argon2` (argon2id hashing), `otplib` (TOTP verify + otpauth URI), `qrcode` (client-side QR render), Node built-ins `node:crypto` (AES-256-GCM, SHA-256, random tokens — no new crypto deps).

**Storage**: Postgres 17 (primary, behind the existing `StorageDriver` seam; migrations via `pnpm db:generate` applied at server boot). Three new tables + one `settings` key; no changes to existing tables. TOTP encryption key lives OUTSIDE Postgres (`MAYON_AUTH_SECRET` env or auto-generated file on the `server-data` volume).

**Testing**: Vitest — `pnpm test` (web+shared, pglite driver) and `pnpm --filter @mayon/server test` (server: `buildApp()` + `app.inject()` pattern, real pglite-backed pool). New: gate-sweep test (every route 401 without a session when locked), auth flow tests with injected clock.

**Target Platform**: Linux Docker (prod: `ghcr.io/bendlikeabamboo/mayon` web on :8080 → nginx proxies `/api/*`+`/ws/*` to internal `server:4319`; dev: `pnpm dev` stack, Vite :5173). Floor stage adds a Caddy sidecar published on 80/443 with web's host port removed.

**Project Type**: Web application (SPA + API server + shared wire-types package) + deployment compose artifacts.

**Performance Goals**: Login (password argon2id verify + TOTP check) completes in well under 1s; LLM streaming through gate and through floor proxy is visually indistinguishable from direct (SC-008); credential-less sweep shows 100% refusal (SC-001/SC-002).

**Constraints**: Same-day session expiry (calendar day, server-local; SC-011); no password-only mode (FR-003); no self-service reset (FR-016); settings table stays secret-free (constitution I) — credentials live in dedicated tables; `/api/health` must remain public or SPA boot/detectServer breaks; gate hook must reject before Fastify reply hijack so streaming stays intact; restore-mode 503 semantics unchanged (auth check precedes restore check — 401 wins).

**Scale/Scope**: Single deployment, one owner + a handful of invitees, one shared dataset. ~8 new API endpoints, 1 WebSocket gate integration, 2 SPA routes (login, security settings section), 1 server CLI entry, 1 optional compose override + Caddyfile.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Layering: repos only | SPA touches auth via a service (`src/lib/auth/`) calling `/api/auth/*`; server-side auth data access follows the existing server pattern (direct pool SQL in `server/src/`, like settings/pg-backup today); no component imports `db`. Auth tables are never exposed through browser repos. | PASS |
| I. No secrets in settings | `settings` table untouched by secrets: `security.mode` is non-secret state; password hashes + encrypted TOTP secrets live in new dedicated `auth_*` tables; TOTP key lives in env/volume file, outside DB. | PASS |
| I. Toolchain pins | Node 22 / pnpm 10 respected; `@node-rs/argon2` ships musl prebuilds (alpine image OK) and must be added to `pnpm.onlyBuiltDependencies` like `better-sqlite3`. | PASS |
| II. Testing standards | Gate sweep + login/setup/invite/rate-limit/session-expiry tests in `server/src/*.test.ts` (inject pattern); shared type tests; regression test requirement honored (sweep test IS the unguarded-endpoint regression guard). | PASS |
| III. UX consistency | Login/setup/invite/session UI composed from existing Tailwind v4 + shadcn-svelte vocabulary; third BootGate-style branch in `+layout.svelte` mirrors existing patterns; progressive capability model preserved (`/api/health` unchanged, gate sits in front of capabilities, not inside them). | PASS |
| III. No downtime/restart for user ops | Enable/disable security, invites, revocation, rotation are in-app, no server restart; CLI recovery runs in-place in the server container. | PASS |
| IV. Performance | No synchronous reindex/FTS impact; auth adds one indexed table lookup per request (per-identity + session lookup by token hash); bundle growth limited to `qrcode` (~justified in research.md); perf probe not implicated (no render-hot paths changed). | PASS |
| IV. Restore atomicity | Restore flow untouched; auth check ordered before restoring-503; note: restored backups may resurrect same-day session/identity rows — accepted + documented (data-model.md), CLI wipe available. | PASS |
| Quality gates: migrations | New tables via `pnpm db:generate` only; no data migration needed (no backfills), so `SCHEMA_VERSION` stays 2. | PASS |
| Docs seam amendment | `docs/dev/seams.qmd` ("server never persists secrets") and `docs/dev/architecture.qmd` ("Non-goals: Multi-user") must be updated in the same change set — this is a documentation amendment of the as-is design, tracked as explicit tasks. | PASS (with mandatory doc tasks) |

## Project Structure

### Documentation (this feature)

```text
specs/017-secure-public-launch/
├── plan.md              # This file
├── research.md          # Phase 0 output: decisions + rationale
├── data-model.md        # Phase 1 output: auth tables, state machines
├── quickstart.md        # Phase 1 output: end-to-end validation guide
├── contracts/
│   ├── auth-api.md      # HTTP contract: gate semantics + /api/auth/* endpoints
│   ├── auth-cli.md      # Server-side CLI contract (recovery)
│   └── deployment-floor.md  # Stage 1 Caddy floor: compose override + checks
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
server/src/
├── server.ts                  # buildApp(): ADD root onRequest gate hook (single seam)
├── auth/
│   ├── index.ts               # registerAuth() Fastify plugin: /api/auth/* routes
│   ├── gate.ts                # central hook: mode check, session verify, allowlist
│   ├── service.ts             # login/setup/invite/session logic (argon2id, otplib, GCM)
│   ├── ratelimit.ts           # attempt-window policy from auth_login_attempts
│   ├── crypto.ts              # hash/verify, token mint+hash, AES-256-GCM wrap/unwrap
│   ├── secret-key.ts          # MAYON_AUTH_SECRET env OR server-data key file (outside DB)
│   └── cli.ts                 # second tsup entry: recovery CLI (status/reset-password/reenroll-mfa)
├── auth.test.ts, auth-gate.test.ts, auth-ratelimit.test.ts   # sweep + flows (inject)
└── (existing register* plugins untouched)

src/
├── routes/login/+page.svelte          # login + first-run setup + invite enrollment UI
├── lib/auth/
│   ├── state.svelte.ts                # boot-time auth state (mode, session), calls /api/auth/session
│   └── client.ts                      # fetch wrappers for /api/auth/*
├── routes/settings/                   # security section: mode toggle, invites, sessions
├── lib/components/AuthQr.svelte       # otpauth URI → QR (qrcode lib)
└── routes/+layout.svelte              # boot order: auth state BEFORE bootstrapDb; login branch

packages/shared/src/auth.ts            # wire types: AuthSessionResponse, LoginRequest/Response, ...
drizzle/                               # generated migration for auth tables (pnpm db:generate)

docker-compose.override.yml.floor + Caddyfile.floor  # Stage 1 floor template (release asset candidate)
```

**Structure Decision**: Existing three-workspace layout (web SPA `src/`, API `server/src/`, wire types `packages/shared/src/`) is kept; auth is a new server plugin + new SPA module, not a new app. The gate is ONE `onRequest` hook registered in `buildApp()` before any `register*()` plugin (server/src/server.ts:43-89), with an explicit public allowlist (`/api/health`, `/api/auth/session`, `/api/auth/setup*`, `/api/auth/login`, `/api/auth/enroll`) — everything else, existing or future, requires a valid session by default (FR-001, SC-002).

**Post-design re-check (after Phase 1)**: PASS — the designed contracts/data model introduce no violations beyond the already-tracked doc amendments: gate hook precedes reply hijack (streaming safe), session lookup is one indexed query, `settings` gains only the non-secret `security.mode` key, credentials live in dedicated `auth_*` tables with keys outside Postgres, and the sweep test enforces the structural gate in CI.

## Complexity Tracking

> No constitution violations to justify. The only flagged item — amending `docs/dev/seams.qmd`/`architecture.qmd` for server-persisted credential verifiers and the owner+invitee model — is executed as documentation tasks inside the feature, not a deviation from the constitution itself (the `settings` table remains secret-free).
