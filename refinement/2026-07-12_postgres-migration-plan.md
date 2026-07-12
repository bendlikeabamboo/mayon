# Implementation Plan — Postgres Primary Store

> Companion to `refinement/2026-07-12_migrating-away-from-SQLite WASM.md`
> (brainstorming/investigation). This is the **execution plan**.

**Role:** Principal engineer / architect.

**Date:** 2026-07-12.

**Scope:** Migrate Mayon's primary data store from in-browser SQLite-WASM/OPFS
to a dockerized Postgres, owned by a **required** local server, with downloadable
backup (`pg_dump -Fc`) and restore (`pg_restore`).

---

## 0. Terminology (locked — use these terms everywhere)

The migration makes the former "sidecar" load-bearing. "Sidecar" implies
optional/adjacent — once it's required, the word lies. This table is the single
source of truth for naming. **Every phase must use these terms** in code, docs,
commit messages, and UI.

| Old term | New term | Rationale |
|---|---|---|
| sidecar | **server** | It's now the required local backend (Fastify + Postgres). Not adjacent — it *is* the app's server tier. |
| `@mayon/sidecar` (package) | `@mayon/server` | Package name reflects its role. |
| `sidecar/` (dir) | `server/` | Source dir. |
| `SidecarDriver` | `RemotePgDriver` | It's a driver over a remote (HTTP→pg) connection, not "a sidecar". |
| `sidecarStatus` (store) | `serverStatus` | State of the required server. |
| `SidecarStatus.svelte` | `ServerStatus.svelte` | Badge component. |
| `SidecarCap` (type) | `ServerCap` | A capability advertised by the server. |
| `sidecarClient` | `serverClient` | HTTP/WS client. |
| `detectSidecar()` | `detectServer()` | Boot probe. |
| `SidecarStdioMcpTransport` | `ServerStdioMcpTransport` | MCP transport over the server. |
| `SIDECAR_FALLBACK_HINT` | `SERVER_REQUIRED_HINT` | Error hint wording changes too. |
| "Run the Mayon sidecar (`docker compose up`)" | "Start the Mayon server (`docker compose up`)" | All user-facing copy. |
| "DB error" badge (OPFS missing) | "Server unreachable" | New failure mode. |
| primary store = OPFS `mayon.sqlite` | primary store = **Postgres** (`mayon` db) | |
| sandbox SQLite (`/data/sandbox.sqlite`) | **sandbox DB** (unchanged concept; may later fold into PG as a schema — see §11.6 of the investigation) | Keep the word "sandbox" for the MCP-tool scratch DB. |
| in-memory sql.js driver (tests) | **`MemorySqliteDriver`** (legacy, tests only) *or* **`TestPgDriver`** (new) | See Phase 6. |

### Naming conventions for the new code
- Driver file: `src/lib/db/driver/pg.ts` exporting `createRemotePgDriver()`.
- Server pg module: `server/src/pg.ts` (pool + query/batch/exec handler).
- Backup routes: `GET /api/backup/db`, `PUT /api/backup/db` (the *app* DB;
  sandbox stays at `/api/backup/sandbox`).
- Health cap additions: `'pg'` (primary store live) — advertised alongside the
  existing caps. The server is "up" regardless; `'pg'` means the pool connected
  and migrations ran.
- `DATABASE_URL` env var (standard PG convention).

> **Migration note:** a full mechanical rename of `sidecar`→`server` across ~163
> grep hits is its own contained pass (Phase 1) and is **not** mixed into the
> Postgres logic changes. Do it once, atomically, with tests green.

---

## 1. Guiding principles

1. **The `StorageDriver` seam stays.** Repositories never change shape; only the
   driver implementation and the drizzle proxy dialect change. This is the
   single biggest risk-reducer.
2. **One dialect change at a time.** Schema → proxy → placeholders → FTS are
   distinct, testable steps. Don't bundle them.
3. **Server is required, but degrades clearly.** No silent half-working state.
   If `detectServer()` fails or `'pg'` cap is absent, the app shows a single,
   actionable "Server unreachable — run `docker compose up`" screen.
4. **Backup/restore parity with today's UX.** Download button → file; upload →
  validate → safety dump → restore → reload. Same flow, different bytes.
5. **No data loss.** The OPFS→PG importer (Phase 5) is reversible and always
   takes a pre-migration safety dump.
