# Contract: Schema Migration v1 → v2 (kind backfill)

First entry in the stamped-version migration registry (`server/src/schema-migrations.ts`). Ships as schema version **2** (`packages/shared/src/schema-version.ts`).

## Descriptor

```ts
{
  from: 1, to: 2,
  description: 'add messages.kind + backfill from legacy column combos',
  kind: 'additive',
  hasMigrate: true,
  migrate: backfillKinds          // (client: PgPoolClient) => Promise<void>
}
```

## DDL vs data split

- **DDL** (drizzle, generated via `pnpm db:generate`, applied at boot by `runPgMigrations`): `ALTER TABLE messages ADD COLUMN kind text` (nullable at add time) + enum CHECK. Restore never applies DDL — it reloads data into the live schema.
- **Data** (registry `migrate(client)`, applied by **both** paths below): ordered backfill UPDATEs (case table in `contracts/entry-kinds.md` § Backfill) guarded by `WHERE kind IS NULL`, a completeness assertion, then `ALTER TABLE messages ALTER COLUMN kind SET NOT NULL`.

## Execution paths (one implementation, two triggers)

1. **Upgrade boot** (new runner, D2): after drizzle migrations + FTS bootstrap, before the stamp — read `settings.schemaVersion`; if `< SCHEMA_VERSION`, run pending registry entries (each in its own transaction; failure aborts boot's pg readiness), then stamp `SCHEMA_VERSION`.
2. **Post-restore** (`pg-backup.ts:278-301`, existing loop): a v1/legacy dump restores data-only into the v2 schema (old rows land with `kind = NULL`), then the same `migrate(client)` runs inside its transaction, then the stamp — unchanged machinery, first real registry entry.

Idempotency is mandatory because both paths can run against partially-classified data.

## Backfill semantics

- Updates **only** `messages.kind`. Never inserts, deletes, renumbers (`ord`), or rewrites `content`/`metadata` — IDs, branch references, and expound offsets remain valid by construction (spec FR-012).
- Completeness: after the UPDATEs, `SELECT count(*) FROM messages WHERE kind IS NULL` MUST be 0; a non-zero count (row matching no case rule) fails the migration loudly (FR-013) — transaction rolls back, boot reports pg not ready / restore aborts with the safety backup already taken.
- `role='system'` rows classify as `assistant_message` with a logged count (explicit rule, expected zero — synthetic system notes are never stored).
- `search_vec` is generated; updating `kind` does not touch `content`, so vectors are stable. No reindex step exists or may be added.

## Gate behavior (unchanged, re-verified by tests)

- `planRestore` with a v2 dump on a v1 server → `refuse-newer` (existing behavior; this feature adds the first real newer-version scenario).
- v1/legacy dump on a v2 server → proceed + auto-migrate (`additive` with `migrate`), notice lists `1→2`.
- While restoring, `/api/db/query` returns 503 and `/api/health` reports `restoring: true` — no new downtime, no server restart.
- The `__drizzle_migrations` bookkeeping table is never reloaded (existing TOC filter).

## Failure modes

| Failure                              | Behavior                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unclassifiable legacy row            | migrate throws → transaction rollback → boot: pg marked not ready + loud log; restore: aborted, pre-restore safety dump preserved on disk |
| Backfill re-run over classified rows | No-op (`WHERE kind IS NULL`)                                                                                                              |
| `SET NOT NULL` with NULLs remaining  | Impossible: completeness assertion precedes it in the same transaction                                                                    |
