# Plan — Phase 5: Sandbox DB backup service (sidecar)

> Status: implementation-ready. Authored 2026-07-12.
> Parent: `.kilo/plans/1783749811883-container-forward-web-transition.md` (Phase 5
> section, lines 380–395). This file expands that terse section into an
> actionable, file-level plan.
> Goal: server-side snapshot/restore of the **Phase 4 sandbox DB** (the MCP-tool
> SQLite DB at `/data/sandbox.sqlite`) via two same-origin sidecar routes, surfaced
> as a "Sandbox DB backup" affordance in Settings. The OPFS app-DB backup
> (`src/lib/db/backup.ts`) is **unchanged** — it stays browser-local.

## Resolved decisions

1. **P4 is a hard prerequisite; P5 plugs into its seams.** (User-confirmed.)
   Phase 4 (sandbox DB: `sidecar/src/db.ts`, `SidecarDriver`, `sandbox-db` cap) is
   not landed yet. This plan is written strictly downstream of P4 and documents
   the exact contract P4 must expose (see "P4 prerequisite contract" below). Do
   not start P5 until P4 is green.
2. **Consistency-safe snapshot + restore for the live WAL-mode DB.** (User-confirmed.)
   GET uses `better-sqlite3`'s online `db.backup(dest)` API (absorbs the WAL
   atomically, safe under concurrent MCP writes) into a temp file, then streams
   that. PUT validates the 16-byte SQLite header, renames the current file to a
   `.bak` safety copy, writes the uploaded bytes, and reopens the handle. This
   **deviates from the parent plan's literal "stream the `/data/sandbox.sqlite`
   file"** wording — a raw copy of a WAL DB can be torn or miss committed WAL
   data.

## Decisions taken in this plan (call out if you disagree)

- **Restore validation = SQLite header magic only, NOT the Mayon app schema.**
  The sandbox DB has an arbitrary, MCP-defined schema, so the existing
  `validateBackupBytes` table check (`src/lib/db/backup.ts:37` `REQUIRED_TABLES`)
  would reject valid sandbox DBs. Reuse **only** the 16-byte header check
  (`src/lib/db/backup.ts:55-71`). Validate twice: in-browser before PUT (fail fast
  with a clear UI error) and in-sidecar before overwrite (keep the `.bak` if it
  fails).
- **Single better-sqlite3 handle, owned by P4; P5 borrows it via exported
  functions.** Two WAL handles to the same file would corrupt. P5's `backup.ts`
  never opens the DB directly — it calls `backupSandboxToFile()` /
  `replaceSandboxFromBytes()` exported from P4's `sidecar/src/db.ts`.
- **No new wire-protocol types.** The `'backup'` cap already exists in the
  `SidecarCap` union (`packages/shared/src/protocol.ts:1`); GET/PUT are raw
  single-file transfers (`application/octet-stream`), so no request/response body
  types are added.
- **In-flight MCP queries during a PUT restore are tolerated, not coordinated.**
  Closing the handle mid-query surfaces SQLITE errors to those MCP tools; we do
  not pause/reject based on "active" connections (single-user local tool; too
  complex). Documented as a known limitation.
- **No new auth / no host port.** Consistent with `/api/llm/proxy` and `/ws/mcp`:
  the sidecar stays internal-network-only; nginx is the single same-origin entry
  (AGENTS.md hard rule).

## P4 prerequisite contract (P4 must provide these exports)

`sidecar/src/db.ts` (created by P4) must export, against its single shared
`better-sqlite3` handle for `/data/sandbox.sqlite`:

- `backupSandboxToFile(destPath: string): Promise<void>` — wraps `db.backup(dest)`
  (online, atomic, WAL-absorbing). Used by GET.
- `replaceSandboxFromBytes(bytes: Uint8Array): Promise<void>` — closes the handle,
  validates the 16-byte SQLite header, renames `/data/sandbox.sqlite` →
  `/data/sandbox.sqlite.bak`, writes `bytes`, reopens a fresh handle. Used by PUT.
- (P4 also adds the `sandbox-db` cap to `/api/health` and `better-sqlite3` to
  `sidecar/package.json` — P5 relies on both being present and does **not**
  re-add them.)

