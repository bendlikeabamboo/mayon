# Tasks: Secure Public Launch

**Input**: Design documents from `/specs/017-secure-public-launch/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-api.md, contracts/auth-cli.md, contracts/deployment-floor.md, quickstart.md

**Tests**: Included — the project constitution (`.specify/memory/constitution.md` §II) REQUIRES tests for all new `server/src/` and `src/lib/` behavior. Each story phase lists its tests FIRST; write them, watch them fail, then implement.

**Organization**: Tasks are grouped by user story (US1–US7 from spec.md). Implementation note: dispatch work in subgroups of at most 6 tasks per sub-agent (project constraint), using phase boundaries as group seams.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7 per spec.md)
- Exact file paths included in every description

## Path Conventions

This is the existing mayon workspace (web SPA + API server + shared types):

- Server (Node/Fastify): `server/src/` (+ tests colocated `server/src/*.test.ts`)
- SPA (SvelteKit/Svelte 5): `src/` (routes in `src/routes/`, lib in `src/lib/`)
- Shared wire types: `packages/shared/src/`
- Migrations: generated into `drizzle/` via `pnpm db:generate`
- Deployment artifacts: repo root (`docker-compose*.yml`, `Caddyfile.floor`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and shared wire types every story needs.

- [x] T001 Add server dependencies `@node-rs/argon2` and `otplib` (`pnpm --filter @mayon/server add @node-rs/argon2 otplib`), add `@fastify/cookie`, and whitelist `@node-rs/argon2` in `pnpm.onlyBuiltDependencies` in `package.json` (same pattern as better-sqlite3)
- [x] T002 [P] Add web dependency `qrcode` + dev type `@types/qrcode` (`pnpm add qrcode && pnpm add -D @types/qrcode`) in root `package.json`
- [x] T003 Create shared wire types per contracts/auth-api.md in `packages/shared/src/auth.ts` (AuthMode, AuthSessionResponse, LoginRequest/Response, SetupRequest/ConfirmRequest, EnrollResponse, InviteDTO, SessionDTO, AttemptDTO, error literals) and re-export from `packages/shared/src/index.ts`; rebuild shared (`pnpm --filter @mayon/shared build`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, crypto, session, and the central gate hook — NOTHING story-specific. ⚠️ No user story work before this phase is complete.

- [x] T004 Add the three tables to `src/lib/db/schema.ts` exactly per data-model.md: `authIdentities` (auth_identities), `authSessions` (auth_sessions), `authLoginAttempts` (auth_login_attempts) — text-uuid ids, bigint epoch-ms app-set timestamps, text enums with TS unions, real FK on auth_sessions.identity_id, unique `label` / `token_hash`
- [x] T005 Generate the migration with `pnpm db:generate` into `drizzle/` and eyeball the SQL against data-model.md (no hand edits; no SCHEMA_VERSION bump — no data backfill)
- [x] T006 [P] Create `server/src/auth/crypto.ts`: argon2id hash/verify wrappers, `randomToken()` (256-bit base64url), `sha256Hex()`, AES-256-GCM `wrapSecret`/`unwrapSecret` envelope `v1.<iv>.<ct>.<tag>`; unit tests in `server/src/auth/crypto.test.ts`
- [x] T007 [P] Create `server/src/auth/secret-key.ts`: resolve 32-byte key from `MAYON_AUTH_SECRET` env else auto-generate once to the auth key file (path from `BuildAppOptions`, default under server-data) with 0600 perms; unit tests in `server/src/auth/secret-key.test.ts`
- [x] T008 Create `server/src/auth/store.ts` (pool-SQL data access, following the settings-on-server pattern in `server/src/server.ts:120-137`): identity create/find-by-label/set-status/set-totp; session create/find-valid-by-token-hash (checks `revoked_at IS NULL AND expires_at > now`)/revoke-one/revoke-all/delete-by-identity; attempts record/count-recent-failures/prune-older-than-30d
- [x] T009 Create `server/src/auth/gate.ts` and register it as the ONE root `app.addHook('onRequest', …)` in `server/src/server.ts` BEFORE the route plugin (`server/src/server.ts:43`): read `security.mode` (missing ⇒ open), PUBLIC_ALLOWLIST exactly per contracts/auth-api.md, session-cookie lookup via store, uniform `401 {"error":"unauthenticated"}`, Origin check on mutating requests → `403 {"error":"bad origin"}`; register `@fastify/cookie`
- [x] T010 Add auth test hooks to `BuildAppOptions` in `server/src/server.ts`: injectable clock `now()`, auth key path, rate-limit window/ladder overrides — thread through gate/store/service constructors
- [x] T011 Create `server/src/auth/cookies.ts`: set/clear `mayon_session` and short-lived `mayon_enroll` cookies with flags HttpOnly; SameSite=Lax; Path=/; Secure (default on, `MAYON_COOKIE_SECURE=false` escape); Max-Age until next local midnight (helper `nextLocalMidnight(now())`)
- [x] T012 Add idempotent auth boot SQL (index `auth_login_attempts (source, at)`) run at server start next to the FTS bootstrap call in `server/src/server.ts` start() (pattern: `packages/shared/src/fts.ts`)
- [x] T013 Create the open-mode parity half of `server/src/auth-gate.test.ts`: with mode open, every existing endpoint behaves exactly as today (`/api/health` 200 public, `/api/db/query` reaches its handler, existing suites in `server/src/server.test.ts` still green) — the gate must be invisible while open

**Checkpoint**: `pnpm --filter @mayon/server test` green; open mode = today's behavior; gate exists but passes everything through. User story implementation can begin.

---

## Phase 3: User Story 1 — Owner Sets the Lock (First-Run Prompt, Skippable) (Priority: P1) 🎯

**Goal**: Fresh deployment offers one-time security setup (password + authenticator enrollment); skippable — open mode runs as today; completing setup flips to locked.

**Independent Test**: Fresh stack → skip prompt → app identical to today, no re-nag; Settings → Enable → setup → verify live code → locked, setup closed (second setup attempt → 409); wrong confirm code → nothing activated.

### Tests for User Story 1 (write FIRST, must FAIL)

- [x] T014 [US1] Create `server/src/auth-setup.test.ts`: happy path (setup → otpauthUri → confirm live code via injected fixed-step secret → session issued, mode locked, second setup 409); wrong confirm code → 400, no session cookie, mode still open, no active owner; replayed code refused; label/password validation bounds per data-model.md

### Implementation for User Story 1

- [x] T015 [US1] Implement `POST /api/auth/session` (public status payload per contract) in `server/src/auth/index.ts` (new Fastify plugin registered alongside the others in `server/src/server.ts` route plugin)
- [x] T016 [US1] Implement `POST /api/auth/setup` in `server/src/auth/index.ts`: validate label (1–64 chars)/password (8–1024), 409 if active owner exists, argon2id hash, otplib secret generate + GCM-wrap (pending), return otpauthUri (`otpauth://totp/mayon:<label>?…&issuer=mayon`)
- [x] T017 [US1] Implement `POST /api/auth/setup/confirm` in `server/src/auth/index.ts`: verify ±1 step via otplib against decrypted secret, set `mfa_enrolled_at`, set `security.mode = locked` (settings upsert), issue session cookie, atomically close setup
- [x] T018 [P] [US1] Create `src/lib/components/AuthQr.svelte`: render an otpauth URI as a QR (qrcode lib, SVG) with the raw URI shown as fallback text
- [x] T019 [US1] Create `src/lib/auth/client.ts` (typed fetch wrappers for /api/auth/*) and `src/lib/auth/state.svelte.ts` (boot-time auth state: calls POST /api/auth/session, exposes mode/authenticated/setupRequired, refresh() after login/logout)
- [x] T020 [US1] Integrate boot ordering in `src/routes/+layout.svelte`: resolve auth state BEFORE `bootstrapDb()`; when locked+unauthenticated render the login branch (placeholder shell ok) and DO NOT bootstrap db; when setup offered (open, no owner, not dismissed) show setup prompt; remember dismissal in localStorage (`mayon_setup_dismissed`) so the prompt never re-nags (FR-022)
- [x] T021 [US1] Create `src/routes/login/+page.svelte` first-run setup mode: label + password form, AuthQr, confirm-code step, clear error states; shadcn-svelte vocabulary only
- [x] T022 [US1] Add Settings › Security entry (`src/routes/settings/`): mode badge + "Enable security" action (open mode only) launching the same setup flow (reuse T021 component) per FR-024
- [x] T023 [US1] Validate against quickstart.md steps 1–2 manually on `pnpm dev`; run `pnpm check && pnpm lint && pnpm test && pnpm --filter @mayon/server test`

**Checkpoint**: US1 independently functional: skip = today; enable = locked; setup closed after completion.

---

## Phase 4: User Story 2 — The Wall at the Seam (Priority: P1)

**Goal**: Structural, centrally-enforced gate: every route 401s without a session when locked; open mode identical to today; open state visible in-app.

**Independent Test**: credential-less sweep of every registered route (incl. /ws/mcp, /api/llm/proxy): locked ⇒ uniform 401; open ⇒ today's behavior. Session-minted requests pass through with streaming intact.

### Tests for User Story 2 (write FIRST, must FAIL)

- [x] T024 [US2] Extend `server/src/auth-gate.test.ts` with the locked-mode sweep: enumerate every registered route from the built app (incl. GET /ws/mcp upgrade and POST /api/llm/proxy), assert `401 {"error":"unauthenticated"}` identical status+body shape on all non-allowlisted routes; assert the allowlist itself (health public; auth/session, auth/login, auth/setup, auth/setup/confirm, auth/enroll, auth/logout reachable) — SC-001/SC-002 invariant
- [x] T025 [US2] Add with-session pass-through cases to `server/src/auth-gate.test.ts`: mint a session row directly via store + valid cookie → `/api/db/query` reaches handler, `/api/llm/proxy` hijacked streaming still streams (assert chunked body passes), `/ws/mcp` upgrade accepted (existing mcp.test.ts pattern)
- [x] T026 [US2] Add restore-order test to `server/src/auth-gate.test.ts`: set restoring flag (`setRestoring(true)`) → no session ⇒ 401 (not 503); valid session ⇒ 503 `restore in progress`

### Implementation for User Story 2

- [x] T027 [US2] Make sweep green: fix any route that escapes the gate in `server/src/auth/gate.ts` allowlist/hook ordering (root hook BEFORE plugin registration; @fastify/websocket upgrade path included)
- [x] T028 [US2] Enforce no-data-before-auth in the SPA: `src/lib/auth/state.svelte.ts` gate flag consumed in `src/routes/+layout.svelte` so no `repos`/settings calls (which would 401) fire while locked+unauthenticated; BootGate-style locked branch shows the login route only
- [x] T029 [US2] Add mode visibility UI in `src/routes/settings/` security section: persistent **Open** badge + warning banner when open (FR-023 — open state must never look like a broken gate), **Locked** badge otherwise
- [x] T030 [US2] Validate quickstart.md steps 0 and 3 (sweep + curl wall checks); full quality gates

**Checkpoint**: SC-001/SC-002 proven in CI; open/locked visibly distinct in-app.

---

## Phase 5: User Story 3 — Login: Password Plus Six Digits (Priority: P1)

**Goal**: Daily gate experience: password + 6-digit code → same-day session; wrong/replayed halves bounce generically; logout/day-end re-locks.

**Independent Test**: enrolled identity: correct creds open the app; wrong password, wrong code, replayed code each refused with one generic message; session valid rest-of-day; logout (or forced day rollover via injected clock) requires login again.

### Tests for User Story 3 (write FIRST, must FAIL)

- [x] T031 [US3] Create `server/src/auth-login.test.ts`: happy login (session cookie flags per contract, expiresAt = next local midnight); wrong password / wrong code / unknown label → identical `401 {"error":"invalid credentials"}`; replayed timestep refused; logout clears; expired session (clock +1 day) rejected by gate

### Implementation for User Story 3

- [x] T032 [US3] Implement `POST /api/auth/login` + `POST /api/auth/logout` in `server/src/auth/index.ts`: label optional iff exactly one non-revoked identity; argon2 verify; TOTP verify ±1 with `totp_last_step` replay guard; uniform 401 for every failure mode (never reveal which half); session issue via store + cookies helper
- [x] T033 [US3] Add login mode to `src/routes/login/+page.svelte`: label (shown only when >1 active identity — fetch hint from POST /api/auth/session), password, code; generic error display; on success refresh auth state and continue into the app
- [x] T034 [US3] Wire session lifecycle in `src/lib/auth/` : logout action (POST logout → state reset), 401-anywhere handler routes to login, `expiresAt` countdown no-op (day sessions — no renewal logic, per FR-006)
- [x] T035 [US3] Validate quickstart.md steps 2–4 and 6 (login, wall with session, day rollover via tests for the clock part); full quality gates

**Checkpoint**: US1+US3 together = usable daily gate (MVP).

---

## Phase 6: User Story 4 — Guests at the Gate (Invited Access and Revocation) (Priority: P2)

**Goal**: Owner creates invited access (one-time password), invitee enrolls own MFA at first login, owner revokes with immediate effect — all in-app.

**Independent Test**: create invite → invitee logs in on a second profile → enrolls own authenticator → shares the same data; owner revokes → live session dies on next request, logins refused; invitee gets 403 on admin endpoints; no registration path exists.

### Tests for User Story 4 (write FIRST, must FAIL)

- [x] T036 [US4] Create `server/src/auth-invites.test.ts`: owner creates invite (one-time password returned exactly once, stored only as hash); invitee login → `mfa_enrollment_required` + enrollToken (no session); enroll with live code → active + session; owner revokes → invitee's live session 401s immediately, login refused; invitee calling owner-only endpoints → 403; revoked identity cannot be re-enrolled via CLI (contract) — asserted at service level

### Implementation for User Story 4

- [x] T037 [US4] Implement invite + session-admin + visibility endpoints in `server/src/auth/index.ts` per contracts/auth-api.md: `POST/GET/DELETE /api/auth/invites`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-all`, `GET /api/auth/attempts` — owner-only (403 otherwise), one-time password shown once
- [x] T038 [US4] Implement invitee enrollment path: `POST /api/auth/login` returns `{status:"mfa_enrollment_required", enrollToken, otpauthUri}` + 15-min `mayon_enroll` cookie when identity is invited; `POST /api/auth/enroll` confirms code → invited→active + full session (extend T032/T017 code paths)
- [x] T039 [US4] Build Settings › Security admin UI in `src/routes/settings/`: invites tab (create → show-one-time-password dialog, list, revoke), sessions tab (device list, revoke one / revoke all), recent login activity list (attempts) — shadcn-svelte patterns
- [x] T040 [US4] Validate quickstart.md step 5 (two-browser-profile invite flow); full quality gates

**Checkpoint**: SC-005 (revocation in seconds, zero infra changes) demonstrated.

---

## Phase 7: User Story 5 — Brute-Force Resistance (Priority: P2)

**Goal**: Progressive delay + lockout on repeated failed logins; legitimate use never delayed.

**Independent Test**: hammer login with wrong creds: attempts 1–4 instant, 5–9 progressively delayed (2^(n−4)s capped 60), ≥10 → 429 until the oldest failure exits the 10-min window; then correct login succeeds untouched.

### Tests for User Story 5 (write FIRST, must FAIL)

- [x] T041 [US5] Create `server/src/auth-ratelimit.test.ts` with injected clock/window: ladder timing assertions, 429 body `{"error":"too many attempts"}` + retry hint, window clears oldest-first, success path un-delayed, per-IP isolation (two sources don't lock each other)

### Implementation for User Story 5

- [x] T042 [US5] Create `server/src/auth/ratelimit.ts` implementing research R7 policy over `store.countRecentFailures` (window 10 min default, ladder `min(2^(failures−4), 60)`s delay, ≥10 ⇒ refuse until window clears); wire into the login endpoint (delay before response on 5–9; record EVERY attempt outcome incl. success via store; opportunistic 30-day prune on write)
- [x] T043 [US5] Surface owner visibility: `GET /api/auth/attempts` already exposes outcomes (T037) — verify rate-limited/refused attempts are recorded with outcome `bad_password`/`bad_code`/`unknown_identity` and appear in Settings recent activity
- [x] T044 [US5] Validate quickstart.md step 4; full quality gates (SC-004 demonstrated)

**Checkpoint**: password half is no longer brute-forceable; SC-004 green.

---

## Phase 8: User Story 6 — Stopgap Floor: Proxy Front Door (Priority: P2)

**Goal**: Optional deployment-level Caddy basic-auth + TLS floor with verifiable single entrance and streaming passthrough; removable once the gate is proven.

**Independent Test**: deployment-level per contracts/deployment-floor.md — without proxy credentials nothing loads; app's own port unpublished (`docker compose port web 8080` errors); streaming chat verified through the proxy; deleting the override restores base compose.

- [x] T045 [US6] Create `docker-compose.override.yml.floor` and `Caddyfile.floor` at repo root exactly per contracts/deployment-floor.md (`!override` empty ports on web; caddy:2 publishing 80/443; basic_auth env-interpolated from `.env`; `flush_interval -1`)
- [x] T046 [US6] Extend the release-assets job in `.github/workflows/docker-publish.yml` to attach both floor templates to every release (assert file presence alongside the existing install.sh/compose asserts)
- [x] T047 [P] [US6] Document the floor in `README.md` (section "Launching publicly (stopgap floor)"): activation steps, single-entrance checks, streaming check, removal, caveats (compose ≥ v2.24 for `!override`; docker engine recommended) per contract
- [x] T048 [US6] Validate the floor locally on a throwaway compose project: confirm `!override` un-publishes web's port, browser-level basic-auth prompt appears, `/api/llm/proxy` streaming passes through unbuffered (plain-HTTP local Caddyfile variant; document results in the PR)

**Checkpoint**: floor deployable in one evening; removal path documented; base stack unaffected when the override is absent.

---

## Phase 9: User Story 7 — Breaking Glass (Recovery) (Priority: P3)

**Goal**: Server-side CLI recovery: password reset + MFA re-enrollment without the old device; no in-app bypass exists anywhere.

**Independent Test**: with no access to the enrolled authenticator: `reenroll-mfa` prints a fresh otpauth URI, `reset-password` sets a new password, next login = new password + new code; no MFA-less path created.

- [x] T049 [US7] Create `server/src/auth/cli.ts` (second tsup entry): commands `status`, `reset-password --label`, `reenroll-mfa --label`, `wipe-sessions`, `rotate-secret` (fail-closed re-wrap), `set-mode --mode open|locked` per contracts/auth-cli.md; hidden stdin prompt for passwords; exit codes 0/1/2; add `"auth"` script to `server/package.json` and the second entry to `server/tsup.config.ts` (outputs `dist/auth-cli.js`); confirm the prod `server/Dockerfile` ships it
- [x] T050 [US7] Create `server/src/auth-cli.test.ts`: reset-password → next login uses new password + valid code (never codeless); reenroll-mfa invalidates the old secret (old code refused, new accepted); wipe-sessions revokes all; rotate-secret refuses to write when any row fails to decrypt; revoked identity refused (exit 1)
- [x] T051 [US7] Validate SC-007 manually (timer the flow < 15 min) and add CLI usage lines to `README.md` security section; full quality gates

**Checkpoint**: recovery path real, MFA-bypass-free (FR-016/FR-017).

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Constitution-required docs, hardening, end-to-end validation.

- [x] T052 [P] Amend `docs/dev/seams.qmd` (secret-boundary rule: credential VERIFIERS now live in dedicated `auth_*` tables; TOTP secrets GCM-wrapped under a key outside Postgres; settings stays secret-free) and `docs/dev/architecture.qmd` (non-goals update: owner + invited identities behind one gate, no multi-user isolation; add the three auth tables to the catalog) — constitution-required doc amendment
- [x] T053 Security hardening pass: audit every mutation endpoint for the Origin check, verify uniform-401/no-oracle messaging everywhere (`rg` for divergent error bodies in `server/src/auth/`), confirm timing-safe token comparison (`crypto.timingSafeEqual`) in session lookup, confirm cookie flags on both cookies in a live dev run
- [x] T054 Run the FULL `quickstart.md` top-to-bottom on `pnpm dev` (steps 0–8) and record results; run all merge gates: `pnpm check && pnpm lint && pnpm test && pnpm --filter @mayon/server test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately (T001/T002 parallel; T003 independent)
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories (gate hook + schema + crypto are prerequisites for every story)
- **US1 (Phase 3)**: after Foundational — first story; flips mode to locked for the first time
- **US2 (Phase 4)**: after US1 (needs locked mode to exist); its sweep test is the CI invariant
- **US3 (Phase 5)**: after US1 (needs an enrolled identity to log in); US2 and US3 can proceed in parallel once US1 lands
- **US4 (Phase 6)**: after US3 (invite enrollment rides the login endpoint)
- **US5 (Phase 7)**: after US3 (wraps the login endpoint)
- **US6 (Phase 8)**: independent of app code (pure deployment artifacts) — can run in parallel with any phase after Setup; do not remove the floor until the gate (US1–US3) is proven in daily use
- **US7 (Phase 9)**: after Foundational (uses store/crypto); independent of US4–US6
- **Polish (Phase 10)**: after all desired stories

### Cross-story notes

- US2's "with-session" tests mint sessions via the store directly (T025) — no dependency on US3's login endpoint.
- US4/US5 both touch `server/src/auth/index.ts` (login endpoint) — sequence them (US4 → US5) rather than parallel-editing the same file.
- Dispatch implementation in subgroups of ≤6 tasks per sub-agent (project constraint), using phase seams.

### Parallel Opportunities

- Phase 1: T001 ∥ T002, T003 anytime
- Phase 2: T006 ∥ T007 (different files); the rest sequential (schema → migration → store → gate)
- Phase 3: T018 ∥ (T015–T017 server work); T019/T020 sequential after T015–T017 exist
- Phase 6/7/8/9: US6 entirely parallel to US4/US5/US7 phases (different files, deployment-only)
- T052 independent of T053–T054

---

## Implementation Strategy

### MVP First

1. Phase 1 + Phase 2 (foundation: gate exists, open = today)
2. Phase 3 (US1: setup + skip) → validate
3. Phase 4 (US2: sweep proves the wall in CI) and Phase 5 (US3: login) → **the gate is now daily-usable**
4. STOP: this is the MVP — a lock the owner can choose, with the unguarded-endpoint failure mode structurally impossible

### Incremental Delivery

- +US4 (invites/revocation) → the "hand a friend credentials" story works
- +US5 (rate limiting) → brute-force class closed
- +US6 floor → public launch possible TODAY on the stopgap, in parallel with everything above
- +US7 CLI → long-term ownership safety
- Polish → docs amendments + hardening + full quickstart sign-off

### Verification loop per story

Tests first (fail) → implement → story checkpoint → quickstart step(s) → `pnpm check && pnpm lint && pnpm test && pnpm --filter @mayon/server test`.

## Notes

- [P] = different files, no dependencies on incomplete tasks
- [Story] labels map to spec.md US1–US7 for traceability
- Contract authority: `specs/017-secure-public-launch/contracts/` — if implementation and contract disagree, fix the implementation or amend the contract explicitly
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
