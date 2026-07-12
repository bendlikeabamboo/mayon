# EPIC — Migrate primary store from SQLite-WASM/OPFS to dockerized Postgres

> **Prompt (verbatim).** Transition the application from SQLite to dockerized
> postgres. The advantages of SQLite WASM are not as big as the limitations it
> imposes. Move to a configurable postgres docker container controlled by
> `docker compose up`. Still must: (1) create a backup as a downloadable file
> (maybe zip), (2) restore DB state from a backup file. Brainstorm as a principal
> engineer: feasibility, advantages, disadvantages, things to take care of.

**Status:** Brainstorming / investigation (no code changed).
**Author role:** Principal engineer.
**Date:** 2026-07-12.

---

## TL;DR

1. **It is feasible**, but it is not a driver swap — it is an **architectural
   pivot** that rewrites the #1 locked decision in `docs/dev/architecture.qmd:25`
   ("SQLite — WASM+OPFS (browser)") and breaks the app's central
   *local-first, browser-only, no-server-required* promise.
2. The `StorageDriver` seam (`src/lib/db/driver/types.ts:17`) holds up well for
   `query`/`batch`/`exec`, but **`snapshot()`/`restore()` are SQLite-byte-clone
   concepts** that do not map to Postgres — backup/restore must be rebuilt on
   `pg_dump`/`pg_restore`.
3. **Postgres-as-primary makes a server component mandatory.** A browser SPA
   cannot speak the Postgres wire protocol; it must go through an HTTP bridge.
   The existing `SidecarDriver` (`POST /api/db/query`) is exactly the right
   shape, so the sidecar flips from **optional** to **required**.
4. Real, contained rewrites: the **schema** (`sqlite-core` → `pg-core`), the
   **drizzle proxy** (`sqlite-proxy` → `pg-proxy`), **FTS5 search**
   (`search_fts` + `snippet()`/`bm25()`/`MATCH` → `tsvector`/GIN/`ts_headline`),
   the **migrator** (custom bundled → drizzle native on the sidecar), and the
   **test driver** (in-memory sql.js → a Postgres test DB).
5. **Backup/restore is the easy part.** `pg_dump -Fc` (custom format) gives a
   single compressed, transactionally-consistent, version-portable file; restore
   via `pg_restore` with a pre-restore safety dump and active-connection
   handling. A zip wrapper is optional (the file is already compressed).
6. **Challenge the premise before committing.** If the real pain is OPFS/WASM
   browser pain (COEP, Safari, quota, worker complexity) — not SQLite itself —
   there is a much smaller-risk alternative: **run native SQLite in the sidecar
   as the primary store** (the `SidecarDriver` + `better-sqlite3` already exist
   for the sandbox). That removes the WASM pain with *zero* dialect change.
   Postgres is the right call only if you want its richer types/JSONB/FTS and a
   path to future sync. See §11.

---

## 1. Current state (grounding in the actual code)

