# Plan — P-pg-2: Schema & proxy to Postgres (browser flips to PG-primary)

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-2, lines
> 175–231). This file expands that phase into implementation-ready tasks.
> Status: implementation-ready. Authored 2026-07-12.
> Prerequisite: **P-pg-1 is merged** (server `pg.ts` pool/handler, `/api/db/query` PG-backed,
> `/api/sandbox/query` SQLite, conditional `'pg'` cap — all verified present in tree).
> Scope: **this plan only**. P-pg-3 (failure UX/retries/dev-docs), P-pg-4 (FTS port),
> P-pg-5 (`pg_dump`/`pg_restore`), P-pg-6 (OPFS→PG importer), P-pg-7 (test strategy +
> OPFS/WASM/COEP removal + docs rewrite) are out of scope and get their own plans.

## Goal

Make the drizzle schema, proxy, and migrations Postgres-native, and **flip the browser's
primary driver to `RemotePgDriver`** so real app data (chats, messages, …) round-trips
through `repos` against `docker compose up`. The server runs drizzle's native PG migrator
at boot; the `'pg'` cap gates on pool **+ migrations applied**.

## The core tension this plan resolves

The epic's P-pg-2 says "convert schema to `pg-core`, proxy to `pg-proxy`, regenerate PG
migrations" **and** "keep `bundle-migrations.ts`/`migrations.ts` compiling for the in-memory
test driver until P-pg-7." Those are mutually inconsistent: a `pg-core` schema makes drizzle
emit **Postgres SQL** (`$n` placeholders, `"col"` identifiers, `::jsonb`/`boolean` types, PG
DDL). SQLite (OPFS worker + in-memory `sqlite-wasm` test driver) **cannot execute** PG SQL
— `$1` is a syntax error in SQLite, and PG DDL like `boolean`/`jsonb` is invalid. So a single
`pg-core` flip breaks every `bootstrapWithDriver(await createMemoryDriver())` test site and
makes the browser's OPFS-primary driver unable to run any drizzle query or migration.

Resolution (locked with user): **single `pg-core` schema + PG-backed test driver**, and the
browser flips to `RemotePgDriver` in P-pg-2 (absorbing the driver-wiring the epic assigned to
P-pg-3). Consequences:
- The app becomes **server-required to function** in P-pg-2. Server-down = `dbStatus.markError`
  (the existing error state). The dedicated full-screen "Server unreachable" UX stays P-pg-3.
- The OPFS snapshot/restore backup (`backup.ts`) is **suspended** (UI hidden, stub throws)
  until P-pg-5 ships `pg_dump`/`pg_restore`.
