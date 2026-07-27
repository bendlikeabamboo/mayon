# In-place DB restore with schema versioning & breaking-change registry

## Goal

Replace the current nuke-and-pave DB restore (drops `public`+`drizzle` schemas,
`pg_restore` full schema+data, `process.exit(0)` container restart) with an
**in-place `--data-only` restore** that has **no server restart and no downtime**,
plus a **schema-version stamp** on backups and a **breaking-change registry** that
can auto-migrate older backups into the current schema.

Overarching UX goal: a **seamless backup & restore** for the end user.

## Resolved decisions (from planning interview)

1. **Semantics: REPLACE only.** Restore makes the live DB match the backup's data.
   Append/merge is out of scope (would require Option B / fdw scratch-DB).
2. **Registry role: gate + auto-migrate.** Older backups with *additive* gaps
   restore automatically; *breaking* gaps run a registered `migrate(client)` fn;
   breaking gaps with no migrate fn, or backups newer than current, are REFUSED
   before any data change.
3. **Older/legacy backup UX: auto-proceed + notice.** No confirm dialog. Refusals
   block pre-restore; everything else proceeds and returns a human-readable notice.
4. **Concurrent access: brief maintenance flag.** During the restore window the
   server returns 503 on the app data path (`/api/db/query`); no restart.
5. **Safety backup UX: opt-in download link.** Server retains the pre-restore
   safety dump in `/data` for auto-rollback; client shows an opt-in "Download
   pre-restore backup" button instead of auto-downloading.

## How "no downtime" works under Option A (honest constraint)

