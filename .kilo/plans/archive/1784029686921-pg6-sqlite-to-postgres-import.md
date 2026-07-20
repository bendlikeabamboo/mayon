# Plan — P-pg-6: Data migration (OPFS SQLite → Postgres)

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-6, lines
> 400–441). Status: **implementation-ready**. Authored 2026-07-14.
> Prerequisite: **P-pg-5 is merged** (`git log`: `518eaac feat: p-pg-5`). The app-DB
> backup/restore (`pg_dump -Fc` / `pg_restore`) and the `serverStatus.has('pg')` UI gating
> already exist. FTS uses `GENERATED ALWAYS AS … STORED` tsvector columns
> (`packages/shared/src/fts.ts`) — they **self-maintain on INSERT**, so the importer does
> NOT rebuild FTS.
> Scope: **this plan only**. P-pg-7 (remove OPFS/WASM/COEP + docs rewrite) is out of scope.

## Goal

A one-time **importer** that reads a legacy OPFS-era `.sqlite` backup (server-side, via the
existing `better-sqlite3` runtime dep) and loads its rows into Postgres, **replacing** all
current app-DB data. Surfaced as a Settings affordance with a **dry-run preview** (row
counts) and a **mandatory pre-import safety `pg_dump`** (auto-downloaded). Highest-risk phase
of the epic — it touches real user data.

## Locked decisions (this phase — user-locked)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Replace = `TRUNCATE … CASCADE` + `INSERT` in a single transaction.** NOT drop+recreate+migrate (the epic's literal D10 wording). NO server restart. | User-locked. The codebase changed since the epic: FTS is now GENERATED (self-maintaining) and a transactional replace is atomic + far simpler than the P-pg-5 restore path. Schema, indexes, FTS columns, and the drizzle migration journal stay untouched → no journal reconciliation, no `process.exit`, no container restart. On failure → `ROLLBACK` (live DB unchanged). The browser `location.reload()`s to refresh caches. |
| L2 | **Circular FK (`chats ↔ messages`) handled via `SET LOCAL session_replication_role = 'replica'` inside the transaction.** | User-locked. Disables FK check triggers for the import so insert order is irrelevant. Requires a SUPERUSER role — the dockerized `POSTGRES_USER=mayon` **is** a superuser by default. `GENERATED` FTS columns are unaffected (computed by the executor, not triggers), so `search_vec` still self-maintains. |
| L3 | **Import source = a pre-existing legacy `.sqlite` only.** No OPFS export button re-added. | User-locked. The OPFS export button was removed in P-pg-5; only stale OPFS *driver* code remains (P-pg-7 deletes it). PG is the primary store since P-pg-3, so there is no live OPFS DB to export. The importer loads an old file the user already saved. |
| L4 | **Two request shapes on one route.** `PUT /api/import/sqlite?dry-run=1` → `200 { summary, warnings }` (validate + open + count; **no writes**). `PUT /api/import/sqlite` → safety `pg_dump -Fc` auto-returned as `application/octet-stream` + `x-import-summary` header (JSON counts); browser saves safety, toasts counts, reloads. Pre-write validation failure → `400 { error, detail }`; no pool → `503`. | User-locked. Dry-run gives a safe preview before a destructive replace; octet-stream safety mirrors the P-pg-5 restore contract (body = bytes, no separate fetch route for the persisted dump). |
| L5 | **Real round-trip test: pglite + better-sqlite3** (add `@electric-sql/pglite` as a **server devDep**). NOT hermetic mocks. | User-locked. This is the data-loss-risk phase; a real SQLite→real-PG round-trip exercises real type coercion (boolean 0/1→bool), real FK disabling, FTS population, and drift tolerance — none of which mocked-SQL assertions validate. `pg_dump`/spawn is still mocked (pglite cannot run the binary). |
| L6 | **No new server cap.** The route + UI are gated on `serverStatus.has('pg')` (the importer needs the live PG pool). | Consistent with P-pg-5 L6. |
| L7 | **Type/column mapping is data-driven via `information_schema`, not a hardcoded schema copy.** Per table, intersect {SQLite columns via `PRAGMA table_info`} ∩ {PG columns via `information_schema.columns`}; `data_type='boolean'` columns get 0/1/null→true/false/null; everything else passes through. | Drift-tolerant by construction (legacy backups missing `brief`/`mcp_config`/`tool_call_id`/`tool_name`/`metadata`; unknown SQLite tables skipped with a warning). Avoids drizzle internal-API spelunking and schema duplication. |
| L8 | **Refuse to import if zero recognized Mayon tables are present** (some other SQLite DB). `400 "no Mayon tables found"`; never `TRUNCATE` for nothing. | Safety: don't wipe PG on a mis-uploaded file. |

