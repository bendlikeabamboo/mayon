# Plan — P-pg-1: Postgres spike

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-1, lines
> 131–171). This file expands that phase into implementation-ready tasks.
> Status: implementation-ready. Authored 2026-07-13.
> Scope: **this plan only**. P-pg-2 (schema/proxy), P-pg-3 (boot gating, server-required),
> P-pg-4 (FTS), P-pg-5 (backup/restore), P-pg-6 (OPFS→PG importer), P-pg-7 (tests/cleanup/docs)
> are explicitly out of scope and get their own plans.

## Goal

Stand up Postgres in compose and prove the server can query it over the existing
`DbQueryRequest` contract (`op: query|batch|exec`). The server advertises a new `'pg'` cap
when the pool is live. **No browser wiring changes**: OPFS remains the sole primary store,
the server stays optional, and `bootstrapDb()`/boot are untouched. The only observable
signals are `GET /api/health` (caps include `'pg'`) and a curl round-trip against
`POST /api/db/query`.

## The core tension this plan resolves

`POST /api/db/query` is currently shared by two concerns:
1. The **sandbox SQLite inspector** (`server/src/db.ts:42` → `src/lib/server/sandbox-db.ts:5`
   → `SandboxDbSection.svelte`), which runs SQLite-specific SQL (`sqlite_master`, `PRAGMA`).
2. The future-primary **`RemotePgDriver`** (`src/lib/db/driver/pg.ts:6`), still non-primary
   until P-pg-3.

The refinement says "point the existing `/api/db/query` route at PG" **and** "the sandbox DB
keeps its own route/instance — separate concern." Those are only consistent if the sandbox
**moves to its own route**. This plan relocates the sandbox to `POST /api/sandbox/query`
(same SQLite handler, new path) and repoints `/api/db/query` at PG.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| P1 | PG-down boot behavior: **server starts, omits `'pg'` from caps, logs a clear error.** Health still responds `ok:true`. | Confirmed with user. Matches the refinement's parenthetical "(no 'pg' cap)"; avoids a compose restart-loop / `depends_on: server(healthy)` never going green on a PG hiccup; lets P-pg-3 distinguish "server up, DB down." |
| P2 | Sandbox route moves `POST /api/db/query` → **`POST /api/sandbox/query`** (SQLite handler unchanged). `/api/db/query` becomes PG-backed. | Required to satisfy "sandbox keeps its own route." Browser `RemotePgDriver` already calls `/api/db/query`, so it transparently hits PG once the server repoints it. |
| P3 | PG client lib = **`pg`** (node-postgres) + `@types/pg`. | Locked by epic decision D1 (drizzle first-class, mature). |
| P4 | **No real PG in the automated test suite this phase.** Test the PG handler with a **mock pool** (thin `{ query(text, params) }` interface) for placeholder translation, row/column conversion, batch txn/rollback, and exec `rowCount`. Testcontainers (D7) stay deferred to P-pg-7. | D7 is explicitly P-pg-7's call. Keeps `pnpm --filter @mayon/server test` fast and green without a container; the real PG round-trip is the **manual** curl gate. |
| P5 | **Placeholder translator** (`?`/`?n` → `$1..$n`) is implemented now as interim glue, with unit tests, even though nothing exercises `?` against PG this phase. | Refinement lists it as a "watch out." It is **idempotent on PG-native `$n`** (the curl gate uses `$1::int` and must pass through untouched). It is removed in P-pg-2 when drizzle `pg-proxy` emits `$n` natively. |
| P6 | `exec` returns `{ changes: rowCount ?? 0, lastInsertRowid: null }`. `lastInsertRowid` is already `null`-permissive in `DbQueryResponse` (`protocol.ts:24`). | PG has no rowid concept. |
| P7 | **No browser/boot change.** `'pg'` is added to the `ServerCap` union (additive); `serverStatus.has('pg')` becomes available but is **unused** until P-pg-3. `bootstrapDb()` still uses OPFS; `detectServer()`/`+layout.svelte` untouched. | P-pg-3 owns server-required gating. Adding the cap is a non-breaking type widening. |
| P8 | PG port is **never published** to the host; only the server connects over the internal docker network. `.env`/compose hold `DATABASE_URL`, never the SPA bundle. | Epic §4.1 security invariant. |
| P9 | `buildApp` gains an injectable pg pool so tests are hermetic: `buildApp(dbPath, opts?: { pgPool?, pgReady? })`. Prod `start()` builds the real pool from `DATABASE_URL`. | Lets tests assert both the PG-up path (mock pool) and the PG-down path (no pool / `pgReady:false`) without a container. |