If P4 exposes the handle differently (e.g. `getSandboxDb()` + close/reopen), adapt
P5 to call those instead — the contract is "one handle, borrowed via functions,
never opened twice."

## Grounding (the seams this plan reuses — verify against these, don't reinvent)

- **Cap union (already includes `backup`):** `packages/shared/src/protocol.ts:1`.
- **`/api/health` caps array + route-registration pattern:**
  `sidecar/src/server.ts:17` (caps), `:20-21` (`registerMcpBridge` /
  `registerLlmProxy(fastify)` — P5 adds `registerBackup(fastify)`).
- **Sidecar route module pattern:** `sidecar/src/llm-proxy.ts:13`
  (`register*(app: FastifyInstance)`).
- **Sidecar raw-streaming pattern:** `sidecar/src/llm-proxy.ts:72-83` (`reply.hijack()`
  + pipe a `Readable` to `reply.raw`, abort on client close).
- **Sidecar test pattern:** `sidecar/src/server.test.ts:8-15` (`buildApp()` +
  `app.listen({port:0})` + `app.inject()`); exact-caps assertion at `:22` (P4 then
  P5 each append a cap — update it).
- **Web sidecar HTTP helper:** `src/lib/sidecar/client.ts:2` (`sidecarClient.http()`).
- **Web cap gate:** `src/lib/sidecar/status.svelte.ts:23` (`sidecarStatus.has('backup')`).
- **Web thin-helper pattern to mirror:** `src/lib/sidecar/llm-proxy-fetch.ts` →
  new `src/lib/sidecar/sandbox-backup.ts`.
- **OPFS backup (unchanged; mine for `downloadBlob` + header check):**
  `src/lib/db/backup.ts:108` (`downloadBlob`, currently not exported),
  `:55-71` (16-byte SQLite header check), `:118`/`:123` (create/restore — untouched).
- **Settings UI to extend:** `src/lib/components/settings/DataSection.svelte`.
- **Volume (P1, already present):** `docker-compose.yml:14` (`sidecar-data:/data`).

## Hard rules (from AGENTS.md / parent plan — non-negotiable)

- The sidecar binds **only to the internal docker network**; nginx is the single
  same-origin entry. Never expose the raw sidecar port in `docker-compose.yml`.
- No secrets cross for backup (it's the sandbox DB, not app data; no API keys
  involved). The OPFS app-DB backup stays browser-local and is not touched.
- After any `pnpm db:generate` run `pnpm bundle:migrations` — N/A here (no schema
  change), but do not introduce one.
- The `SidecarCap` value `'backup'` already exists; do not redefine it.

---

## Task list

### P5.1 — Shared protocol (no new types; cap already exists)
- Confirm `'backup'` is present in `SidecarCap`
  (`packages/shared/src/protocol.ts:1`) — it is; no change needed.
- No new request/response types (raw-file GET/PUT). Do not add any.

### P5.2 — Sidecar: `backup.ts` (safe snapshot + restore)
- `sidecar/src/backup.ts` (new) — `export function registerBackup(app:
  FastifyInstance): void`:
  - `GET /api/backup/sandbox`:
    - `await backupSandboxToFile(tmp)` (P4 export; online `.backup()`).
    - Stream `fs.createReadStream(tmp)` to `reply.raw` with
      `content-type: application/octet-stream` and
      `content-disposition: attachment; filename="mayon-sandbox-YYYYMMDD.sqlite"`.
      Abort/cleanup on client close (mirror `llm-proxy.ts:42`).
    - `fs.unlink(tmp)` in a `finally`.
  - `PUT /api/backup/sandbox`:
    - Stream the binary body to a temp file (read `req.raw`; register an
      `application/octet-stream` content-type parser or bypass the JSON parser —
      do **not** let fastify parse it as JSON). Set a generous route `bodyLimit`
      (e.g. 512 MB) or stream unbounded.
    - Validate the 16-byte SQLite header of the temp file → `400` "not a valid
      SQLite file" if it fails (do not touch the live DB).
    - `await replaceSandboxFromBytes(bytes)` (P4 export: header-revalidate →
      rename to `.bak` → write → reopen).
    - `204` on success; clean up the temp file.
