# Contract: Telemetry Relay & Config API (web ↔ server)

Phase 1 output. Same-origin REST surface under `/api/telemetry/*`, registered via the standard `registerTelemetry(app)` module pattern in `buildApp` (`server/src/server.ts`). All routes sit behind the existing auth gate (session + same-origin CSRF when the deployment is locked — no `PUBLIC_ALLOWLIST` entries). Errors follow the repo convention `{ error: string; detail?: string }`.

Types live in `@mayon/shared` (`packages/shared/src/protocol.ts`); this document is the normative behavior contract.

## `PUT /api/telemetry/config`

Apply a telemetry configuration change atomically (research D5).

**Request body** (`TelemetryConfigInput`):

```json
{
  "enabled": true,
  "host": "https://langfuse.example.com",
  "publicKey": "pk-lf-...",
  "captureMode": "content"
}
```

**Behavior**:

- Validation per the [data model](../data-model.md#entity-telemetryconfig): host shape, key presence, mode enum, and (when enabling or changing destination while enabled) the authenticated probe (research D6) run **before** anything is persisted.
- On `enabled: false`: settings row updated **and** the server queue is dropped synchronously in the handler (FR-003).
- Accepted config is persisted to the `telemetry` settings KV row (server-side write) and `updatedAt` stamped.
- Mode-only changes while enabled: no probe, immediate effect for subsequent records.

**Responses**:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, config: TelemetryConfig }` | Applied. |
| 400 | `{ error: 'invalid config', detail }` | Malformed host/mode/key shape. |
| 409 | `{ error: 'destination not reachable', detail }` / `{ error: 'credentials rejected', detail }` | Probe failed; previous active config retained. |
| 409 | `{ error: 'server secret missing', detail: 'MAYON_LANGFUSE_SECRET_KEY is not set' }` | Enable attempted without the env secret. |

## `GET /api/telemetry/status`

**Response** (200): `TelemetryStatus` per the [data model](../data-model.md#entity-telemetrystatus). Cheap, side-effect-free; the UI polls this only while the telemetry settings section is mounted (no global polling loop).

## `POST /api/telemetry/events`

Fire-and-forget record ingestion from the browser relay. Never blocks the caller: the handler validates shape, enqueues, and returns immediately; delivery happens in the background pipeline.

**Request body**:

```json
{ "records": [ TelemetryEventRecord, ... ] }
```

- Batch bound: ≤50 records per request, request body ≤2 MiB (`bodyLimit`). Larger batches are the client relay's signal it is over its window; oversized requests are rejected `400` and the surplus dropped client-side.
- Mode enforcement: if active config says `metadata`, any record carrying `input`/`output` is rejected (`400 { error: 'content in metadata mode' }`) and **not** enqueued — defense in depth behind client-side stripping (FR-009).
- Records accepted while telemetry is disabled or unconfigured: rejected `409 { error: 'telemetry disabled' }` — the server is the second gate on FR-002's zero-emission guarantee (it never dials Langfuse unless enabled).
- Queue at capacity: still `202` — oldest records are dropped silently (bounded-queue edge case); status exposes `queueDepth`.

**Responses**: `202 { ok: true }` enqueued (or dropped-oldest under pressure) · `400` shape/mode violations · `409` disabled.

## Non-goals of this surface

- No record read-back, no queue inspection beyond `TelemetryStatus`, no delete/replace of already-delivered data (Langfuse owns retention).
- No Langfuse credentials ever appear in any request or response of this API.