6. **Tests gate every phase.** A phase is "done" when `pnpm lint && pnpm check &&
   pnpm test` (root) and `pnpm --filter @mayon/server test` are green and the
   phase's manual acceptance gate passes.

---

## 2. Phase overview

| Phase | Name | Goal | Risk | Acceptance signal |
|---|---|---|---|---|
| **P-pg-0** | Rename: sidecar → server | Mechanical rename; zero behavior change. | Low (tedious) | All tests green; "server" terminology everywhere. |
| **P-pg-1** | Postgres spike | `db` + server pg pool + `POST /api/db/query` round-trips a trivial query. | Low | `curl POST /api/db/query` returns rows; `'pg'` cap in health. |
| **P-pg-2** | Schema & proxy to PG | `pg-core` schema, `pg-proxy`, regenerated migrations; drizzle queries work end-to-end through the server. | Medium | A chat + messages round-trip via `repos`. |
| **P-pg-3** | Boot & gating | `RemotePgDriver` is the primary driver; server+pg required at boot; new failure UX. | Medium | App boots to "DB ready" with compose up; shows "Server unreachable" without. |
| **P-pg-4** | Full-text search | `tsvector` + GIN + `ts_headline`/`ts_rank_cd`; `searchRepo` ported. | Medium | Search returns ranked hits with snippets. |
| **P-pg-5** | Backup & restore | `pg_dump -Fc` download + `pg_restore` upload with validation + safety. | Medium | Download/restore round-trip; pre-restore safety dump; non-PG file rejected. |
| **P-pg-6** | Data migration (OPFS→PG) | One-time importer: upload `.sqlite` → server reads → inserts into PG. | High | A real OPFS DB imports cleanly; row counts match; FTS rebuilt. |
| **P-pg-7** | Tests, cleanup, docs | PG test strategy; remove OPFS/WASM code + COEP; rewrite docs & AGENTS gates. | Low-Medium | Full suite green; dead code gone; docs accurate. |

Phases 0–1 are low-risk plumbing. Phases 2–5 are the core rewrite. Phase 6 is
the riskiest (touches user data). Phase 7 is polish + debt removal.

---

## 3. Detailed phases

### Phase P-pg-0 — Rename: "sidecar" → "server"

**Goal:** Make the codebase say what it means, before any logic changes, so the
PG work reads cleanly.

**Scope (mechanical, atomic):**
- Rename dir `sidecar/` → `server/`; package `@mayon/sidecar` → `@mayon/server`
  (in `sidecar/package.json`, root `package.json` pnpm filters, `pnpm-lock`,
  `Dockerfile`, `docker-compose.yml` build context).
- Rename per the table in §0: `SidecarCap`→`ServerCap`, `sidecarStatus`→
  `serverStatus`, `SidecarStatus.svelte`→`ServerStatus.svelte`, `sidecarClient`→
  `serverClient`, `detectSidecar`→`detectServer`, `SidecarDriver`→`RemotePgDriver`
  *(note: this file's *contents* don't change yet — only the name; it still
  talks SQLite-over-HTTP to the sandbox route until P-pg-3)*, the MCP transport
  class, and `SIDECAR_FALLBACK_HINT`→`SERVER_REQUIRED_HINT`.
- Update all user-facing copy: badges ("Server: connected/off"), error hints
  ("Start the Mayon server (`docker compose up`)"), settings section labels.
- Update `packages/shared/src/protocol.ts` type names; re-export from `index.ts`.

**Out of scope:** No Postgres, no schema, no behavior change. The
`SidecarDriver` is *renamed* to `RemotePgDriver` but still points at the
existing SQLite `/api/db/query` route (the sandbox). This is intentional — the
name describes the *pattern* (remote driver), not the current backing DB.

**Verify:** `pnpm lint && pnpm check && pnpm test` green; `docker compose up`
still works; badge reads "Server: connected".

**Commit strategy:** One PR (or a small stack of rename-only commits). Reviewer
verifies it's purely a rename via `git diff --diff-filter=R` and a no-op logic
diff.

---

### Phase P-pg-1 — Postgres spike

**Goal:** Stand up Postgres in compose and prove the server can query it over
the existing `/api/db/query` contract.