- P-pg-3 shrinks to **failure-UX + retries + dev-workflow docs** only.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Single `pg-core` schema** (`schema.ts` flipped; no dual schema). | User-locked. One source of truth; tests exercise the prod PG dialect. Dual schema was rejected (drift risk; tests can't exercise prod SQL). |
| L2 | **Browser flips to `RemotePgDriver` as primary** in P-pg-2 (absorbs P-pg-3 driver-wiring). | Forced by L1: OPFS SQLite cannot run pg-core SQL. The epic's P-pg-2 acceptance ("repos round-trip through the browser against compose up") requires the browser to talk to PG. |
| L3 | **PG test driver = pglite (`@electric-sql/pglite`).** Each test gets a fresh in-memory Postgres 17 (compiled to WASM, runs in-process in Node/CI with no Docker). Full PG feature support — recursive CTEs, temp tables, `information_schema`, constraints. Supersedes the original testcontainers decision: pglite exercises real PG SQL without the Docker-in-CI dependency. | User-locked (epic D7 revised). Self-contained: `pnpm test` needs only Node. CI ubuntu-latest works with zero extra services. |
| L4 | **JSON columns stay `text`-as-JSON** (`checklist`,`payload`,`value`,`brief`,`mcp_config`,`metadata`,`trace`,`reasoning`). Repos keep `JSON.stringify`/`JSON.parse` unchanged. | User-locked (epic D2 default). Minimal churn; bounds P-pg-2. A later migration can convert to `jsonb` if queryability is needed. |
| L5 | **`createDb` switches `sqlite-proxy`→`pg-proxy`**, same 3-arg factory. Drivers feed drizzle **positional-array rows** (`{ rows: unknown[][] }`) — unchanged contract; drizzle's proxy maps positional→object via per-query `fields`/`isResponseInArrayMode` (verified in installed `drizzle-orm@0.45.2` `sqlite-proxy/session.d.ts` + `pg-proxy/session.d.ts`). **Fallback:** if pg-proxy rejects positional rows, `RemotePgDriver`/PG-test-driver zip `columns`+positional rows into named objects. | Preserves the working contract; minimizes diff. One empirical unknown, gated by the early chats round-trip test. |
| L6 | **Server runs drizzle native `migrate()`** (`drizzle-orm/node-postgres/migrator`) against the pool at boot. `'pg'` cap gates on pool connect **+ migrations applied**. | Epic P-pg-2 step 5. Server has Node `fs`; reads `drizzle/`. The custom bundled-migrator pipeline is dead and removed. |
| L7 | **Keep `translatePlaceholders` through P-pg-4.** Raw-`?` SQL callers bypass drizzle: `chats.ts` (`deleteBranch`/`deleteSubtree` cascade), `search.ts` (deferred to P-pg-4), `backup.ts` (suspended). It is idempotent on PG-native `$n`, so drizzle's `$n` passes through untouched. | **Deviation from P-pg-1's stated P-pg-2 removal** — forced: P-pg-2 does not rewrite all raw-`?` callers. Removed in P-pg-4 when `search.ts` is ported to `$n`/`tsvector`. |
| L8 | **Fresh PG migration history.** Delete old `drizzle/*.sql` + `drizzle/meta/*`; `pnpm db:generate` emits a single `0000_*.sql`. The FTS5 migration (`0006_search_fts.sql`, hand-authored, not a model) is **not** regenerated — `search_fts` does not exist in PG until P-pg-4. | Epic P-pg-2 step 3. OPFS→PG importer (P-pg-6) writes rows directly; it does not replay old migrations. |
| L9 | **`search.ts` is stubbed** in P-pg-2: `search()`→`[]`, `fts5Available()`→`false`, `rebuildIndex()`→no-op. Pure helpers (`stripIndexNoise`,`buildMatchQuery`,`renderSnippet`,`deepLink`) kept (SQL-agnostic, re-exported). | `search_fts` table absent; P-pg-4 owns the `tsvector`/GIN/`ts_headline` port. |
| L10 | **OPFS snapshot/restore backup suspended.** `backup.ts` OPFS path (`createBackup`/`restoreBackupFromBytes`/`validateBackupBytes`/`isSqliteHeader`/`checkBackup`/`REQUIRED_TABLES`/`maxKnownMigrationMillis`) → replaced by a stub throwing `"Backup/restore returns in P-pg-5 (pg_dump/pg_restore)."`. Settings backup UI hidden. `opfs-worker.ts` `validate` op removed. | `RemotePgDriver` has no `snapshot()`/`restore()`. P-pg-5 ships the PG backup; P-pg-7 removes the stub. |
| L11 | **Dead migration glue removed now**: `driver/migrator.ts`, `driver/bundle-migrations.ts`, `driver/migrations.ts` (bundled), root `bundle:migrations` script. **OPFS/WASM/COEP left as dead code** (`memory.ts`, `opfs-driver.ts`, `opfs-worker.ts`, `@sqlite.org/sqlite-wasm`, `sql.js`, `vite.config.ts` COEP plugin, `onlyBuiltDependencies`) — P-pg-7 removes them. | The migration glue is P-pg-2's direct subject and is non-functional after the flip (can't apply PG DDL to SQLite). OPFS/WASM removal touches COEP + deps + vite config = P-pg-7's scoped cleanup; leaving them unreferenced-but-compiling is safe for one phase. |
| L12 | **Minimal boot gate in P-pg-2**: `bootstrapDb()` awaits `detectServer()`; if `!serverStatus.has('pg')`, `dbStatus.markError('Server/PG unavailable — run docker compose up')`. No full-screen UX. | Makes the flip functional without building P-pg-3's UX. P-pg-3 owns the dedicated "Server unreachable" screen + retries + dev-workflow docs. |
| L13 | **No secrets in SPA; PG port never published.** `DATABASE_URL` stays in `.env`/compose (from P-pg-1). | Epic §4.1 invariant, unchanged. |

