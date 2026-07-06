# UX3 — Backup & restore (data-only)

**Epic:** `refinement/ui-ux-phased.md` → UX3 (refinement #3 + #4).
**Status:** Execution-ready. All decisions resolved (two are **corrections to the
spec**, surfaced by code inspection and confirmed below).

## Goal

A Settings **Data** panel that lets a user **download a full snapshot** of their
local DB and **restore** one (replace), in both the browser (OPFS) and desktop
(native SQLite) runtimes. Snapshots are **data-only** — provider API keys never
enter the DB (they live in the OS keychain / IndexedDB), so a `VACUUM INTO`
snapshot contains no keys by construction. A restore replaces the live DB, takes
an **auto-stored rolling safety snapshot** first (decision D = yes), validates the
file, migrates it forward, then reloads the app.

## Decisions (resolved)

- **D (spec, sign-off): YES** — auto-store one rolling pre-restore safety
  snapshot. Desktop: `mayon-pre-restore.db` next to `mayon.db`. Browser: offered
  as a download `mayon-pre-restore-<ts>.sqlite`.
- **Desktop flow (sign-off): ADD `tauri-plugin-dialog`** + dedicated Rust
  `backup_database` / `restore_database` path commands (spec decision B, native
  path-to-path).
- **❗ Correction 1 — no `PRAGMA user_version` in this codebase.** The migrator
  (`src/lib/db/driver/migrator.ts`) tracks applied migrations via the
  `__drizzle_migrations` table keyed on `created_at`/hash — `user_version` is
  never set (verified: the only `PRAGMA` usages are `foreign_keys`/WAL). So the
  spec's "reject if `user_version` newer than app" is impossible. **Replacement:**
  a backup is "too new" iff `MAX(created_at)` from its `__drizzle_migrations` is
  **greater than** the running app's max bundled migration `folderMillis`. The
  pure decision lives in `checkBackup()` (unit-tested); each runtime extracts the
  applied ceiling its own way.
- **❗ Correction 2 — desktop SQLite ops in Rust via `rusqlite` (bundled).** The
  project has no in-Rust SQLite today (`plugin-sql` bundles its own). To both
  `VACUUM INTO` a snapshot and validate+overwrite on restore from Rust, add
  `rusqlite` with the `bundled` feature. **Tradeoff:** the desktop binary then
  contains two SQLite copies (plugin-sql + rusqlite). Accepted because (a) it
  matches the spec's "Rust path commands" decision exactly, (b) it lets Rust
  validate the source *before* overwriting, and (c) a pinned bundled SQLite
  **guarantees FTS5** for the UX4 hard gate.
- **Restore lifecycle (spec decision C): YES** — `rebootstrap()` (re-migrate)
  then `location.reload()`. Migration errors surface before reload so the app
  boots into a known-good DB; reload then drops all stale store caches.
- **Tauri driver does NOT implement the byte seam.** Spec called it optional
  ("for symmetry"). Desktop uses the Rust path commands exclusively, so
  `snapshot?()`/`restore?()` are implemented only on the memory + OPFS drivers
  (less surface). Noted as a deliberate simplification.

---

## Storage seam

### `src/lib/db/driver/types.ts` (edit) — add optional methods

```ts
export interface StorageDriver {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  batch(stmts: BatchStatement[]): Promise<QueryResult[]>;
  exec(sql: string): Promise<void>;
  /** Whole-DB snapshot as bytes (browser + in-memory). Optional on desktop. */
  snapshot?(): Promise<Uint8Array>;
  /** Replace the live DB with `bytes` (browser + in-memory). Optional on desktop. */
  restore?(bytes: Uint8Array): Promise<void>;
  /** Release the underlying connection/worker so a fresh driver can replace it. */
  dispose?(): Promise<void>;
}
```

### `src/lib/db/driver/memory.ts` (edit)

- Change `const db` → `let db` (closure-private, reassignable on restore).
- `snapshot`: `return Promise.resolve(db.export());` (sql.js `Database.export()`).
- `restore(bytes)`: `const next = new SQL.Database(bytes as Buffer); next.run('PRAGMA foreign_keys = ON'); db = next;`
- `dispose`: no-op (in-memory; nothing to release). Implement as `async dispose() {}`.

### `src/lib/db/driver/opfs-driver.ts` + `opfs-worker.ts` (edit)

Extend the worker protocol `DriverRequest.op` with `'snapshot' | 'restore' | 'validate'`
and the response with a transferable `bytes?: Uint8Array` / `validate?: { ok: boolean; reason?: string }`.
`createOpfsDriver` gains:
- `snapshot()` → `send('snapshot', {})` → return `new Uint8Array(r.bytes)`.
- `restore(bytes)` → `send('restore', { bytes })` (transfer the buffer).
- `dispose()` → `worker.terminate()`.

Worker ops (`opfs-worker.ts`):
- `snapshot`: `database.exec("VACUUM INTO 'file:mayon-snapshot.sqlite?vfs=opfs'")`;
  read that OPFS file's bytes via the `opfs` root handle (`navigator.storage.getDirectory()`),
  `delete` the temp file, `reply({ ok:true, bytes })` (mark transferable).
- `restore`: `database.exec('PRAGMA wal_checkpoint(TRUNCATE)')`; `database.close()`;
  overwrite the `mayon.sqlite` OPFS file with `bytes` (`root.getFileHandle('mayon.sqlite',{create:true}).createWritable()` → `write` → `close`);
  reopen `db = new OpfsDb('file:mayon.sqlite?vfs=opfs')`; `db.exec('PRAGMA foreign_keys = ON')`; `reply({ok:true})`.
- `validate`: open `bytes` in an in-memory sqlite-wasm db (`new sqlite3.oo1.DB(':memory:')` … or
  `sqlite3.oo1.OpfsDb` equivalent for `:memory:`); read table names from `sqlite_master` and
  `SELECT MAX(created_at) FROM __drizzle_migrations` (guard no-such-table → `null`); call the pure
  `checkBackup()` (imported from `$lib/db/backup` — that module MUST stay sql.js-free at its top
  level so the worker can import it; see backup.ts constraint); `reply({ok, reason})`.

### `src/lib/db/driver/tauri.ts` (edit)

- Add `dispose()` only: `async dispose() { await db.close(); }` (plugin-sql `Database.close()`;
  capability `sql:allow-close` already granted). **No** `snapshot`/`restore` (desktop uses Rust).

### `src/lib/db/driver/client.ts` (edit) — add `rebootstrapWith`

```ts
export async function rebootstrapWith(
  next?: { driver?: StorageDriver; runtime?: DbRuntime }
): Promise<Db> {
  if (next?.driver) {
    try { await driverRef?.dispose?.(); } catch { /* best-effort */ }
    driverRef = next.driver;
  }
  if (next?.runtime) dbStatus.runtime = next.runtime;
  dbStatus.status = 'initializing';
  driverPromise = null;
  dbRef = null;
  if (!driverRef) throw new Error('rebootstrap called before bootstrap');
  await runMigrations(driverRef, migrations);   // migrate-forward an older restored DB
  dbRef = createDb(driverRef);
  dbStatus.markReady(dbStatus.runtime);
  driverPromise = Promise.resolve(dbRef);
  return dbRef;
}
```

- Browser restore reuses the **same** driver (the worker's `restore` op already reopened
  the handle) → calls `rebootstrapWith()` with no arg.
- Desktop restore swaps to a **fresh** driver (the live plugin-sql conn was disposed, the
  file overwritten by Rust) → `rebootstrapWith({ driver: await createTauriDriver(), runtime:'tauri' })`
  (import `createTauriDriver` directly from `./tauri`).
- Export `rebootstrapWith` from `src/lib/db/index.ts`.

---

## Validation + orchestration — `src/lib/db/backup.ts` (new)

**⚠️ Top-level must NOT import `sql.js`** (the OPFS worker imports `checkBackup` from
here; a static sql.js import would bloat/break the browser bundle). `validateBackupBytes`
dynamic-imports the loader lazily.

Exports:
- `REQUIRED_TABLES` — the 11 tables from `schema.ts` (`chats, messages, branch_sources,
  cross_links, labs, quizzes, quiz_questions, quiz_attempts, quiz_answers, agent_traces,
  settings`).
- `maxKnownMigrationMillis()` → `Math.max(...migrations.map(m => m.folderMillis))` (imports
  the bundled `migrations` module).
- **Pure** `checkBackup({ headerOk, tables, maxAppliedMillis }): { ok; reason? }` — the
  single decision point: reject if `!headerOk`; reject if any `REQUIRED_TABLES` missing;
  reject if `maxAppliedMillis != null && maxAppliedMillis > maxKnownMigrationMillis()`
  ("backup is from a newer app version"); else ok. (`maxAppliedMillis === null` = legacy DB
  with no `__drizzle_migrations` → treat as old → ok.)
- `validateBackupBytes(bytes)` → (lazy sql.js) `new SQL.Database(bytes)`; header check
  (`bytes[0..15] === "SQLite format 3\0"`); read `sqlite_master` table names + `MAX(created_at)`
  from `__drizzle_migrations` (guard absent → null); return `checkBackup(...)`. Closes the db.
- `createBackup()` — branches on `isTauri()`:
  - **desktop:** `save()` dialog (`@tauri-apps/plugin-dialog`) → `invoke('backup_database', { target })`.
  - **browser:** `const bytes = await getDriver().snapshot!();` → `Blob` download `mayon-YYYYMMDD.sqlite`.
- `restoreBackupFromBytes(bytes)` — **browser path:** `validateBackupBytes` → reject fast on
  invalid; safety: `const safety = await getDriver().snapshot!();` offer as download
  `mayon-pre-restore-<ts>.sqlite`; `await getDriver().restore!(bytes)`; `await rebootstrapWith()`;
  `location.reload()`.
- `restoreBackupFromPath(path)` — **desktop path:** `await getDriver().dispose?.();` (close live
  plugin-sql conn); `const res = await invoke('restore_database', { source: path, knownMax:
  maxKnownMigrationMillis() })`; `if (!res.ok) throw new Error(res.error);` (Rust already wrote
  the safety snapshot); `await rebootstrapWith({ driver: await createTauriDriver(), runtime:'tauri' })`;
  `location.reload()`.

> Note: the **extract** step (bytes→tables/maxApplied) is triplicated (sql.js for tests,
> sqlite-wasm in the worker, rusqlite in Rust). Only the pure `checkBackup` is shared — that
> is the tested contract. The `REQUIRED_TABLES` list is also duplicated in Rust (string array);
> keep them in sync (cross-language, not unit-testable — document at both sites).

---

## Rust desktop backend

### `src-tauri/Cargo.toml` (edit) — add deps
```toml
tauri-plugin-dialog = "2"
rusqlite = { version = "0.32", features = ["bundled"] }
```
(Pin rusqlite to whatever resolves against Rust 1.95 / tauri 2; `bundled` is required.)

### `src-tauri/src/lib.rs` (edit)
- `mod backup;`
- `.plugin(tauri_plugin_dialog::init())`
- register `backup::backup_database, backup::restore_database` in `invoke_handler`.

### `src-tauri/src/backup.rs` (new)
```rust
use rusqlite::{Connection, OpenFlags};
use std::fs;
use tauri::Manager;

const REQUIRED_TABLES: &[&str] = &[ /* same 11 names as backup.ts REQUIRED_TABLES */ ];

fn live_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("mayon.db"))
}

#[tauri::command]
pub fn backup_database(app: tauri::AppHandle, target: String) -> Result<(), String> {
    let live = live_db_path(&app)?;
    let conn = Connection::open(&live).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
    if target.contains('\'') { return Err("Invalid backup path.".into()); }
    conn.execute_batch(&format!("VACUUM INTO '{}'", target)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_database(app: tauri::AppHandle, source: String, known_max: i64) -> Result<(), String> {
    let live = live_db_path(&app)?;
    // 1) validate source read-only BEFORE touching the live db
    let conn = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").map_err(|e| e.to_string())?;
    let tables: std::collections::HashSet<String> = stmt.query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
    for t in REQUIRED_TABLES { if !tables.contains(*t) { return Err("Backup is missing required tables.".into()); } }
    let max_applied: Option<i64> = conn.query_row(
        "SELECT MAX(created_at) FROM __drizzle_migrations", [], |r| r.get(0)
    ).ok();   // table absent → None → treat as legacy/old
    if let Some(m) = max_applied { if m > known_max { return Err("Backup is from a newer app version.".into()); } }
    drop(conn);
    // 2) safety snapshot (rolling)
    let safety = live.with_file_name("mayon-pre-restore.db");
    fs::copy(&live, &safety).map_err(|e| e.to_string())?;
    // 3) overwrite live (+ drop WAL sidecars so the new conn doesn't replay stale WAL)
    fs::copy(&source, &live).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(format!("{}-wal", live.display()));
    let _ = fs::remove_file(format!("{}-shm", live.display()));
    Ok(())
}
```
Return shape for `restore_database`: the JS side expects `{ ok, error }` — wrap with a tiny
serde struct, or have JS treat `invoke` rejection (Rust `Err`) as failure (cleaner: return
`Result<(), String>` and let `invoke` throw; JS `try/catch`). **Decide at impl: use `invoke`
rejection (no `{ok}` envelope) — simpler.** Update `restoreBackupFromPath` accordingly:
`await invoke('restore_database', {...})` in a try/catch.

> ⚠️ Verify `live_db_path` resolves to the **same** file `plugin-sql` opens
> (`Database.load('sqlite:mayon.db')` resolves relative to app data dir). If plugin-sql uses
> an identifier-based subdir, adjust the join. Manual gate confirms (key not in `mayon.db`
> via `secret-tool`, and a round-trip persists).

### `src-tauri/capabilities/default.json` (edit)
- Add `"dialog:default"` (covers save/open) — or the explicit `"dialog:allow-save"`,
  `"dialog:allow-open"`.

### `package.json` (edit)
- Add `"@tauri-apps/plugin-dialog": "^2"` to dependencies.

---

## UI

### `src/lib/components/settings/DataSection.svelte` (new)
- Two buttons: **Download backup** → `createBackup()`; **Restore from backup** → runtime-specific:
  - **Browser:** a hidden `<input type="file" accept=".sqlite">` triggered by the button;
    `onchange` → `restoreBackupFromBytes(new Uint8Array(await file.arrayBuffer()))`.
  - **Desktop:** `const { open } = await import('@tauri-apps/plugin-dialog'); const p = await open({ filters:[{name:'SQLite',extensions:['sqlite']}], multiple:false }); if (p) restoreBackupFromPath(p as string);`
  Branch via `isTauri()`.
- Disable both while `chatStore.streaming` (import from `$lib/stores/chat.svelte`).
- A confirm step before restore ("This replaces all current data. A safety backup is saved first.").
- Status / error line; note: "Backups are data-only — they do not include API keys."
- Reserved slot (comment) for UX4's **Rebuild search index** button.

### `src/routes/settings/+page.svelte` (edit)
- Add `<DataSection />` as a fourth child of `ProviderConfig` (renders in the existing
  `max-w-3xl` column via `{@render children?.()}`, after the lab/quiz configs). Minimal change,
  matches how the other config blocks are composed.

---

## Tests — Vitest (in-memory driver), `src/lib/db/backup.test.ts` (new)

Mirror the style of `self-check.test.ts` (`bootstrapWithDriver(await createMemoryDriver())`).

1. **`maxKnownMigrationMillis()`** equals `Math.max` of bundled `migrations[*].folderMillis`.
2. **`checkBackup` (pure):** ok for valid; rejects `!headerOk`; rejects a missing required
   table; rejects `maxAppliedMillis > maxKnown`; **ok** when `maxAppliedMillis === null`
   (legacy DB, no `__drizzle_migrations`).
3. **`validateBackupBytes`:** round-trip a memory-driver `snapshot()` → ok; corrupt/random
   bytes → reject; a sql.js db missing a table → reject; a db whose `__drizzle_migrations`
   has a `created_at` in the future → reject ("newer app version").
4. **Snapshot/restore round-trip (memory driver):** insert a chat + a `settings` row;
   `snapshot()` → restore into a fresh memory driver → `rebootstrapWith()` → chat + setting
   present; assert **no** `settings.key LIKE 'providerKey:%'` row (data-only guard).
5. **Migrate-forward:** `runMigrations(driver, migrations.slice(0, -1))` (simulate older),
   `snapshot()`, then restore those bytes into a new driver and `runMigrations(driver,
   migrations)` (full) → the last migration applies cleanly (its column/table exists),
   `__drizzle_migrations` now contains every entry.

`pnpm check` + `pnpm lint` clean. (Rust side is desktop-only → manual gate.)

---

## Manual gates (OPFS + Tauri — not CI-runnable)

**Browser (`pnpm dev`):**
- `/settings` → Data → **Download backup** → `mayon-YYYYMMDD.sqlite`; reopen in a SQLite
  client → all chats/messages/labs/quizzes/settings present, **no** `providerKey:*` rows.
- **Restore from backup** → confirm → a `mayon-pre-restore-<ts>.sqlite` downloads (safety) →
  app reloads into the restored data (chats/trees/labs/theme all back).
- Bad/corrupt file → clear error, nothing changed. Older backup → migrates forward cleanly.

**Desktop (`pnpm tauri dev`):**
- Native save dialog → `mayon-YYYYMMDD.sqlite`; native open dialog → restore → reloads into
  restored data; `mayon-pre-restore.db` sits next to `mayon.db`.
- Confirm key **not** in `mayon.db` (`secret-tool lookup service Mayon` returns it; the
  `settings` table has no `providerKey:*`).
- Newer-version backup → rejected with the clear error; live DB untouched.

> Desktop build needs GTK/WebKit dev libs + a running secret service on Linux (AGENTS.md).
> Verify on a real machine.

---

## Risks / edge cases

- **Restore while a connection is open.** Browser: the worker's `restore` op closes+reopens
  its own handle in-worker; `rebootstrapWith()` reuses that driver (no second worker).
  Desktop: `dispose()` closes the plugin-sql conn before Rust overwrites; `rebootstrapWith`
  creates a fresh driver. If plugin-sql's pool caches the closed conn and re-`load` returns a
  stale handle, restore would read the old file — **manual gate must confirm a fresh handle**.
- **`live_db_path` mismatch with plugin-sql's resolution.** If `app_data_dir/mayon.db` is not
  the file plugin-sql opened, backup/restore target the wrong file. Confirm at the desktop
  manual gate; adjust the join if plugin-sql uses a subdir.
- **Double SQLite in the desktop binary** (plugin-sql + rusqlite `bundled`). Accepted (see
  Correction 2); benefits UX4 FTS5.
- **`VACUUM INTO` path quoting.** Reject any `'` in the target path (Rust guard). Dialog
  paths on Win/macOS/Linux don't normally contain single quotes, but guard anyway.
- **`maxAppliedMillis === null`.** A hand-made/legacy DB without `__drizzle_migrations` is
  accepted as "old" and migrated forward. This is intentional (forward-compat) but means a
  maliciously-crafted DB missing the table won't be rejected as "too new" — acceptable since
  required-tables + header checks still apply and the safety snapshot protects the user.
- **Restore mid-stream.** Buttons disabled while `chatStore.streaming`; a lab/quiz run has no
  single global flag today — guard on `streaming` only (note as a known gap).

## Out of scope

- Tauri driver byte seam (`snapshot`/`restore`) — desktop uses Rust path commands.
- Cloud sync / cross-device restore.
- Selective/partial restore (per-chat import).
- UX2 per-node delete, UX4 FTS5 search (separate phases; UX4 reuses this Data section).

## Suggested commit split

1. Seam + drivers: `types.ts` optional methods; memory/opfs/tauri driver impls; `client.ts`
   `rebootstrapWith` + `db/index.ts` export.
2. `backup.ts` (pure `checkBackup`/`maxKnownMigrationMillis`/`validateBackupBytes` +
   orchestrators) + `backup.test.ts`.
3. Rust: `Cargo.toml` deps, `backup.rs`, `lib.rs` registration, capability.
4. UI: `DataSection.svelte` + settings page composition.
