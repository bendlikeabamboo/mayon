# Quickstart: Optional Telemetry (Langfuse First)

Phase 1 output. Runnable validation scenarios proving the feature end-to-end against [spec.md](./spec.md) FRs and SCs. Each scenario names its gate and expected outcome; shapes are defined in [contracts/telemetry-api.md](./contracts/telemetry-api.md), [contracts/langfuse-ingestion.md](./contracts/langfuse-ingestion.md), and [data-model.md](../data-model.md).

## Prerequisites

- Dev stack up (`pnpm dev`) — app on http://localhost:5173, server on :4319, with the mock-llm fixture reachable (compose service `mock-llm:9999`).
- A Langfuse destination, one of:
  - **Real**: any Langfuse project (cloud or self-hosted) — needed for the visual V2/V4 checks.
  - **Stub**: a local receiver that asserts the ingestion contract (serves `GET /api/public/projects` 200 and records `POST /api/public/ingestion` batches) — used by automated tests and sufficient for V0/V1/V3/V5/V6.
- To enable delivery, the server container env must carry `MAYON_LANGFUSE_SECRET_KEY` (add to the dev compose environment and `pnpm dev:build`, or export before `pnpm --filter @mayon/server dev`).

## Automated gates (run first, every scenario)

```bash
pnpm --filter @mayon/shared build   # shared types before consumers
pnpm check && pnpm lint
pnpm test                            # web: capture stripping, relay bounds, config state
pnpm --filter @mayon/server test     # routes via app.inject; Langfuse client via stubbed fetch
```

Expected: all green. Server suite must include the FR-003 regression test (disable ⇒ queue dropped, no flush) and the FR-009 defense-in-depth test (content record rejected in metadata mode).

## V0 — Off by default, provably silent (FR-001/FR-002, SC-001)

1. Fresh dev stack (no `telemetry` settings row; do not open telemetry settings).
2. Chat with the mock provider for several turns while the stub receiver logs every request.
3. Also inspect the browser network tab and server logs for any `/api/telemetry/*` or Langfuse-bound request.

**Expected**: zero requests to the receiver; no telemetry-related outbound traffic anywhere; chat behavior identical to pre-feature.

## V1 — Configure and validate the destination (FR-004/FR-005, SC-002)

1. Settings → Telemetry: enter host + public key of the stub/real Langfuse; choose capture mode `content`; enable.
2. Repeat with a wrong key (expect "credentials rejected") and an unreachable host (expect "destination not reachable"), then configure correctly.

**Expected**: validation outcome stated in plain language per case; accepted config persists across reload; the secret is nowhere in the settings store or any API response (spot-check `GET /api/telemetry/status` shows `secretPresent: true` without echoing material). Total time from unconfigured to validated under 5 minutes (SC-002).

## V2 — Traces arrive, grouped by conversation (FR-006/FR-007/FR-012, SC-003/SC-006)