## Grounding (verified current state)

- Schema — `src/lib/db/schema.ts:2` imports `sqlite-core`; 11 `sqliteTable` defs (`:19`–`:192`); `AnySQLiteColumn` self-refs in `chats` (`:21,24,26`); `is_correct` is `integer` (`quizAnswers:163`); JSON cols are `text`; `checklist` default `sql\`'[]'\`` (`:113`); enum `text({enum})` (`messages:58`, `quizQuestions:136`); `kind` default `'chat'` (`agentTraces:179`).
- drizzle config — `drizzle.config.ts:4` `dialect:'sqlite'`, `out:'./drizzle'`, `schema:'./src/lib/db/schema.ts'`.
- Migrations on disk — `drizzle/0000…0007_*.sql` + `drizzle/meta/_journal.json` (dialect `"sqlite"`, 8 entries; `0006_search_fts.sql` is hand-authored FTS5 + 12 triggers).
- Proxy — `src/lib/db/driver/proxy.ts:1` `drizzle-orm/sqlite-proxy`; 3-arg factory `drizzle(remoteCb, batchCb, { schema })`; `Db` type exported `:20`.
- drizzle proxy contract (verified in `node_modules/.../drizzle-orm@0.45.2/...`): `sqlite-proxy/driver.d.ts` `RemoteCallback = (sql, params, method) => Promise<{rows:any[]}>`; `pg-proxy/session.d.ts` `PgRemoteQueryResultHKT` defaults to `{[column:string]:any}[]`; both sessions carry `isResponseInArrayMode` + `fields` + `customResultMapper` (positional→object mapping). Current memory driver returns positional (`memory.ts:43` `rowMode:'array'`) and repos read `row.title`/`row.rootId` (`chats.ts:97,104`) — proving sqlite-proxy maps positional→named.
- Browser driver — `src/lib/db/driver/pg.ts:4` `createRemotePgDriver()` posts to `/api/db/query`, returns positional `{rows}` (`:22,27`); `src/lib/db/driver/client.ts:15` `createDriver()` dynamic-imports `./opfs-driver`; `bootstrapDb()` `:48`; `bootstrapWithDriver()` `:30` calls `runMigrations` + `createDb`; `rebootstrapWith()` `:92` (used by suspended backup).
- Server PG — `server/src/pg.ts` (`createPgPool`,`probePg`,`translatePlaceholders`,`pgQueryHandler`,`registerPgDb`); `server/src/server.ts:25` `buildApp(dbPath,{pgPool,pgReady})`; `:31` caps push `'pg'` when `pgReady`; `start()` `:60` probes pool. No drizzle-orm dep in `server/package.json`; `pg` present.
- Raw-`?` SQL callers (bypass drizzle): `chats.ts:181,185` (`getDriver().batch`, cascade + recursive CTE + `CREATE TEMP TABLE _delete_set`); `search.ts:88,130,148` (FTS5 `MATCH`/`snippet`/`bm25`); `backup.ts:125,137` (snapshot/restore); `self-check.test.ts:18`; `backup.test.ts:118,122,126,146,149`.
- Tests using `createMemoryDriver()` (~20 sites): `repositories.test.ts`, `search.test.ts`, `search-fts5-gate.test.ts`, `mcp.test.ts`, `backup.test.ts`, `self-check.test.ts`, `proxy.test.ts`, `pg.test.ts`, plus `stores/*`, `mcp/*`, `chat/context.test.ts`, `ai/keystore/migrate.test.ts`, `agent/*.test.ts`. All do `bootstrapWithDriver(await createMemoryDriver())` in `beforeEach`.
- SQLite-specific tests to rewrite/remove: `proxy.test.ts` (sqlite_master + bundled migrator), `backup.test.ts` (isSqliteHeader/validateBackupBytes via sql.js/snapshot/restore/migrate-forward), `search-fts5-gate.test.ts` + `search.test.ts` (FTS5).
- `DbRuntime` — `src/lib/stores/db.svelte.ts` (values `'memory'`/`'browser'`); needs `'pg'`.
- CI — `.github/actions/ci/action.yml` runs `pnpm test` on `ubuntu-latest` (Docker available, no PG service). `vite.config.ts:22` COEP plugin + `:51` `optimizeDeps.exclude:['@sqlite.org/sqlite-wasm']` (left for P-pg-7).
- Boot layout — `src/routes/+layout.svelte` runs `bootstrapDb()` + `detectServer()` independently.
- Dockerfile — `Dockerfile` builds SPA; `server/Dockerfile` builds server (does not copy `drizzle/`).

