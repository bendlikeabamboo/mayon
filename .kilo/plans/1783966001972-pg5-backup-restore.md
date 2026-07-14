# Plan — P-pg-5: Backup & restore (`pg_dump -Fc` / `pg_restore`)

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-5, lines
> 328–397). Status: **implementation-ready**. Authored 2026-07-14.
> Prerequisite: **P-pg-3 + P-pg-4 are merged** — app boots against PG via `RemotePgDriver`,
> server-required gating works, `'pg'` cap advertised, FTS live. The app-DB backup is
> currently **suspended**: `src/lib/db/backup.ts` is a stub that throws
> `"Backup/restore returns in P-pg-5"`, and `DataSection.svelte` **hides** the app-DB
> buttons when `serverStatus.has('pg')`.
> Scope: **this plan only**. P-pg-6 (OPFS→PG importer) and P-pg-7 (OPFS/WASM/COEP removal
> + docs rewrite) are out of scope.

## Goal

Download a full app-DB backup (`pg_dump -Fc`, `.dump`) and restore from it
(`pg_restore`), with parity to today's sandbox-backup UX (download button → file;
upload → validate → restore → reload) but new bytes and a mandatory pre-restore safety
dump. This re-enables the "Download backup" / "Restore from backup" buttons under PG.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Restore re-establishes the connection by restarting the server** (`process.exit(0)` after reply; container `restart: unless-stopped` brings it back). NOT a live pool swap. | User-locked. Restore is a rare, deliberate, destructive, user-initiated action on a single-user local app; ~1–2 s downtime is acceptable. The restarted server's `start()` already runs the idempotent boot path (`probePg → runPgMigrations → runFtsBootstrap`), so no new pool-swap abstraction or in-request re-migrate is needed. The browser's existing `waitForServerPg()` poll reconnects on reload. |
| L2 | **Pre-restore safety dump is auto-downloaded AND persisted.** The PUT handler always runs a safety `pg_dump -Fc` to `/data/mayon-pre-restore-<ts>.dump` first; on success it returns those bytes as `200 application/octet-stream` (browser auto-saves via `downloadBlob`) then exits; on failure it returns `500` JSON `{error, detail, safetyPath}` and **rolls back to the safety dump before exiting**. | User-locked. Matches epic principle #4/#5 ("provide as download"; "always takes a pre-migration safety dump"). The volume copy is the durable rollback artifact; the response body is the UX copy. |
| L3 | **`pg_dump`/`pg_restore` are installed in the server image via `apk add --no-cache postgresql17-client`** (runtime stage of `server/Dockerfile`). | The server runs `node:22-alpine` with no PG client tools today. PG client major must match the `postgres:17-alpine` db service (dump-from-17 / restore-into-17). Build verification is the first gate. |
| L4 | **Restore = drop `public` + `drizzle` schemas, recreate `public`, then `pg_restore --no-owner --no-privileges`.** A maintenance `pg.Client` (separate from the pool) does the drop after `pool.end()`. | Epic D9, extended: also drop the `drizzle` schema (drizzle's PG migrator keeps its `__drizzle_migrations` journal in schema `drizzle`) so `pg_restore` does not conflict on already-existing objects. The dump is full-DB (no `--schema` filter) so both schemas + the FTS function/columns/indexes round-trip; boot's `IF NOT EXISTS` FTS bootstrap and no-op migrate reconcile cleanly. |
| L5 | **Validation = `PGDMP` magic header (first 5 bytes) + `pg_restore -l <file>` (exit 0)**, both BEFORE any destructive step. | Cheap, side-effect-free gate so a bad file is rejected with the live DB untouched. |
| L6 | **Reuse the existing `'backup'` cap (no new cap).** App-DB download/restore buttons are gated on `serverStatus.has('pg')` (which already implies pool ready); the sandbox section stays gated on `serverStatus.has('backup')`. | Epic decision. `'backup'` is in `BASE_CAPS` (always advertised) so it alone does **not** imply PG — the UI must gate the **app-DB** buttons on `'pg'`, not on `'backup'`. |
| L7 | **Browser restore = PUT → (200) save safety `.dump` → `location.reload()`.** The driver is stateless HTTP, so reload re-runs `bootstrapDb()` against the restarted server; no `rebootstrapWith()` needed. | Confirmed: `createRemotePgDriver()` holds no connection. |
| L8 | **New module `server/src/pg-backup.ts`** (`registerPgBackup(app, {pool, databaseUrl})`) + new browser client `src/lib/server/db-backup.ts` (`downloadDbBackup`/`restoreDbBackup`), mirroring the existing `server/src/backup.ts` ↔ `src/lib/server/sandbox-backup.ts` split. `src/lib/db/backup.ts` keeps only pure helpers (`downloadBlob`, `isPgDumpHeader`). | Mirrors the established sandbox-backup pattern; keeps `$lib/db/backup.ts` free of fetch/state. |
| L9 | **The `application/octet-stream` body parser is registered once at `buildApp` top level** (moved out of `registerBackup`). Both `registerBackup` and `registerPgBackup` rely on it. | Fastify throws `FST_ERR_CTP_ALREADY_PRESENT` if two modules register the same content-type parser. |
| L10 | **Server tests are hermetic: mock `child_process.spawn` (+ `process.exit`).** Real `pg_dump`/`pg_restore` round-trip is a **manual acceptance gate** (`docker compose`). | pglite cannot run the PG client binaries and there is no real PG in CI; the orchestration, validation, header, and wire contract are fully coverable with mocked spawns. |

## Grounding (verified current state)

- **Suspended app-DB backup** — `src/lib/db/backup.ts`: `createBackup()`/`restoreBackupFromBytes()`
  throw; only `downloadBlob` + `isSqliteHeader` (SQLite-specific) helpers exist.
- **UI hides app-DB backup under PG** — `DataSection.svelte:117` `{#if !serverStatus.has('pg')}`
  wraps the "Download backup"/"Restore from backup" buttons (the `handleBackup`/`handleRestore`/
  `handleFileInput` handlers call the throwing stubs). P-pg-5 **flips** this to show under PG.
- **Sandbox backup is the parity reference** — `server/src/backup.ts` `registerBackup(app, db, dbPath)`
  registers `GET/PUT /api/backup/sandbox` (stream `db.serialize()`; restore validates the
  `SQLite format 3\x00` header, `bodyLimit: 512*1024*1024`). `server/src/db.ts`
  `replaceSandboxFromBytes` closes+renames+rewrites. Browser mirror: `src/lib/server/sandbox-backup.ts`
  (`downloadSandboxBackup`/`restoreSandboxBackup`, gated on `serverStatus.has('backup')`).
- **Server PG stack** — `server/src/pg.ts`: `createPgPool(url)` (`pg.Pool`, `max:10`),
  `probePg` (retry), `translatePlaceholders`, `pgQueryHandler`, `runPgMigrations`
  (drizzle native `migrate()`), `registerPgDb(app, pool)` (`POST /api/db/query`, **503 if no pool**).
  `PgPoolLike = { query, end }`; `pg.Client` available for a maintenance connection.
- **Server boot** — `server/src/server.ts` `start()`: `createPgPool → probePg → runPgMigrations →
  runFtsBootstrap` (all idempotent); `buildApp(dbPath, {pgPool, pgReady})` registers routes;
  `BASE_CAPS = ['stdio-mcp','llm-proxy','sandbox-db','backup']`; `'pg'` pushed when ready; pool
  closed in `onClose`. `BuildAppOptions = { pgPool?, pgReady? }`.
- **Server image has no PG client tools** — `server/Dockerfile` final stage `FROM node:22-alpine`,
  no `apk add`. `drizzle/` is copied in (`COPY ./drizzle ./drizzle`); `MIGRATIONS_DIR` defaults to
  `cwd/drizzle` = `/app/drizzle`. Build = `tsup src/server.ts → dist/` (new `pg-backup.ts` is
  auto-included).
- **Wire types** — `packages/shared/src/protocol.ts`: `ServerCap` includes `'backup'` and `'pg'`;
  `HealthResponse` carries `caps` + `sandboxDbPath`. No backup-specific wire types needed (octet-stream
  bodies + `content-disposition`).
- **Stateless browser driver** — `src/lib/db/driver/pg.ts` `createRemotePgDriver()` is pure HTTP
  (`serverClient.http('/api/db/query')`); no pool/connection to reset on restore.
- **Reconnect on reload** — `src/lib/db/driver/client.ts` `bootstrapDb()` calls `waitForServerPg()`
  (polls until server+`'pg'` cap) before building the driver; `location.reload()` re-runs it.
- **Compose** — `docker-compose.yml`: `db: postgres:17-alpine` (internal-only, `pg-data` volume,
  `pg_isready` healthcheck), `server` `depends_on: db (healthy)`, `DATABASE_URL` from env,
  `sidecar-data` volume at `/data`, `restart: unless-stopped`.
- **Server test pattern** — `server/src/backup.test.ts`: `buildApp(dbPath)` on port 0, `app.inject`.
  Browser test pattern — `src/lib/server/sandbox-backup.test.ts`: `vi.mock` `$lib/server/status.svelte`
  + `$lib/db/backup`, fake `globalThis.fetch`.

## Hard rules (non-negotiable this phase)

- `pg_dump`/`pg_restore`/`pg_restore -l` are the **only** restore mechanism; no pure-JS dump.
- The app-DB download/restore **routes 503 when the pool is absent** (mirror `/api/db/query`);
  the **UI** gates app-DB buttons on `serverStatus.has('pg')`, the sandbox section on `'backup'`.
- Restore **always** takes a safety dump before any destructive step; a failed restore **rolls back
  to the safety dump** before exiting (the live DB is never left dropped/empty).
- The destructive restore runs from a **maintenance `pg.Client`** after `pool.end()`; the server
  **exits** on restore completion (success or rolled-back failure) — never leaves a half-open pool.
- `process.exit` is **mocked** in tests (never actually exits the vitest worker).
- No OPFS code removal (P-pg-7), no OPFS→PG importer (P-pg-6), no schema/FTS changes.
- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green.

---

## Tasks

> Order is a dependency sequence. After all edits: `pnpm install` (no new deps — `pg` already
> present server-side), then the T9 verification block.

### T1 — Server image: install PG client tools (`server/Dockerfile`)

- In the **final** stage (`FROM node:22-alpine`), add:
  ```dockerfile
  RUN apk add --no-cache postgresql17-client
  ```
- Place it before `CMD`. (Alpine 3.21+ ships `postgresql17-client`; matches the `postgres:17-alpine`
  db. If the package name is unavailable on the base's alpine, fall back to
  `postgresql16-client` — pg_dump 16 → restore into 17 is supported; **never** older-restore-into-newer-dump.
  The T9 build gate catches a wrong package immediately.)
- No build-stage change needed (`pg_dump` is a runtime tool, not needed to compile).

### T2 — Shared helpers + routes (`server/src/pg-backup.ts`, new)

- Spawn wrappers (all use `node:child_process` `spawn`; capture stderr; reject on non-zero exit):
  ```ts
  import { spawn } from 'node:child_process';
  import { writeFile, createWriteStream, readFile, mkdir } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import pg from 'pg';
  import type { FastifyInstance } from 'fastify';
  import type { PgPoolLike } from './pg';

  const PGDMP = Buffer.from('PGDMP', 'ascii'); // custom-format magic, 5 bytes
  export function isPgDumpHeader(b: Buffer): boolean {
    return b.length >= 5 && b.subarray(0, 5).equals(PGDMP);
  }

  /** pg_dump -Fc → file. Resolves on exit 0; rejects with stderr on failure. */
  export function dumpDatabase(databaseUrl: string, destPath: string): Promise<void> { /* spawn('pg_dump', ['-Fc','--no-owner','--no-privileges','-d',databaseUrl]) → pipe stdout to createWriteStream(destPath); await 'exit'===0 */ }

  /** pg_restore --dbname <url> <srcPath>. Resolves on exit 0. */
  export function restoreDatabase(databaseUrl: string, srcPath: string): Promise<void> { /* spawn('pg_restore', ['--no-owner','--no-privileges','--dbname',databaseUrl, srcPath]); await exit 0 */ }

  /** pg_restore -l <srcPath> → exit 0 means a valid TOC. */
  export function validateDumpToc(srcPath: string): Promise<void> { /* spawn('pg_restore', ['-l', srcPath]); await exit 0 */ }

  /** Streaming dump for GET (stdout piped straight to the reply). */
  export function spawnPgDump(databaseUrl: string) { return spawn('pg_dump', ['-Fc','--no-owner','--no-privileges','-d',databaseUrl]); }
  ```
- `registerPgBackup(app, { pool, databaseUrl })`:
  - **`GET /api/backup/db`** (download):
    - `if (!pool) return reply.code(503).send({ error: 'pg not configured' });`
    - `const child = spawnPgDump(databaseUrl);`
    - headers: `content-type: application/octet-stream`, `content-disposition: attachment; filename="mayon-${formatDate()}.dump"`.
    - `req.raw.on('close', () => child.kill())` (no leaked process on client cancel).
    - `reply.send(child.stdout)`; on `child` `'error'` or non-zero exit → `reply.code(500).send({error:'backup failed', detail})` (only if headers not yet sent).
  - **`PUT /api/backup/db`** (restore; `bodyLimit: 512*1024*1024`):
    1. `const bytes = req.body as Buffer;` **validate** `isPgDumpHeader(bytes)` → else `400 {error:'not a valid pg_dump (custom format) file'}`.
    2. Write `bytes` to `tmp = join(tmpdir(), mayon-restore-${ts}.dump)`; `await validateDumpToc(tmp)` → else `400 {error:'invalid or corrupt dump'}`.
    3. **Safety:** `await mkdir('/data',{recursive:true}); const safety = '/data/mayon-pre-restore-${ts}.dump'; await dumpDatabase(databaseUrl, safety);`
    4. `await pool.end();` (release server-held connections).
    5. Maintenance client:
       ```ts
       const client = new pg.Client(databaseUrl); await client.connect();
       await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database();');
       await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
       await client.query('DROP SCHEMA public CASCADE');
       await client.query('CREATE SCHEMA public');
       await client.end();
       ```
    6. `try { await restoreDatabase(databaseUrl, tmp); }` — **success path**:
       - `const safetyBytes = await readFile(safety);`
       - `reply.header('content-type','application/octet-stream').header('content-disposition', 'attachment; filename="mayon-pre-restore-${ts}.dump"').send(safetyBytes);`
       - `setImmediate(() => process.exit(0));` (reply flushes first; verify in manual gate).
    7. **failure path** (catch): best-effort rollback then 500:
       ```ts
       try { await restoreDatabase(databaseUrl, safety); } catch { /* rollback failed; leave for manual recovery */ }
       const body = { error: 'restore failed', detail, safetyPath: safety, rolledBack: true };
       if (!reply.sent) reply.code(500).send(body);
       setImmediate(() => process.exit(0));   // restart: boot re-migrates; user can retry via UI
       ```
    8. `finally { try { unlinkSync(tmp); } catch {} }`
  - (Content-type parser is NOT registered here — see T3.)

### T3 — Server wiring (`server/src/server.ts` + `server/src/backup.ts`)

- `BuildAppOptions`: add `databaseUrl?: string`.
- In `buildApp`, **move** the `application/octet-stream` content-type parser to the top level
  (remove the `app.addContentTypeParser(...)` call from `registerBackup` in `server/src/backup.ts`;
  place it once in `buildApp` before `registerBackup`/`registerPgBackup` run). L9.
- In `buildApp` after `registerPgDb(fastify, opts.pgPool)`:
  `registerPgBackup(fastify, { pool: opts.pgPool, databaseUrl: opts.databaseUrl });`
- In `start()`, pass `databaseUrl` through: `buildApp(SANDBOX_DB_PATH, { pgPool, pgReady, databaseUrl })`.
- `onClose` unchanged (pool already ended by a successful restore + process exited; harmless otherwise).

### T4 — Browser pure helpers (`src/lib/db/backup.ts`)

- Keep `downloadBlob(bytes, filename, type='application/octet-stream')` (generalize the blob type).
- Remove the throwing stubs `createBackup`/`restoreBackupFromBytes`.
- Replace `isSqliteHeader` with `isPgDumpHeader(bytes: Uint8Array): boolean` (`P,G,D,M,P` = `0x50,0x47,0x44,0x4d,0x50`).
- Add `parseContentDispositionFilename(res: Response, fallback: string): string` (regex on
  `content-disposition`; fallback `mayon-pre-restore.dump`).
- Re-export `isPgDumpHeader`/`downloadBlob`/`parseContentDispositionFilename` for the client + tests.

### T5 — Browser client (`src/lib/server/db-backup.ts`, new)

- Mirror `src/lib/server/sandbox-backup.ts`:
  ```ts
  import { serverClient } from './client';
  import { serverStatus } from './status.svelte';
  import { downloadBlob, isPgDumpHeader, parseContentDispositionFilename } from '$lib/db/backup';

  export async function downloadDbBackup(): Promise<void> {
    if (!serverStatus.has('pg')) throw new Error('Server DB not ready');
    const res = await serverClient.http('/api/backup/db');
    if (!res.ok) throw new Error(`Backup download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    downloadBlob(bytes, `mayon-${formatDate()}.dump`);
  }

  export async function restoreDbBackup(file: File): Promise<void> {
    if (!serverStatus.has('pg')) throw new Error('Server DB not ready');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPgDumpHeader(bytes)) throw new Error('Not a valid pg_dump file');
    const res = await serverClient.http('/api/backup/db', {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes
    });
    if (res.ok) {
      // auto-save the safety dump the server returns, then reconnect to the restarted server
      const safety = new Uint8Array(await res.arrayBuffer());
      downloadBlob(safety, parseContentDispositionFilename(res, 'mayon-pre-restore.dump'));
      location.reload();
      return;
    }
    const j = await res.json().catch(() => ({}));
    throw new Error(j.detail ? `Restore failed: ${j.detail}` : `Restore failed: ${res.status}`);
  }
  ```
  (`formatDate` local helper, same as sandbox-backup.)

### T6 — UI (`src/lib/components/settings/DataSection.svelte`)

- Replace imports: drop `createBackup`/`restoreBackupFromBytes`; import
  `downloadDbBackup`/`restoreDbBackup` from `$lib/server/db-backup`; keep
  `downloadSandboxBackup`/`restoreSandboxBackup`.
- **Flip the app-DB gate** (L6): change `{#if !serverStatus.has('pg')}` → `{#if serverStatus.has('pg')}`.
- App-DB `<input accept=".sqlite">` → `accept=".dump,.backup"`.
- `handleBackup` → `await downloadDbBackup()`; `handleRestore`/`handleFileInput` → read file →
  `await restoreDbBackup(file)` (on success the client reloads; catch surfaces `detail`/`safetyPath`).
- Update the descriptive `<p>`: "Backups are Postgres custom-format dumps (`.dump`) — data only,
  no API keys. Restoring first downloads a safety backup, then replaces all data and reloads."
- Sandbox section (`{#if serverStatus.has('backup')}`) unchanged.

### T7 — Tests

- **`server/src/pg-backup.test.ts`** (hermetic; `vi.mock('node:child_process')` to fake `spawn`,
  `vi.spyOn(process, 'exit')` to no-op/throw):
  - `buildApp(dbPath, { pgPool: mockPool, databaseUrl: 'postgres://t:t@db/t' })`; `app.inject`.
  - GET no pool → 503.
  - GET success → 200, `content-type` octet-stream, `content-disposition` matches
    `/mayon-\d{8}\.dump/`, spawn args include `pg_dump -Fc --no-owner --no-privileges -d <url>`;
    `req.raw close` kills the child.
  - PUT non-PGDMP body → 400, no spawn, no `pool.end`.
  - PUT valid header but `pg_restore -l` non-zero → 400, no `pool.end`, no DROP.
  - PUT success path → spawn order asserted: `pg_dump` (safety) → `pool.end()` called → DROP/CREATE
    (maintenance client mocked) → `pg_restore` (restore); returns 200 octet-stream with the safety
    bytes; `process.exit` invoked (mocked). `finally` unlinks the temp.
  - PUT failure path (restore rejects) → rollback `pg_restore(safety)` attempted; returns 500
    `{error, detail, safetyPath, rolledBack}`; `process.exit` invoked.
  - Assert the octet-stream parser is registered exactly once (no `FST_ERR_CTP_ALREADY_PRESENT`).
- **`src/lib/server/db-backup.test.ts`** (mirror `sandbox-backup.test.ts`; mock status + helpers;
  fake `globalThis.fetch`; stub `location.reload`):
  - cap-absent throws; download calls `/api/backup/db` + `downloadBlob(... '.dump')`;
    non-ok throws.
  - restore rejects non-PGDMP before fetch; PUTs valid bytes; on 200 downloads safety +
    calls `location.reload`; on 500 surfaces `detail`.
- **`src/lib/db/backup.test.ts`** (pure): `isPgDumpHeader` true for `PGDMP…`, false for SQLite/short;
  `parseContentDispositionFilename` parses `attachment; filename="x.dump"` and falls back.

### T8 — Docs (`AGENTS.md`)

- Add a **P-pg-5 acceptance-gate** section (mirror existing phase-gate format): browser+server+PG
  → Settings "Data" shows "Download backup"/"Restore from backup" under PG → download yields a valid
  `.dump` (restores into a throwaway PG); restore → a safety `.dump` auto-downloads → app reloads →
  state matches the restored content; uploading a non-PG file → clear error, live DB untouched;
  downloading while an MCP tool writes the **sandbox** DB → app-DB `.dump` is valid (separate DB,
  `pg_dump` MVCC snapshot); failed restore rolls back to safety and restarts. Note OPFS backup is
  permanently superseded (code removal is P-pg-7); document "restore into the same or newer PG".
- Update the P-pg-2 line "OPFS backup suspended until P-pg-5" → now live under PG (`pg_dump`/`pg_restore`).

### T9 — Verify

- `docker compose build` succeeds and `pg_dump --version` (in the server container) reports 17.x
  (validates T1's package). **Run this first** — it gates everything.
- `pnpm check`; `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green.
- `docker compose up`:
  - Server logs `pg: ready` → `pg: migrations applied` → `pg: fts ready`.
  - `GET /api/health` → caps include `'pg'` (and `'backup'`).
  - Settings → Data → "Download backup" → a `mayon-YYYYMMDD.dump`; restore it into a throwaway PG to confirm validity.
  - Create a chat/message, download, then "Restore from backup" → safety `.dump` auto-downloads →
    reload → the chat/message is present (round-trip); a second download matches.
  - Upload a non-`.dump`/non-PGDMP file → clear error; live data intact.
  - Failed restore path (e.g. truncated dump): confirm rollback-to-safety + restart + UI error.
- Grep guards: `rg "returns in P-pg-5|isSqliteHeader|createBackup\b" src/ server/` → no hits (stub +
  SQLite header gone); `rg "pg_dump|pg_restore" server/src` → the new module.

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green
  (mocked spawns; `process.exit` mocked).
- `docker compose build` installs `postgresql17-client`; `pg_dump --version` = 17.x.
- `docker compose up` → app-DB download/restore round-trips; pre-restore safety auto-downloads;
  non-PG file rejected; failed restore rolls back + restarts; download-while-sandbox-writing is not torn.
- App-DB buttons gated on `serverStatus.has('pg')`; sandbox section still on `'backup'`; the
  octet-stream parser is registered once.
- Restore restarts the server (no live pool swap); boot's idempotent migrate+FTS reconcile the
  restored DB; browser reconnects via `waitForServerPg()` on reload.

## Risks

- **`postgresql17-client` package availability on `node:22-alpine`'s base.** Mitigation: T9 build gate
  runs first; documented fallback to `postgresql16-client` (dump-16/restore-17 supported; never older).
- **`pg_restore` object-existence conflicts.** Mitigation: L4 drops both `public` and `drizzle`
  schemas first; the dump is full-DB so both + FTS objects round-trip.
- **Reply-then-exit sequencing** (browser must receive the response before the server exits). Mitigation:
  `setImmediate(() => process.exit(0))` after `reply.send`; manual gate confirms the browser saves the
  safety dump and reloads; `onResponse`-hook exit is the robust fallback if flush races.
- **drizzle journal schema name.** Mitigation: `DROP SCHEMA IF EXISTS drizzle CASCADE` covers it; T9
  restore round-trip confirms `runPgMigrations` is a no-op on restart (journal intact).
- **`process.exit` killing the vitest worker.** Mitigation: `vi.spyOn(process,'exit')` in T7; never
  call the real exit in tests.
- **Leaked `pg_dump` child on client cancel.** Mitigation: `req.raw.on('close', () => child.kill())` (T2).
- **Double octet-stream parser registration.** Mitigation: L9 moves it to `buildApp`; T7 asserts
  single registration.
- **Dump size / upload.** Personal learning DBs are MB-scale; `bodyLimit: 512 MB` (parity with sandbox)
  is ample; no streaming-upload needed.

## Out of scope (explicit)

- OPFS/WASM/COEP removal, dead-code sweep, full docs rewrite (P-pg-7).
- OPFS→PG importer (P-pg-6) — separate, higher-risk phase.
- Folding the sandbox SQLite into PG (separate epic, D11).
- `timestamptz`/`jsonb`/`CREATE TYPE` enum cleanups (deferred).
- Real-PG integration tests in CI (pglite can't run the binaries; round-trip is the manual gate).
- A "merge" restore mode (epic D10 locks **replace** for v1).

## Dependency graph

```
T1 (Dockerfile pg client) ──┐
T2 (pg-backup.ts routes) ───┼─► T3 (server wiring + parser) ─► T7 (server tests) ─┐
T4 (backup.ts helpers) ─────┬─► T5 (db-backup client) ─► T6 (DataSection UI) ─► T7 (browser tests) ─┤
                            └──────────────────────────────────────────────────► T8 (docs) ─► T9 (verify)
```
T1, T2, T4 are independent starts; T3 needs T2; T5 needs T4; T6 needs T5; T7 after T3+T5+T6; T8/T9 last.