## Grounding (verified current state)

- `ServerCap` union — `packages/shared/src/protocol.ts:1` (`'stdio-mcp'|'sandbox-db'|'llm-proxy'|'backup'`); adding `'pg'` is additive.
- Wire types — `DbQueryRequest` (`protocol.ts:13`), `DbQueryResult { columns: string[]; rows: unknown[][] }` (`:17`, **positional rows**), `DbQueryResponse` exec shape `{ changes, lastInsertRowid }` (`:21`).
- Server entry — `server/src/server.ts:16` `buildApp(dbPath)`; health caps hardcoded at `:25` (`['stdio-mcp','llm-proxy','sandbox-db','backup']`); `start()` at `:45`.
- Sandbox route — `server/src/db.ts:42` `registerSandboxDb` mounts `POST /api/db/query` against `better-sqlite3`; query/batch/exec logic at `:71`–`101`; batch wraps in `db.transaction()` and rolls back on error (`:84`).
- Browser sandbox client — `src/lib/server/sandbox-db.ts:5` posts to `/api/db/query`; `sandboxTables()` queries `sqlite_master` (`:34`).
- Browser PG driver — `src/lib/db/driver/pg.ts:6` posts to `/api/db/query` (unchanged by this plan; now hits PG).
- Browser boot — `src/routes/+layout.svelte:17` `bootstrapDb()` (OPFS, untouched), `:32` `detectServer()` → `serverStatus.markConnected` (untouched).
- Compose — `docker-compose.yml`: service `server` (`:8`), `depends_on: [server]` for web (`:6`), volume `sidecar-data` (`:15,:18`, **kept** per P-pg-0 R3). No `db` service yet.
- Vite dev proxy — `vite.config.ts:45` `/api`→`localhost:4319` (unaffected; `pnpm dev` still OPFS-primary, server optional).
- No `.env`/`.env.example` exists → created this phase.
- AGENTS.md `:148` (P4 gate) says sandbox is "exposed via `POST /api/db/query`" → goes stale on route move; minimal touch in T7.
- Server tests — `server/src/server.test.ts:24` asserts caps array exactly; `server/src/db.test.ts` exercises the sandbox route at `/api/db/query` (SQLite syntax). Both must move/update.
- `server/vitest.config.ts` includes `src/**/*.test.ts`, `environment: 'node'`.

## Hard rules (non-negotiable this phase)

- **No behavior change to boot or the browser primary store.** OPFS stays sole primary; server stays optional; `bootstrapDb()` untouched.
- **Sandbox inspector keeps working** at its new route with identical SQLite semantics.
- **`/api/db/query` is the only route repurposed** (→ PG). Sandbox → `/api/sandbox/query`. No other routes move.
- **No secrets in the SPA bundle.** `DATABASE_URL` lives in `.env`/compose only.
- **PG port not published.**
- **`pnpm --filter @mayon/server test` green without a running PG** (mock pool; P4).

## Prerequisite (verify before starting)

1. **P-pg-0 is merged** (or its working tree applied). This plan assumes `server/` exists,
   `@mayon/server` is the package name, and the rename is complete.
