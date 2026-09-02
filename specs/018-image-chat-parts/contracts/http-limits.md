# Contract: HTTP Body Limits on `/api/db/query` and `/api/llm/proxy`

**Feature**: `018-image-chat-parts` | **Status**: Draft (Phase 1)

The only server-side contract change in this feature. Both routes exist today; only their
request-body ceiling changes. No parsing, schema, envelope, or response changes anywhere.

## 1. Change

| Route | File | Today | Contract |
|---|---|---|---|
| `POST /api/db/query` | `server/src/pg.ts` (registered in `server/src/server.ts`) | Fastify default 1 MiB | `bodyLimit: 16 * 1024 * 1024` (16 MiB) |
| `POST /api/llm/proxy` | `server/src/llm-proxy.ts` | Fastify default 1 MiB | `bodyLimit: 16 * 1024 * 1024` (16 MiB) |

Rationale: one downsized image ≈ 500 KB raw ≈ 667 KB base64 inside JSON params; the 8-image
guardrail plus context headroom needs multi-MiB requests. Bounded 16 MiB follows the existing
per-route override precedent (backup/import routes: `bodyLimit: 512 * 1024 * 1024`). All other
routes keep the conservative default.

## 2. Unchanged guarantees

- `/api/db/query`: request schema (`op`/`sql`/`params`/`stmts`, `additionalProperties:false`),
  positional-row response mapping, 503-while-restoring, 400-on-SQL-failure — all identical.
- `/api/llm/proxy`: `LlmProxyRequest` envelope (`url`/`method`/`headers`/opaque `body` string),
  verbatim stream passthrough, hop-by-hop header stripping, 400/502 behavior — all identical.
  Pass-through of provider request bodies (including image parts) is already its behavior
  (FR-004); only larger bodies now fit.
- Auth/topology: neither route is host-exposed beyond the existing compose network; no CORS or
  key changes.

## 3. Verification hooks

- Server tests (`server/src/`) assert route registration with the new limit and that payloads
  just over the old 1 MiB default now succeed end-to-end (e.g. an INSERT carrying a >1 MiB
  base64 param via the query handler, and a proxy POST whose opaque body exceeds 1 MiB).
- Root tests assert the client `RemotePgDriver` path is unchanged (no client-side cap exists
  today; none is added).
