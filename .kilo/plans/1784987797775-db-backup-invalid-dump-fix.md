# Fix: "Not a valid pg_dump file" on restore after reinstall

## Problem

After `docker compose down -v` + fresh one-line install, restoring a previously
downloaded backup fails with `Not a valid pg_dump file`.

## Root cause (confirmed from code)

1. The error is thrown **client-side, pre-network** in
   `src/lib/services/db-backup.ts:27` (`restoreDbBackup` → `isPgDumpHeader`).
   The selected file's first 5 bytes ≠ `PGDMP`. The upload never runs.
2. The download path (`downloadDbBackup`, `db-backup.ts:13-21`) saves whatever
   HTTP-200 body comes back **without ever validating the header**.
3. The server GET `/api/backup/db` (`server/src/pg-backup.ts:89-116`) streams
   `pg_dump` stdout immediately and only converts a failure to a 500 when
   `!reply.sent`. If `pg_dump` exits non-zero *after* streaming began, the
   browser receives a truncated/empty body with status 200, which gets saved
   unchecked as `mayon-YYYYMMDD.dump`.

Net: the saved `.dump` is almost certainly garbage (empty, a JSON error body,
or a torn stream). Restore correctly refuses it. **The download path is the
bug; the restore path is correct.**

`serverClient.http` is a plain `fetch`; no service worker interception.

## Decision

Robust fix: server writes `pg_dump` to a temp file, checks exit code, then
serves the file (or a proper 500). Browser validates the `PGDMP` header before
saving and surfaces the real error. Guarantees a saved `.dump` is always valid
or accompanied by a clear non-200.

---

## Phase 0 — Confirm root cause (no code; do first)

Have the user inspect the saved file's first bytes. This pins the cause
instantly and validates the fix later:

```sh
file mayon-*.dump                 # reports type/size
head -c 16 mayon-*.dump | xxd     # first 16 bytes hex
```

Expected interpretations:
- `5047 4d50 ...` (`PGDMP`) → file IS valid → upload path is the bug (unlikely
  given the pre-network guard; would imply the file was altered on disk).
- empty / size 0 → `pg_dump` produced nothing; download saved it unchecked.
- `7b22 ...` (`{"`) → a JSON error body got saved (download returned an error
  payload with a 200-ish status).
- `1f8b ...` → gzip/encoding corruption.
- other → torn stream mid-download.

Any result other than `PGDMP` confirms the download produced a bad file and
Phase 1+2 are the correct fixes.

---

## Phase 1 — Client-side: never save a bad dump

File: `src/lib/services/db-backup.ts`

- In `downloadDbBackup`, after `await res.arrayBuffer()` and before
  `downloadBlob`, run `isPgDumpHeader(bytes)`. If false:
  - Decode the first ~512 bytes as ASCII/UTF-8 (best-effort) to surface the
    server's error text if it's JSON/text.
  - Throw a descriptive error, e.g.
    `Backup failed: server returned an invalid dump (size N, first bytes: …)`.
    Include `res.status` and any decoded body text.
- Do NOT call `downloadBlob` for an invalid body.
- (Restore path already guards correctly; keep it.)

### Diagnostic logging (instrument both paths)

- `downloadDbBackup`: `console.error('[mayon-backup] download', { status, contentType, byteLength, first16 })` before the header check.
- `restoreDbBackup`: `console.error('[mayon-backup] restore-file', { name, size, type, first16 })` before the header check, and include `first16`/`size` in the thrown error text so future failures self-diagnose.

Helpers: `isPgDumpHeader` already in `src/lib/db/backup.ts`; reuse it.

---

## Phase 2 — Server-side: temp-file then stream (never serve a failed dump)

File: `server/src/pg-backup.ts`

Rewrite `GET /api/backup/db`:

1. Guard on `!opts.pool` → 503 (unchanged).
2. Write `pg_dump -Fc --no-owner --no-privileges -d $DATABASE_URL` output to a
   temp file under `os.tmpdir()` (e.g. `mayon-backup-<ts>.dump`), capturing
   stderr. Use the existing `runDump(databaseUrl, destPath)` helper
   (`pg-backup.ts:15-31`) — it already collects stderr and rejects on non-zero
   exit.