Option A is **two transactions**: (a) our `TRUNCATE` commits on our connection,
then (b) `pg_restore --data-only --single-transaction` loads data on its *own*
connection. Unlike Option B this cannot be one atomic transaction, so during the
(seconds-long) window the DB is transitional. The **maintenance flag** (#4) makes
this correct: the app data path returns 503 for the duration, so no chat write
can land mid-restore and get truncated. The server itself stays up the whole time.

## Architecture / data flow

```
PUT /api/backup/db (octet-stream .dump)
  │
  1. validate PGDMP header
  2. write to tmp file
  3. validate TOC          (pg_restore -l)
  4. EXTRACT dumpVersion   (pg_restore --data-only -t settings --column-inserts
                            → stdout INSERTs → parse 'schemaVersion' row)
                            ↑ NON-DESTRUCTIVE: no --dbname, touches nothing live
  5. GATE  (pure: planRestore(dumpVersion, SCHEMA_VERSION, registryDescriptors))
        dumpVersion > current           → 400 refuse "newer schema"
        breaking gap, no migrate fn     → 400 refuse "upgrade Mayon first"
        otherwise                       → proceed (+ ordered migrate plan)
  6. restoring = true                              ← maintenance flag ON
  7. safety dump → /data/mayon-pre-restore-<ts>.dump
  8. client = pool.connect()
        BEGIN; SET LOCAL session_replication_role='replica';
        TRUNCATE <11 tables> CASCADE;  COMMIT;     ← FK triggers off (superuser ✓)
  9. pg_restore --data-only --single-transaction --disable-triggers
        --no-owner --no-privileges -d <url> <tmp>
        (GENERATED cols excluded → search_vec recomputes; FTS self-heals)
  10. if plan.migrations: for each (ordered): await m.migrate(client)  [in a tx]
  11. UPSERT settings.schemaVersion = SCHEMA_VERSION   ← re-stamp to current
  12. restoring = false                             ← maintenance flag OFF
  13. 200 { ok, notice, safetyFilename, dumpVersion, currentVersion, migrated: [...] }

  failure (step 9/10):
        pg_restore --data-only safety dump back into emptied tables
        restoring = false
        500 { error:'restore failed', detail, rolledBack:true, safetyFilename }
```

Key facts already verified in codebase (do not re-litigate):
- Dockerized `mayon` PG user is a **superuser** → `session_replication_role` and
  `--disable-triggers` work (`docker-compose.yml:34`, `.env`, `pg-import.ts:159`).
- `search_vec` is `GENERATED ALWAYS AS (...) STORED` (`packages/shared/src/fts.ts`)
  → excluded from `pg_restore` COPY, recomputes on insert. Importer test already
  asserts non-null `search_vec` post-load (`pg-import.test.ts:277`).
- The 11 app tables + `settings` list already exists in `pg-import.ts:11-23` —
  reuse it verbatim for the `TRUNCATE`.
- `/api/db/query` is the ONLY app-data route touching the app PG
  (`server/src/pg.ts:107-147`) → gating it alone is sufficient.

## File-by-file task list (ordered)

### Phase 1 — Schema-version plumbing (shared, no behavior change)

**1. `packages/shared/src/schema-version.ts`** (NEW) — pure, pg-free:
```ts
export const SCHEMA_VERSION = 1;          // bump on every migration
export const LEGACY_VERSION = 0;          // sentinel for "no stamp in dump"
export const SCHEMA_VERSION_SETTINGS_KEY = 'schemaVersion';

export interface SchemaMigrationDescriptor {
  from: number;
  to: number;
  description: string;
  kind: 'additive' | 'breaking';
}

export interface MigrationPlan {
  decision: 'proceed' | 'refuse-newer' | 'refuse-breaking';
  migrations: SchemaMigrationDescriptor[];   // ordered, to run
  notice: string;
  dumpVersion: number;   // LEGACY_VERSION if absent
  currentVersion: number;
}

export function planRestore(
  dumpVersion: number,
  currentVersion: number,
  registry: SchemaMigrationDescriptor[]
): MigrationPlan;
```
`planRestore` rules:
- `dumpVersion > currentVersion` → `refuse-newer`.
- collect descriptors with `from` in `[dumpVersion, currentVersion)`, ordered by `to`.
- if any selected descriptor is `kind:'breaking'` AND has no `migrate` (server side
  passes a parallel array / the descriptor carries `hasMigrate:boolean`) →
  `refuse-breaking`.
- else `proceed`; `notice` describes additive vs migrated gaps + legacy fallback.

> NOTE on `hasMigrate`: to keep shared pg-free, add `hasMigrate?: boolean` to the
> descriptor. The server populates it when building the descriptor view from its
> registry. `planRestore` treats `breaking` + `!hasMigrate` as refuse-breaking.

**2. `packages/shared/src/index.ts`** — re-export everything from `./schema-version`.

**3. `server/src/schema-migrations.ts`** (NEW) — server-side registry, owns the fns:
```ts
import type { PgPoolClient } from './pg';
import { SCHEMA_VERSION, type SchemaMigrationDescriptor } from '@mayon/shared';

export interface ServerSchemaMigration extends SchemaMigrationDescriptor {
  hasMigrate: boolean;
  migrate?(client: PgPoolClient): Promise<void>;
}

// Empty today. First real migration adds an entry + bumps SCHEMA_VERSION.
export const SCHEMA_MIGRATIONS: ServerSchemaMigration[] = [];

export function registryDescriptors(): SchemaMigrationDescriptor[] {
  return SCHEMA_MIGRATIONS.map(({ from, to, description, kind, hasMigrate }) =>
    ({ from, to, description, kind, hasMigrate }));
}
```

**4. Build shared before consumers:** `pnpm --filter @mayon/shared build`
(existing project constraint — `@mayon/shared` exports from `./dist`).

### Phase 2 — Boot stamping + backup stamping

**5. `server/src/server.ts`** — after `runFtsBootstrap` succeeds, stamp:
```ts
await pool.query(
  `INSERT INTO settings(key,value) VALUES('schemaVersion',$1)
   ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
  [String(SCHEMA_VERSION)]
);
console.log(`pg: schemaVersion ${SCHEMA_VERSION} stamped`);
```
(Server owns schema metadata, same place it runs migrations + FTS bootstrap.)

**6. `server/src/pg-backup.ts` `GET /api/backup/db`** — just before `runDump`,
UPSERT current stamp (belt-and-suspenders for a restored-then-not-rebooted DB),
then dump. Also bake the version into the filename: `mayon-YYYYMMDD-vN.dump`
(authoritative version is the in-data stamp; filename is a human hint only).

### Phase 3 — Version extraction (non-destructive pre-restore read)

**7. `server/src/pg-backup.ts`** — add `extractDumpVersion(srcPath): Promise<number>`:
- `spawn('pg_restore', ['--data-only','-t','settings','--column-inserts','--no-owner','--no-privileges', srcPath])` (NO `--dbname` → writes INSERT SQL to stdout, touches no DB).
- capture stdout, regex the row whose first value is `'schemaVersion'`, parse the
  second value as int. Absent/unparseable → `LEGACY_VERSION` (0).
- We control the stamp format (JSON-stringified int) so the parse is robust.

### Phase 4 — Restore rewrite (the core)

**8. `server/src/pg-backup.ts` `PUT /api/backup/db`** — replace the entire current
body (lines 126-194) with the data-flow sequence above. Concretely DELETE:
- `pool?.end()`
- `pg_terminate_backend(...)` + `DROP SCHEMA drizzle/public` + `CREATE SCHEMA public`
- BOTH `setImmediate(() => process.exit(0))`
KEEP: header check, tmp write, `runValidateToc`, safety dump, tmp cleanup.
ADD: extract version → `planRestore` gate → refuse-early on bad plan →
`restoring=true` → truncate tx → `pg_restore --data-only --single-transaction
--disable-triggers` → run migrate fns → re-stamp → `restoring=false` → JSON 200.
Failure branch: rollback-to-safety via `pg_restore --data-only` into emptied
tables, `restoring=false`, 500 `{rolledBack:true}`.

`runRestore` helper: add a `dataOnly` variant (or a new `runRestoreDataOnly`) that
spawns `pg_restore` with `--data-only --single-transaction --disable-triggers`.

### Phase 5 — Maintenance flag

**9. `server/src/pg.ts`** — module-level `let restoring = false;` + exported
`setRestoring(v:boolean)` / `isRestoring()`. In the `/api/db/query` handler
(line 132), before the `pool` check: `if (isRestoring()) return reply.code(503).send({ error:'restore in progress' });`

**10. `server/src/server.ts` `/api/health`** — add `restoring: boolean` to the
response (extend `HealthResponse` in `packages/shared/src/protocol.ts`) so other
tabs/clients can show "Restoring…". The initiating client is blocked on the PUT.

### Phase 6 — Opt-in safety download endpoint

**11. `server/src/pg-backup.ts`** — add `GET /api/backup/safety?filename=...`:
- validate `filename` matches `/^mayon-pre-restore-\d+\.dump$/` (path-traversal guard).
- stream `/data/<filename>` as octet-stream, or 404 if absent.
- The restore response (step 13) returns `safetyFilename`; client uses it here.

### Phase 7 — Client changes

**12. `src/lib/services/db-backup.ts` `restoreDbBackup`** — rewrite:
- PUT bytes (unchanged).
- on 200: parse JSON `{ ok, notice, safetyFilename, dumpVersion, currentVersion, migrated }`.
  - **do NOT** auto-download a blob; **do NOT** call `waitForServerPg` (no restart).
  - `location.reload()` still called (refresh in-memory caches) but no longer a
    correctness requirement.
  - return the parsed payload so the UI can show the notice + the opt-in button.
- on 400 (refused): parse `{ error, decision, dumpVersion, currentVersion, detail }`
  → throw a clear, user-facing refusal message.
- on 500 (failed+rolled back): parse `{ error, detail, rolledBack }` → throw,
  telling the user the DB is back to its pre-restore state.

**13. `src/lib/services/db-backup.ts`** — add `downloadSafetyBackup(filename)`:
`GET /api/backup/safety?filename=...` → `downloadBlob`.

**14. UI (Settings → Data restore panel)** — surface the restore result:
- success notice ("Restored from older backup v3 → v7, 1 migration applied").
- opt-in "Download pre-restore backup" button using `safetyFilename`.
- refused message with the reason ("backup is from a newer schema v9; upgrade
  Mayon first").
(Locate the existing restore panel via grep for `restoreDbBackup` callers.)

### Phase 8 — Tests (rewrite the contracts)

**15. `server/src/pg-backup.test.ts`** — rewrite. Remove `pool.end` + `process.exit`
assertions. New cases:
- 400 non-PGDMP (keep).
- 400 invalid TOC (keep, assert no truncate / no `restoring` flip).
- refuse-newer: mock `extractDumpVersion` → 9, current 1 → 400, `pool.end` never
  called, no TRUNCATE.
- refuse-breaking-no-migrate: seed registry with a breaking descriptor lacking
  `migrate`, dumpVersion below it → 400.
- success v1→v1: extract=1 → proceed → safety dump → truncate → pg_restore
  --data-only → re-stamp → 200 JSON `{ok,notice,dumpVersion:1,currentVersion:1}`.
- success legacy v0→v1: extract=0 → proceed with legacy notice.
- success migrated: dumpVersion<current with a migrate fn in registry → migrate
  called once, in order, listed in `migrated`.
- failure: pg_restore --data-only exits 1 → safety rollback pg_restore called →
  500 `{rolledBack:true}`, `restoring` ends false.
- maintenance flag: while `restoring=true`, `POST /api/db/query` → 503.
Mock `extractDumpVersion` via the existing `spawn` mock (the `--data-only
-t settings --column-inserts` stdout path) — add a stdout payload fixture
containing an `INSERT INTO public.settings VALUES ('schemaVersion','1');` line.

**16. `src/lib/services/db-backup.test.ts`** — rewrite:
- keep pg-cap-absent + non-PGDMP checks.
- 200 path: response is now JSON (not blob); assert no auto `downloadBlob` on
  success, `location.reload` still called, returned payload carries `notice`.
- add refusal-400 path → throws user-facing message containing the reason.
- add `downloadSafetyBackup` happy path (200 octet-stream → `downloadBlob`).
- remove the `waitForServerPg` mock reliance (no longer used by restore).

**17. `server/src/schema-migrations.test.ts`** (NEW) — pure `planRestore` tests
(lives next to the server registry but tests the shared pure fn):
- equal versions → proceed, no migrations.
- legacy 0 → current → proceed, legacy notice.
- older additive → proceed, no migrate listed.
- older breaking-with-migrate → proceed, migrate listed in order.
- older breaking-without-migrate → refuse-breaking.
- newer → refuse-newer.
- multi-hop 0→3 with [additive 0→1, breaking 1→2(+migrate), additive 2→3] →
  proceed, migrations ordered [1,2,3], breaking one included.

**18. Shared build + full gate:** `pnpm --filter @mayon/shared build && pnpm lint
&& pnpm check && pnpm test && pnpm --filter @mayon/server test` must be green.

## How to add a migration later (the whole point of the registry)

When a schema change lands in a future PR:
1. Generate the drizzle migration (`pnpm db:generate`).
2. In `packages/shared/src/schema-version.ts`: `SCHEMA_VERSION = N+1`.
3. In `server/src/schema-migrations.ts`: push
   `{ from:N, to:N+1, description:'…', kind:'additive'|'breaking', hasMigrate,
     migrate: async (c) => { … } }` (omit `migrate`/`hasMigrate:false` for pure
   additive — auto-fill handles it).
4. Add a `planRestore` case to `schema-migrations.test.ts`.
5. `pnpm --filter @mayon/shared build` (shared must rebuild before server check).

Additive example (no fn needed): adding nullable `brief`/`mcp_config` columns —
already the project's additive convention (`schema.ts` comments).
Breaking example (fn required): renaming/dropping a column, or a type change —
the `migrate` fn runs after the data load and reshapes the just-restored rows.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two-tx gap: truncate commits, pg_restore fails → tables empty | Auto-rollback to safety dump (already taken); `--single-transaction` makes pg_restore all-or-nothing so failure leaves empty (not partial) tables → safety restore is clean. |
| Long synchronous PUT times out at proxy (large DB) | Existing pattern is already a long synchronous op + restart; bump nginx `proxy_read_timeout`/`proxy_send_timeout` if multi-hundred-MB DBs expected. Note in PR. |
| `--disable-triggers` / `session_replication_role` need superuser | Existing constraint (importer already relies on it). Dockerized `mayon` user is superuser. Document for external-PG deployments. |
| Restored `settings` has stale schemaVersion (dump's old value) | Step 11 re-stamps to `SCHEMA_VERSION` after successful restore. |
| `extractDumpVersion` parse fragility | We control stamp format (JSON int); regex targets the exact `schemaVersion` row; absent → legacy (safe default). |
| Safety filename path traversal | `GET /api/backup/safety` validates `/^mayon-pre-restore-\d+\.dump$/`. |
| Other tabs see 503 mid-restore with no explanation | `HealthResponse.restoring` lets them show "Restoring…"; initiating tab shows its own progress from the in-flight PUT. |
| Non-dumped objects (FTS fn, indexes, drizzle migration table) drift | None — `--data-only` never touches schema objects; live schema (incl. FTS fn/indexes + `drizzle.__drizzle_migrations`) is untouched and authoritative. This is strictly better than the old nuke-and-pave which reinstalled the dump's schema. |

## Out of scope

- Append/merge restore (Option B / fdw). Replace-only per decision #1.
- Background/async restore with progress polling (sync PUT matches existing pattern).
- Automatic cleanup of old `/data/mayon-pre-restore-*.dump` safety files (future).
- Browser-side schema-version display beyond the restore notice.
- Changing the SQLite importer (`pg-import.ts`) — it already does in-place replace
  correctly; it will pick up `schemaVersion` stamping for free since `settings` is
  in its table list.

## Validation (manual acceptance, post-implementation)

Mirrors the AGENTS.md P-pg-5 gates, adapted to no-restart in-place:

1. **Round-trip, no restart:** create chat+message → Download backup (`mayon-...-v1.dump`)
   → Restore from backup → app reloads, data present, **server container did NOT
   restart** (check `docker compose ps` uptime unchanged). Second download matches.
2. **Maintenance flag:** open a second tab, start a restore from a large dump,
   observe the second tab's DB operations get 503/"restore in progress" then recover.
3. **Refusal — newer backup:** craft/restore a dump stamped with a version > current
   → clear 400 refusal, live DB untouched.
4. **Refusal — breaking-no-migrate:** seed registry with a breaking descriptor (no
   `migrate`), restore an older dump → 400 refusal, no truncate.
5. **Legacy (no stamp):** restore a dump produced before this feature → proceeds with
   "legacy backup" notice, data loads, FTS search still works (`/search` returns hits).
6. **Opt-in safety:** after a restore, "Download pre-restore backup" yields the
   retained `/data` safety dump; restoring it returns to pre-restore state.
7. **Failed restore rollback:** truncated/corrupt dump → 500 `rolledBack:true`,
   live data unchanged, app fully functional immediately after.
8. **FTS self-heal:** after any restore, `/search` returns ranked hits for imported
   content (GENERATED `search_vec` recomputed).
9. **Version stamp survives:** `SELECT value FROM settings WHERE key='schemaVersion'`
   == current `SCHEMA_VERSION` after boot, after backup, and after restore.
10. **Green:** `pnpm --filter @mayon/shared build && pnpm lint && pnpm check &&
    pnpm test && pnpm --filter @mayon/server test`.