2. **The server Docker image builds and starts** — i.e. the `Cannot find package 'fastify'`
   failure reported in `refinement/2026-07-12_notes_on_use.md` is resolved (P-pg-0 owns this
   via its `pnpm deploy --prod` step). P-pg-1's `docker compose up` gate cannot pass
   otherwise. If still broken, fix the deploy step before proceeding (it is on the critical
   path for every acceptance gate below).

---

## Tasks

> Order is a suggested dependency sequence. `git mv` for file moves. After all edits:
> `pnpm install` (adds `pg`), then the verification block.

### T1 — Compose: add `db` service + env
- `docker-compose.yml`: add a `db` service — `image: postgres:17-alpine`; env
  `POSTGRES_DB=mayon`, `POSTGRES_USER=${POSTGRES_USER:-mayon}`,
  `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-mayon}`; volume `pg-data:/var/lib/postgresql/data`;
  healthcheck `pg_isready -U mayon -d mayon` (interval/timeout/retries sensible). **Do not
  publish** any host port (`expose: '5432'` internal only).
- `server` service: add `depends_on: db: { condition: service_healthy }`; add env
  `DATABASE_URL: postgres://mayon:${POSTGRES_PASSWORD:-mayon}@db:5432/mayon`.
- Add top-level `volumes: pg-data:`. **Keep** `sidecar-data` (P-pg-0 R3 defers its rename).
- New `.env.example` (committed): `POSTGRES_USER=mayon`, `POSTGRES_PASSWORD=mayon`,
  `POSTGRES_DB=mayon`, `DATABASE_URL=postgres://mayon:mayon@db:5432/mayon`. Document that
  these are local single-user defaults.

### T2 — Server dep: add `pg`
- `server/package.json`: add `"pg": "^8.13.0"` to `dependencies` and `"@types/pg": "^8.11.0"`
  to `devDependencies`.
- `pnpm install` (regenerates lock). Note: `pg` is a pure-JS dep (no native build), so
  `onlyBuiltDependencies` is unaffected.

### T3 — Server PG module: `server/src/pg.ts` (new)
Export:
- `createPgPool(databaseUrl: string): pg.Pool` — `new pg.Pool({ connectionString, max: 10 })`.
- `probePg(pool: pg.Pool, opts?: { retries?: number; delayMs?: number }): Promise<boolean>` —
  runs `SELECT 1`; retries with backoff (default ~5 attempts, ~500ms) before returning `false`
  (never throws — swallows + logs). Implements P1.
