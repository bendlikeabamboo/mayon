---
card: 004
name: zero-trust-edge
origin: dealt
bet: Wins if you don't need public discoverability and are happy to put identity at the network edge instead of the application
played: yes
---

# Card 004 — Zero-trust edge

## Story

You don't expose mayon publicly at all. The stack stays bound to a private interface and Cloudflare Access (or a Tailscale tailnet) sits in front: each visitor proves an identity you allowlisted — email OTP or SSO with MFA built in — before any packet reaches the web port. The app never learns what auth is, and you get real MFA with zero code, on a free tier.

## Playthrough (2026-08-31)

- **What checked**: launch mayon publicly, gated so only invited people can reach the app and its APIs (why: prod stack has no front door today).
- **How it goes**: compose publishes no ports; cloudflared dials out and the domain resolves at the edge, where visitors authenticate (email OTP by default, SSO for true MFA) against an email allowlist before any packet reaches the host. Tailscale variant makes the app unfindable instead of locked. Highest security-per-hour in the deck, with a vendor permanently in the hot path.
- **Snags**: edge outage/latency becomes app outage (whenever the vendor wobbles; with internal-only compose you also lose direct access); email OTP is inbox-security, not MFA — true MFA needs SSO wiring (still zero code, one more identity dependency); LLM streaming through the tunnel is plausible-but-unverified (test before trusting).
- **Trade-offs**: the access policy lives in a vendor dashboard, outside the repo and version control; the app never learns about identity; the front door is a third-party dependency by design.
- **Delivers the what?**: fully — beyond the ask, since MFA arrives built-in rather than built.
- **Difficulty vs payoff**: difficulty S · payoff H · time-to-first-value an afternoon plus one streaming-test evening (estimates).
- **Your take**: (none) Asked for a plain re-explanation (not familiar with the route); walked through the concept — guard outside the machine: compose publishes no ports, cloudflared dials out, domain resolves at Cloudflare's edge, email-allowlist policy gates visitors before traffic reaches the host, app sees none of it. Email code / SSO = the MFA ask, delivered by the guard. Per-email revocation named as the edge over 002/003's rotate-for-everyone.
