# Data Model: Optional Telemetry (Langfuse First)

Phase 1 output. Entities, fields, validation, and state transitions derived from [spec.md](./spec.md) FRs. Storage-wise this feature adds **no tables** — config lives in one `settings` KV row and pending records live in bounded in-memory queues (see [research.md](./research.md) D2/D4/D9).

## Entity: TelemetryConfig

Where the owner's decisions live. Persisted as the `telemetry` key in the existing `settings` KV store (`src/lib/db/schema.ts` settings table), written only via `PUT /api/telemetry/config` (research D5).

| Field | Type | Constraints |
|---|---|---|
| `enabled` | `boolean` | Default `false` (FR-001). Persistent row may be absent ⇒ treated as disabled. |
| `host` | `string` | `https?://` origin of the Langfuse instance, no path/query/fragment. Required when `enabled`. |
| `publicKey` | `string` | Langfuse public key (`pk-lf-…` shaped; non-secret by design). Required when `enabled`. |
| `captureMode` | `'content' \| 'metadata'` | Default `'content'`. Descriptions shown at selection point (FR-008). |
| `updatedAt` | `string` (ISO 8601) | Set by the config route on every accepted write. |

**Validation rules** (enforced server-side in the config route, FR-004/FR-008):

- Enabling requires valid `host` + `publicKey` **and** the server env holding a non-empty `MAYON_LANGFUSE_SECRET_KEY`; a missing env secret is reported as an explicit configuration error, never silently ignored.
- Enabling (and host/publicKey changes while enabled) must pass the authenticated probe (research D6); rejected probe ⇒ config **not** activated (previous active state retained, failure surfaced).
- `captureMode` changes are accepted without probe and apply to subsequent records only.

**Secret (out-of-band)**: `MAYON_LANGFUSE_SECRET_KEY` env var on the server — never part of this entity, never returned by any API, never logged (constitution I).

**State transitions**:

```text
absent ──PUT(enabled)──▶ active ──PUT(enabled=false)──▶ disabled ──PUT(enabled)──▶ active
                             │
                             └─PUT(host|publicKey while enabled)──▶ (re-probe) ──ok──▶ active
                                                                            └─fail──▶ active-with-previous-config + surfaced error
```

Disable semantics (FR-003): server drops its pending queue synchronously inside the route handler; browser relay buffer is discarded on next tick; capture no-ops from the next record onward.

## Entity: TelemetryEventRecord

The normalized capture unit — one LLM interaction. Assembled in the browser at the trace seam (research D1), stripped per capture mode (research D9), POSTed in batches to `/api/telemetry/events`, mapped to Langfuse events per [contracts/langfuse-ingestion.md](./contracts/langfuse-ingestion.md). Shape lives in `@mayon/shared` so web and server agree without deep imports.

| Field | Type | Present in mode | Notes |
|---|---|---|---|
| `id` | `string` (uuid) | both | Client-generated; ingestion-idempotency anchor. |
| `kind` | `'chat-turn' \| 'title' \| 'brief' \| 'quiz' \| 'grading' \| 'lab' \| 'branch-summary' \| 'mcp-sampling'` | both | Which generator produced it (FR-011 generic sink). |
| `chatId` | `string` | both | Session linkage ⇒ Langfuse `sessionId` (FR-006, SC-006). |
| `model` | `string` | both | Model id as used by the SDK call. |
| `provider` | `string` | both | Provider kind (e.g. `openai-compatible`, `ollama`). |
| `startedAt` | `string` (ISO 8601) | both | Interaction start. |
| `durationMs` | `number` | both | Wall time of the interaction. |
| `outcome` | `'success' \| 'error' \| 'aborted'` | both | Error records carry `errorDetail` (FR-006 scenario 3). |
| `errorDetail` | `string` | both (when errored) | Short reason; no stack dumps, no key material. |
| `input` | provider-agnostic message/prompt structure | `content` only | Full fidelity for dataset-building (FR-012). |
| `output` | `string` | `content` only | Final accumulated text (partial text if aborted). |
| `usage` | `{ input?: number; output?: number; total?: number }` | both | When the provider reported it; absent otherwise. |

**Validation rules**:

- `input`/`output` MUST be absent (not empty-string) in `metadata` mode — the relay rejects records that carry content fields while config says `metadata` (defense in depth behind client-side stripping, FR-009).
- Content fields are capped at ~128 KiB per field at assembly; beyond that, truncated with a `truncated: true` marker in the record (edge case: extremely long conversations).
- Records never contain API keys, auth headers, or raw wire bodies — assembly works from SDK-level values only (constitution I secret rule).

**Lifecycle**:

```text
assembled (browser) ──stripped per mode──▶ buffered (≤50 / ≤5s, drop-oldest) ──POST──▶ server queue (≤500, drop-oldest)
                                                                                                                                 │
                       disabled anywhere along the way ──▶ record discarded, never delivered (FR-003)
                                                                                                                                 │
                                                                                                              flush batch ──▶ Langfuse (or backoff ≤60s, then retry)
```

## Entity: TelemetryStatus

Delivery-health projection for the UI (FR-010, Story 4). Derived server-side from the ingest pipeline; never blocks chat; polled only while the telemetry settings section is visible.

| Field | Type | Notes |
|---|---|---|
| `configured` | `boolean` | Active config exists (enabled or not). |
| `enabled` | `boolean` | Mirrors config. |
| `captureMode` | `'content' \| 'metadata'` | Mirrors config. |
| `secretPresent` | `boolean` | Whether the server env secret is set (named reason when false). |
| `queueDepth` | `number` | Pending records on the server. |
| `lastDeliveredAt` | `string \| null` (ISO 8601) | "Recent successful delivery" signal (Story 4 scenario 4). |
| `lastError` | `{ at: string; summary: string } \| null` | Class + short summary (unreachable / rejected / other); no secrets, no bodies. |

**State transitions**: healthy ⇄ degraded (delivery failing) driven by flush outcomes; both coexist with `enabled: true`; `enabled: false` freezes the projection (queue pinned at 0 after the drop).

## Relationships

```text
TelemetryConfig ──governs──▶ capture (browser) ──produces──▶ TelemetryEventRecord* ──consumed by──▶ server pipeline ──projects──▶ TelemetryStatus
        │                                                                                            │
        └── validated against ──▶ Langfuse (probe on enable)                                          └── delivered to ──▶ Langfuse traces/generations
                                                                                                                          (sessionId = chatId)
```

Mayon's own chat data (chats/messages tables) is untouched — telemetry reads identifiers at capture time and never writes back.