1. With telemetry active, hold a multi-turn conversation against the mock provider; trigger one side generator (e.g., ask for a quiz).
2. Open Langfuse (or the stub's recorded batches).

**Expected**: one trace per turn plus a tagged `quiz` trace, all grouped under one session (`sessionId` = chat id); each generation shows model, full input/output, usage `{1,1,2}` from the mock's terminal frame, and duration; delivery lags completion by ≤2 min (SC-003); chat latency unchanged (run with `window.__MAYON_PERF__ = 1` to confirm no added render/longtask regression).

## V3 — Errors and aborts are captured, not gaps (FR-006)

1. Point the active provider at an endpoint that fails (e.g., invalid base URL) and send a turn; abort another turn mid-stream.

**Expected**: both interactions produce records with `outcome: 'error'` / `'aborted'` (Langfuse `level: ERROR` + `statusMessage`); partial output preserved when available; the chat itself recovers as it does today.

## V4 — Metadata-only mode leaks nothing (FR-008/FR-009, SC-005)

1. Switch capture mode to `metadata` in settings (no restart).
2. Hold a conversation containing a distinctive passphrase (e.g., `ZEBRA-42-TELEMETRY`).
3. Search the destination (or stub batches) for the passphrase.

**Expected**: subsequent records carry model/usage/timing/outcome/session linkage with **no** conversation text; passphrase search returns nothing (SC-005); mode switch effective for records after the change.

## V5 — Disable is immediate and total (FR-003, SC-001)

1. With telemetry active and traffic flowing, toggle it off; immediately send another turn.
2. Check `GET /api/telemetry/status` and server logs.

**Expected**: no further delivery; server queue dropped synchronously in the disable request; post-disable network capture (as V0) shows zero telemetry traffic; re-enabling probes again before delivering anything new.

## V6 — Destination outage degrades quietly (FR-007/FR-010, edge case)

1. Stop the stub/Langfuse (or point host at an unreachable URL via re-validated config change).
2. Chat normally for a while; watch the telemetry status; restore the destination.

**Expected**: chats unaffected throughout; status shows the failure (`lastError`) and non-shrinking `queueDepth` bounded at cap; after restore, delivery resumes and status returns to healthy; no retry storm in server logs (backoff ≤60s).

## V7 — Backup/restore does not resurrect telemetry (edge case)

1. With telemetry enabled, take a DB backup; disable telemetry; restore the backup taken earlier.

**Expected**: restore completes per existing in-place semantics; telemetry state after restore matches the backed-up config, and delivery revalidates the destination before emitting (no silent emission with a stale destination).

## E2E mapping

`tests/e2e/telemetry.spec.ts` automates V2 (assertion-level via stub receiver), V3 (abort leg), and V4 (batch scan for absence) against the dev compose, reusing the mock-llm onboarding fixture for real chat paths. V0/V5 have unit + inject-level coverage (and the V0 network half is additionally exercised by the T027 off-run below); V1/V3/V6/V7 stay manual+unit/inject-level in v1.

## Perf measurement (T027)

Measured 2026-10-31 on the dev compose (web :5173, mock-llm), per constitution IV, with the perf probe (`window.__MAYON_PERF__ = 1`, `mayon_perf_scenario` tags `telemetry-off` / `telemetry-on-content`). Method: a scripted Playwright driver ran identical activity in both configurations — fresh page, new chat, 4 mock-provider turns (fill → send → wait for stream completion → 500ms settle), then 8s idle — collecting the probe's 3s `[mayon-perf]` console summaries (6 windows per run). Telemetry off = settings row disabled; on = enabled in `content` mode against the dev `langfuse-stub`, page booted after the config change. Raw runs: `/tmp/kilo/perf-off.json`, `/tmp/kilo/perf-on.json`.

| Metric (identical scripted activity) | telemetry-off | telemetry-on-content |
|---|---|---|
| Longtasks during chat activity | 0 | 0 |
| Longtasks in first window (dev-mode page load, pre-chat) | 1 × 50–100ms | 1 × 50–100ms |
| Frame deltas over the 18s run | n=179, p50 16.7ms, max 16.8ms, dropped 0 | n=179, p50 16.7ms, max 16.8ms, dropped 0 |
| Input latency samples | none (scripted clicks produce no event-timing entries) | none (identical) |
| `markdown:render` mark totals across active windows | ≈186ms / 96 renders | ≈186ms / 96 renders |
| Relay traffic observed from the page | 0 requests to `/api/telemetry/*` | 2 fire-and-forget POSTs to `/api/telemetry/events` |
| Destination received | 0 batches (stub verified empty after run) | 18 events (9 records: 4 chat-turns + title side-generator) |

Result: **no measurable difference within noise**. Zero added longtasks; frame timing and dropped frames identical; the only telemetry-side work visible at the network level (2 buffered relay POSTs) is off the interaction path, and delivery completed without affecting the run.