| Concern | Where | Today |
|---|---|---|
| Storage seam | `src/lib/db/driver/types.ts:17` | `StorageDriver` = `query`/`batch`/`exec` + optional `snapshot`/`restore`/`dispose`. Comment says params use SQLite `?` placeholders. |
| Drizzle glue | `src/lib/db/driver/proxy.ts:12` | `drizzle-orm/sqlite-proxy` over the driver callbacks. |
| Schema | `src/lib/db/schema.ts:2` | `sqliteTable`/`integer`/`text` from `drizzle-orm/sqlite-core`. JSON columns stored as `text`; booleans as 0/1 `integer`. |
| Primary store | `src/lib/db/driver/opfs-worker.ts:36` | `file:mayon.sqlite?vfs=opfs` in a Web Worker; `PRAGMA foreign_keys = ON`. |
| Test store | `src/lib/db/driver/memory.ts` | in-memory sql.js; the whole `pnpm test` suite runs on it (`vitest`, `environment: 'node'`). |
| Sidecar DB driver | `src/lib/db/driver/sidecar.ts:4` | `POST /api/db/query` — already a `StorageDriver`, but "never wired as the app's primary store" (`docs/dev/seams.qmd:33`). |
| Migrator | `src/lib/db/driver/migrator.ts:14` | custom, reads build-time-bundled `migrations.ts` (no Node `fs` in browser). `__drizzle_migrations(id SERIAL PRIMARY KEY, hash text, created_at numeric)`. |
| Bundled migrations | `src/lib/db/driver/migrations.ts` | 8 migrations incl. `0006_search_fts.sql` (FTS5 virtual table + triggers). |
| Search | `src/lib/db/repositories/search.ts:108` | hand-rolled FTS5 SQL: `MATCH`, `snippet(search_fts,2,...)`, `bm25(search_fts)`, `?1`/`?2` placeholders, positional `row[n]` indexing. |
| Backup (download) | `src/lib/db/backup.ts:124` | `snapshot()` → worker does `VACUUM INTO` a temp OPFS file → bytes → `downloadBlob(... .sqlite)`. |
| Restore (upload) | `src/lib/db/backup.ts:129` | validate via SQLite header magic + required tables + migration head (sql.js on main thread); pre-restore safety download; `restore(bytes)` overwrites OPFS file; `rebootstrapWith()` + `location.reload()`. |
| Sidecar sandbox backup | `sidecar/src/backup.ts:27` | `GET/PUT /api/backup/sandbox` using `better-sqlite3.serialize()` + file replacement. **This is the template to copy for a PG backup route.** |
| Sidecar caps | `sidecar/src/server.ts:25` | `['stdio-mcp','llm-proxy','sandbox-db','backup']`. |
| Compose | `docker-compose.yml` | `web` (nginx SPA on :8080) + `sidecar` (Fastify, internal) + `sidecar-data` volume. nginx proxies `/api/`+`/ws/` → `sidecar:4319` (`docker/nginx.conf:8`). |
| Secrets | `src/lib/ai/keystore/browser.ts:110` | API keys in **IndexedDB**, never in `settings` or the DB. Browser resolves into headers. |
| Boot | `src/routes/+layout.svelte:17` | `bootstrapDb()` → migrate → seed defaults → sidecar detect. |
| COEP/COOP | `vite.config.ts:22` | Required today *only* because sqlite-wasm OPFS needs `SharedArrayBuffer`. **Goes away** if OPFS is removed. |

The app is explicitly **"100% functional without the sidecar"** (AGENTS.md) and
**"local-first… ships as a browser SPA"** (`docs/dev/architecture.qmd:16`). This
epic changes both.

---

## 2. Proposed target architecture

```
docker compose up
├── db        postgres:17-alpine   (named volume pg-data, configurable via .env)
├── sidecar   Fastify (Node/TS)    REQUIRED now — holds the pg pool + migrates
│   ├── POST /api/db/query         (query/batch/exec over pg)  ← new primary path
│   ├── GET  /api/backup/db        (pg_dump -Fc stream)        ← new
│   ├── PUT  /api/backup/db        (pg_restore)                ← new
│   ├── /api/health                caps += 'pg'
│   └── (existing) stdio-mcp · llm-proxy · sandbox-db
└── web       nginx SPA (static)   /api + /ws → sidecar
```

- The browser SPA talks to Postgres **only** through the sidecar over same-origin
  HTTP. No Postgres port is published to the browser; no SQL is constructed in
  the browser beyond what drizzle's pg-proxy already generates.
- `bootstrapDb()` instantiates a **`PostgresDriver`** (HTTP → sidecar → pg pool)
  instead of the OPFS worker. The sidecar becomes a hard dependency: if
  `detectSidecar()` fails, the app cannot boot (today it degrades gracefully).
- `docker-compose.yml` gains a `db` service and a `pg-data` volume; the sidecar
  gets `DATABASE_URL` and a `pg`/`postgres` npm dependency.

### What stays the same
- Repository layer shape (`repos.*`) and the "components call repos only" rule.
- The `settings` KV (provider configs) — just moves to PG.
- The `KeyStore` (IndexedDB) — **untouched**; keys never enter Postgres.
- The `HealthResponse`/caps progressive-enable model.

### What changes
- Schema dialect, drizzle proxy, placeholders, FTS, migrator, test driver,
  backup/restore, boot gate, dev workflow, CI.

---

## 3. Feasibility verdict (dimension by dimension)