**Changes:**
1. `docker-compose.yml`: add a `db` service
   (`postgres:17-alpine`, `POSTGRES_DB=mayon`, `POSTGRES_USER/password` from
   `.env`, `pg-data` volume, `pg_isready` healthcheck). Server `depends_on: db`
   (healthy).
2. `server/package.json`: add `pg` (or `postgres` — pick one; recommend `pg`
   for ecosystem maturity + drizzle first-class support).
3. `server/src/pg.ts`: a `pg.Pool` from `DATABASE_URL`; a handler that maps the
   existing `DbQueryRequest` (`op: query|batch|exec`) → PG calls. **For now,
   point the existing `/api/db/query` route at PG instead of the sandbox
   SQLite.** (The sandbox DB keeps its own route/instance — separate concern.)
4. `server/src/server.ts`: add `'pg'` to caps when the pool connects on boot;
   run a trivial `SELECT 1` probe; fail boot (no `'pg'` cap) if PG is down.
5. `.env.example`: `DATABASE_URL=postgres://mayon:mayon@db:5432/mayon`.

**Watch out:**
- The existing `DbQueryResult` returns `{ columns, rows: unknown[][] }` (positional
  rows, see `protocol.ts:17`). PG's `pg` driver returns named objects — convert
  to positional arrays in the server handler so the wire shape is unchanged
  *for this phase*. (Phase P-pg-2 will revisit whether to switch to named rows
  once drizzle pg-proxy is in place.)
- Placeholder translation: incoming `?`/`?n` (SQLite style used by the current
  driver) → PG `$1..$n`. Do this translation in the server handler for now.
- `exec` today returns `{ changes, lastInsertRowid }` (`protocol.ts:24`) — PG has
  no `lastInsertRowid`; return `rowCount` and null/omit the rowid field. Keep the
  type permissive (it already allows `null`).

**Verify:**
- `docker compose up` → `GET /api/health` returns `caps: [...,'pg']`.
- `curl -XPOST /api/db/query -d '{"op":"query","sql":"SELECT $1::int AS x","params":[42]}'`
  → `{"columns":["x"],"rows":[[42]]}`.
- `pnpm --filter @mayon/server test` green.

**Stop if:** latency from browser→server→pg feels unacceptable on a trivial
query (measure; should be single-digit ms on localhost). If not, reconsider
before investing in P-pg-2.

---

### Phase P-pg-2 — Schema & proxy to Postgres

**Goal:** The drizzle schema, proxy, and migrations are Postgres-native. Real
app data (chats, messages, …) round-trips through `repos`.

**Steps:**
1. **Schema** (`src/lib/db/schema.ts`): `sqlite-core` → `pg-core`.
   - `sqliteTable` → `pgTable`.
   - `integer` (timestamps) → `bigint`/`integer` (epoch-ms stays — don't
     switch to `timestamptz` in this phase; keep the epoch-ms convention from
     `schema.ts:8` to minimize churn; a separate "use timestamptz" cleanup can
     come later).
   - `integer` used as boolean (`is_correct`) → `boolean`.
   - JSON `text` (`checklist`, `payload`, `value`, `brief`, `mcp_config`,
     `metadata`, `trace`, `reasoning`) → `jsonb` (strictly better: queryable,
     indexable). App layer already serializes/parses (`schema.ts:11`), so either
     keep serializing in JS (store as `jsonb` of the parsed value) or store the
     JSON string in a `text` column for now. **Decision (lock):** store as
     `jsonb` and stop double-serializing in the repository layer where trivial;
     but to bound this phase, *initially* keep `text`-as-JSON and convert to
     `jsonb` in a follow-up migration if the win isn't needed now. Pick one and
     note it in the migration.
   - Enums (`role`, `quiz_questions.type`): keep as `text` + `CHECK` for now
     (cheapest); `CREATE TYPE` enums can come later.
   - Foreign keys: identical semantics; PG enforces by default.
2. **drizzle config** (`drizzle.config.ts`): `dialect: 'sqlite'` →
   `'postgresql'`.
3. **Regenerate migrations:** `pnpm db:generate` against the PG schema → new
   `drizzle/` SQL. **Do not** try to translate the old SQLite migrations — start
   a fresh PG migration history. (The OPFS→PG importer in P-pg-6 writes rows
   directly; it does not replay old migrations.)