3. On `runDump` rejection → `reply.code(500).send({ error: 'backup failed', detail: <stderr> })`. The browser's Phase-1 guard + this 500 mean no bad file is saved.
4. On success: `fs.stat` the temp file to confirm non-zero size, set
   `content-type: application/octet-stream` + `content-disposition`
   (`mayon-YYYYMMDD.dump`, reuse `formatDate()`), stream the file via
   `reply.type(...).header(...).send(createReadStream(tmp))`.
5. Clean up the temp file in a `finally` after the response finishes (use
   `reply.raw.on('close', () => unlink(tmp))` — note: cannot unlink before the
   stream is fully sent).

Notes:
- `spawnPgDump` (the streaming variant at `pg-backup.ts:71-73`) is no longer
  used by the GET route; keep or remove per taste (removing is cleaner; check
  no other importers — `grep spawnPgDump`). The `GET` test will need updating.
- Slightly higher latency / temp disk use, acceptable for a backup download
  (max size bounded by DB; `pg_dump -Fc` is compressed).

### Server-side PUT diagnostics (cheap, add now)

File: `server/src/pg-backup.ts`, top of `PUT /api/backup/db` handler (~line 118):

- `console.error('[mayon-backup] restore-upload', { byteLength: bytes.length, contentType: req.headers['content-type'], first16: bytes.subarray(0,16).toString('hex') })` before the `isPgDumpHeader` check. Confirms bytes arrive intact if the client guard is ever bypassed.

---

## Phase 3 — Tests

- `server/src/pg-backup.test.ts`:
  - Update the GET "returns 200 with octet-stream + .dump filename" test
    (line ~112) for the temp-file path (still asserts status, content-type,
    filename, and now a `PGDMP` body header).
  - Add: GET when `pg_dump` exits non-zero → 500 `{ error: 'backup failed', ... }`
    and NO file body (assert response body does not start with `PGDMP` /
    is JSON). This is the regression test for the original bug.
  - Add: GET returns empty-body guard — if temp file is 0 bytes, treat as
    failure → 500 (defensive).
- `src/lib/services/db-backup.test.ts`:
  - Add: `downloadDbBackup` throws (and does NOT call `downloadBlob`) when the
    response body fails `isPgDumpHeader`; assert the thrown message includes
    status + a hint of the body.
  - Existing restore test already covers the guard; add first-bytes info to
    the error assertion.
- Mock `pg_dump`/temp writes the same way existing tests do.

---

## Validation / acceptance gates

- `pnpm lint && pnpm check && pnpm test` (root) green.
- `pnpm --filter @mayon/server test` green.
- **Reproduce the original flow, fixed:**
  1. `docker compose up` with data → Settings → Download backup → confirm the
     saved file starts with `PGDMP` (`head -c 5 mayon-*.dump`).
  2. Simulate a failing dump (e.g. point `pg_dump` at a non-existent DB, or
     kill it) → Download must show a clear error and **not** save a file.
  3. `docker compose down -v` → fresh one-line install → Restore from the
     Phase-0.1 `.dump` → safety dump downloads, app reloads, data present.
- `GET /api/backup/db` on a healthy server returns a `PGDMP`-prefixed body with
  `application/octet-stream`.

---

## Risks / open questions

- **Temp disk pressure:** large DBs write a full compressed dump to
  `/tmp` inside the container before streaming. Acceptable for daily-driver
  scale; flag if DBs are very large (could add a size guard / stream-with-peek,
  out of scope here).
- **`spawnPgDump` removal:** confirm no external importer before deleting;
  `grep -rn spawnPgDump`.
- **Old bad file:** Phase 0 will reveal the user's existing saved file is
  garbage — that data is unrecoverable from that file. Any *real* backup must
  be re-created after the fix is deployed. Communicate this to the user.
- If Phase 0 shows `PGDMP` (file is actually valid), the bug is on the upload
  side instead — the PUT diagnostics (Phase 2 second half) will reveal it; the
  client-side restore guard would then need re-examination. Treat as fallback
  branch only.