| # | Dimension | Verdict | Notes |
|---|---|---|---|
| 1 | **Schema → pg-core** | ✅ Medium effort | `sqliteTable`→`pgTable`; `text`/`integer` map 1:1; JSON `text`→`jsonb` (strictly better); 0/1 `integer`→`boolean`; enums → `text`+CHECK or `CREATE TYPE`. Regenerate `drizzle/` with `dialect:'postgresql'`. |
| 2 | **Drizzle proxy** | ✅ Easy | `drizzle-orm/pg-proxy` is the same `(remoteCb, batchCb, {schema})` shape as `sqlite-proxy` (`proxy.ts:12`). |
| 3 | **Placeholders / row shape** | ⚠️ Watch out | `StorageDriver` says `?` placeholders; PG uses `$1`. Repository code that calls `getDriver().query()` **directly with `?n` and positional `row[i]`** (notably `search.ts:108-146`) must be rewritten. Drizzle-generated queries are fine (pg-proxy emits `$n`). |
| 4 | **FTS5 → PG FTS** | ⚠️ Contained rewrite | `search_fts` + triggers → `tsvector` GENERATED column + GIN index; `MATCH`→`@@ to_tsquery`; `snippet()`→`ts_headline()`; `bm25()`→`ts_rank_cd()` (true BM25 needs `paradedb`/`pg_bm25` ext — optional). `search.ts` SQL + `rebuildIndex()` + `fts5Available()` probe all change. |
| 5 | **Migrator** | ✅ Simplifies | Sidecar has Node `fs` → use drizzle's **native** `migrate()` against `drizzle/`. The custom bundler (`bundle:migrations`) and custom `migrator.ts` can be dropped for production. Reconcile `__drizzle_migrations` shape (drizzle PG uses its own). |
| 6 | **Tests** | ⚠️ Heaviest CI cost | In-memory sql.js (`memory.ts`) can't speak PG. Options: Testcontainers PG per run (slow, needs Docker in CI), or per-test ephemeral PG schema. The fast hermetic suite becomes slower. |
| 7 | **Backup (download)** | ✅ Easy | `pg_dump -Fc` streamed over HTTP. See §5. |
| 8 | **Restore (upload)** | ✅ Medium | `pg_restore` + connection handling + pre-restore safety. See §5. |
| 9 | **Sidecar → required** | ⚠️ Philosophical break | App is no longer "100% functional without the sidecar." Boot must fail loudly if sidecar/pg down. |
| 10 | **Dev workflow** | ⚠️ Heavier | `pnpm dev` alone has no DB. Need `db`+`sidecar` running. Add `docker-compose.dev.yml`. (Silver lining: COEP/COOP plugin at `vite.config.ts:22` can be deleted.) |
| 11 | **Data migration (OPFS→PG)** | ✅ Scriptable | One-time: export OPFS `.sqlite` → sidecar reads with `better-sqlite3` → row-by-row insert into PG (types converted, FTS rebuilt, migration head reconciled). |
| 12 | **Performance posture** | ⚠️ Regressed for local | Every query gains a hop (browser→nginx→sidecar→pg). Context assembly walks ancestors with several queries. Mitigate with pooling, batching, keep-alive, maybe a server-side `assembleContext` endpoint. |

---

## 4. Advantages

- **Escape OPFS/WASM browser pain** — no more `SharedArrayBuffer`/COEP/COOP
  (`vite.config.ts:22`), no Safari OPFS quirks, no browser quota surprises, no
  worker `postMessage` marshalling for every query.
- **Richer types** — `jsonb` is queryable/indexable (today JSON is opaque
  `text`); native `boolean`; real enums; `timestamptz` if wanted.
- **Better full-text search** — PG FTS is more flexible than FTS5 (dictionaries,
  weights, GIN trigram for substring, `ts_headline` markup). Optional `paradedb`
  for true BM25.
- **Real concurrency** — multiple writers, MVCC. (Marginal for single-user, but
  matters if MCP tools / background jobs write concurrently — exactly the
  `busy_timeout` dance the sandbox already does at `sidecar/src/db.ts:37`.)
- **Standard ops tooling** — `pg_dump`/`pg_restore`/Point-in-Time-Recovery/WAL
  archiving, `pgvector` (future RAG), logical replication (future sync — listed
  as a future seam in `architecture.qmd:277`).
