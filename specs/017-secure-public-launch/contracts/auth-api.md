# Contract: Auth HTTP API (`/api/auth/*` + gate semantics)

Wire types live in `packages/shared/src/auth.ts` (re-exported from `packages/shared/src/index.ts`), following the `protocol.ts` precedent. All bodies are JSON; all errors are `{"error": string}` with uniform, non-oracular messages.

## Gate semantics (apply to every server route, present and future)

- Enforcement: ONE Fastify `onRequest` hook registered in `buildApp()` before route plugins (server/src/server.ts:43). No route may opt out except via the PUBLIC_ALLOWLIST below.
- When `security.mode = "open"`: no check, behavior identical to today (FR-022).
- When `"locked"`: every route NOT in the allowlist requires a valid session cookie, else `401 {"error":"unauthenticated"}` — identical body/status for every route, including WebSocket upgrade of `/ws/mcp` (rejected before upgrade) and streaming `/api/llm/proxy` (rejected before the handler hijacks the reply).
- Check order: `401 unauthenticated` → `503 restore in progress` (existing) → handler. A valid session never bypasses the restoring 503.
- Public allowlist (locked mode): `GET /api/health`; `POST /api/auth/session`; `POST /api/auth/login`; `POST /api/auth/setup`; `POST /api/auth/setup/confirm`; `POST /api/auth/enroll`; `POST /api/auth/logout`.
- Sessions ride the `mayon_session` cookie (HttpOnly; SameSite=Lax; Path=/; Secure default, `MAYON_COOKIE_SECURE=false` escape hatch; Max-Age = seconds until local midnight). Same-origin `fetch` needs no changes. Mutating requests must carry `Origin` matching the host (CSRF backstop) — mismatches get `403 {"error":"bad origin"}`.

## Endpoints

### `POST /api/auth/session` (public; no side effects)

Boot-time status for the SPA gate. Request: `{}`.
Response `200`:
```json
{ "mode": "open" | "locked",
  "setupRequired": boolean,          // locked-pending or open-with-no-identities offering setup
  "authenticated": boolean,
  "identity": { "label": string, "role": "owner"|"invitee" } | null,
  "session": { "expiresAt": number } | null }
```
`setupRequired` is `true` only while setup is being offered (open mode, no active owner) or mid-enrollment — it never re-arms after skip (skip is client-side UX memory; the server simply stops advertising setup once an owner exists).

### `POST /api/auth/setup` (public while setup is open; refused with `409 {"error":"setup closed"}` once an active owner exists — FR-004)

Request: `{ "label": string, "password": string }`.
Behavior: creates the owner identity (`role:"owner"`, `status:"active"` semantics pending MFA), generates + encrypts a TOTP secret (pending until confirmed).
Response `200`: `{ "otpauthUri": "otpauth://totp/mayon:<label>?secret=…&issuer=mayon" }` — SPA renders the QR.
Errors: `400` validation (label/password rules), `409` setup closed. A wrong path never leaves a usable owner: the row stays MFA-less until confirm.

### `POST /api/auth/setup/confirm` (public while the pending owner enrollment is open)

Request: `{ "code": "123456" }`.
Behavior: verifies one live code (±1 step window); on success sets `mfa_enrolled_at`, sets `security.mode = "locked"`, issues a session cookie. Setup is permanently closed (FR-004).
Response `200`: `{ "authenticated": true, "identity": {...}, "session": { "expiresAt": ... } }`
Errors: `400 {"error":"invalid code"}` (generic; wrong/replayed indistinguishable) — nothing activated.

### `POST /api/auth/login` (public; rate-limited per research R7)

Request: `{ "label"?: string, "password": string, "code": string }` — `label` optional iff exactly one non-revoked identity exists.
Responses:
- Active identity, code valid → `200 { "authenticated": true, "identity": {...}, "session": {"expiresAt": ...} }` + cookie.
- Invitee with no MFA yet → `200 { "status": "mfa_enrollment_required", "enrollToken": "<opaque>", "otpauthUri": "..." }` + short-lived (15 min) `mayon_enroll` HttpOnly cookie. Note: no session is issued, and `code` may be omitted in this case.
Errors (ALL map to `401 {"error":"invalid credentials"}` — never reveal which half failed or whether the label exists, FR-014):
- unknown label / bad password / bad/replayed code / revoked identity.
- `429 {"error":"too many attempts"}` when the source is locked out (retry-after in response body, seconds).
- `400` malformed input (same generic shape as 401 messaging rules allow).

### `POST /api/auth/enroll` (public; requires `mayon_enroll` cookie)

Request: `{ "code": "123456" }`.
Behavior: confirms the invitee's MFA enrollment → identity `invited → active`, enroll cookie cleared, full session issued. Brute-force cap: 5 failed codes consume the enrollment — the entry is deleted and the response is `401 {"error":"enrollment expired"}` (same body as expiry — no new oracle).
Errors: `401 {"error":"enrollment expired"}` (no/old cookie, consumed entry, or revoked identity), `400 {"error":"invalid code"}` (retryable while attempts remain).

### `POST /api/auth/logout` (session optional)

Revokes the caller's session, clears the cookie. Always `204`.

### `POST /api/auth/mode` (session; owner only)

Request: `{ "mode": "open", "password": string }` — disabling requires password re-entry.
Behavior: sets `security.mode = "open"`, revokes ALL sessions (no session survives a mode change). Re-enabling later runs `/api/auth/setup` only if no active owner exists; otherwise the settings toggle locks directly via:
`{ "mode": "locked" }` → `security.mode = "locked"` with NO revocation (owner stays signed in; any open-mode sessions were gate-inert anyway).
Responses: `200 { "mode": "open" | "locked" }`; locking without an active owner → `409 {"error":"setup closed"}` (the required action is to run setup). Password failures on disable return `401 {"error":"invalid credentials"}` and burn a dummy argon2 verify (no oracle).

### Invites (session; owner only; 403 for invitees)

- `POST /api/auth/invites` `{ "label": string }` → `201 { "id": "...", "oneTimePassword": "..." }` — password shown exactly once (never stored in plaintext; argon2id hash only).
- `GET /api/auth/invites` → `200 { "invites": [{ "id", "label", "createdAt", "status" }] }`
- `DELETE /api/auth/invites/:id` → `204`; identity → `revoked`, all its sessions deleted (immediate, SC-005).

### Sessions (session; owner sees all, invitee sees own)

- `GET /api/auth/sessions` → `200 { "sessions": [{ "id", "identityLabel", "label", "createdAt", "expiresAt", "lastSeenAt", "current": boolean }] }`
- `DELETE /api/auth/sessions/:id` → `204` (owner: any; invitee: own only)
- `POST /api/auth/sessions/revoke-all` → `204`; revokes every session in the deployment, including the caller's.

### Login attempt visibility (FR-015)

- `GET /api/auth/attempts?limit=50` (session; owner only) → `200 { "attempts": [{ "identityLabel", "source", "outcome", "at" }] }` — surfaced in Settings › Security ("recent login activity").

## Status-code summary (uniform refusal, SC-001)

`401` unauthenticated/invalid credentials — one body shape everywhere; `403` forbidden (role/origin); `429` rate-limited; `409` invalid state transitions; `400` malformed input; `503` restore in progress (unchanged, post-auth).
