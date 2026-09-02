# Quickstart: Secure Public Launch — end-to-end validation

Proves the spec's success criteria against a running stack. Implementation details live in [plan.md](./plan.md) / tasks.md; data shapes in [data-model.md](./data-model.md); wire details in [contracts/](./contracts/auth-api.md).

## Prerequisites

- Docker or Podman (`MAYON_DEV_ENGINE`), Node 22, pnpm 10.
- Dev stack: `pnpm install && pnpm dev` (web http://localhost:5173, server :4319 internal, db internal).
- After changing `packages/shared` or deps: `pnpm dev:build` first.
- Gates before any commit: `pnpm check && pnpm lint && pnpm test && pnpm --filter @mayon/server test`.

## 0. Automated gate sweep (SC-001, SC-002 — the permanent invariant)

```bash
pnpm --filter @mayon/server test -- auth-gate
```

Expected: the sweep enumerates EVERY registered route (db/query, sandbox, backup, import, llm, copilot, ws/mcp, auth admin) and asserts `401 {"error":"unauthenticated"}` uniformly in locked mode without a session, and unchanged behavior in open mode. Adding a route later without touching the gate makes this test fail red.

## 1. First run is skippable (US1, SC-010)

1. Fresh stack (`pnpm dev:down -v && pnpm dev`). Open http://localhost:5173.
2. The setup prompt appears once → click **Skip**.
3. Expected: the app works exactly as today (chat, search, settings); no login screen; no auth UI anywhere; the prompt does NOT re-appear on reload; Settings › Security shows mode **Open**.

## 2. Enable + enroll (US1, FR-004, SC-003)

1. Settings › Security → **Enable security** → choose label + password → scan the QR with any authenticator app → enter the 6-digit code.
2. Expected: mode flips to **Locked**; the app locks immediately (you keep your session — you just logged in).
3. Reload → login screen. Password + current code → app opens. Password + wrong code → `401` generic message that does NOT say which half failed.
4. Enter the SAME code twice in a row (second login within 30s) → refused (replay guard).

## 3. The wall (US2, SC-001, SC-009)

```bash
curl -i -X POST http://localhost:5173/api/db/query -H 'content-type: application/json' -d '{"op":"exec","sql":"select 1"}'
curl -i -X POST http://localhost:5173/api/llm/proxy -H 'content-type: application/json' -d '{"url":"https://example.com"}'
curl -i http://localhost:5173/api/health
```

Expected while locked: first two → `401` identical shape; health → `200` (public, no user data); the SPA shell at `/` still loads but shows only the login screen.

## 4. Rate limiting (US5, SC-004)

Hammer login with a wrong password 12× (script or rapid manual).

Expected: attempts 1–4 instant; 5–9 progressively delayed; ≥10 → `429` until the oldest failure leaves the 10-minute window; a correct login then succeeds with no residual penalty; Settings › Security › recent activity lists the attempts (outcome values visible to the owner only, FR-015).

## 5. Invites + revocation (US4, SC-005)

1. Owner: Settings › Security → invite `friend` → copy the one-time password (shown once).
2. Second browser profile: login as `friend` + password → QR enrollment → own code → full app, same shared data.
3. Owner: revoke `friend`.
4. Expected: friend's open app bounces to login on the next request; new logins refused; no infrastructure touched; no registration path exists anywhere.

## 6. Same-day sessions (US3, FR-006, SC-011)

Reload within the day → no re-login. Then simulate day rollover (tests use an injected clock; manually: restart with system date shifted past midnight in a throwaway env) → first use next day requires login.

## 7. Recovery CLI (US7, SC-007)

```bash
docker compose exec server node dist/auth-cli.js status
docker compose exec server node dist/auth-cli.js reenroll-mfa --label owner   # scan new QR
docker compose exec server node dist/auth-cli.js reset-password --label owner
```

Expected: re-login works with new password + new authenticator; the app itself never offers a reset flow anywhere (US7-3).

## 8. Streaming through the gate (SC-008)

Locked mode: run one streaming chat — tokens must stream progressively (the 401 gate fires before the proxy handler, so hijacked streaming is untouched).

## 9. Stage 1 floor (US6) — deployment-level, needs a public host + domain

Follow [contracts/deployment-floor.md](./contracts/deployment-floor.md): copy override + Caddyfile into `~/.mayon/`, set domain + basic-auth hash, `docker compose up -d`.

- Without proxy credentials: `401` at the domain; browser prompt; nothing loads.
- `docker compose port web 8080` errors; only caddy publishes 80/443 (single entrance).
- Streaming chat through the domain streams progressively before trusting the floor.
- Floor removal later: delete the two files, restore base compose, gate alone still passes steps 2–8.