- **Server-side query power** — can push `assembleContext` and search to SQL
  (CTEs, window functions) instead of N round-trips.
- **One DB engine across dev/prod** — no "browser SQLite vs desktop SQLite"
  drift; the schema comment at `schema.ts:6` referencing two mirrored runtimes
  goes away.

---

## 5. Disadvantages & risks

- **Breaks the local-first promise.** Data moves from "in the browser, origin-
  scoped" to "in a docker volume." Still local, but no longer browser-resident.
  `docs/guide/data-and-privacy.qmd` must be rewritten.
- **Sidecar becomes mandatory.** The app is dead without `docker compose up`
  (or a running pg+sidecar). `pnpm dev` alone shows a "database unreachable"
  error. This is the single biggest UX regression.
- **Per-query latency up.** The "instant local reads" posture
  (`architecture.qmd:258`) is gone; every read is a network round-trip.
- **Ops surface grows.** A real DB to upgrade, tune, secure, back up, and
  recover. Credentials in env. Volume management.
- **Test/CI cost.** Fast in-memory suite → Postgres test container (slower,
  Docker-in-CI, connection management, test isolation via schemas/transactions).
- **Secrets boundary unchanged but re-explained.** Keys stay in IndexedDB
  (good), but backups **do not** include keys — users restoring on a new origin
  must re-enter provider keys. (Already true today with OPFS backup; just needs
  docs.)
- **Migration risk.** A botched OPFS→PG migration could lose user data; needs
  the pre-restore safety pattern that already exists at `backup.ts:133`.
- **Dialect drift in hand-rolled SQL.** Any future raw SQL must be PG-correct
  (`$n` placeholders, no `PRAGMA`, no `VACUUM INTO`).

---

## 6. Backup & restore deep-dive (the explicit requirement)

### Format recommendation
- **Primary: `pg_dump -Fc` (custom format).** Single file, already compressed,
  parallel-restoreable, version-portable, supports selective restore.
  - Serve as `application/octet-stream`, `mayon-YYYYMMDD.dump`.
  - A zip is **redundant** here (the file is already compressed).
- **If you specifically want a zip:** zip a **directory-format** dump
  (`pg_dump -Fd -j 4`) — useful for large DBs (parallel dump) — or zip a plain
  **SQL text dump** (`pg_dump -Fp`) for human inspectability. Both are worse
  than `-Fc` for a single-user app.
- **Bonus option:** a zip bundling `db.dump` **plus** a `manifest.json`
  (app version, migration head, provider-config handles, export timestamp).
  This is the only reason to introduce zip — it gives the backup provenance.
  Recommended only if restore-from-older-version robustness matters.

### Backup (download) — `GET /api/backup/db`
- Sidecar spawns `pg_dump -Fc -d $DATABASE_URL` and **streams stdout straight to
  the HTTP response** (no temp file, no memory spike). Mirror the streaming
  pattern already used for the sandbox at `sidecar/src/backup.ts:27`, just with
  `pg_dump` instead of `db.serialize()`.
- **Consistency:** `pg_dump` takes an MVCC snapshot transaction — a concurrent
  MCP write cannot tear the dump. This is at least as robust as the current
  `VACUUM INTO` (`opfs-worker.ts:82`).
- Advertise a new cap (e.g. `pg-backup`) in `server.ts:25` if you want the UI to
  gate on it; otherwise reuse `backup`.

### Restore (upload) — `PUT /api/backup/db`
1. **Validate:** check the `PGDMP` magic header; optionally run `pg_restore -l`
   (lists archive TOC) to confirm structure without restoring.
2. **Safety:** dump the current DB (`pg_dump -Fc`) and offer it as a
   `mayon-pre-restore-<ts>.dump` download — exactly the safety-net pattern at
   `backup.ts:133-135`.
3. **Quiesce:** close the sidecar's pg pool; `pg_terminate_backend(pid)` all
   other backends on the target DB (the sidecar itself holds connections, so
   this is mandatory before a drop/restore).