## Grounding (verified current state)

- **P-pg-5 merged** — `server/src/pg-backup.ts` exports `dumpDatabase`/`runRestore`/`validateDumpToc`/`spawnPgDump`/`isPgDumpHeader` + `registerPgBackup(app,{pool,databaseUrl})` (`GET/PUT /api/backup/db`). `src/lib/server/db-backup.ts` is the browser mirror. `src/lib/db/backup.ts` is pure helpers (`downloadBlob`, `isPgDumpHeader`, `parseContentDispositionFilename`). `DataSection.svelte` gates app-DB buttons on `serverStatus.has('pg')`.
- **`better-sqlite3` ^12.11.1 is a server RUNTIME dep** (`server/package.json`) → the importer reads the `.sqlite` with no new runtime dep. `server/src/db.ts` already uses it for the sandbox DB and has the 16-byte `SQLITE_HEADER` constant (not exported).
- **FTS is GENERATED** (`packages/shared/src/fts.ts:4-10`): `search_vec tsvector GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(...))) STORED` on `messages`/`chats`/`labs`/`quiz_questions` + GIN indexes; boot runs `runFtsBootstrap(pool)` idempotently (`server/src/fts.ts`). No rebuild step needed post-insert.
- **Schema = 11 tables** (`src/lib/db/schema.ts`, aliased as `@mayon/schema` → `src/lib/db/schema.ts` in `server/tsconfig.json` + `server/vitest.config.ts`): `chats, messages, branch_sources, cross_links, labs, quizzes, quiz_questions, quiz_attempts, quiz_answers, agent_traces, settings`. Only one boolean column: `quiz_answers.is_correct`. `bigint` epoch-ms timestamps; JSON columns are `text` in both SQLite and PG (pass-through).
- **Circular FK**: `chats.branch_point_message_id → messages`, `messages.chat_id → chats`, plus `chats.parent_id`/`root_id` self-refs → motivates L2.
- **`PgPoolLike`** (`server/src/pg.ts:18-21`) = `{ query(text,params?), end() }` — **no `connect()`**. A transaction needs a checked-out client, so T1 adds `connect()`. Real `pg.Pool` already satisfies it.
- **`PgQueryResult`** = `{ rows: Record<string,unknown>[]; fields: {name}[]; rowCount }`.
- **Boot/server wiring** (`server/src/server.ts`): `buildApp(dbPath,{pgPool,pgReady,databaseUrl})` registers routes inside one fastify plugin; `application/octet-stream` parser is registered once at plugin top (P-pg-5 L9). `BASE_CAPS` excludes `'pg'` (added at boot when ready). `start()` runs `createPgPool → probePg → runPgMigrations → runFtsBootstrap`.
- **pglite** (`@electric-sql/pglite` ^0.5.4) is a **root** devDep; `src/lib/db/driver/pg-test.ts` shows the exact pattern to mirror for the server test: `new PGlite()` → `drizzle(client)` → `migrate({migrationsFolder: drizzle/})` → run `FTS_BOOTSTRAP_SQL`. NOT currently a server dep (T7 adds it as a server devDep).
- **Server build** (`server/package.json`): `tsup src/server.ts` — a new `server/src/pg-import.ts` is auto-included via the `server.ts` import in T3.
- **Test patterns**: server `pg-backup.test.ts` (mock `node:child_process` spawn + mock `pg` Client + mocked `node:fs`, `app.inject`, `vi.spyOn(process,'exit')`). Browser `src/lib/server/db-backup.test.ts` (mock status + helpers, fake `globalThis.fetch`, stub `location.reload`).
- **Compose**: `db: postgres:17-alpine` (internal-only, superuser `mayon`), `server depends_on: db`, `DATABASE_URL` from env, `/data` volume (`sidecar-data`), `restart: unless-stopped`.