4. **Proxy** (`src/lib/db/driver/proxy.ts`): `drizzle-orm/sqlite-proxy` →
   `drizzle-orm/pg-proxy`. Same `(remoteCb, batchCb, { schema })` shape.
5. **Migrator** (`src/lib/db/driver/migrator.ts`): the server now has Node `fs`,
   so use drizzle's **native** `migrate()` against `drizzle/` on the server at
   boot. The custom bundler (`bundle-migrations.ts`) and bundled
   `migrations.ts` are no longer needed for production. *(Keep them compiling
   until P-pg-7 to avoid breaking the in-memory test driver, which still uses
   them — see P-pg-6.)*
6. **Placeholder/row audit:** grep `getDriver().query` direct calls (outside
   drizzle). Today only `search.ts` and `migrator.ts` and `self-check.ts` do
   this. `migrator.ts` is going away (server-side now); `search.ts` is deferred
   to P-pg-4; `self-check.ts` uses drizzle. Confirm no other raw-`?` SQL remains.

**Watch out:**
- `onConflictDoUpdate` (used in `settings.ts:33`) — PG supports this; drizzle
  emits the right SQL for pg-core. Verify.
- `sql\`'[]'\`` default for `checklist` (`schema.ts:113`) → `'[]'::jsonb`.
- The `__drizzle_migrations` table shape differs between drizzle's SQLite and PG
  migrators. Don't carry the old one over.

**Verify:**
- `repos.chats.create` + `repos.messages.create` + read back, through the
  browser, against `docker compose up`.
- `pnpm --filter @mayon/server test`: migration runs clean on an empty DB.
- `pnpm check` (svelte-check) — schema type inference still works.

---

### Phase P-pg-3 — Boot & gating (server required)

**Goal:** The app boots against Postgres via the server, and fails loudly +
clearly when the server/PG is down.

**Changes:**
1. **New driver** `src/lib/db/driver/pg.ts` — `createRemotePgDriver()`:
   `query`/`batch`/`exec` over `serverClient.http('/api/db/query')`. This
   replaces the OPFS worker as the primary driver. (The renamed
   `RemotePgDriver` from P-pg-0 *was* the old sandbox sidecar driver; here we
   repoint it at the PG-backed `/api/db/query` and make it the primary.)
2. **`bootstrapDb()`** (`driver/client.ts:48`): instantiate
   `createRemotePgDriver()` instead of `createOpfsDriver()`. Remove the
   `opfsAvailable()` check (`client.ts:7`).
3. **Server-required gate:** `detectServer()` (renamed in P-pg-0) must succeed
   *and* `serverStatus.has('pg')` must be true before `bootstrapDb()` proceeds.
   If not, set `dbStatus` to a new failure state.
4. **`dbStatus` store** (`stores/db.svelte.ts`): add a `'server-unreachable'`
   failure mode (or reuse `'error'` with a typed reason). The UI shows a
   full-screen "Server unreachable — run `docker compose up`" instead of the
   app shell. The badge reads "Server: off" / "DB error".
5. **Dev workflow:** add `docker-compose.dev.yml` (or document running
   `docker compose up db server` alongside `pnpm dev`). `pnpm dev` alone now
   requires the server reachable at the vite proxy (`vite.config.ts:45` already
   proxies `/api`→`:4319`).
6. **Self-check** (`self-check.ts`): still works (uses `repos`); verify it
   passes against PG in dev.

**Watch out:**
- Boot ordering: today `bootstrapDb()` and `detectServer()` run independently
  (`+layout.svelte:17,32`). Now `bootstrapDb()` depends on the server being up.
  Either await `detectServer()` first, or have `bootstrapDb()` poll the server.
- Connection retries: PG may take a few seconds to be ready in compose. The
  server should retry the pool connection (with backoff) before declaring
  `'pg'` absent.

**Verify (manual acceptance):**
- `docker compose up` → app boots, badge "Server: connected"/"DB ready (pg)",
  theme toggle persists (proving PG-backed settings KV), dev self-check passes.
- Stop the server (`docker compose stop server`) → reload → full-screen
  "Server unreachable" with the `docker compose up` hint.
- `pnpm dev` with server running → app works (DB via server).

---

### Phase P-pg-4 — Full-text search

**Goal:** Port `searchRepo` from FTS5 to Postgres FTS, preserving the
`SearchHit` shape and ranking UX.

