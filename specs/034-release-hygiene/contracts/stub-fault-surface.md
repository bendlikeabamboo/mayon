# Contract: langfuse stub fault surface

Scope: `tests/fixtures/langfuse-stub/server.mjs` (026 telemetry e2e dependency).
Preserves the abort-resilience motivation of `86e83db` while removing process-wide
fault swallowing (issue #74 item 5).

## HTTP surface (unchanged routes)

| Route | Behavior |
|---|---|
| `GET /api/public/projects` | 200 probe response (unchanged). |
| `POST /api/public/otel/v1/traces` | Valid OTLP/JSON export → recorded, 200 `{}`. Malformed JSON **or aborted body** → `400 {"error":"malformed JSON body"}` — answered only if the socket is still writable; a dead socket is dropped silently (no write attempt). |
| `GET /__received` | 200 batches/received/spans (unchanged). |
| `POST /__reset` | 200 `{ok:true}` (unchanged). |
| other | 404 (unchanged). |

## Fault-handling rules (normative)

1. **No process-level handlers**: the file contains no
   `process.on('uncaughtException')` and no `process.on('unhandledRejection')`.
2. **Body reads settle**: `readBody` resolves/rejects on `end` / `error` / early
   client abort (`aborted`/`close` before `end`) — no path leaves the promise
   pending and no path needs a process handler.
3. **Writes are guarded**: `sendJson` (or its callers) never writes to a response
   whose socket is gone (`res.writableEnded` / `socket.writable` guard, or an
   attached `res.on('error')` no-op). Writing to a destroyed response was the actual
   crash path the old handlers masked.
4. **Genuine faults crash**: any other unexpected exception propagates and terminates
   the stub process (visible in e2e deck output) — this is the desired loud failure.
5. `server.on('clientError')` stays: per-connection 400 + socket end
   (`server.mjs:96-99`).

## Verification (standalone, no Docker)

`node --check tests/fixtures/langfuse-stub/server.mjs`; then a probe script that
boots the stub on a free port and asserts: malformed body → 400; aborted body
(mid-body disconnect) → process alive, no phantom batch in `/__received`;
`POST /__reset` → 200; `grep -c "process.on" server.mjs` → only the `clientError`
listener on `server` (zero `process.on` matches). See quickstart S5.