## Hard rules (non-negotiable this phase)

- The importer is the **only** write path; it `TRUNCATE`s all 11 tables then inserts. No partial/merge mode (epic D10 locks **replace** for v1).
- The actual import **always** runs a safety `pg_dump -Fc` to `/data/mayon-pre-import-<ts>.dump` **before** any `TRUNCATE`, and returns those bytes as the response body (auto-downloaded). The persisted file is the durable rollback artifact.
- All PG writes run inside **one** transaction (`BEGIN … COMMIT`); any error → `ROLLBACK` + rethrow → `500`. The live DB is never left half-truncated.
- `SET LOCAL session_replication_role = 'replica'` scopes the FK disable to the transaction only.
- Refuse (400) if zero recognized Mayon tables; reject non-SQLite bodies before any write (L8).
- `better-sqlite3` opens the upload **readonly** from a temp file; temp is unlinked in `finally`.
- No OPFS code changes/removal (P-pg-7), no schema/FTS/migration changes, no new server cap.
- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green.

---

## Tasks

> Order is a dependency sequence. After all edits: `pnpm install` (adds pglite to server
> devDeps — no new runtime deps), then the T9 verification block.

### T1 — Extend `PgPoolLike` with a transaction client (`server/src/pg.ts`)

- Add a `PgPoolClient` interface and `connect()` to `PgPoolLike`:
  ```ts
  export interface PgPoolClient {
    query(text: string, params?: unknown[]): Promise<PgQueryResult>;
    release(err?: boolean): void;
  }
  export interface PgPoolLike {
    query(text: string, params?: unknown[]): Promise<PgQueryResult>;
    connect(): Promise<PgPoolClient>;
    end(): Promise<void>;
  }
  ```
- Real `pg.Pool` already satisfies this (`pool.connect()` → `PoolClient` with `query`/`release`). No production call-site changes.
- Add `connect: vi.fn()` to `makeMockPool()` in `server/src/pg-backup.test.ts` (returns a mock client) so the existing suite still type-checks under the widened interface.

### T2 — Server importer module (`server/src/pg-import.ts`, new)

