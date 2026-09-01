---
card: 001
name: password-mfa-gate
origin: user
bet: Wins if you want a durable, self-contained gate that lives in the app and are willing to own the auth UI, session handling, and TOTP plumbing
played: yes
---

# Card 001 — Password + MFA gate (your card)

## Story

You put a login wall in front of mayon. First visit you set a password and enroll an authenticator app; from then on, anyone hitting the URL gets the login screen — password plus a 6-digit TOTP code — before the SPA loads, and the server rejects every `/api` call without a valid session. You hand credentials to the few people who should have access; everyone else bounces off the wall.

## Playthrough (2026-08-31)

- **What checked**: launch mayon publicly, gated so only invited people can reach the app and its APIs (why: prod stack has no front door today).
- **How it goes**: sessions table, login route, and TOTP enrollment land in the server first; week one the happy path works — password plus 6-digit code, then the app opens. Week two a new server endpoint ships without the session middleware and quietly works for strangers — the characteristic failure mode: the gate fails one unguarded route at a time, silently. Slow burns follow: rate limiting is mandatory or the password half is decorative; cookie flags/CSRF/session-lifetime need real care; password resets and phone-swap TOTP re-enrollment are self-service forever via SSH. Static SPA stays public (just chrome), so the wall lives or dies entirely at the server's `/api` seams.
- **Snags**: unguarded endpoint = open door (week 2, silent, severe); no rate limit = brute-forceable password (day one); owning resets/re-enrollment for life (bites at the worst moment).
- **Trade-offs**: permanent maintenance burden; login friction for every invitee; you become your own identity provider with its threat model.
- **Delivers the what?**: fully on paper — strongest self-contained gate in the deck — but only as strong as the most forgettable middleware.
- **Difficulty vs payoff**: difficulty L · payoff H · time-to-first-value ~2–3 weeks (estimates; lean on a vetted auth library if pursued).
- **Your take**: Not really looking for a multi-user setup — the goal is a lock for a (near-)single-user deployment. Moved on with `next`. Follow-up question post-comparison: does password+TOTP make the app a "dead app" until sign-in, and are hackers then locked out? Answer given: data yes (SPA shell still loads, harmlessly — empty showroom shape), and security is implementation-dependent: every endpoint must check, login needs rate limiting, session cookie hygiene, KDF-hashed passwords, TOTP seeds not in cleartext, and no self-service password-reset bypass (single-user: reset via SSH instead). TOTP defeats credential guessing, not XSS/session theft or host compromise. Post-comparison: user revealed learning is a first-class goal (hobby project) — strengthens this card's case; Kit's recommendation became 002 (basic auth) as a one-evening stopgap floor while building 001 as the learning project, dropping the proxy once the in-app gate is proven.