- `sidecar/src/server.ts` — `import { registerBackup } from './backup'`;
  `registerBackup(fastify)` after `registerLlmProxy`. Add `'backup'` to the
  `/api/health` caps array (`:17`) → `['stdio-mcp', 'llm-proxy', 'sandbox-db',
  'backup']` (the `sandbox-db` entry is added by P4 first).
- `sidecar/src/server.test.ts:22` — update the exact-caps assertion to the
  4-cap list (P4 will have bumped it to 3; P5 makes it 4).

### P5.3 — Web: thin sandbox-backup helper
- `src/lib/sidecar/sandbox-backup.ts` (new) — mirrors `llm-proxy-fetch.ts`:
  - `downloadSandboxBackup()` — `sidecarClient.http('/api/backup/sandbox')` →
    `res.arrayBuffer()` → `downloadBlob(bytes, 'mayon-sandbox-YYYYMMDD.sqlite')`.
  - `restoreSandboxBackup(file: File)` — read `file.arrayBuffer()`; in-browser
    16-byte header pre-check (fail fast with a clear error); `PUT` the bytes to
    `/api/backup/sandbox` with `content-type: application/octet-stream`.
  - Both are no-ops/throw-clearly when `!sidecarStatus.has('backup')` (the UI also
    gates, but keep the guard here).
- `src/lib/db/backup.ts` — **export** the local `downloadBlob` (`:108`) and extract
  the 16-byte header check (`:55-71`) into an exported `isSqliteHeader(bytes)` so
  the sandbox helper (and the existing OPFS path) share them. Do not change
  `createBackup`/`restoreBackupFromBytes` behavior.

### P5.4 — UI: Sandbox DB backup affordance in Settings
- `src/lib/components/settings/DataSection.svelte` — add a clearly-separated
  "Sandbox DB" block, rendered only when `sidecarStatus.has('backup')` (import
  `sidecarStatus` from `$lib/sidecar/status.svelte`):
  - A one-line explainer: this backs up the **sidecar sandbox DB** (MCP-tool
    data), **not** your chats/labs/quizzes (those use the OPFS buttons above).
  - "Download sandbox backup" → `downloadSandboxBackup()`.
  - "Restore sandbox backup" → hidden file input (`accept=".sqlite"`) →
    `restoreSandboxBackup(file)`.
  - Reuse the existing `busy`/`status`/`error` pattern; keep its own flags so it
    doesn't conflict with the OPFS buttons' state. Disable while
    `chatStore.streaming` is irrelevant here (sandbox DB ≠ chat), but keep a
    `busy` guard.
  - Place it **below** the existing OPFS block (after the `<hr>`), labelled
    distinctly to avoid the two backups being confused.

### P5.5 — Tests
- `sidecar/src/backup.test.ts` (new) — mirror `llm-proxy.test.ts`
  (`buildApp()` + `app.inject()`):
  - GET returns `200`, `content-type: application/octet-stream`, a body whose
    first 16 bytes are the SQLite magic, and a `content-disposition` attachment
    filename. Stub `backupSandboxToFile` to write a known bytes file via
    `vi.mock('./db', ...)`.
  - GET is consistent: byte-stable across a stubbed concurrent write (assert the
    online-backup path is used, i.e. `backupSandboxToFile` is awaited before
    streaming).
  - PUT with a valid SQLite-header body → `204` and calls
    `replaceSandboxFromBytes` with those bytes; PUT with a non-SQLite body → `400`
    and does **not** call `replaceSandboxFromBytes`.
  - `/api/health` now includes `'backup'` (covers the `server.test.ts` bump too).
- Web: `src/lib/sidecar/sandbox-backup.test.ts` (new, vitest) — mock
  `sidecarClient.http` / `fetch`: download triggers a blob download; restore
  pre-checks the header and PUTs; both throw clearly when the cap is absent
  (mutate `sidecarStatus` to the disconnected state).

