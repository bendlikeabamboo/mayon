# Contract: Langfuse Ingestion (server → destination)

Phase 1 output, updated for the OpenTelemetry ingestion path (Langfuse v3.22+ / v4). The outbound contract for [research.md D3](../research.md#d3--langfuse-client-minimal-typed-ingestion-client-no-sdk-dependency): a minimal typed client in `server/src/telemetry-ingest.ts` speaking Langfuse's OTLP/HTTP JSON trace endpoint with global `fetch`. Auth is Basic (`publicKey:secretKey`) on every call; the secret comes from `MAYON_LANGFUSE_SECRET_KEY` server env and never leaves the server.

## Probe (config validation — research D6)

`GET {host}/api/public/projects`

- Any 2xx ⇒ reachable and authenticated.
- Network error / timeout (5s) ⇒ "destination not reachable".
- 401/403 ⇒ "credentials rejected".
- Side-effect-free; used only by `PUT /api/telemetry/config`.

## Delivery (OTLP traces)

`POST {host}/api/public/otel/v1/traces` with an OTLP/JSON `ExportTraceServiceRequest` body:

```
{ "resourceSpans": [{ "resource": { "attributes": [{ "key": "service.name", "value": { "stringValue": "mayon" } }] }, "scopeSpans": [{ "spans": [...] }] }] }
```

Headers: Basic auth, `content-type: application/json`, and `x-langfuse-ingestion-version: 4` (selects the real-time v4 ingestion path on Langfuse v4; ignored harmlessly by v3).

One `TelemetryEventRecord` maps to **one** INTERNAL span:

| TelemetryEventRecord | OTLP span |
|---|---|
| id | `traceId` = id with hyphens stripped (32 hex) |
| — | `spanId` = 16 hex random (`crypto`), fresh per export |
| kind | `name`, `kind: 1` (INTERNAL) |
| startedAt | `startTimeUnixNano` (string nanos) |
| startedAt + durationMs | `endTimeUnixNano` (string nanos) |

Attributes (stringValue unless noted):

| Attribute | Source |
|---|---|
| `langfuse.observation.type` | `"generation"` |
| `langfuse.session.id` | chatId |
| `gen_ai.request.model` | model |
| `mayon.provider` | provider |
| `mayon.outcome` | outcome |
| `mayon.capture_mode` | captureMode |
| `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.usage.total_tokens` | usage (intValue as decimal string per OTLP/JSON int64 encoding; only keys the provider reported — no synthesized zero-usage) |
| `error.type` | errorDetail, present only on error/aborted records with a reason |
| `gen_ai.prompt` | input (JSON-stringified when structured) — **content mode only** |
| `gen_ai.completion` | output — **content mode only** |

Field rules:

- Content attributes are included **only in content capture mode**. Metadata-mode records carry no input/output (stripped at assembly, rejected at the relay gate), and the mapper never emits prompt/completion for them regardless.
- Attribute names follow Langfuse's current OTel mapping: `langfuse.observation.type` (not the legacy `langfuse.span.type`), input/output via `gen_ai.prompt`/`gen_ai.completion`, usage via `gen_ai.usage.*`.
- Batch ≤20 records (20 spans), JSON body within the per-field ~128 KiB caps set at assembly.

### Success / partial-failure semantics (no lying Delivery health)

Only a clean success counts as delivered:

- 2xx (≠ 207) with no populated `partialSuccess.errorMessage` ⇒ **ok**.
- HTTP **207 is a failure** regardless of its 2xx class: the legacy ingestion body `{successes, errors: [{id, status, message}]}` surfaces the first `errors[].message`; the OTLP body `{partialSuccess: {errorMessage, ...}}` surfaces `errorMessage` when non-empty.
- 2xx with a non-empty `partialSuccess.errorMessage` ⇒ **failure** carrying that message.
- 401/403 ⇒ `credentials rejected`. Other non-2xx ⇒ `ingestion failed (HTTP n)` plus the parsed body message when available. Network error ⇒ `destination not reachable`.
- Surfaced messages are truncated (~300 chars) into `TelemetryStatus.lastError.summary`; delivery health must never report "last delivered" for a batch whose events were rejected.

### Delivery cadence (research D9)

- Flush cadence: ≤5s interval or ≤20 queued records, whichever first; best-effort flush on server shutdown.
- Failure handling: exponential backoff per failed flush (cap 60s); no record is retried more than until queue bound evicts it (drop-oldest at 500). Outcomes update `TelemetryStatus` (`lastDeliveredAt`, `lastError`).
- The pipeline dials Langfuse **only** while config is enabled and probed-valid — the network-level half of FR-002.

## Version support

The OTLP endpoint exists since Langfuse **v3.22.0**, so v3+ and v4 deployments keep working. **Langfuse v2-only deployments no longer receive delivery**: on v4 (`events_only` write mode) the legacy `POST /api/public/ingestion` keeps HTTP 207 but rejects every event type except scores, so the legacy path is dead for traces/observations. The probe endpoint works across v2–v4 and stays the enable-time validation.

## Non-goals

- No OpenTelemetry SDK dependency — the client stays a small typed module over global `fetch` (research D8).
- No prompt-management pull, no score push (research D8).
- No multi-destination fan-out in v1; the sink design keeps the door open (FR-011) but only Langfuse is implemented.