## Hard rules (non-negotiable this phase)

- **Single `pg-core` schema.** No `sqlite-core` table defs remain in `schema.ts`.
- **Browser primary = `RemotePgDriver`** (PG over the server). OPFS is no longer primary.
- **`pnpm test` (root) green with only Node running** (pglite in-process); `pnpm --filter @mayon/server test` green.
- **No secrets in SPA; PG port not published.**
- **Sandbox SQLite (`/api/sandbox/query`) untouched** — still `better-sqlite3`, still optional.
- **No full-screen "Server unreachable" UX** (P-pg-3). No `pg_dump`/`pg_restore` (P-pg-5). No FTS (P-pg-4). No OPFS→PG importer (P-pg-6). No OPFS/WASM/COEP removal (P-pg-7).

---

## Tasks

> Order is a suggested dependency sequence. After all edits: `pnpm install`, then the
> verification block. `git mv` for file moves/removes.

### T1 — Schema: `sqlite-core` → `pg-core` (`src/lib/db/schema.ts`)
- Imports: `drizzle-orm/sqlite-core` → `drizzle-orm/pg-core`; `sqliteTable`→`pgTable`;
  `AnySQLiteColumn`→`AnyPgColumn`.
- All 11 tables: `sqliteTable('x', …)` → `pgTable('x', …)`.
- `quizAnswers.isCorrect`: `integer('is_correct')` → `boolean('is_correct')`.
- JSON columns (`checklist`,`payload`,`brief`,`mcp_config`,`metadata`,`trace`,`reasoning`,
  `settings.value`): stay `text` (L4). `checklist` default `sql\`'[]'\`` unchanged (emits
  `DEFAULT '[]'`).
- Enums: `text('role',{enum:[…]})` / `text('type',{enum:[…]})` unchanged (L4/D4 — TS union
  only; no `CHECK` emitted).
- Timestamps: stay `integer('created_at')` etc. (epoch-ms, D5).
- `references((): AnySQLiteColumn => chats.id)` → `references((): AnyPgColumn => chats.id)`
  (all FK self/forward refs).
- Update the file-header comment: DB is Postgres (server-owned); drop the "browser SQLite-WASM
  and desktop native SQLite" mirror claim (stale post-flip).
- Inferred types (`$inferSelect`/`$inferInsert`) unchanged — pg-core infers identically.

### T2 — drizzle config + fresh PG migrations
- `drizzle.config.ts:4`: `dialect:'sqlite'` → `'postgresql'`.
- Delete `drizzle/0000…0007_*.sql` and `drizzle/meta/*` (the FTS5 migration is intentionally
  not carried forward — L8).
- `pnpm db:generate` → single `drizzle/0000_*.sql` (all PG DDL) + fresh `meta/_journal.json`
  (dialect `"postgresql"`).
- `pnpm bundle:migrations` — **do not run** (script removed in T7). The bundled
  `migrations.ts` is deleted in T7.