### P5.6 — Docs
- `AGENTS.md` — add a "Manual acceptance gates (P5 — sandbox DB backup)" section
  describing the sidecar backup flow (download/restore the sandbox DB via the
  sidecar; OPFS backup unchanged). **Note:** the stale Tauri-era "P5 desktop shell"
  gate still in AGENTS.md is a P0.7 leftover; flag it for removal there (removing
  it is P0.7's job, not P5's — do not silently delete it, just call it out).

---

## Definition of Done (Phase 5)

- `pnpm --filter @mayon/sidecar test` green (new `backup.test.ts`); root
  `pnpm lint && pnpm check && pnpm test` green (new web helper test).
- `docker compose up` → header shows "Sidecar: connected" with `backup` in the cap
  list; `GET /api/health` → `caps: ['stdio-mcp','llm-proxy','sandbox-db','backup']`.
- `/settings → Data`: a "Sandbox DB" block appears; **Download sandbox backup**
  yields a valid `.sqlite` file (16-byte magic, opens in a SQLite client) that
  reflects current sandbox contents; **Restore sandbox backup** replaces the
  sandbox DB and a subsequent download matches the restored bytes.
- Consistency: trigger a download **while** an MCP tool is writing to the sandbox
  DB → the downloaded file is not torn (online-backup path).
- Restore safety: a non-SQLite upload is rejected client-side AND server-side; the
  live DB is untouched and `/data/sandbox.sqlite.bak` is preserved after a
  successful restore.
- Sidecar down: the "Sandbox DB" block is hidden; the OPFS Download/Restore
  buttons work exactly as before (no regression).
- Data persists across `docker compose down/up` (the `sidecar-data` volume).

**Depends on:** Phase 4 (sandbox DB). Do not start until P4 is green and exposes
the `backupSandboxToFile` / `replaceSandboxFromBytes` contract.

## Risks

- **P4 contract drift.** If P4 names the handle-lifecycle functions differently,
  P5's calls must adapt. Mitigation: the contract above is the single coupling
  point; pin it in P4's plan too.
- **Restore mid-MCP-write.** A PUT close+reopen can error in-flight MCP queries.
  Mitigation: tolerated (single-user local tool); surfaced as a clear SQLITE error.
  No silent corruption (header-validated, `.bak` kept).
- **Large uploads.** A big sandbox DB could exceed fastify's default body limit.
  Mitigation: stream `req.raw` to a temp file with a raised `bodyLimit` (no JSON
  parsing).
- **WAL `-wal`/`-shm` files on raw ops.** Avoided entirely: GET uses the online
  `.backup()` API (single consistent file); PUT replaces via the reopened handle
  (the old WAL files are discarded with the renamed `.bak`). Never copy the raw
  trio.
- **Stale docs contradiction.** Two "P5" sections in AGENTS.md until P0.7 cleans
  the Tauri one. Mitigation: P5.6 flags it explicitly.

## Validation

- **Automated:** sidecar `backup.test.ts` (GET consistency + header, PUT
  validate/replace/400, health cap) and web `sandbox-backup.test.ts` (download,
  restore pre-check/PUT, cap-absent guard). Both run under the existing vitest
  configs (`pnpm --filter @mayon/sidecar test`; root `pnpm test`).
- **Manual, browser + sidecar:** the DoD flow above. Canonical check: write data
  via an MCP tool → download → tear-down → restore → data back; download during a
  concurrent write is not torn; non-SQLite upload rejected both sides.
- **No regression:** the existing P0/P1/P3 browser+sidecar gates (DB ready, theme
  persists, provider streaming, HTTP MCP, Anthropic via proxy) pass unchanged.

## Out of scope

- OPFS app-DB backup through the sidecar (architecturally impossible — the sidecar
  can't reach the browser's OPFS; OPFS backup stays browser-local).
- Snapshot retention / versioned history / listing past snapshots (single current
  file + `.bak`; one-shot download/upload).
- Auth on the backup routes (internal-network-only, same-origin via nginx).
- TLS/HTTPS termination (localhost/internal; nginx-layer concern, deferred).
- Backing up anything other than the sandbox DB.
