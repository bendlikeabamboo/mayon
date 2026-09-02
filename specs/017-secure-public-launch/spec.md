# Feature Specification: Secure Public Launch

**Feature Branch**: `secure-public-launch`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Launch mayon on the public internet, gated so only the owner (and explicitly invited people) can reach the app and its APIs. Chosen path per ideas/002-secure-public-launch verdict (2026-09-01): Stage 1 — a reverse-proxy front door with basic auth over TLS as the stopgap floor; Stage 2 (this feature's core) — password + TOTP MFA built into the app, with every server API requiring a valid session. Reference artifacts: ideas/002-secure-public-launch/cards/password-mfa-gate.md (winner), ideas/002-secure-public-launch/cards/proxy-basic-auth.md (on-ramp), ideas/002-secure-public-launch/decisions.md (verdict)." (Full verbatim input retained in the triggering conversation.)

## Clarifications

### Session 2026-09-01

- Q: Is the security gate mandatory or optional? → A: Optional — the first run prompts for setup but it is skippable; security is opt-in ("security is optional is what i want").
- Q: Once skipped or off, how is security turned back on without a stranger enabling it first on a public URL? → A: Free toggle in app settings (Option A) — the hostile-takeover risk is explicitly accepted; the owner's server-side CLI recovery is the backstop if a stranger flips it first.
- Q: When enabled, is MFA always required or does a password-only mode exist? → A: Always password + 6-digit code (Option A); no password-only mode.
- Q: How long does a login session last before re-login is required? → A: Until the end of the day — no re-login within the same day; using the app on a later day requires logging in again.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner Sets the Lock (First-Run Prompt, Skippable) (Priority: P1)

On the first visit to a fresh deployment, the app offers a one-time security setup: choose a password and enroll an authenticator app by scanning a code and confirming a working six-digit code. The owner may complete it — or skip it and keep using the app exactly as today, open and ungated. Setup is never forced: if skipped, the app runs fully functional with the security mode "open", and the same one-time setup can be completed later through an explicit owner action whenever they choose to lock down.

**Why this priority**: The prompt is the entry point to the entire gate, and its skippability is the owner's explicit ruling (2026-09-01): security is opt-in.

**Independent Test**: Can be fully tested on a fresh deployment: skip the prompt and verify the app is fully usable with no gate; later complete setup and verify the gate activates; wrong confirming code leaves no half-activated state.

**Acceptance Scenarios**:

1. **Given** a fresh deployment, **When** the owner visits, **Then** the app offers the security setup once and presents a clear way to skip it.
2. **Given** the owner skips the setup, **When** the app is used, **Then** every capability works exactly as today with no login screen, no nagging re-prompt on later visits, and no auth UI anywhere.
3. **Given** the setup is completed (password plus verifying one live code), **When** the next visit occurs, **Then** the app requires login and the setup flow is closed (re-openable only by turning security off and on again through the owner's explicit action).
4. **Given** the owner is mid-enrollment, **When** the confirming code is entered incorrectly, **Then** activation fails with a clear message and no half-activated state is left behind.

---

### User Story 2 - The Wall at the Seam (Priority: P1)

When security is enabled, every server-provided capability — data reads and writes, AI-provider proxying, backups, sandbox, tool execution — refuses any request that does not carry a valid session. A stranger hitting the URL may load the static shell, but it contains no data and can do nothing: the wall lives entirely at the server seam, and it is structural. There is no way to expose a server capability without the gate; a new capability added later is gated by default. When security is disabled (open mode), server capabilities behave exactly as they do today — and that openness is an explicit, visible owner choice, never an accident or a forgotten default.

**Why this priority**: This is the actual security property being purchased — and, in open mode, the honest statement of what "security optional" means. The deck's characteristic failure mode is one unguarded endpoint silently serving strangers — so enforcement must be centralized at the boundary, not left to per-route discipline.

**Independent Test**: Can be fully tested by sweeping every server capability without credentials in both modes: security off → all behave as today; security on → all refuse uniformly without a session and all work with one.

**Acceptance Scenarios**:

1. **Given** security is enabled and no valid session exists, **When** any server capability is requested, **Then** it refuses with one uniform "unauthenticated" outcome — no capability-dependent exceptions.
2. **Given** security is enabled and no valid session exists, **When** the site URL is loaded, **Then** the static shell renders but contains no user data and cannot perform any action.
3. **Given** security is disabled, **When** the app and its capabilities are used, **Then** everything behaves exactly as it does today (open), and the app makes the open state visible to the owner.
4. **Given** a server capability is added later, **When** it is deployed with security enabled, **Then** it is unreachable without a session by default — exposing it without the gate requires deliberately dismantling the gate itself.
5. **Given** a valid session (security enabled), **When** the app is used normally, **Then** all existing behavior (chat, editing, search, backup, tools) works as it does today.

---

### User Story 3 - Login: Password Plus Six Digits (Priority: P1)

When security is enabled, every visit begins at the login screen. The owner enters their password and the current six-digit code from their authenticator; on success a session is granted and mayon opens exactly as it does today. Wrong password, wrong code, or a reused code bounces. Ending a session (logout, expiry, revocation) returns the app to the locked state.

**Why this priority**: This is the daily experience of the gate — it must be airtight yet low-friction for the owner.

**Independent Test**: Can be fully tested with an enrolled identity while security is enabled: correct credentials open the app; each wrong half is refused; logout/expiry re-locks.

**Acceptance Scenarios**:

1. **Given** security is enabled and an enrolled identity exists, **When** the correct password and current code are submitted, **Then** a session is granted and the full app is usable.
2. **Given** a correct password with a wrong or reused code, **When** submitted, **Then** login is refused, no session is granted, and the failure message does not reveal which half failed.
3. **Given** a live session from earlier the same day, **When** the site is reopened, **Then** the app is usable without re-entering credentials.
4. **Given** the user logs out (or the session expires at day's end or is revoked), **When** the app is next used, **Then** login is required again before anything works.

---

### User Story 4 - Guests at the Gate (Invited Access and Revocation) (Priority: P2)

When security is enabled, the owner can create an invited access and hand the credentials to a friend; the friend completes their own authenticator enrollment at first login and uses the app with the same shared data. When the friend stops being a friend, the owner revokes that access from within the app — live sessions die immediately, further logins are refused, and no infrastructure is touched.

**Why this priority**: Required by the story ("invite a friend … revoke and rotate without touching infrastructure") but not needed for the owner-only MVP.

**Independent Test**: Can be fully tested by creating an invited access, logging in with it, revoking it, and verifying immediate lockout including live sessions.

**Acceptance Scenarios**:

1. **Given** security is enabled and the owner creates an invited access, **When** the invitee logs in with the handed credentials (enrolling their own authenticator at first use), **Then** they can use the app against the same shared data.
2. **Given** an invitee with a live session, **When** the owner revokes that access, **Then** the live session stops working immediately and new logins are refused.
3. **Given** a revoked invitee, **When** they attempt to log in with their old credentials, **Then** they are refused.
4. **Given** the public URL, **When** a stranger looks for a way in, **Then** no registration or self-service account creation path exists anywhere.

---

### User Story 5 - Brute-Force Resistance (Priority: P2)

When security is enabled, repeated failed login attempts trigger progressive delay or temporary lockout, so the password half of the gate cannot be ground down by automated guessing. Normal successful use is never meaningfully slowed.

**Why this priority**: Without it the password half is decorative (deck snag: "no rate limit = brute-forceable password, day one") — but it only matters once login exists (Story 3).

**Independent Test**: Can be fully tested by hammering the login with wrong credentials and observing progressive refusal, then confirming legitimate login works after the lockout clears.

**Acceptance Scenarios**:

1. **Given** ten failed attempts within ten minutes from one source, **When** further attempts are made, **Then** they are progressively delayed or temporarily refused with clear feedback.
2. **Given** a lockout that has expired, **When** correct credentials are submitted, **Then** login succeeds without residual penalty.
3. **Given** legitimate use with correct credentials, **When** logging in routinely, **Then** no perceptible rate-limiting is applied.

---

### User Story 6 - Stopgap Floor: Proxy Front Door (Priority: P2)

Until the in-app gate is proven in daily use, public exposure can pass through a deployment-level front door: a TLS reverse proxy requiring one shared credential before anything loads. The app itself has exactly one network entrance — through the proxy; its own port is unreachable from outside. The streaming AI-chat path is explicitly verified through the proxy before the configuration is trusted. Once the in-app gate is proven, the floor is removed and the gate becomes the sole entrance.

**Why this priority**: It is the verdict's "security floor while building" — chronologically first and cheap, but it is a stopgap: the feature's core value is Stories 1–5. Like the gate itself, it belongs to the launch path, not to everyday localhost-style use.

**Independent Test**: Can be fully tested at the deployment level: without the proxy credential nothing loads; probing the app's own port fails; streaming chat works through the proxy; removing the proxy later leaves the gate working alone.

**Acceptance Scenarios**:

1. **Given** the floor is deployed, **When** the site is visited without the proxy credential, **Then** a browser-level credential prompt is shown and nothing loads until it is provided.
2. **Given** the deployment, **When** the app's own port is probed from outside, **Then** it is unreachable — the proxy is the only entrance (a still-published app port silently voids the wall, so the single-entrance property must be explicit and checkable).
3. **Given** the proxy credential, **When** streaming chat is used end-to-end, **Then** responses stream correctly (verified deliberately before trusting the floor).
4. **Given** the in-app gate is proven in production, **When** the proxy floor is decommissioned, **Then** the app remains fully functional behind the gate alone.

---

### User Story 7 - Breaking Glass (Recovery) (Priority: P3)

When security is enabled and the owner loses their phone (authenticator gone) or forgets their password, recovery happens server-side via CLI: reset the password or re-enroll MFA without the old device. The app itself offers no self-service password reset and no MFA-less recovery path anywhere — the classic bypass door does not exist as a feature.

**Why this priority**: Essential for long-term ownership ("bites at the worst moment") but only after the gate has been in use long enough for a phone to be lost; nothing else depends on it.

**Independent Test**: Can be fully tested by using the server-side CLI recovery path with no access to the enrolled authenticator, then logging in with the new credentials + MFA.

**Acceptance Scenarios**:

1. **Given** a lost authenticator device, **When** the owner performs server-side MFA re-enrollment, **Then** they can log in again with a newly enrolled authenticator and no in-app reset-without-MFA path was used or exists.
2. **Given** a forgotten password, **When** the owner resets it via the server-side CLI, **Then** the next login requires the new password plus a valid code.
3. **Given** the running app, **When** its flows are inspected, **Then** no self-service password reset, no email-reset, and no MFA-bypass option exists anywhere in the product.

---

### Edge Cases

- What happens when a stranger reaches the one-time setup before the owner? Mitigated by ordering: the Stage 1 floor is deployed before public exposure, so setup happens behind the shared-credential front door; setup also closes after completion.
- What happens when a stranger reaches the "enable security" toggle on a public URL while the gate is open? Accepted risk (2026-09-01 ruling): whoever enables first sets the credentials and locks the other side out; the owner regains control through server-side CLI recovery (Story 7), which works regardless of who enabled.
- What happens when the owner leaves security disabled on a public URL? The app is open by explicit choice; no data protection exists in this mode — the app must make the open state visible so it is never forgotten.
- What happens when a TOTP code is entered twice (replay within its validity window)? The second use is refused.
- How does the system handle small clock drift between server and authenticator? A tolerance of roughly one time step is accepted; larger drift fails with a clear message.
- What happens when the same identity logs in from several devices? Concurrent sessions are allowed; each is individually visible and revocable.
- What happens when a session expires mid-use? The next request bounces to login; completed work is already persisted, only unsaved in-flight state is at risk.
- How does login interact with an in-progress data restore (existing 503 mode)? The gate applies independently; a valid session does not bypass restore-mode unavailability.
- What happens when an invitee's device is lost? The owner revokes that invitee's access and the owner's own access is unaffected.
- What happens if the app's own port is accidentally re-published during the floor stage? The wall is silently void — the deployment must make the single-entrance property explicit and verifiable (see Story 6).
- What happens with malformed or extreme login input (very long passwords, garbage codes)? Refused safely with generic messaging; no crashes, no oracles.
- What happens when the owner rotates credentials after a revocation? Rotation is an in-app action; it must not require infrastructure changes.

## Requirements *(mandatory)*

### Functional Requirements

**Gate optionality and mode**

- **FR-022**: The security gate MUST be optional: on first run the app MUST offer the setup flow and MUST let the owner skip it; a skipped deployment runs fully open, exactly as today, with no login screen, no auth UI, and no repeated nagging prompt.
- **FR-023**: Security MUST be a single explicit mode (open / locked) that the owner can see in the app at any time; the open state must never be silently mistaken for a broken gate.
- **FR-024**: Enabling security later MUST run the same one-time setup flow (password + authenticator enrollment) and MUST be a plain toggle in the app's settings, reachable by anyone who can reach the app while in open mode — the hostile-takeover risk (a stranger flipping it first on a public URL) is explicitly accepted by this ruling; the owner's server-side CLI recovery (FR-016/FR-017) is the designated way back in.

**Gate and sessions (when enabled)**

- **FR-001**: When security is enabled, the system MUST enforce, centrally at the server API boundary, that every server-provided capability (data reads/writes, AI-provider proxying, backup/restore, sandbox, tool execution) refuses requests lacking a valid session — such that a capability cannot be exposed without the gate by omission or accident.
- **FR-002**: Static UI assets MAY load without a session but MUST contain no user data; all data and actions flow exclusively through gated server capabilities.
- **FR-003**: The system MUST grant access only after verifying both a password and a time-based one-time code (MFA), identically for the owner and any invitee; no password-only mode exists (2026-09-01 ruling).
- **FR-004**: The setup flow MUST verify one working code before activation, MUST be completable exactly once per enabling, and MUST be permanently closed afterward until security is explicitly turned off and on again.
- **FR-005**: Sessions MUST be transmitted in a form browsers neither expose to page scripts nor attach to cross-site requests (HttpOnly / Secure / SameSite guarantees).
- **FR-006**: Session lifetime MUST be an explicit, documented decision — ruled 2026-09-01: a session lasts until the end of the calendar day (server-local time) on which login occurred; no re-login is required within the same day, and any use on a later day requires logging in again. Logout and owner-initiated revoke-all MUST also be supported.
- **FR-007**: Sessions MUST be revocable individually (per identity, per device) and all at once, with revocation taking effect immediately.

**Identities and invites (when enabled)**

- **FR-008**: The system MUST support exactly one owner identity plus a small set of invited identities behind the same gate, all sharing the single dataset; there MUST be no registration, no self-service account creation, and no per-user data isolation (user ruling, 2026-08-31).
- **FR-009**: The owner MUST be able to create invited access, hand over credentials (invitee completes their own MFA enrollment at first login), and revoke that access entirely from within the app, without infrastructure changes.
- **FR-010**: All gated capabilities MUST behave identically for owner and invitees — identities exist for access control only.

**Credential security (when enabled)**

- **FR-011**: Passwords MUST be stored only as salted one-way hashes produced by a vetted, standard algorithm; plaintext or reversibly encoded passwords and hand-rolled cryptography are prohibited.
- **FR-012**: TOTP enrollment secrets MUST be stored in a form that is unusable if the database contents alone are compromised (protected under a key held outside the database) — never in cleartext.
- **FR-013**: The system MUST rate-limit login attempts (progressive delay or temporary lockout on repeated failures) while never meaningfully delaying legitimate successful use.
- **FR-014**: Failed-login responses MUST NOT reveal whether the password or the code failed, and a TOTP code MUST NOT be accepted twice within its validity window.
- **FR-015**: The system MUST record login successes and failures (identity or source, time, outcome) sufficient for the owner to notice attack attempts.
- **FR-016**: The app MUST offer no self-service password reset and no MFA-less recovery path of any kind; recovery (password reset, MFA re-enrollment) MUST be performed server-side via CLI only.
- **FR-017**: Server-side CLI recovery MUST require direct server access and MUST NOT leave behind, or create, any login path that skips MFA.

**Stage 1 floor (stopgap, launch path)**

- **FR-018**: Until the in-app gate is proven in production use, public exposure SHOULD place a TLS reverse proxy requiring one shared credential in front of all app traffic.
- **FR-019**: When the floor is deployed, the deployment MUST have exactly one external entrance — through the proxy; the app's own port MUST NOT be reachable from outside, and this single-entrance property MUST be explicitly checkable.
- **FR-020**: The streaming AI-chat path MUST be explicitly verified through the proxy (and, after floor removal, through the gate) before the configuration is trusted for daily use.
- **FR-021**: Once the in-app gate is proven, the proxy floor MUST be removed, leaving the gate as the sole entrance.

### Key Entities *(include if feature involves data)*

- **Security Mode**: The deployment's gate state — open (default; everything behaves as today) or locked (all capabilities require a session). The explicit, visible toggle between these states is itself part of the feature.
- **Gate Identity**: An access principal — the owner or an invited person. Attributes: label, role (owner / invitee), active or revoked state, MFA enrollment status. All identities share the one dataset; identities exist for access control only.
- **Credential**: Per-identity proof of knowledge — the password (salted one-way hash) and the MFA enrollment (protected secret, verified at enrollment time).
- **Session**: A granted, bounded authorization bound to one identity. Attributes: identity, creation time, last activity, expiry policy, revocation state.
- **Login Attempt**: A record of an authentication try (identity or source, time, outcome) feeding rate limiting and attack visibility.
- **Front Door (Stage 1)**: The deployment-level entrance (TLS proxy + shared credential) that exists only until the in-app gate is proven, then is dismantled.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With security enabled, an unauthenticated visitor holding only the public URL can retrieve, modify, or use nothing: an automated credential-less sweep of every server-provided capability shows 100% uniform refusal.
- **SC-002**: The gate is structural, not disciplinary: in a build containing a deliberately added new capability, the same credential-less sweep still shows 100% refusal — no per-capability opt-in was needed.
- **SC-003**: With security enabled, an owner logs in (password + code) in under 30 seconds including retrieving the code from their authenticator.
- **SC-004**: With security enabled, ten or more failed attempts within ten minutes from one source trigger progressive refusal; correct credentials succeed once the lockout clears.
- **SC-005**: Revoking an invited identity ends their access — including live sessions — within seconds, with zero infrastructure changes.
- **SC-006**: A stolen copy of the stored data alone yields no usable credentials: no plaintext or reversibly recoverable passwords or MFA secrets.
- **SC-007**: The owner recovers from a lost phone (MFA re-enrollment) or a forgotten password in under 15 minutes using only server-side CLI access.
- **SC-008**: During the floor stage, streaming chat through the proxy behaves identically to direct access (no visible lag or breakage); after floor removal the same holds through the gate alone.
- **SC-009**: With security enabled, a stranger visiting the URL sees only an inert shell or the login screen; every byte they can load is free of user data.
- **SC-010**: With security skipped or disabled, the app behaves indistinguishably from today (zero added friction, zero auth UI), and a fresh deployment can be put to use in under 1 minute including the skippable prompt.
- **SC-011**: With security enabled, logging in once grants friction-free use until the end of that day, and 100% of sessions are expired by the start of the next day (first use the next day always requires login).

## Assumptions

- Security is opt-in (owner ruling, 2026-09-01): the first-run prompt is skippable and skipping leaves the app exactly as it is today; the default deployment posture is open.
- After a skip, the setup prompt does not re-appear on every visit; enabling security later happens through the plain in-app settings toggle (2026-09-01 ruling), with server-side CLI recovery as the backstop against hostile enablement.
- The Stage 1 floor is deployed before any public exposure; Stage 2 setup therefore happens behind the floor, which protects the one-time setup window from hostile takeover.
- A domain with automated TLS is available for the floor stage.
- "Small set" of invitees means a handful of people, managed manually by the owner; no bulk or self-serve invitation flows.
- Session lifetime is decided (2026-09-01): same-day sessions only — login once per day; sessions expire at the end of the calendar day in server-local time.
- With MFA mandatory whenever security is enabled (2026-09-01), TOTP enrollment is part of every enabling path; "security optional" applies to the gate as a whole, never to the MFA half alone.
- SSH/CLI-side recovery is acceptable for a hobby, owner-operated deployment — this is a deliberate feature deletion, not an omission.
- Password hashing and TOTP use vetted standard libraries; per the deck verdict, learning is a first-class goal, so the gate is owned end-to-end rather than outsourced to a hosted vendor product (zero-trust-edge remains fallback only).
- Multi-user machinery — registration, an accounts system, per-user data isolation — is explicitly out of scope (user ruling, 2026-08-31).
- The public-launch gate composes with the existing server capability model: capabilities stay advertised and progressively enabled; the gate sits in front of them, not inside them.