### T3 — Proxy: `sqlite-proxy` → `pg-proxy` (`src/lib/db/driver/proxy.ts`)
- Import `drizzle-orm/sqlite-proxy` → `drizzle-orm/pg-proxy`.
- Factory call unchanged (3-arg: `(remoteCb, batchCb, { schema })`).
- Update the doc comment (mentions sqlite-proxy positional factory) to pg-proxy.
- **Contract:** `remoteCb` returns `driver.query(...)` → `{ rows: unknown[][] }` (positional);
  `batchCb` returns `driver.batch(...)` → `{rows}[]`. Drizzle maps positional→object (L5).
- **Fallback hook (only if T10 chats round-trip fails):** if pg-proxy requires named rows,
  change `remoteCb` to zip: read `columns` from the driver (extend `StorageDriver.query` to
  also return columns, or have `RemotePgDriver` map positional→object using the wire
  `columns`). Document whichever path lands.

### T4 — Browser flip: `bootstrapDb()` → `RemotePgDriver` + minimal gate
- `src/lib/db/driver/client.ts`:
  - Remove `opfsAvailable()` and the `./opfs-driver` dynamic import.
  - `createDriver()` → `createRemotePgDriver()` (sync; returns the driver).
  - `bootstrapDb()`: `runtime='pg'`; **await `detectServer()`**; if
    `!serverStatus.has('pg')`, `dbStatus.markError('Server/PG unavailable — run docker
    compose up')` and throw (L12). Else `bootstrapWithDriver(driver,'pg')`.
  - `bootstrapWithDriver()`: **remove `runMigrations(...)` call** — migrations run server-side
    (L6). Keep `createDb(driver)` + `dbStatus.markReady(runtime)`. Tests pass a PG driver.
  - `rebootstrapWith()`: drop the `runMigrations` call (server owns migrations); keep the
    driver-swap + `createDb` flow (P-pg-5 will repurpose it).
- `src/lib/stores/db.svelte.ts`: `DbRuntime` += `| 'pg'`.
- `src/routes/+layout.svelte`: ensure `detectServer()` resolves before/within `bootstrapDb()`
  (the await in `bootstrapDb` handles ordering; remove any parallel-start assumption). No
  full-screen UX.
- `src/lib/db/index.ts`: re-exports unchanged.

### T5 — Server: native PG migrations + cap gating (`server/src/pg.ts`, `server/src/server.ts`)
- `server/package.json`: add `"drizzle-orm": "^0.45.2"` to `dependencies` (for
  `drizzle-orm/node-postgres` + migrator). (`drizzle-kit` stays a root devDep.)
- `server/src/pg.ts`: add `runPgMigrations(pool, migrationsDir): Promise<boolean>` — builds
  `drizzle(pool, { schema })` from `drizzle-orm/node-postgres` (import `* as schema` from the
  SPA schema path — see T6 wiring) and calls `migrate(db, { migrationsFolder: migrationsDir })`.
  Swallow+log on failure, return `false` (never throw). `probePg` unchanged.
  - **Schema import:** the server needs the pg-core schema for `drizzle(pool,{schema})`. Add a
    build path so `server/` can import `src/lib/db/schema.ts` (alias `@mayon/schema` or a
    `server` tsconfig path to `../src/lib/db/schema.ts`). Verify `tsup` bundles it.
- `server/src/server.ts` `start()`:
  - After `probePg` succeeds, call `runPgMigrations(pool, migrationsDir)`; `pgReady = poolOk &&
    migrationsOk`. Log `'pg: migrations applied'` or `'pg: migrations failed — <err>'`.
  - `migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle')`.
  - On migration failure, `await pool.end()` and start without `'pg'` (server still serves
    other caps; `/api/db/query` returns 503).
- `BuildAppOptions` unchanged (`{pgPool?,pgReady?}`); `pgReady` now means pool+migrations.
- `registerPgDb` / `pgQueryHandler` / `translatePlaceholders` — **unchanged** (L7 keeps
  translation; raw `?` callers still route through it).