4. **Restore:** either (a) `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
   then `pg_restore --no-owner --no-privileges`, or (b) `pg_restore --clean
   --if-exists --no-owner`. Option (a) is cleaner for a single-user app.
5. **Re-bootstrap:** close & reopen the pool, re-run any pending migrations, and
   have the browser `rebootstrapWith()` + reload (same end-state as
   `backup.ts:138-139`).

### What a backup does **not** include
- API keys (IndexedDB, per-origin) — by design. Document the "re-enter keys
  after restore on a new origin" expectation.
- The sandbox DB (`/data/sandbox.sqlite`) — it already has its own backup route
  (`/api/backup/sandbox`); keep them separate, or bundle both into the zip
  `manifest.json` option above if a single "everything" backup is desired.

---

## 7. Things we have to take care of (checklist)

- [ ] **Schema rewrite** `sqlite-core` → `pg-core` (`schema.ts`); regenerate
      `drizzle/` with `drizzle.config.ts` `dialect:'postgresql'`.
- [ ] **Proxy swap** `sqlite-proxy` → `pg-proxy` (`proxy.ts`).
- [ ] **Placeholder/row-shape audit** — grep for `getDriver().query` with `?n`
      and positional `row[i]` (esp. `search.ts`); convert to `$n` / named rows.
- [ ] **FTS rewrite** — `tsvector` + GIN + `ts_headline`/`ts_rank_cd`; rewrite
      `search.ts` SQL, `rebuildIndex()`, `fts5Available()`; replace
      `drizzle/0006_search_fts.sql`.
- [ ] **PostgresDriver** — new `src/lib/db/driver/pg.ts` (HTTP → sidecar); wire
      `bootstrapDb()` to use it; flip boot to require sidecar+pg.
- [ ] **Sidecar pg layer** — add `pg`/`postgres` dep; pg pool; `POST /api/db/query`
      honoring the existing `DbQueryRequest`/`DbQueryResult` contract
      (`@mayon/shared`); run drizzle native `migrate()` at boot.
- [ ] **Backup/restore routes** — `GET/PUT /api/backup/db` (§6).
- [ ] **Compose** — add `db` service + `pg-data` volume; `DATABASE_URL` env;
      sidecar `depends_on: [db]` with a healthcheck (`pg_isready`).
- [ ] **Tests** — pick a strategy (Testcontainers vs ephemeral schema); rewrite
      the in-memory-driver-based suites; keep fast unit tests DB-free where
      possible.
- [ ] **OPFS→PG data migration** — one-time importer: upload `.sqlite` → sidecar
      reads via `better-sqlite3` → inserts into PG (bool/jsonb conversion, FTS
      rebuild, `__drizzle_migrations` reconcile).
- [ ] **Delete dead code** — `opfs-driver.ts`, `opfs-worker.ts`, `memory.ts`
      (or keep for tests), `bundle-migrations.ts`, the COEP/COOP vite plugin,
      `@sqlite.org/sqlite-wasm` + `sql.js` deps (if memory driver also removed).
- [ ] **Docs** — rewrite `architecture.qmd` (locked DB decision), `seams.qmd`
      (driver table), `data-and-privacy.qmd` (no longer OPFS); update AGENTS.md
      acceptance gates.
- [ ] **Security** — never publish PG's port to the host/browser; keep keys in
      IndexedDB; the sidecar receives the DB connection string from env only.
- [ ] **Error UX** — define the "sidecar/pg unreachable" boot state (the
      `dbStatus` store at `stores/db.svelte.ts` needs a new failure mode).

---

## 8. Suggested epic breakdown (phased)

- **P-pg-0 — Spike.** Stand up `db` + sidecar pg pool + `POST /api/db/query`
  returning rows from a trivial PG table. Validate the round-trip and latency.
- **P-pg-1 — Schema & proxy.** Port schema to `pg-core`, swap to `pg-proxy`,
  regenerate migrations, get drizzle queries working through the sidecar.
- **P-pg-2 — Search.** Rebuild FTS on `tsvector`/GIN; port `search.ts`; tests.
- **P-pg-3 — Boot & gating.** `PostgresDriver`, require sidecar+pg at boot,
  new `dbStatus` failure mode, dev compose file.
- **P-pg-4 — Backup/restore.** `pg_dump -Fc` download + `pg_restore` upload
  with validation, safety dump, connection quiesce. Tests.
- **P-pg-5 — Data migration.** OPFS `.sqlite` → PG importer + UX.
- **P-pg-6 — Test/CI.** Postgres test strategy; remove OPFS/WASM deps & code;
  delete COEP/COOP plugin.
- **P-pg-7 — Docs & acceptance gates.** Rewrite architecture/seams/privacy docs.

---

## 9. Decisions to lock before implementation

1. **Is the sidecar allowed to become mandatory?** (This is the whole game.)
2. **Backup format:** `pg_dump -Fc` (recommended) vs zipped SQL vs
   zip(`db.dump`+`manifest.json`).
3. **Test strategy:** Testcontainers vs ephemeral-schema vs keep sql.js for pure
   unit tests + a smaller PG integration suite.
4. **Booleans/enums:** native `boolean` + `CREATE TYPE` enums, or keep
   `text`/`integer` to minimize churn?
5. **FTS ranking:** `ts_rank_cd` (built-in) vs `paradedb` BM25 (extension).
6. **Sandbox DB fate:** keep `better-sqlite3` sandbox alongside PG, or fold it
   into PG as a separate schema?

---

## 10. Open questions for the user

- Which SQLite-WASM limitation actually hurts you today? (OPFS/Safari/COEP?
  concurrency? FTS? sync?) The answer decides §11 vs §2.
- Is "must run `docker compose up` to use the app" acceptable, or must a
  no-Docker path survive?
- Single-user forever, or is multi-device sync on the horizon (which would
  strongly favor Postgres)?

---

## 11. Alternative: SQLite-in-sidecar (challenge the premise)

Before committing to Postgres, weigh a **much smaller** change that likely solves
the actual pain:

- Run **native `better-sqlite3` in the sidecar** as the *primary* store at
  `/data/mayon.sqlite` (the sidecar already uses better-sqlite3 for the sandbox
  at `sidecar/src/db.ts:34`, and `SidecarDriver` already speaks the contract at
  `src/lib/db/driver/sidecar.ts:4`).
- Point `bootstrapDb()` at `createSidecarDriver()` instead of the OPFS worker.

### What this buys
- Removes **all** OPFS/WASM/COEP pain with **zero dialect change** — the schema,
  drizzle sqlite-proxy, FTS5 search, migrator, and the in-memory test driver all
  stay as-is.
- Backup/restore is **identical** to today (`.sqlite` file via
  `db.serialize()`, the `sidecar/src/backup.ts` template already exists).
- The data-migration step is **trivial** (copy `mayon.sqlite` from OPFS into the
  volume).

### What it costs (same as PG on these axes)
- Sidecar becomes **mandatory** (same philosophical break).
- Per-query gains a network hop (same latency regression).
- Heavier dev workflow (same).

### Why prefer it over Postgres *unless* you need PG specifics
- ~10% of the effort, ~10% of the risk, no schema/search/test rewrite.
- Keeps the schema, migrations, FTS5, and tests untouched.

### Why prefer Postgres *over* this
- You want `jsonb` queryability, richer FTS, `pgvector`, real concurrency, or a
  credible path to **cloud sync / multi-device** (logical replication). If any of
  those is a real near-term goal, pay the PG cost now rather than migrating
  twice.

**Recommendation:** if the goal is "stop fighting OPFS/WASM," do §11 first. If
the goal is "build toward richer data + sync and never migrate again," do §2.
Don't do §2 solely to escape OPFS — that's paying for Postgres with a dialect
migration you may not need.

---

## 12. Verdict

The Postgres migration is **feasible and well-scoped**, and the backup/restore
requirement is cleanly satisfiable with `pg_dump -Fc` / `pg_restore`. The cost is
real: it demotes the app from "browser-only, server-optional" to
"server-required," regresses local per-query latency, and forces rewrites of the
schema, FTS search, migrator, and test driver. The `StorageDriver` seam makes
the storage swap itself tractable; the work is in the dialect and the ops model.

**Approve §2 only if** the team accepts the mandatory-sidecar model and wants
Postgres's richer data/sync future. **Otherwise do §11** (SQLite-in-sidecar) to
kill the OPFS/WASM pain at a fraction of the cost, and revisit Postgres when a
PG-specific capability (sync, jsonb, pgvector) is actually on the roadmap.
