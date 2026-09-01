---
card: 002
name: proxy-basic-auth
origin: dealt
bet: Wins if the threat model is strangers stumbling in rather than targeted attackers, and you want the gate up tonight with near-zero maintenance
played: yes
---

# Card 002 — Reverse-proxy basic auth

## Story

You spend an evening on compose, not the app: a tiny Caddy (or nginx) service goes in front of the web container with a single `basic_auth` line — one shared password. The browser prompts once, remembers it, and every request to the app and `/api` (same-origin through the proxy) sits behind it. No app code changes, no sessions, no MFA — just a locked front door.

## Playthrough (2026-08-31)

- **What checked**: launch mayon publicly, gated so only invited people can reach the app and its APIs (why: prod stack has no front door today).
- **How it goes**: an evening of compose work — Caddy sidecar in front of the web container, one `basic_auth` line, TLS via automatic certs (needs a domain). Browser prompts once and remembers for years; SPA and all `/api` traffic share the one proxied entrance. Works the same night with ~15 lines of YAML and zero app changes. The wall holds only if the web container's own port is unpublished — if :8080 stays host-mapped, the proxy is decorative.
- **Snags**: bypass door — app port still published means the lock is silently void (day one, severe, invisible while it works); revocation = password rotation for everyone, every device (bites whenever someone leaves or a device is lost); no MFA or logout in the native dialog, so the shared password is the entire security and demands TLS + a strong secret.
- **Trade-offs**: no per-user identity (logs can't attribute), no MFA, shared credential that leaks sideways; in exchange, zero app code and near-zero ongoing maintenance.
- **Delivers the what?**: partially — strangers stay out, but the MFA half of the original ask is absent by design.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value an evening (estimates).
- **Your take**: (none)