### T6 — Dockerfile: ship `drizzle/` to the server image
- `server/Dockerfile`: add `COPY drizzle ./drizzle` (next to the server's CWD) so
  `migrate({ migrationsFolder: 'drizzle' })` resolves at runtime. Set
  `ENV MIGRATIONS_DIR=/app/drizzle` (or wherever the server CWD lands) if the path differs.
- `docker-compose.yml`: `server` env already has `DATABASE_URL` (from P-pg-1); no new env
  needed unless the image CWD differs — set `MIGRATIONS_DIR` if so.
- Verify `pnpm --filter @mayon/server dev` (tsx watch, CWD=`server/`) resolves `drizzle/` at
  `../drizzle` — set `MIGRATIONS_DIR=../drizzle` in a `server/.env` or the dev script if needed.

### T7 — Remove dead migration glue
- `git rm src/lib/db/driver/migrator.ts`, `src/lib/db/driver/bundle-migrations.ts`,
  `src/lib/db/driver/migrations.ts` (the bundled module).
- `package.json`: remove the `"bundle:migrations"` script (`:30`). Leave `db:generate`
  (now PG) and `db:studio`.
- Grep guard: no remaining import of `./migrations` or `./migrator` or `./bundle-migrations`
  in `src/` or `server/`.

### T8 — PG test driver + test setup (`src/lib/db/driver/pg-test.ts`, new)
- Add `@electric-sql/pglite` to root `devDependencies`.
- `src/lib/db/driver/pg-test.ts`:
  - `createPgTestDriver(): Promise<StorageDriver>` — creates a fresh in-memory
      PGlite DB (`new PGlite()`), runs drizzle `migrate()` into it, returns a
      `StorageDriver` whose `query`/`batch`/`exec` call PGlite's `query()` (which
      returns `{ rows: object[] }` — zip into positional arrays `{columns, rows}`
      to match the L5 contract). Returns positional `{rows: unknown[][]}` (L5
      contract). `dispose()` is a no-op (DB is GC'd). (No `snapshot`/`restore`.)
  - `bootstrapTestDb(): Promise<Db>` — `bootstrapWithDriver(await createPgTestDriver(), 'pg')`.
- `vite.config.ts` `test`: no globalSetup needed (pglite is in-process); keep
  `environment:'node'`.
- All ~20 test sites: `import { createMemoryDriver }` → `import { bootstrapTestDb }`;
  `beforeEach` body `bootstrapWithDriver(await createMemoryDriver())` → `bootstrapTestDb()`.
- CI (`.github/actions/ci/action.yml`): `pnpm test` needs only Node — no Docker,
  no PG service. No change required.

### T9 — Rewrite/remove SQLite-specific tests
- `src/lib/db/driver/proxy.test.ts`: rewrite as `pg-proxy` seam proof — `bootstrapTestDb()`,
  assert all expected tables exist via
  `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
  write+read a chats row through `createDb`, assert migrations idempotent (re-`migrate` is
  no-op). Drop `sqlite_master` / `__drizzle_migrations` count assertions (PG migrator table
  lives in `drizzle.__drizzle_migrations`).
- `src/lib/db/backup.test.ts`: **delete** (OPFS backup suspended — L10). Its pure-helper
  assertions (`checkBackup`, `isSqliteHeader`) tested nothing PG-relevant.
- `src/lib/db/repositories/search-fts5-gate.test.ts`: delete (FTS5 gone). `search.test.ts`:
  rewrite to assert the stub — `search('x')`→`[]`, `fts5Available()`→`false`,
  `rebuildIndex()` resolves without error. Keep helper tests for `stripIndexNoise`/
  `buildMatchQuery`/`renderSnippet`/`deepLink` (pure).
- `src/lib/db/driver/pg.test.ts`: the "contract proof" `beforeEach` currently backs the remote
  driver with `createMemoryDriver` as a fake server — replace with `bootstrapTestDb()`-style PG
  backing (or a mock-pool unit test for the wire mapping, keeping the positional-rows assertions).
- Any other raw `sqlite_master` / `PRAGMA` / `snapshot()` / `restore()` assertions: rewrite to
  PG equivalents or remove.

### T10 — `search.ts` stub (L9)
- `src/lib/db/repositories/search.ts`: `search()` returns `[]`; `fts5Available()` returns
  `false`; `rebuildIndex()` is `async () => {}`. Keep `stripIndexNoise`, `buildMatchQuery`,
  `renderSnippet`, `deepLink`, types (`SearchHit`/`SearchKind`) unchanged. Remove the `getDriver`
  raw-FTS SQL (the `search_fts` table no longer exists).
- Note in a comment: FTS ported to `tsvector`/GIN/`ts_headline` in P-pg-4.

### T11 — Suspend OPFS backup (`src/lib/db/backup.ts`, UI)
- `backup.ts`: replace the OPFS implementation (`createBackup`/`restoreBackupFromBytes`/
  `validateBackupBytes`/`isSqliteHeader`/`checkBackup`/`REQUIRED_TABLES`/
  `maxKnownMigrationMillis`/`downloadBlob`) with stubs that throw
  `"Backup/restore returns in P-pg-5 (pg_dump/pg_restore)."` Keep `downloadBlob` if P-pg-5 will
  reuse it (optional). Remove the `import migrations` (deleted in T7) and `getDriver().snapshot`
  calls.
- `src/lib/db/driver/opfs-worker.ts`: remove the `validate` op + `validateBytesInWorker` +
  `checkBackup`/`REQUIRED_TABLES` import (backup suspended). (The worker file itself stays as
  dead code — P-pg-7 removes it — but must compile; trim the now-broken backup imports.)
- Settings UI (`components/settings/DataSection.svelte` or wherever the OPFS Download/Restore
  buttons live): hide them when `serverStatus.has('pg')` (or unconditionally until P-pg-5).
  Leave the sandbox-DB backup UI untouched (separate concern).
- `src/lib/db/backup.test.ts` already deleted in T9.

### T12 — Docs touch (keep honest; full rewrite is P-pg-7)
- `AGENTS.md`: add a P-pg-2 acceptance-gate section: server-required for app function; badge
  reaches **DB ready (pg)**; `repos.chats`/`repos.messages` round-trip via `docker compose up`;
  server-down → "DB error" (full unreachable UX is P-pg-3); OPFS backup suspended (returns
  P-pg-5). Note `GET /api/health` `'pg'` cap now means pool+migrations.
- Do **not** rewrite P0–P5 gates or architectural claims (P-pg-7). Mark the P1 "OPFS primary"
  claim superseded by P-pg-2 in a one-line note.
- `drizzle.config.ts`/`.env.example` already PG (P-pg-1 set `DATABASE_URL`).

### T13 — Verify
- `pnpm install` (adds `drizzle-orm` to server, `@electric-sql/pglite` to root; removes nothing
  automatically — deleted files' imports must be gone).
- `pnpm check` — pg-core type inference works; no `sqlite-core` refs in `src/lib/db/schema.ts`.
- `pnpm lint && pnpm check && pnpm test` (root) — green (pglite in-process; no Docker needed).
- `pnpm --filter @mayon/server test` — green (mock-pool hermetic tests from P-pg-1 still pass;
  add a migration-success/migration-failure unit test for `runPgMigrations` with a mock).
- `docker compose build && docker compose up`:
  - Server logs `pg: ready` + `pg: migrations applied`.
  - `GET /api/health` → `caps: ['stdio-mcp','llm-proxy','sandbox-db','backup','pg']`.
  - Badge reaches **DB ready (pg)**; dev self-check passes (chats write/read/delete via repos).
  - `repos.chats.createRoot` + `repos.messages.append` + read back, through the browser.
  - Server-down: `docker compose stop server` → reload → `dbStatus` error (existing badge);
    `/api/db/query` unreachable. (Full UX = P-pg-3.)
  - PG-down: `docker compose stop db` → restart server → `'pg'` cap absent; `/api/db/query` 503.
  - Sandbox regression: Settings → Sandbox DB → `SELECT name FROM sqlite_master …` still works
    (`/api/sandbox/query`, untouched).
- Grep guards:
  - `rg 'sqlite-core|sqliteTable|AnySQLiteColumn' src/` → no hits.
  - `rg "from './migrations'|from './migrator'|bundle-migrations" src/ server/` → no hits.
  - `rg 'createMemoryDriver' src/` → only the dead `memory.ts` definition + (optionally) its own
    removal-target references; no test imports it.

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green (pglite in-process).
- `pnpm --filter @mayon/server test` green.
- `docker compose up` → `'pg'` cap (pool+migrations); badge **DB ready (pg)**; self-check
  passes; chats+messages round-trip via `repos`; sandbox inspector unaffected; server-down and
  PG-down degrade cleanly (error badge / 503).
- Single `pg-core` schema; `pg-proxy`; fresh PG migration history; server native `migrate()`.
- Dead migration glue removed; OPFS backup suspended (stub + hidden UI); `search.ts` stubbed.
- No boot/browser change beyond the PG flip + minimal gate (full unreachable UX = P-pg-3).

## Risks

- **pg-proxy rejects positional rows** (L5 fallback). Mitigation: T10 chats round-trip is the
  early canary; fallback zips `columns`+positional→named in `RemotePgDriver`/PG-test-driver.
- **`runPgMigrations` schema import across packages** (server importing SPA `schema.ts`).
  Mitigation: T5 wires an alias/tsconfig path; verify `tsup` bundles it; if awkward, the server
  can run `migrate()` without `{schema}` (migrations are self-contained SQL) — schema only
  matters for query building, not for `migrate()`. Prefer the no-schema `migrate()` form to
  sidestep the cross-package import entirely.
- **`migrationsFolder` path differs between dev (tsx, CWD `server/`) and Docker (CWD `/app`).**
  Mitigation: `MIGRATIONS_DIR` env with per-environment defaults (T6).
- **`deleteBranch` raw SQL (`CREATE TEMP TABLE`, `WITH RECURSIVE`, `?`)** under PG. Mitigation:
  PG supports temp tables + recursive CTEs; `?`→`$n` via `translatePlaceholders` (L7). Verify in
  the cascade regression test (repositories.test.ts delete suite).
- **Per-test pglite migrations slow the suite** (~20 tests × full migrate). Mitigation: acceptable
  for P-pg-2; P-pg-7 switches to truncate-or-reuse if >~30s.
- **CI Node-only test suite.** Mitigation: pglite runs in-process with no Docker; CI needs no extra services.
- **Leftover `sqlite_master`/`PRAGMA`/`snapshot` assertions** in tests not enumerated here.
  Mitigation: T13 grep + `pnpm test` failures surface them; rewrite to PG equivalents.
- **`bootstrapDb` now server-coupled** breaks `pnpm dev` without the server. Mitigation: document
  `docker compose up db server` alongside `pnpm dev` (P-pg-3 formalizes dev workflow); the vite
  proxy (`/api`→`:4319`) already routes to the server.
- **`boolean` column (`is_correct`)** changes the wire value (PG `true`/`false` vs SQLite `0`/`1`).
  Repos/tests reading `isCorrect` as `0`/`1` must expect `boolean`. Mitigation: audit
  `quizAnswers`/`quiz-attempts` repo + tests; PG returns `boolean`.

## Out of scope (explicit)

- P-pg-3: full-screen "Server unreachable" UX, boot retry/backoff, `docker-compose.dev.yml`,
  formal dev-workflow docs, `dbStatus` `'server-unreachable'` typed reason.
- P-pg-4: FTS (`tsvector`/GIN/`ts_headline`/`ts_rank_cd`), `search.ts` real implementation,
  removing `translatePlaceholders` (last raw-`?` caller ported).
- P-pg-5: `pg_dump -Fc` download / `pg_restore` upload, app-DB backup/restore (replaces the
  suspended stub).
- P-pg-6: OPFS→PG importer.
- P-pg-7: pglite-vs-faster strategy decision (if suite grows), OPFS/WASM/`sql.js`/COEP removal,
  `sidecar-data` volume rename, full architectural doc/AGENTS gate rewrite.
- Resolving epic D2 fully (jsonb migration) — deferred (L4 keeps `text`).
- Sandbox DB folding into PG (separate epic, D11).