**Today's FTS5 surface** (must all be replaced):
- `drizzle/0006_search_fts.sql`: `search_fts` virtual table + 12 triggers.
- `search.ts:108`: `MATCH ?1`, `snippet(search_fts,2,char(1),char(2),'…',12)`,
  `bm25(search_fts)`, positional `row[i]`.
- `search.ts:148` `rebuildIndex()`: bulk re-insert.
- `search.ts:85` `fts5Available()`: probe.

**Target PG design:**
- A `search_index` `tsvector` **GENERATED ALWAYS AS** column on each base table
  (or a single `search_fts` materialized view if you want the unified kind
  filter). Simplest: one `tsvector` column per table + a GIN index each, and a
  `UNION ALL` query in `searchRepo.search`. Keep `kind`/`chat_id`/`ref_id`/
  `quiz_id` columns so the `SearchHit` shape maps cleanly.
- Tokenization: `to_tsvector('simple', ...)` or a language config. The current
  `unicode61 remove_diacritics 2` (`migrations.ts:62`) ≈ `'simple'` +
  `unaccent`. Use `'simple'` to start; add `unaccent` extension if needed.
- Ranking: `ts_rank_cd(vec, query)` (built-in). True BM25 needs `paradedb` —
  out of scope unless ranking quality is unacceptable. **Decision (lock):**
  `ts_rank_cd` for now; revisit if search quality regresses.
- Snippets: `ts_headline('simple', body, query, 'StartSel=... StopSel=... MaxWords=12')`
  to mirror the `char(1)/char(2)` marker convention in `renderSnippet()`
  (`search.ts:35`).
- Triggers: PG triggers maintain the `tsvector` on INSERT/UPDATE/DELETE (mirror
  the FTS5 triggers), **or** use `GENERATED ALWAYS AS (to_tsvector(...)) STORED`
  which auto-updates — prefer GENERATED (no trigger maintenance).
- `fts5Available()` → a `pgFtsAvailable()` probe (`SELECT 1 FROM
  pg_ts_config`).

**Changes:**
- New migration `drizzle/0NNN_pg_search.sql` creating the tsvector columns +
  GIN indexes (+ `unaccent` if used).
- Rewrite `search.ts` SQL for `$n` placeholders, `@@ to_tsquery`, `ts_headline`,
  `ts_rank_cd`, named or positional rows per the driver's chosen shape.
- `rebuildIndex()` becomes a no-op (GENERATED columns self-maintain) or a
  one-time backfill for existing rows.