- `translatePlaceholders(sql: string): string` — converts SQLite-style `?` (positional,
  sequential) and `?n` (explicit) to PG `$1..$n`; **leaves existing `$n` untouched**
  (idempotent on PG-native SQL, so the curl gate's `$1::int` passes through). Pure function.
- `pgQueryHandler(pool: pg.Pool, req: DbQueryRequest): Promise<DbQueryResponse>` — maps the
  contract:
  - `query` → `pool.query(translate(sql), params)` → `{ columns: res.fields.map(f=>f.name),
    rows: res.rows.map(r => res.fields.map(f => r[f.name])) }` (**positional**, matching
    `DbQueryResult`).
  - `batch` → `BEGIN` … run each stmt (reader → `{columns,rows}`, non-reader →
    `{columns:[],rows:[]}`) … `COMMIT`; on any error `ROLLBACK` and rethrow (mirrors the
    better-sqlite3 transaction semantics in `db.ts:84`). Returns `{ results }`.
  - `exec` → `pool.query(translate(sql))` → `{ changes: res.rowCount ?? 0, lastInsertRowid: null }` (P6).

### T4 — Repoint routes + health cap
- `server/src/db.ts`: in `registerSandboxDb`, change the mounted path `'/api/db/query'` →
  `'/api/sandbox/query'` (`:44`). Handler body unchanged (still `better-sqlite3`).
- `server/src/server.ts`:
  - `buildApp(dbPath, opts: { pgPool?, pgReady? } = {})` (P9). Register a **new**
    `POST /api/db/query` route (same JSON schema as the sandbox route: `op`/`sql`/`params`/
    `stmts`) that delegates to `pgQueryHandler(opts.pgPool, body)` when a pool is present;
    when no pool, return `503 { error: 'pg not configured' }`.
  - Health caps: build conditionally — always include
    `['stdio-mcp','llm-proxy','sandbox-db','backup']`; append `'pg'` only when
    `opts.pgReady === true` (P1/P7). `ok:true` regardless.
  - `onClose` hook (`:37`): add `await opts.pgPool?.end()` before `sandboxDb.close()`.
  - `start()`: read `DATABASE_URL` from env; if set, `createPgPool` + `probePg` (logs
    `'pg: ready'` or `'pg: unreachable — ' + err`); pass `{ pgPool, pgReady }` into
    `buildApp(SANDBOX_DB_PATH, …)`. If `DATABASE_URL` absent, log `'pg: DATABASE_URL not set
    (pg cap disabled)'` and start without a pool (server still serves other caps).
- `src/lib/server/sandbox-db.ts`: change `post()` URL `'/api/db/query'` → `'/api/sandbox/query'`
  (`:5`). (`sandboxTables()`' `sqlite_master` query still valid.)
- `src/lib/db/driver/pg.ts`: **unchanged** (already calls `/api/db/query`, now PG-backed).

### T5 — Shared types: add `'pg'` cap
- `packages/shared/src/protocol.ts:1`: `ServerCap` union += `| 'pg'`. Additive; no re-export
  change needed (already re-exported in `index.ts`).
- No browser consumption change (P7) — `serverStatus.has('pg')` is available but unused.

### T6 — Server tests (hermetic; mock pool, no real PG)
- `git mv server/src/db.test.ts server/src/sandbox.test.ts`; update every `url: '/api/db/query'`
  → `'/api/sandbox/query'`. Keep all SQLite assertions (they now prove the sandbox still works
  at its new route). `describe` label `'POST /api/db/query'` → `'POST /api/sandbox/query'`.
- New `server/src/pg.test.ts`:
  - `translatePlaceholders`: `?`→`$1,$2…`; `?3`→`$3` (explicit, with mixing); `$1::int`
    **unchanged** (idempotency); no params / empty string.
  - `pgQueryHandler` with a **mock pool** (fake `{ query: vi.fn(...) }`):
    - `query` returns `{ columns: ['x'], rows: [[42]] }` from a fake
      `{ rows:[{x:42}], fields:[{name:'x'}] }`.
    - `exec` returns `{ changes: N, lastInsertRowid: null }` from `{ rowCount: N }`.
    - `batch`: success path returns per-stmt `results`; a failing mid-batch stmt triggers
      `ROLLBACK` (assert `query` called with `BEGIN`/`ROLLBACK`/`COMMIT` in order) and throws.
- `server/src/server.test.ts`:
  - PG-up path: `buildApp(':memory:', { pgPool: mockPool, pgReady: true })` → health caps
    include `'pg'`; `/api/db/query` delegates to `pgQueryHandler` (assert a query round-trips
    through the mock).
  - PG-down path: `buildApp(':memory:', { pgReady: false })` (no pool) → health is `200 ok:true`
    with caps **excluding** `'pg'` but including the other four; `/api/db/query` returns `503`
    (proves P1). The existing "caps exactly equal […]" assertion (`:24`) must be relaxed to
    "includes the four base caps" so it holds in both paths.

### T7 — Minimal docs touch (keep honest; full rewrite is P-pg-7)
- `AGENTS.md:148` (P4 gate): `POST /api/db/query` → `POST /api/sandbox/query` (the sandbox
  inspector's route moved; `/api/db/query` is now the PG-backed primary-DB route added in
  P-pg-1). Add a one-line note that `GET /api/health` may now also advertise `'pg'`.
- Do **not** rewrite P0–P5 acceptance gates or architectural claims (P-pg-3/P-pg-7 own that).
- `.env.example` (from T1) documents `DATABASE_URL` + PG config (satisfies the epic DoD line).

### T8 — Verify
- `pnpm install`.
- `pnpm lint && pnpm check && pnpm test` (root) — green.
- `pnpm --filter @mayon/server test` — green (hermetic, no PG needed).
- `docker compose build && docker compose up`:
  - `GET /api/health` → `caps: ['stdio-mcp','llm-proxy','sandbox-db','backup','pg']`.
  - `curl -XPOST /api/db/query -H 'content-type: application/json' \
    -d '{"op":"query","sql":"SELECT $1::int AS x","params":[42]}'` →
    `{"columns":["x"],"rows":[[42]]}`.
  - Latency sanity: trivial query single-digit ms on localhost (the epic's "stop if" gate).
  - Sandbox regression: Settings → Sandbox DB → run
    `SELECT name FROM sqlite_master WHERE type='table'` → still works (now via
    `/api/sandbox/query`).
  - PG-down path: `docker compose stop db` → restart server → `GET /api/health` still `200`
    with caps **excluding** `'pg'` (P1); `/api/db/query` returns `503`.

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green.
- `pnpm --filter @mayon/server test` green (mock pool, no real PG).
- `docker compose up` → `'pg'` in health caps; `curl /api/db/query` round-trips a trivial
  PG query; sandbox inspector works at `/api/sandbox/query`; PG-down path degrades cleanly
  (server stays up, `'pg'` cap absent, `/api/db/query` 503).
- `.env.example` documents `DATABASE_URL` + PG config.
- No boot/browser-primary change (OPFS still primary, server still optional).

## Risks

- **Route move breaks a missed caller of `/api/db/query`.** Mitigation: grep guard
  (`rg '/api/db/query' src/ server/`) after T4 — only `pg.ts` (PG driver) and
  `sandbox.test.ts`/`pg.test.ts` should remain; `sandbox-db.ts` must point at
  `/api/sandbox/query`.
- **Placeholder translator mangles PG-native `$n`.** Mitigation: idempotency unit test in
  T6; the curl gate uses `$1::int` directly and must pass through unchanged.
- **`buildApp` signature change breaks existing tests.** Mitigation: `opts` is optional with
  defaults; existing `buildApp(':memory:')` calls still compile (now the PG-down path).
- **`pg.Pool` left open on shutdown.** Mitigation: `onClose` calls `pool.end()` (T4).
- **Docker image still broken (fastify) from P-pg-0.** Mitigation: the Prerequisite blocks
  the manual gate; fix before T8.
- **Compose `depends_on: db(healthy)` stalls the stack if PG never becomes healthy.**
  Acceptable: that is the intended "PG down" state for compose; `pg_isready` healthcheck +
  `probePg` retries cover normal startup latency.

## Out of scope (explicit)

- P-pg-2: `pg-core` schema, `pg-proxy`, regenerated migrations, drizzle queries through
  `repos`, removing the placeholder translator (pg-proxy emits `$n` natively).
- P-pg-3: making `RemotePgDriver` the primary driver, server-required boot gating, the
  `'server-unreachable'`/`'pg'`-absent failure UX.
- P-pg-4: FTS (`tsvector`/GIN/`ts_headline`/`ts_rank_cd`).
- P-pg-5: `pg_dump -Fc` / `pg_restore` app-DB backup/restore (sandbox backup unchanged).
- P-pg-6: OPFS→PG importer.
- P-pg-7: testcontainer PG test strategy (D7), OPFS/WASM/COEP dead-code removal, full
  architectural doc/gate rewrite, `sidecar-data` volume rename.
- Wiring the browser `RemotePgDriver` as primary or exercising it end-to-end (P-pg-3).
- Resolving epic-wide D2 (JSON `text` vs `jsonb`) — belongs to P-pg-2.
