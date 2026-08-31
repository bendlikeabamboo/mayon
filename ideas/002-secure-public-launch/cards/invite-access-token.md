---
card: 003
name: invite-access-token
origin: dealt
bet: Wins if your audience is a handful of people you know and the goal is keeping strangers out, not authenticating specific identities
played: yes
---

# Card 003 — Invite access token

## Story

You don't build a login at all — you mint a long random access token and hand it out with the invite link. A visitor pastes the token once; the app stores it locally and they're in from then on, while anyone without the link gets nothing. Rotating the token locks everyone out at once, and inviting a new person is one message.

## Playthrough (2026-08-31)

- **What checked**: launch mayon publicly, gated so only invited people can reach the app and its APIs (why: prod stack has no front door today).
- **How it goes**: day one — generate a 256-bit token, hash into server env, one paste-once interstitial in the SPA, one header-check middleware on every `/api` route. No sessions, cookies, CSRF, or password machinery; paste once and it's invisible afterwards. Rotation is the only revocation (change env, everyone re-pastes). Security floor ends up equivalent to proxy basic auth; the difference is the gate lives in the app and a logout exists.
- **Snags**: token-in-URL leaks into browser history/chat previews/server logs (silent, avoidable by design); token never expires, so every device it touched stays valid until rotate-all (bites exactly when revoking); still requires the every-endpoint middleware discipline, though the check itself is one line.
- **Trade-offs**: strictly single factor (token replaces password+MFA), shared credential, no per-person attribution; buys — no auth infrastructure, a real logout, full ownership of the gate in the codebase.
- **Delivers the what?**: partially — strangers without the token stay out; the MFA half of the ask is explicitly not delivered.
- **Difficulty vs payoff**: difficulty S–M · payoff M · time-to-first-value 1–2 days (estimates).
- **Your take**: (none)
