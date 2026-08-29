# Quickstart: GitHub Copilot Support (016) — Validation Guide

End-to-end validation for the finished feature. Prerequisites: a GitHub account **with a Copilot subscription** (Individual or Business), `pnpm dev` stack running (web :5173, server :4319 — the companion server is mandatory for this feature; without it all scenarios fail with the server-absent indicator).

Automated gates first:

```bash
pnpm check && pnpm lint && pnpm test
pnpm --filter @mayon/server test
```

## Scenario 1 — Add provider, authorize, first reply (P1)

1. Settings → Add provider → **GitHub Copilot**.
2. Click **Connect GitHub account** → dialog shows a user code and https://github.com/login/device.
3. Complete the code entry at GitHub; the dialog flips to **Connected** (login shown when available). No secret was ever pasted.
4. Confirm model picker populated (discovery ran post-connect); keep the default model.
5. Set active → send a chat message → **expect** a normal streamed reply with stop/retry affordances.

Fail signals: dialog hangs pending after authorization (check `/api/llm/copilot/auth/poll`); exchange 404 in server logs ⇒ client-id/allowlist risk (research D2); chat 400 ⇒ missing mandatory headers.

## Scenario 2 — Transparent renewal (P2, FR-007)

1. With a working provider, restart the server container (`docker compose -f docker-compose.dev.yml restart server` or your dev equivalent) — server session cache is memory-only, so the next request must re-exchange.
2. Send another message → **expect** success with no prompt and no lost input (grant survives in the browser KeyStore; cache is cold but transparent).

## Scenario 3 — Revoked grant recovery (P2, FR-008)

1. Revoke the authorization at GitHub → Settings → Applications → Authorized OAuth Apps (the VS Code Copilot Chat entry).
2. Send a message → **expect** the provider-specific "needs reconnect" state (not a generic error), conversation intact.
3. Click **Reconnect GitHub** once → authorize → **expect** the same message resend to succeed in one action.

Fail signal: repeated re-auth loops ⇒ 403/`not_entitled` mapped wrong (research D4).

## Scenario 4 — Model catalog (P3, FR-009/FR-011)

1. Refresh models on the provider → **expect** the list to match the account's picker-visible models (policy-disabled entries absent; do not expect `model_picker_enabled` to gate anything).
2. Select a model, reload the app → **expect** the selection persists.
3. (Optional, Business/policy-restricted account) Attempt a policy-disabled model via advanced config → **expect** a clear provider error (400/403 family) — this is risk #3, record what you see.
4. Stop the server → refresh models → **expect** the curated fallback list, and chat attempts to fail with the standard server-absent/offline error, not a crash.

## Scenario 5 — Parity & cleanup (FR-005/FR-006/SC-006)

1. Mid-conversation built with another provider, switch active provider to GitHub Copilot → continue → **expect** history preserved.
2. Generate a quiz over the conversation → **expect** success (orchestrator parity).
3. Remove the GitHub Copilot provider → DevTools → IndexedDB `mayon/providerKeys` → **expect** no record with the old provider id.

## Performance smoke (constitution IV)

With `window.__MAYON_PERF__ = 1`, run one streamed reply on Copilot vs the previous provider: first-token latency within normal provider variance, no long tasks introduced by the session wrapper (the token exchange happens before streaming; the wrapper must not add per-chunk work).