- Keep `stripIndexNoise`, `buildMatchQuery`, `renderSnippet`, `deepLink` as-is
  (they're SQL-agnostic helpers).

**Verify:**
- Insert a message, search for a token → ranked hit with snippet.
- `search-fts5-gate.test.ts` and `search.test.ts` updated and green.

---

### Phase P-pg-5 — Backup & restore

**Goal:** Download a single backup file; restore from it. Parity with today's
`backup.ts` UX, new bytes.

**Server routes** (`server/src/backup.ts`, new — alongside the existing sandbox
backup):

- **`GET /api/backup/db`** — download.
  - Spawn `pg_dump -Fc --no-owner --no-privileges -d $DATABASE_URL`.
  - Stream `stdout` directly to the HTTP response (no temp file, no buffering).
  - Headers: `application/octet-stream`,
    `content-disposition: attachment; filename="mayon-YYYYMMDD.dump"`.
  - Consistency: `pg_dump`'s MVCC snapshot transaction → no torn read even if
    an MCP tool is writing concurrently.
  - Mirror the streaming pattern from the existing `sidecar/src/backup.ts:27`
    (which streams `db.serialize()`), just with a child process's stdout.

- **`PUT /api/backup/db`** — restore.
  1. Receive the body as a buffer (`application/octet-stream`, like the sandbox
     restore at `sidecar/src/backup.ts:51`).
  2. **Validate:** check the `PGDMP` magic header (first 5 bytes). Optionally
     `pg_restore -l` (list TOC) to confirm structure without restoring.
  3. **Safety:** `GET`-style `pg_dump -Fc` of the current DB → return it as
     `mayon-pre-restore-<ts>.dump` (mirror `backup.ts:133-135`). Provide this as
     a download in the restore UI before completing.
  4. **Quiesce:** `pg_terminate_backend(pid)` all connections except the
     restore's own; close the server's pool. (The server holds persistent
     connections — mandatory before a schema drop.)
  5. **Restore:** `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then
     `pg_restore --no-owner --no-privileges --dbname $DATABASE_URL` against the
     uploaded bytes (written to a temp file). `--clean --if-exists` is an
     alternative; prefer the drop-schema approach for a single-user app (cleaner
     state).
  6. **Re-open:** reopen the pool; re-run drizzle migrations (should be no-op);
     re-bootstrap the browser (`rebootstrapWith()` + `location.reload()`, same
     as `backup.ts:138-139`).

**Browser** (`src/lib/db/backup.ts`, rewrite):
- `createBackup()` → `fetch('/api/backup/db')` → blob → download as `.dump`.
- `restoreBackupFromBytes(bytes)`:
  - Validate via the server (or a lightweight `PGDMP` header check in the
    browser; the heavy validation is server-side in step 2).
  - `PUT` the bytes to `/api/backup/db`; the server returns the pre-restore
    safety dump (or a URL to fetch it) in the response.
  - On 204, `rebootstrapWith()` + `location.reload()`.
- `checkBackup` / `validateBackupBytes` / `isSqliteHeader` (the SQLite-specific
  validation in `backup.ts:33-104`) → replaced by PG archive validation.
- `REQUIRED_TABLES` list → a PG equivalent: query `information_schema.tables`
  after restore, or trust `pg_restore -l` TOC.
- Advertise via `serverStatus.has('backup')` (reuse the existing cap) or a new
  `'pg-backup'` cap — **decision (lock):** reuse `'backup'` (it already gates
  the sandbox backup; the app-DB backup is the same capability).

**Watch out:**
- `pg_restore` needs the `pg_dump` format to match the server's PG major
  version (a dump from PG 16 restores fine into PG 17; the reverse may warn).
  Document "restore into the same or newer PG".
- File size: a custom-format dump of a personal learning DB is small (MBs);
  no streaming-upload concerns, but set a sane `bodyLimit` (the sandbox uses
  512 MB at `backup.ts:54`).
- Active stream abort: if the browser cancels a download mid-stream, kill the
  `pg_dump` child (don't leak processes).

**Verify (manual acceptance):**
- Download → valid `.dump` (restore it into a throwaway PG to confirm).
- Restore → subsequent download matches the restored content.
- Upload a non-PG file → clear error, live DB untouched.
- Download while writing → file is valid (not torn).

---

### Phase P-pg-6 — Data migration (OPFS → Postgres)

**Goal:** Existing users with data in OPFS `mayon.sqlite` can move it into
Postgres without loss. **Highest-risk phase** — touches real user data.

**Design:**
- A **one-time importer** surfaced as a Settings affordance: "Import data from a
  browser backup."
- User flow:
  1. (Pre-step, manual) User exports their current OPFS DB via the *old* backup
     button (still available until P-pg-7 removes it) → `mayon-YYYYMMDD.sqlite`.
  2. In Settings → "Import from SQLite backup" → upload the `.sqlite` file.
  3. Server receives it, opens it with `better-sqlite3` (already a dep), reads
     each table, converts types (0/1→bool, JSON-text→jsonb), and inserts into PG
     in idempotent batches (upsert by PK).
  4. Rebuild FTS (if not using GENERATED) / reconcile migration head.
  5. Return a summary (row counts per table); browser reloads.

**Watch out:**
- **Idempotency:** upsert (`ON CONFLICT DO UPDATE`) so a re-run doesn't
  duplicate. Provide a "dry-run" mode (counts only, no writes).
- **Order:** respect FK ordering (chats → messages → branch_sources, etc.) or
  defer constraints during the import transaction.
- **Schema drift:** the SQLite backup may be from an older app version (missing
  columns added by later migrations — `brief`, `mcp_config`, `tool_call_id`,
  etc.). The importer must tolerate absent columns (default null).
- **Migration head:** write a single row into PG's `__drizzle_migrations`
  equivalent so the app doesn't try to re-run migrations and fail on
  already-populated tables.
- **Safety:** always `pg_dump` the current PG DB before importing (in case the
  user imports into a non-empty DB). Offer "replace all" vs "merge" semantics
  (lock decision: **replace** for v1 — simpler; the importer drops+recreates
  the schema then inserts, mirroring the restore flow).
- **Keys:** the OPFS backup never contained keys (IndexedDB); after import on a
  new origin, the user re-enters provider keys. Document this.

**Verify:**
- Import a real OPFS backup → row counts match source → app renders the chats/
  labs/quizzes.
- Import a legacy (pre-`brief`) backup → imports cleanly, `brief` null.
- Re-import (idempotent) → no duplicates.
- Import a non-SQLite file → clear error.

---

### Phase P-pg-7 — Tests, cleanup, docs

**Goal:** Close the loop — modern test strategy, remove dead code, accurate
docs.

**Tests:**
- Decide PG test strategy (lock decision):
  - **Option A (recommended):** **Testcontainers** — a real PG per test *file*
    (not per test) via a shared container + per-test schema/truncation. Slower
    than in-memory but exercises real PG SQL (FTS, jsonb, constraints).
  - **Option B:** keep a fast in-memory tier (sql.js) for pure logic tests that
    don't depend on PG semantics, plus a smaller PG integration suite.
  - Pick A if the suite stays under ~30s; pick B if it balloons.
- Rewrite test setup: replace `createMemoryDriver()` with a PG-backed test
  driver (or keep memory for non-SQL unit tests).
- The vitest config (`vite.config.ts:56`, `environment: 'node'`) stays; add
  testcontainer lifecycle hooks.

**Cleanup (remove):**
- `src/lib/db/driver/opfs-driver.ts`, `opfs-worker.ts` — OPFS gone.
- `src/lib/db/driver/memory.ts` — if not kept for tests.
- `src/lib/db/driver/bundle-migrations.ts` + `migrations.ts` — server uses
  native drizzle migrations now.
- `vite.config.ts` `crossOriginIsolation()` plugin + COEP/COOP — no longer
  needed (no `SharedArrayBuffer`).
- `@sqlite.org/sqlite-wasm`, `sql.js` deps (and `onlyBuiltDependencies` entries
  in `package.json:13`) — if memory driver removed.
- The OPFS-specific `snapshot`/`restore`/`validate` paths in `backup.ts`.
- `SidecarCap`→`ServerCap` (done in P-pg-0) — final sweep for stragglers.

**Docs:**
- `docs/dev/architecture.qmd`: update the locked-decisions table (DB row),
  system diagram (server+pg required), performance posture (network hop
  acknowledged).
- `docs/dev/seams.qmd`: update the driver table (OPFS row gone; `RemotePgDriver`
  is primary; `SidecarDriver` rename).
- `docs/guide/data-and-privacy.qmd`: rewrite storage section (Postgres in a
  docker volume, not OPFS); keep the "keys in IndexedDB, not in the DB" point.
- `AGENTS.md`: replace P0–P5 acceptance gates (OPFS/self-check) with PG/server
  gates; add the new backup/restore gate.
- `refinement/2026-07-12_*.md`: mark the brainstorming doc "superseded by the
  implementation plan".

**Verify:**
- `pnpm lint && pnpm check && pnpm test` (root) green.
- `pnpm --filter @mayon/server test` green.
- `docker compose up` → full manual acceptance pass.
- No grep hits for `sidecar`/`Sidecar`/`opfs`/`OPFS`/`sqlite-wasm` in `src/`
  (except intentional historical references in `refinement/`).

---

## 4. Cross-cutting concerns

### 4.1 Security
- **Never publish Postgres's port** to the host/browser. Only the server
  connects to PG over the internal docker network.
- `DATABASE_URL` lives in `.env` / compose env, never in the SPA bundle.
- API keys stay in **IndexedDB** (browser), resolved into headers by the browser
  before same-origin calls to the server. The server never persists keys. This
  invariant is unchanged from today.
- Backups do not contain keys. Document "re-enter keys after restore on a new
  origin."

### 4.2 Configuration
- `.env` / `docker-compose.yml` make PG configurable: image tag, credentials,
  db name, port (internal), volume path. Sensible defaults for local
  single-user.
- Server reads `DATABASE_URL`; no hardcoded connection string.

### 4.3 Dev ergonomics
- `docker compose up` → full stack (db + server + web).
- `pnpm dev` → SPA only; requires `db` + `server` running (via a dev compose or
  the full compose). Document both.
- Drizzle Studio (`pnpm db:studio`) against PG via `DATABASE_URL`.

### 4.4 Performance
- pg `Pool` (sized reasonably for a single user — e.g. `max: 10`).
- Keep-alive on the browser↔server HTTP connection.
- Watch `assembleContext` (ancestor walk) — if it becomes a latency problem,
  push it server-side as a single SQL CTE in a later optimization phase (not
  blocking).
- `pg_dump`/`pg_restore` are fast for personal-DB sizes; no special streaming
  needed beyond stdout→response.

### 4.5 Backward compatibility
- The OPFS→PG importer (P-pg-6) is the only backward-compat path. There is no
  "dual-write" period — it's a one-time cutover per user.
- After P-pg-7, OPFS is gone; users who never import start fresh on PG.

---

## 5. Decisions to lock (before starting P-pg-1)

| # | Decision | Recommendation |
|---|---|---|
| D1 | PG client lib | `pg` (node-postgres) — drizzle first-class, mature. |
| D2 | JSON columns | Start as `text`-as-JSON (minimal churn); migrate to `jsonb` later if queryability needed. *Or* go `jsonb` now if the schema rewrite is already touching every column. |
| D3 | Booleans | Native `boolean`. |
| D4 | Enums | `text` + `CHECK` for now; `CREATE TYPE` later. |
| D5 | Timestamps | Keep epoch-ms `integer`/`bigint` for now; `timestamptz` is a separate cleanup. |
| D6 | FTS ranking | `ts_rank_cd`; `paradedb` BM25 only if quality regresses. |
| D7 | Test strategy | Testcontainers PG per test file (Option A); fall back to B if too slow. |
| D8 | Backup format | `pg_dump -Fc` (custom format). No zip unless bundling a manifest. |
| D9 | Restore semantics | Drop+recreate `public` schema, then `pg_restore --no-owner --no-privileges`. |
| D10 | Importer semantics | Replace (drop+recreate+insert) for v1; merge later if asked. |
| D11 | Sandbox DB | Keep as separate `better-sqlite3` for now; folding into PG is a separate epic. |
| D12 | Server rename | Yes — `sidecar`→`server` everywhere (P-pg-0). |

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Importer loses/corrupts user data (P-pg-6) | Medium | **Critical** | Always pre-dump PG; dry-run mode; idempotent upserts; FK-ordered inserts; test against real legacy backups. |
| FTS quality regression vs FTS5/bm25 (P-pg-4) | Medium | Medium | `ts_rank_cd` first; `paradedb` as fallback; keep `stripIndexNoise` parity. |
| Test suite becomes too slow (P-pg-7) | Medium | Medium | Per-file container reuse; truncation over recreate; keep memory tier for pure-logic tests. |
| Latency regression hurts UX (P-pg-3) | Medium | Medium | Pooling, keep-alive, batching; server-side `assembleContext` if needed. |
| `pg_restore` version mismatch | Low | Medium | Document "same or newer PG"; pin image tag in compose. |
| Rename (P-pg-0) misses a reference | Low | Low | Grep sweep in P-pg-7; type-check catches most. |
| Server-required breaks someone's no-Docker workflow | High (by design) | Medium | Document loudly; provide `docker compose up` as the one command. |

---

## 7. Definition of done (epic level)

- [ ] All phases P-pg-0 … P-pg-7 complete and individually gated.
- [ ] `pnpm lint && pnpm check && pnpm test` (root) green.
- [ ] `pnpm --filter @mayon/server test` green.
- [ ] `docker compose up` → full manual acceptance:
  - [ ] App boots; badge "Server: connected" / "DB ready (pg)".
  - [ ] Theme toggle persists (PG settings KV).
  - [ ] Dev self-check passes.
  - [ ] Chat → stream → branch → lab → quiz all work.
  - [ ] Search returns ranked hits.
  - [ ] Download backup → valid `.dump`; restore → state matches.
  - [ ] Import from OPFS `.sqlite` → data present, counts match.
- [ ] No `sidecar`/`OPFS`/`sqlite-wasm` references in `src/` or `server/`.
- [ ] `docs/dev/architecture.qmd`, `seams.qmd`,
      `docs/guide/data-and-privacy.qmd`, and `AGENTS.md` updated.
- [ ] `.env.example` documents `DATABASE_URL` and PG config.
