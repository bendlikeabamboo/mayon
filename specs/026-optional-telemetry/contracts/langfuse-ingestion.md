# Contract: Langfuse Ingestion (server → destination)

Phase 1 output. The outbound contract for [research.md D3](../research.md#d3--langfuse-client-minimal-typed-ingestion-client-no-sdk-dependency): a minimal typed client in `server/src/telemetry-ingest.ts` speaking Langfuse's public HTTP API with global `fetch`. Auth is Basic (`publicKey:secretKey`) on every call; the secret comes from `MAYON_LANGFUSE_SECRET_KEY` server env and never leaves the server.

## Probe (config validation — research D6)

`GET {host}/api/public/projects`

- Any 2xx ⇒ reachable and authenticated.
- Network error / timeout (5s) ⇒ "destination not reachable".
- 401/403 ⇒ "credentials rejected".
- Side-effect-free; used only by `PUT /api/telemetry/config`.

## Ingestion

`POST {host}/api/public/ingestion` with `{ "batch": Event[] }`.

One `TelemetryEventRecord` maps to **two** batch events (trace + generation observation). Each batch event carries its own client-generated `id` — Langfuse deduplicates on it, making retries idempotent.

### Mapping table

| TelemetryEventRecord | Langfuse event |
|---|---|
| — | `{ id: <uuid>, type: "trace-create", timestamp: startedAt, body: { id: <record.id>, name: kind, sessionId: chatId, tags: [kind, provider, captureMode], metadata: { app: "mayon", model, outcome } } }` |
| the interaction itself | `{ id: <uuid>, type: "observation-create", timestamp: startedAt, body: { id: <uuid>, traceId: record.id, type: "generation", name: kind, startTime: startedAt, endTime: startedAt + durationMs, model, input, output, usage: { input, output, total, unit: "TOKENS" }, level: error ? "ERROR" : "DEFAULT", statusMessage: errorDetail } }` |

Field rules:

- `input`/`output` are **omitted** from the observation body in metadata mode (absent keys, not empty strings) — matching the stripped record, so nothing to redact downstream.
- `usage` is included only when the provider reported it; no synthesized zero-usage.
- `statusMessage` carries `errorDetail` (short reason) for error/aborted records so failures are visible in the observations table.
- Batch ≤20 records (40 events), JSON body within the per-field ~128 KiB caps set at assembly.

### Delivery semantics (research D9)

- Flush cadence: ≤5s interval or ≤20 queued records, whichever first; best-effort flush on server shutdown.
- Failure handling: exponential backoff per failed flush (cap 60s); no record is retried more than until queue bound evicts it (drop-oldest at 500). Outcomes update `TelemetryStatus` (`lastDeliveredAt`, `lastError`).
- The pipeline dials Langfuse **only** while config is enabled and probed-valid — the network-level half of FR-002.

## Non-goals

- No OTLP endpoint use, no OpenTelemetry SDK, no prompt-management pull, no score push (research D8).
- No multi-destination fan-out in v1; the sink design keeps the door open (FR-011) but only Langfuse is implemented.
