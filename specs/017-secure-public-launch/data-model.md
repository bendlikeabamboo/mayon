# Phase 1 Data Model: Secure Public Launch

All conventions follow `src/lib/db/schema.ts` (authoritative header): text UUID ids (`crypto.randomUUID()`), epoch-ms `bigint({mode:'number'})` timestamps set by the app layer, JSON-in-`text`, `text` enums with TS unions, real `.references()` FKs. New tables are generated via `pnpm db:generate`; **no data migration / `SCHEMA_VERSION` bump needed** (no backfills).

## Entities

### `auth_identities` — drizzle export `authIdentities`

An access principal: the owner or an invited person (FR-008). All identities share the single dataset; roles exist only for gate administration.

| Column | Type | Rules |
|--------|------|-------|
| `id` | `text` PK | uuid |
| `label` | `text` NOT NULL **UNIQUE** | human handle, shown in login + session lists; immutable after creation |
| `role` | `text` NOT NULL, enum `('owner','invitee')` | exactly one `owner` may exist (enforced in service logic during setup) |
| `status` | `text` NOT NULL, enum `('invited','active','revoked')` | see state machine below |
| `password_hash` | `text` NOT NULL | argon2id encoded hash (salt + params embedded) — FR-011 |
| `totp_secret_enc` | `text` (nullable) | AES-256-GCM envelope `v1.<iv-b64>.<ciphertext-b64>.<tag-b64>` under the outside-DB key — FR-012. NULL while `invited` (MFA not yet enrolled) |
| `totp_last_step` | `bigint mode:number` (nullable) | last accepted TOTP timestep; replay guard (FR-014). NULL until first successful code |
| `mfa_enrolled_at` | `bigint mode:number` (nullable) | set when a live code first confirms |
| `created_at` / `updated_at` | `bigint mode:number` NOT NULL | app-set epoch-ms |

Indexes: unique on `label`; index on `status` (login path filters active/invited).

Validation rules: password ≥ 8 chars and ≤ 1024 chars (checked pre-hash; upper bound prevents DoS-by-hash); label 1–64 chars, trimmed; code is exactly 6 digits server-side (trimmed input, generic error otherwise).

### `auth_sessions` — drizzle export `authSessions`

A granted, bounded authorization (FR-005/006/007). Token itself is NEVER stored — only its SHA-256.

| Column | Type | Rules |
|--------|------|-------|
| `id` | `text` PK | uuid |
| `identity_id` | `text` NOT NULL → `auth_identities.id` | FK |
| `token_hash` | `text` NOT NULL **UNIQUE** | hex SHA-256 of the cookie token |
| `created_at` | `bigint mode:number` NOT NULL | |
| `expires_at` | `bigint mode:number` NOT NULL | next local midnight after login (same-day rule, FR-006); lazy-checked per request |
| `revoked_at` | `bigint mode:number` (nullable) | set by logout/invite-revocation/revoke-all — checked per request (immediate effect, FR-007) |
| `label` | `text` (nullable) | device/session label for visibility (user-agent summary) |
| `last_seen_at` | `bigint mode:number` (nullable) | throttled update for the session list UI |

Validity predicate: `revoked_at IS NULL AND expires_at > now()`.

Indexes: unique `token_hash` (the per-request lookup); index `identity_id`.

### `auth_login_attempts` — drizzle export `authLoginAttempts`

Append-only attempt log feeding rate limiting (FR-013) and attack visibility (FR-015).

| Column | Type | Rules |
|--------|------|-------|
| `id` | `text` PK | uuid |
| `identity_label` | `text` (nullable) | as submitted (may not exist — never surface existence) |
| `source` | `text` NOT NULL | client IP (as seen behind nginx/floor proxy) |
| `outcome` | `text` NOT NULL, enum `('success','bad_password','bad_code','unknown_identity')` | internal only — client gets one uniform failure |
| `at` | `bigint mode:number` NOT NULL | epoch-ms |

Retention: rows older than 30 days pruned opportunistically on write (keeps the table bounded; keeps 10-min windows and owner visibility intact).

Index: `(source, at)` — created out-of-band in the FTS-bootstrap-style idempotent boot SQL (repo convention: no secondary drizzle indexes).

### `settings` (existing table — one new key)

| Key | Value (JSON string) | Meaning |
|-----|---------------------|---------|
| `security.mode` | `"open"` \| `"locked"` | gate posture (FR-022/023). Non-secret state; default `"open"` seeded lazily. Never holds credentials (constitution I) |

### Outside-DB key material (not a table)

- `MAYON_AUTH_SECRET` env (preferred when provided) **or** `/data/auth-secret` file on the `server-data` volume (auto-generated 32 random bytes, base64, chmod 600, created on first enable). Normalized to a 32-byte AES key via SHA-256. Postgres never sees it (FR-012, research R5).

## State machines

### Identity

```text
              owner: setup(password + live code confirms)
   [no row] ─────────────────────────────────────────────▶ ACTIVE
              invitee: owner creates invite (one-time password)
   [no row] ─────────────────────────────────────────────▶ INVITED
   INVITED ── login(password ok) + own MFA enrollment confirmed ──▶ ACTIVE
   ACTIVE  ── owner revokes ──▶ REVOKED      (sessions deleted; login refused)
   REVOKED ── terminal (no un-revoke; issue a fresh invite instead)
```

Setup atomicity: the pending enrollment state (encrypted secret, not yet `mfa_enrolled_at`) lives only on the would-be owner/invitee row; a wrong confirming code leaves `status` unchanged (`invited`/row-absent) and never issues a session.

### Session

```text
   [no row] ── login ok (locked mode) ──▶ ACTIVE(until local midnight)
   ACTIVE ── logout            ──▶ REVOKED
   ACTIVE ── revoke (single / all / identity revocation) ──▶ REVOKED (immediate)
   ACTIVE ── expires_at < now  ──▶ EXPIRED (lazy; row pruned opportunistically)
```

### Security mode

```text
   OPEN ── setup completes (password + live code, owner created) ──▶ LOCKED
   OPEN ── owner skips prompt ──▶ OPEN (stays; no nagging; enable via settings toggle later)
   LOCKED ── owner disables (session + password re-entry) ──▶ OPEN (identities/sessions wiped? NO —
            identities retained; sessions revoked; re-enabling runs setup only if no active owner,
            otherwise locked directly by existing credentials)
```

Disabling retains identities so a flip back doesn't force re-enrollment; sessions are revoked on disable (no session survives a mode change).

## Relationships

- `auth_sessions.identity_id → auth_identities.id` (1:N — concurrent devices allowed per identity).
- `auth_login_attempts` stands alone (denormalized `identity_label`; attempts for unknown labels recorded).
- No FK relationship to any existing content table — the gate is orthogonal to the dataset (FR-010).

## Restore/backup implications

`--data-only` pg_dump captures all `auth_*` rows: restores may resurrect same-day sessions and previously-revoked identities (accepted; ≤ 1 day session exposure; CLI `wipe-sessions`/`reset-password` for surgical fixes — research R12). `security.mode` rides `settings`.

## Derived rules to test (traceability)

- SC-001/SC-002: sweep = for every registered route: locked+no-session ⇒ 401 uniform; open ⇒ today's behavior.
- SC-006: DB dump alone yields no password (argon2id) and no TOTP secret (GCM w/ external key) and no usable session token (hash-only).
- SC-011: `expires_at` strictly < next local midnight for every session created during a day.
- SC-005: revocation effect = `revoked_at` set + sessions deleted ⇒ next request 401 within one round-trip.
