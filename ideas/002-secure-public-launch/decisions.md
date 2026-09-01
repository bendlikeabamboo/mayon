# Decisions: 002-secure-public-launch

- Created: 2026-08-31

## Verdict

- **Winner**: Card 001 — password-mfa-gate (your card), with Card 002 — proxy-basic-auth as the immediate on-ramp: basic auth goes up in one evening as the security floor while 001 is built at hobby pace; the proxy layer comes down once the in-app gate (sessions, TOTP, rate limiting, middleware discipline) is proven.
- **Runner-up**: Card 004 — zero-trust-edge (kept as the standing fallback if owning auth wears thin).
- **Why**: hobby project where learning is a first-class goal — 001 is the full transferable auth curriculum, and 002 removes the "public and naked while building" window. User ruled out multi-user (kills Card 005); 004's shallow dashboard-config learning and vendor-in-path made it runner-up despite best security-per-hour.
- **Date**: 2026-09-01