Constants & helpers:
- `TABLES`: the fixed 11-table import set (order is arbitrary under L2, but keep a readable order). Used for `TRUNCATE … CASCADE` and iteration.
- `isSqliteHeader(bytes: Buffer): boolean` — 16-byte magic `SQLite format 3\x00` (mirror `server/src/db.ts`'s `SQLITE_HEADER`; define locally so `db.ts` is untouched).
- `openSqliteReadonly(bytes)`: header-check → `writeFile(tmp)` → `new Database(tmp, { readonly: true })`; return `{ db, cleanup }` (`cleanup` closes + `unlinkSync(tmp)`). Throw on bad header / open failure.
- `readSqliteColumns(db, table): string[]` — `db.pragma(`table_info(${table})`)` → column `name` list. Empty if the table is absent.
- `readPgColumns(client, table): Promise<{ name: string; isBoolean: boolean }[]>` —
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1` (`data_type='boolean'` → `isBoolean`).
- `coerceRow(row, booleanCols)` — for each boolean col, map `0/1 → false/true`, leave `null → null`; other values pass through unchanged.

Core logic (pure, injectable — takes a `PgPoolLike`, returns data; no Fastify):
- `dryRunImport(bytes): Promise<{ summary: Record<string, number>; warnings: string[] }>`:
  - open readonly → for each `TABLE`: if present in SQLite, `SELECT count(*)` → `summary[table]=count`; collect intersection columns; warn on dropped SQLite columns not in PG. Unknown SQLite tables (`SELECT name FROM sqlite_master WHERE type='table'`) not in `TABLES` → warning `"skipped unknown table: X"`.
  - `cleanup`. No PG access, no writes.
- `runImport(bytes, pool, databaseUrl): Promise<{ summary; safetyPath; safetyFilename }>`:
  1. open readonly; read sqlite columns per present table; if **zero** present Mayon tables → throw `ImportError('no Mayon tables found')` (→ 400 by the handler; **before** any `pg_dump`/`TRUNCATE`).
  2. **Safety:** `const ts = Date.now(); const safety = '/data/mayon-pre-import-${ts}.dump'; await dumpDatabase(databaseUrl, safety);` (reuse `dumpDatabase` from `./pg-backup`).
  3. `const client = await pool.connect();`
  4. try: `await client.query('BEGIN'); await client.query("SET LOCAL session_replication_role = 'replica'");`
  5. `await client.query('TRUNCATE ' + TABLES.join(', ') + ' CASCADE');`
  6. For each present table: read PG columns (`readPgColumns(client, table)`); intersect with sqlite columns; `SELECT <intersection> FROM <table>` → rows; coerce booleans; batch-insert in chunks (e.g. 500) via parameterized `INSERT INTO <table> (<cols>) VALUES ($1,…)` (or multi-row VALUES). Count inserted rows → `summary[table]`.
  7. `await client.query('COMMIT');`
  8. catch: `await client.query('ROLLBACK');` rethrow.
  9. finally: `client.release();` sqlite `cleanup`.
  10. return `{ summary, safetyPath: safety, safetyFilename: 'mayon-pre-import-${ts}.dump' }`.

Route registration `registerPgImport(app, { pool, databaseUrl })`:
- `app.put('/api/import/sqlite', { bodyLimit: 512*1024*1024 }, async (req, reply) => {`
  - `const bytes = req.body as Buffer;`
  - `if (!isSqliteHeader(bytes)) return reply.code(400).send({ error: 'not a valid SQLite file' });`
  - `const dryRun = (req.query as { 'dry-run'?: string })['dry-run'] != null;`
  - **dry-run:** `const { summary, warnings } = await dryRunImport(bytes); return reply.send({ summary, warnings });`
  - **actual:** `if (!pool) return reply.code(503).send({ error: 'pg not configured' });`
    `try { const { summary, safetyPath, safetyFilename } = await runImport(bytes, pool, databaseUrl);`
    `const safetyBytes = await readFile(safetyPath);`
    `reply.header('content-type','application/octet-stream')`
    `      .header('content-disposition', 'attachment; filename="${safetyFilename}"')`
    `      .header('x-import-summary', JSON.stringify(summary))`
    `      .send(safetyBytes);`
    `} catch (err) { if (!reply.sent) reply.code(500).send({ error:'import failed', detail }); }` (a thrown `ImportError('no Mayon tables found')` → map to `400`).
- (Do NOT register a content-type parser here — the `application/octet-stream` parser already exists at plugin top from P-pg-5.)

### T3 — Server wiring (`server/src/server.ts`)

- `import { registerPgImport } from './pg-import';`
- In `buildApp`, after `registerPgBackup(fastify, { pool: opts.pgPool, databaseUrl: opts.databaseUrl ?? '' });` add:
  `registerPgImport(fastify, { pool: opts.pgPool, databaseUrl: opts.databaseUrl ?? '' });`
- No `start()` change (the existing `databaseUrl` plumbing is sufficient).

### T4 — Browser pure helper (`src/lib/db/backup.ts`)

- Add `isSqliteHeader(bytes: Uint8Array): boolean` — `bytes.length >= 16 && decoder(bytes.subarray(0,16)) === 'SQLite format 3\x00'` (compare the 16-byte magic; first 15 are `SQLite format 3`, 16th is `0x00`). Keep existing helpers.

### T5 — Browser import client (`src/lib/server/db-import.ts`, new)

- Mirror `src/lib/server/db-backup.ts`:
  ```ts
  export interface ImportPreview { summary: Record<string, number>; warnings: string[] }
  export async function dryRunImport(file: File): Promise<ImportPreview> {
    if (!serverStatus.has('pg')) throw new Error('Server DB not ready');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isSqliteHeader(bytes)) throw new Error('Not a valid SQLite file');
    const res = await serverClient.http('/api/import/sqlite?dry-run=1', {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes
    });
    if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.detail ?? `Preview failed: ${res.status}`); }
    return (await res.json()) as ImportPreview;
  }
  export async function importFromSqlite(file: File): Promise<{ summary: Record<string, number> }> {
    if (!serverStatus.has('pg')) throw new Error('Server DB not ready');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isSqliteHeader(bytes)) throw new Error('Not a valid SQLite file');
    const res = await serverClient.http('/api/import/sqlite', {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes
    });
    if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.detail ?? `Import failed: ${res.status}`); }
    const header = res.headers.get('x-import-summary');
    const summary = header ? JSON.parse(header) : {};
    const safety = new Uint8Array(await res.arrayBuffer());
    downloadBlob(safety, parseContentDispositionFilename(res, 'mayon-pre-import.dump'));
    return { summary };
  }
  ```
- Caller (UI) performs the `location.reload()` after `importFromSqlite` resolves.

### T6 — UI (`src/lib/components/settings/DataSection.svelte`)

- Imports: `dryRunImport, importFromSqlite` from `$lib/server/db-import`; `isSqliteHeader` from `$lib/db/backup` (optional client-side guard).
- New state: `importBusy`, `importError`, `importStatus`, `importPreview: ImportPreview | null`.
- New hidden `<input type="file" accept=".sqlite,.db" bind:this={importFileEl} onchange={handleImportFileInput}>`.
- `handleImportFileInput`: read file → `dryRunImport(file)` → set `importPreview` (counts + warnings). Errors → `importError`.
- `confirmImport()`: `importBusy=true` → `await importFromSqlite(currentFile)` → `importStatus='Imported: ' + summary line` → `location.reload()`. The safety dump auto-downloads inside `importFromSqlite`.
- `cancelImport()`: clears `importPreview`.
- Markup (inside the `{#if serverStatus.has('pg')}` block, below the existing app-DB buttons):
  - `<hr>` + `<h3>Import from SQLite backup</h3>` + explanatory `<p>`: "Load chats, labs, and quizzes from a legacy (pre-Postgres) SQLite backup. This **replaces all current data**; a safety backup downloads first. API keys are not included — re-enter provider keys after import."
  - "Import from SQLite backup" button (disabled when `importBusy || chatStore.streaming`).
  - When `importPreview`: show a counts table (`chats: N, messages: M, …`) + any warnings + "This will replace all current data. Continue?" + **Confirm** / **Cancel** buttons.
  - `importStatus` (`role="status"`) and `importError` (`role="alert"`) lines.
- Existing app-DB backup buttons and the sandbox section are unchanged.

### T7 — Tests

**`server/src/pg-import.test.ts`** (real round-trip; mirrors `src/lib/db/driver/pg-test.ts` setup):
- Mock `node:child_process` `spawn` (covers `dumpDatabase` in `runImport`); do NOT mock `node:fs` (let the real safety file write/read happen so `runImport` can return it). A `mockChild` pipes dummy bytes (e.g. `Buffer.from('safety')`) to stdout so `createWriteStream(safety)` produces a real file.
- Setup once (beforeAll): `const pg = new PGlite();` → `migrate(drizzle(pg), { migrationsFolder: '<repo>/drizzle' })` → run `FTS_BOOTSTRAP_SQL`. Wrap as a `PgPoolLike`: `{ query:(t,p)=>pg.query(t,p), connect: async()=>({ query:(t,p)=>pg.query(t,p), release:()=>{} }), end: async()=>pg.close() }`. Build the app via `buildApp` with this pool + `databaseUrl:'pglite'` (the spawn is mocked so the URL is never used). **Verify-early (blocker):** confirm `SET LOCAL session_replication_role='replica'` is accepted by pglite (superuser); if it errors, stop and surface it before writing the rest of the assertions.
- SQLite fixture (`better-sqlite3` `:memory:`): create a **legacy** column subset — e.g. `chats(id,parent_id,root_id,title,depth,created_at,updated_at)` (omit `brief`,`mcp_config`,`model`,`provider`,`branch_point_message_id`), `messages(id,chat_id,role,content,ord,created_at)` (omit `tool_call_id`,`tool_name`,`metadata`,`model`,`tokens`), `labs`, `quizzes`, `quiz_questions`, `quiz_answers(... is_correct INTEGER)` with 0/1, `quiz_attempts`, `branch_sources`, `cross_links`, `agent_traces`, `settings`. Insert a few consistent rows each. Add one **unknown** table `old_legacy_table(x)` (must be skipped + warned).
- Cases:
  1. **dry-run:** `PUT /api/import/sqlite?dry-run=1` → 200 `{ summary, warnings }`; counts equal fixture inserts per table; `warnings` includes `old_legacy_table`; PG untouched (assert a sentinel row inserted pre-test still present — i.e. no `TRUNCATE` ran).
  2. **actual import:** `PUT /api/import/sqlite` → 200 `application/octet-stream`; `content-disposition` matches `/mayon-pre-import-\d+\.dump/`; `x-import-summary` header JSON counts equal fixture; body non-empty (the dummy safety). `spawn` was called once (the safety `pg_dump`), never `pg_restore`.
  3. **post-import pglite asserts:** each table's `SELECT count(*)` matches the fixture; `quiz_answers.is_correct` is a real `boolean` (`= true`/`= false` rows found); `messages.search_vec IS NOT NULL` for a row with non-empty content (FTS populated by GENERATED column); legacy-omitted PG columns (`brief`, `mcp_config`, `tool_call_id`, `metadata`) are `NULL`/default; `settings` rows imported.
  4. **idempotent re-import:** run import #2 (re-feed fixture bytes, safety spawn mocked again) → counts identical to import #1; no duplicates.
  5. **non-SQLite body** → 400 `not a valid SQLite file`; `spawn` not called; no `TRUNCATE` (sentinel row intact).
  6. **no Mayon tables:** a valid SQLite header DB containing only `old_legacy_table` → 400 `no Mayon tables found`; `spawn` not called; no `TRUNCATE`.
  7. **no-pool actual import** → 503 (build a separate app without `pgPool`).
- `afterAll`: close pglite + app.

**`src/lib/server/db-import.test.ts`** (hermetic; mirror `src/lib/server/db-backup.test.ts`):
- mock `$lib/server/status.svelte` (`serverStatus.has('pg')` true/false) + `$lib/db/backup` (`downloadBlob`, `isSqliteHeader`, `parseContentDispositionFilename`); fake `globalThis.fetch`; stub `location.reload`.
- dry-run: cap-absent throws; valid bytes → `PUT …?dry-run=1` → parses `{ summary, warnings }`; non-ok throws `detail`.
- actual import: rejects non-SQLite pre-fetch; on 200 reads `x-import-summary` → summary, calls `downloadBlob` with the body, resolves (caller reloads); on 500 surfaces `detail`.

**`src/lib/db/backup.test.ts`** (pure): add `isSqliteHeader` true for the 16-byte magic; false for short / non-SQLite bytes.

### T8 — Docs (`AGENTS.md`)

- Add a **P-pg-6 acceptance-gate** section (mirror the existing phase-gate format): with `docker compose up` and a real legacy `.sqlite`, Settings → Data → "Import from SQLite backup" → **dry-run** shows per-table counts + skipped-table warnings → **Confirm** → a safety `.dump` auto-downloads → app reloads → chats/labs/quizzes/messages present; row counts match the source; `is_correct` round-trips as boolean; **search** on imported content returns hits (FTS self-maintained); re-import is idempotent; a non-`.sqlite` file is rejected with a clear error and the live DB untouched; a SQLite DB with no Mayon tables is rejected (no truncate). Document: replace semantics (truncate+insert, no server restart), `session_replication_role='replica'` requires the superuser docker default, FTS is GENERATED (no rebuild), and **API keys are not imported** (re-enter provider keys after import on a new origin).

### T9 — Verify

- `pnpm install` (adds `@electric-sql/pglite` to `server/devDependencies`).
- `pnpm check`; `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green (real pglite round-trip — T7 case 1–7).
- `docker compose up`: obtain a real legacy `.sqlite` (a pre-PG OPFS export) → Settings → Data → "Import from SQLite backup" → dry-run preview → Confirm → safety `.dump` downloads → reload → data present + counts match source → search returns hits on imported content.
- Grep guards: `rg "registerPgImport|pg-import|importFromSqlite|dryRunImport|isSqliteHeader" server/src src` → the new module/client/helpers; `rg "DROP SCHEMA" server/src/pg-import.ts` → no hits (import uses `TRUNCATE`, not drop+recreate).

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green (real pglite + better-sqlite3 round-trip; `pg_dump` spawn mocked).
- A legacy `.sqlite` imports cleanly; per-table counts match source; `is_correct` is boolean; FTS `search_vec` populated; re-import idempotent; legacy-missing columns tolerated; non-SQLite and no-Mayon-tables rejected pre-write.
- A pre-import safety `.dump` always downloads; failed import `ROLLBACK`s (live DB unchanged) → `500`/`400`.
- No server restart on import (truncate+insert); the route + UI gated on `serverStatus.has('pg')`; no new cap; `PgPoolLike` extended with `connect()`.

## Risks

- **pglite rejects `SET LOCAL session_replication_role='replica'`.** Mitigation: T7 marks this as a verify-early blocker (run it first). pglite is real PG 17 and its default user is a superuser, so it is expected to pass; if it does not, surface immediately (the importer and its test both depend on it). Production docker `mayon` is a superuser by default — document the superuser requirement.
- **Safety `pg_dump` failure aborts import.** Mitigation: `dumpDatabase` rejects → the handler returns `500` **before** any `TRUNCATE`; live DB untouched. (Dockerfile already installs `postgresql17-client` from P-pg-5.)
- **Type-coercion bug corrupts data (boolean/bigint).** Mitigation: L7 limits coercion to `data_type='boolean'` columns; the real round-trip test (T7 case 3) asserts `is_correct` is a real boolean and counts match.
- **`bodyLimit` / large legacy DBs.** Personal learning DBs are MB-scale; `512 MB` parity with backup is ample. Batched inserts (500/chunk) bound statement size.
- **A legacy backup with orphaned FKs (data integrity issue from a crash).** Mitigation: under `session_replication_role='replica'` PG does not re-check FKs on commit, so orphans import without error — acceptable for previously-valid data; the safety dump is the rollback path.
- **`PgPoolLike` widening breaks existing mock pools.** Mitigation: T1 adds `connect` to `pg-backup.test.ts`'s `makeMockPool`; the real `pg.Pool` already satisfies the interface.
- **Summary header ignored by proxies/clients.** Mitigation: the header is a UX nicety; the safety body is the contract. If a proxy strips `x-import-summary`, the toast is empty but the import still succeeds + reloads.

## Out of scope (explicit)

- OPFS/WASM/COEP removal + dead-code sweep + full docs rewrite (P-pg-7).
- A "merge" import mode (epic D10 locks **replace** for v1).
- Re-adding an OPFS-to-disk export button (L3 — import-only).
- Folding the sandbox SQLite into PG (separate epic, D11).
- `timestamptz`/`jsonb`/`CREATE TYPE` enum cleanups (deferred).
- Real-PG integration in CI beyond pglite (the docker round-trip is the manual gate).

## Dependency graph

```
T1 (PgPoolLike.connect) ──► T2 (pg-import.ts) ─► T3 (server wiring) ─► T7 (server tests) ─┐
T4 (isSqliteHeader) ──────► T5 (db-import client) ─► T6 (DataSection UI) ─► T7 (browser tests) ─┤
                                                        (pglite added to server devDeps in T7) ─► T8 (docs) ─► T9 (verify)
```
T1, T4 are independent starts; T2 needs T1; T5 needs T4; T6 needs T5; T3 needs T2; T7 after
T2+T3+T5+T6; T8/T9 last.
