# Phased plan — UI/UX refinements (UX1–UX5)

- **Source spec:** `refinement/2026-07-04 refinement plan.md` (items #1–#6, all decided there).
- **Status:** This is the execution-ready breakdown built *from* that spec. It turns each
  decision into file-level tasks, tests, manual gates, and the few implementation decisions
  the spec left open (collected in **Decisions surfaced while planning** below).
- **Phase keys:** `UX1` … `UX5`. Phases are sized so each is independently shippable.
- **Authoritative for:** file paths, task ordering, tests, and gates. Where this doc and the
  refinement spec disagree, **this doc wins on mechanism** (one correction — see UX2 / Decisions);
  the product decisions stay with the refinement doc.
- **Where this lives:** `refinement/ui-ux-phased.md` (per request). Note: `AGENTS.md` keeps the
  *active* execution checklist in `.kilo/plans/`; this is the design-level phased plan.

## Cross-cutting conventions (apply to every phase)

- **Two runtimes, one file format.** Every storage change must work in **both** the browser
  (sqlite-wasm + OPFS worker) and desktop (native SQLite via `@tauri-apps/plugin-sql`), or be
  behind a runtime flag. Schema changes are additive migrations: `pnpm db:generate` (or
  hand-authored, see UX4) → `pnpm bundle:migrations`.
- **One storage seam.** New storage capabilities extend `StorageDriver`
  (`src/lib/db/driver/types.ts`) as **optional** methods; components/stores call repositories only.
- **Keys never enter the DB.** Backups/restore are **data-only**; provider keys stay in the OS
  keychain / IndexedDB.
- **Every phase ships:** (a) automated Vitest coverage against the **in-memory** driver
  (`pnpm test`), and (b) a **manual** gate for the OPFS + Tauri runtimes (cannot run in CI).
- **Lint/typecheck before done:** `pnpm lint && pnpm check`.

## Phase dependency graph

```
UX1 (quick wins) ──┐
                   ├─ independent; can start immediately
UX2 (per-node del) ┘
UX3 (backup/restore) ──> UX4 (FTS5) reuses UX3's "Data" Settings section
UX5 (semantic) ── gated, after UX4, on three verification gates (see UX5)
```

UX1 and UX2 are fully independent and can land in either order or in parallel. UX4 has only a
**soft** dependency on UX3 (the "Rebuild search index" button lives in the Settings "Data"
section created in UX3; the FTS5 migration/repo/route do not depend on UX3).

---

## UX1 — Quick wins (#2 branch-tool suppression + #5 Mermaid centering)

Two unrelated, low-risk, no-schema changes. They are bundled as one phase for sequencing
convenience but are independently mergeable.

### UX1a — Hide `branch_chat` on the first turn after a manual branch (#2)

**Mechanism (decided):** first-turn-only suppression via a transient store flag, building on the
existing `disabledToolIds` contract (`src/lib/agent/loop.ts:49`, threaded in
`src/lib/stores/chat.svelte.ts:230`). No schema, no prompt change.

**Files modified**
- `src/lib/stores/chat.svelte.ts`
  - Add `manualBranchPending = $state<boolean>(false)` on `ChatState`.
  - Set it `true` in the two manual-branch entry points: `branchFromMessage` (`:601`) and
    `createBranchChild` (`:611`) — the latter also covers `branchFromSelection` and
    `createExpoundBranch` (`:566`) since both delegate to it. (The LLM-suggested branch via the
    `branch_chat` tool goes through `deterministic-tools.ts` → `repos.chats.createChild` and does
    **not** touch the store, so it is correctly excluded.)
  - In `send`, build `disabledToolIds` as
    `[...disabledToolsForBrief(rootBriefRaw), ...(this.manualBranchPending ? ['branch_chat'] : [])]`
    at the existing call site (`:230`).
  - Clear `manualBranchPending = false` in the `finally` of `send` so an aborted/failed first
    turn never leaves suppression stuck on.

**Tests** — add to the store test module
- After `createExpoundBranch`/`branchFromMessage`, the next `send` passes `branch_chat` in
  `disabledToolIds`; after that `send` resolves (or aborts), a subsequent `send` no longer
  includes it.

**Manual gate**
- Expound an excerpt → the seeded summary streams **without** a branch offer; turn 2+ behaves
  normally. Click **Branch** on a message → first typed message has no branch offer. An
  LLM-suggested branch is unchanged.

### UX1b — Center Mermaid diagrams in the preview (#5)

**Mechanism (decided):** compute a centering transform from the SVG and viewport bounding boxes,
apply on open + reset, re-apply on resize.

**Files modified**
- `src/lib/components/chat/MermaidPreview.svelte`
  - Extract a pure helper `computeCenter(viewport, svg) => {x, y}` (so it is unit-testable):
    `x = (viewport.w - svg.w) / 2`, `y = (viewport.h - svg.h) / 2` (panzoom `moveTo` operates in
    the transformed coordinate space).
  - New `centerView()` measures `svgContainer.firstElementChild.getBoundingClientRect()` and the
    `flex-1 overflow-hidden` pane, then `pzInstance.moveTo(cx, cy)` + `zoomAbs(…, 1)`.
  - Call `centerView()` after panzoom init in `onMount` (`:55`) with a `requestAnimationFrame`
    retry until `svgWidth > 0` (guards a not-yet-laid-out SVG).
  - Replace the hardcoded `moveTo(0,0)`/`zoomAbs(0,0,1)` in `resetPanZoom` (`:49`) with
    `centerView()`.
  - Add a `ResizeObserver` on the pane that re-runs `centerView()` (keeps reset correct on resize).

**Tests**
- Unit-test `computeCenter` (pure). Panzoom/DOM centering itself is a manual gate.

**Manual gate**
- Open a Mermaid diagram → centered. Pan/zoom → **Reset** → recenters. Resize window → reopen/reset
  → still centered. Large diagrams still center (minZoom 0.5 allows shrink-to-fit).

### UX1 — decisions / open items
- None unresolved. Suppression is non-persistent across reload (decided in the refinement spec as
  acceptable).

---

## UX2 — Per-node delete, cascading (#1)

**Decision (from spec):** `chatsRepo.deleteBranch(id)` = the existing `deleteSubtree` cascade but
scoped to *id + all `parent_id`-reachable descendants* instead of `WHERE root_id = ?`. Per-node
Delete lives on **`/tree` only**; root delete on `/chat` is unchanged.

### ⚠️ Correction to the spec — the recursive-CTE is NOT visible across batch statements

The refinement doc (#1, line 33) says: compute the descendant set with a recursive CTE "in the
first batch statement" and have later deletes use `WHERE … IN (SELECT id FROM desc)`. **That does
not work**: in SQLite a CTE is scoped to the single statement that declares it; later statements
in the same batch (even in one transaction) cannot reference `desc`. 

**Decided mechanism:** materialize the descendant set into a **session-scoped `TEMP` table** as the
first statement of the batch, reference it in every cascade delete, and drop it last. Temp tables
are connection-scoped and survive across statements on the same connection in **both** drivers (the
OPFS worker keeps one `db` handle for its lifetime, `opfs-worker.ts:36`; the Tauri driver keeps one
`plugin-sql` connection). The whole batch is one transaction (`opfs-worker.ts:73`, `tauri.ts:49`).

```sql
-- stmt 1 (create + populate, one recursive walk)
CREATE TEMP TABLE _delete_set(id TEXT PRIMARY KEY);
INSERT INTO _delete_set(id)
  WITH RECURSIVE desc(id) AS (
    SELECT id FROM chats WHERE id = ?
    UNION ALL
    SELECT c.id FROM chats c JOIN desc ON c.parent_id = desc.id
  )
  SELECT id FROM desc;
-- stmts 2..N: every existing deleteSubtree clause, with
--   'WHERE root_id = ?'  →  'WHERE <col> IN (SELECT id FROM _delete_set)'
-- stmt N+1
DROP TABLE _delete_set;
```

**Files modified**
- `src/lib/db/repositories/chats.ts`
  - Refactor `deleteSubtree(rootId)` so its statement list is produced by a shared helper
    `cascadeStatements(scope: { where: string; params: unknown[] })` where the scope selects the
    target chat-id set. Today's clauses all use `WHERE root_id = ?`; generalize them to
    `<col> IN (SELECT id FROM _set)`.
  - `deleteSubtree(rootId)` builds the set via `WHERE root_id = ?` into `_set` and runs the
    cascade (behavior unchanged — regression-safe).
  - New `deleteBranch(id)` builds the set via the recursive-CTE `TEMP` table above and runs the
    same cascade. The deleted chat's own `branch_source` row is removed by the existing
    `branch_chat_id IN (set)` delete; a sibling branched from the same parent message is **not** in
    the set and survives. The parent row is never touched (children hold the FK to parent).
- `src/lib/stores/chat.svelte.ts`
  - New `deleteBranch(id: string)` → `await repos.chats.deleteBranch(id)`; if the active
    `chatStore.chat` is in the deleted set (i.e. it no longer exists after the delete), clear the
    active chat state and let the route navigate away (see `/tree` task).

**Files modified (UI)**
- `src/routes/tree/+page.svelte`
  - Add a per-node **Delete** affordance (hover row menu / inline `Trash2` button) for **non-root**
    nodes only (root delete stays on `/chat`). Reuse the existing confirm wording
    (`Delete "<title>" and all its branches?`).
  - On confirm: `await chatStore.deleteBranch(id)`; reload `roots`/`forests`; if the active chat
    was in the deleted subtree, `goto('/chat')` and clear `chatStore`.
  - Pagination clamp to page 1 when the current page empties (already the established rule,
    `routes/chat/+page.svelte:60`).

**Tests** (Vitest, in-memory driver)
- `deleteBranch(midNode)` removes the node + all descendants + their labs/quizzes/attempts/answers/
  agent_traces/branch_sources; parent + siblings + ancestors remain.
- A cross-link whose **target** is in the set is removed; the **source** peer chat survives and opens.
- A sibling branched from the same parent message survives with its `branch_source` intact.
- `deleteSubtree(rootId)` is unchanged (regression).

**Manual gate**
- `/tree`: hover a branch node → Delete → confirm → that subtree disappears; siblings/parent stay;
  page re-renders. Delete the active chat → app returns to `/chat`. Root delete on `/chat`
  unchanged.

### UX2 — decisions / open items
- **RESOLVED (correction):** recursive-CTE visibility → use a `TEMP` table (above).
- **RESOLVED:** active-chat invalidation → clear store + `goto('/chat')`.

---

## UX3 — Backup & restore (#3 + #4)

**Decisions (from spec):** binary SQLite snapshot via `VACUUM INTO`; restore = **replace** the live
DB (with an automatic pre-restore safety snapshot + validate + migrate-forward); **no key
restore** (data-only). #3 and #4 are bundled because they share the new driver methods and the
Settings "Data" section.

### Decision surfaced while planning — byte-seam for browser/test, Rust path-commands for desktop

The spec defines the seam as byte-based (`snapshot(): Promise<Uint8Array>`,
`restore(bytes)`). That fits the browser (worker produces bytes → `Blob` download) and the
in-memory test driver. The **desktop**, however, wants a **native save/open dialog** that works
path-to-path (no reason to marshal a whole DB through the webview). 

**Decided split:**
- **Browser + in-memory (test):** implement the optional byte-based `snapshot()` / `restore(bytes)`
  on the seam.
- **Desktop user-facing flow:** dedicated Rust commands `backup_database(path)` and
  `restore_database(path)` (native dialogs, path-to-path). The desktop driver *also* implements the
  byte seam by delegating to a Rust temp path, for symmetry, but the `/settings` UI on desktop
  calls the Rust commands directly.
- This keeps the browser/test path on the storage seam (testable, no native deps) and the desktop
  path native-correct (no giant Uint8Array crossing the IPC boundary).

**Files modified / new**
- `src/lib/db/driver/types.ts` — add two optional methods:
  ```ts
  snapshot?(): Promise<Uint8Array>;
  restore?(bytes: Uint8Array): Promise<void>;
  ```
- `src/lib/db/driver/opfs-driver.ts` + `src/lib/db/driver/opfs-worker.ts`
  - Add `snapshot` / `restore` ops to the worker protocol (`DriverRequest.op`).
  - `snapshot`: `db.exec("VACUUM INTO 'file:mayon-snapshot.sqlite?vfs=opfs'")`, read that OPFS
    file's bytes (transferable), delete the temp file, return bytes.
  - `restore`: write `bytes` over `file:mayon.sqlite` (overwrite + reopen handle; checkpoint/closed
    the live handle first).
- `src/lib/db/driver/memory.ts` (in-memory test driver) — real `snapshot()`/`restore(bytes)` via
  sql.js `db.export()` / `new SQL.Database(bytes)` so the round-trip is unit-tested.
- `src/lib/db/driver/client.ts` — new `rebootstrap()`: reset `driverRef`/`dbRef`/`driverPromise`
  (`:35-37`), re-run `createDriver()` + `bootstrapWithDriver()` (re-runs migrations →
  migrate-forward an older restored DB).
- `src-tauri/src/backup.rs` **(new)** — `backup_database(target: String)` and
  `restore_database(source: String)`:
  - Resolve `mayon.db` from `app.path()` app_data_dir.
  - Backup: `PRAGMA wal_checkpoint(TRUNCATE)` on the live file, then `VACUUM INTO '<target>'`.
  - Restore: open `source` read-only, validate (SQLite header + required tables + `user_version` ≤
    app's), then overwrite `mayon.db`. Signal the webview to `rebootstrap()`.
- `src-tauri/src/lib.rs` — register `backup_database` / `restore_database` in `invoke_handler`
  (`:33`).
- `src/lib/db/backup.ts` **(new)** — `validateBackupBytes(bytes)` (open in sql.js, check header +
  required tables `chats/messages/...`; reject if schema is **newer** than the app understands via
  `user_version`). Shared by browser restore and by the in-memory tests.
- `src/lib/components/settings/DataSection.svelte` **(new)** — the "Data" panel:
  - **Download backup** → browser: `driver.snapshot()` → `Blob` → download `mayon-YYYYMMDD.sqlite`;
    desktop: `invoke('backup_database', { ...save dialog })`.
  - **Restore from backup** → file picker → confirm "this replaces all current data" → browser:
    `validateBackupBytes` → `driver.snapshot()` (safety) → `driver.restore(bytes)` → `rebootstrap()`
    → reload; desktop: `invoke('restore_database', { path })` → `rebootstrap()` → reload.
  - Disable both while `chatStore.streaming` or a lab/quiz run is active.
  - Note in the UI: backups are **data-only** (no provider keys).
  - (Reserved for UX4: a **Rebuild search index** button lives here.)
- `src/routes/settings/+page.svelte` — compose `DataSection` alongside the existing config blocks.

**Decision surfaced while planning — restore reload mechanism**
After a whole-DB replace, every store holds stale cached state. Rather than invalidate each store
individually (fragile for a rare, destructive action), **restore does a full `location.reload()`**
after `rebootstrap()` resolves. The new DB is live before reload so the app boots into it.

**Tests** (Vitest, in-memory driver)
- Snapshot → restore round-trip: all tables/data intact; `settings` contains **no** `providerKey:*`
  rows.
- `validateBackupBytes` rejects non-SQLite bytes and a DB missing required tables; rejects a
  `user_version` newer than the app.
- Restore an **older** snapshot → `rebootstrap` runs pending migrations → opens clean.

**Manual gate**
- `/settings` → Data → Download backup → `mayon-YYYYMMDD.sqlite`; reopen in a SQLite client → all
  chats/messages/labs/quizzes/settings present, no `providerKey:*` rows.
- Restore from backup → confirm → app reloads into the restored data (chats/trees/labs/theme back).
- Bad file → clear error, nothing changed. Older backup → migrates forward cleanly.
- Desktop: native save/open dialogs; key not in `mayon.db` (`secret-tool lookup service Mayon`).

### UX3 — decisions / open items
- **RESOLVED:** browser/test use the byte seam; desktop uses Rust path commands.
- **RESOLVED:** restore does a full `location.reload()` after `rebootstrap()`.
- **[DECISION? — for sign-off]**: Should the pre-restore safety snapshot be **auto-stored** (e.g.
  `mayon-pre-restore-<ts>.sqlite`) so the user can recover a bad restore, or only kept in-memory
  for the session? **Recommendation: auto-store one rolling safety snapshot** alongside the DB
  (cheap, and "I restored the wrong file" is a realistic disaster). Desktop writes it next to
  `mayon.db`; browser offers it as a download. *(Decided: auto-store one rolling copy — see final
  sign-off list; override if you'd rather not write a second file.)*

---

## UX4 — FTS5 full-text search (#6, round 1)

**Decision (from spec):** ship FTS5 now as the search foundation + UX; semantic is deferred (UX5).
External-content FTS5 + triggers (write-path consistency in both runtimes); `/search` route; works
fully offline.

### 🔒 Hard gate at the top of UX4 — FTS5 must be available in BOTH runtimes

The very first task is a smoke test: `CREATE VIRTUAL TABLE t USING fts5(x)` then insert/MATCH, run
against (a) the in-memory driver, (b) the OPFS worker, (c) desktop native SQLite. `@sqlite.org/
sqlite-wasm` **ships FTS5**; the desktop bundled SQLite (Tauri plugin-sql) **must be verified**.

- **If FTS5 is present in both:** proceed as below.
- **If absent on desktop only:** configure the desktop SQLite build to include FTS5 (or accept a
  runtime where desktop search is unavailable until fixed). **[DECISION? — surface at gate time]**
- **If FTS5 is unavailable and cannot be added:** fall back to `LIKE` queries (slower, no ranking,
  no snippet/highlight) as the `/search` backend, keeping the route/UX identical. This is a
  separate branch decision — **not pre-decided**; it depends on gate results.

### Decision surfaced while planning — FTS5 DDL is hand-authored, not drizzle-generated

FTS5 virtual tables and triggers are **not** drizzle-ORM models, so `pnpm db:generate` will not
emit them and (importantly) won't try to drop them on a later generate. Workflow:

1. Hand-author `drizzle/0006_search_fts.sql` (FTS5 table + triggers + backfill) and append its
   entry to `drizzle/meta/_journal.json`.
2. `pnpm bundle:migrations` so the SPA runs it offline (`src/lib/db/driver/migrations.ts`).
3. Do **not** add the FTS table to `schema.ts` (it's not a drizzle model); keep a code comment in
   the migration documenting this. The migrator (`migrator.ts`) just executes raw SQL, so this is
   safe.

### Decision surfaced while planning — FTS5 tokenizer & indexed-text normalization

The spec leaves these open (#6, edge cases). **Decided:**
- **Tokenizer:** `unicode61` with `remove_diacritics 2` (good multilingual/learner coverage, the
  FTS5 default lineage). `trigram` (better for code/partial matches) is noted as a future option
  if code-search feedback is poor — **not now** (it needs SQLite ≥ 3.34 and triples index size).
- **Indexed-text normalization (in the backfill + triggers):** index message content largely
  as-is, but **strip** ```` ```mermaid ``` ```` blocks and KaTeX (`$…$` / `$$…$$`) source so diagram
  / math source tokens don't dominate matches. **Keep** inline code and fenced non-mermaid code
  (code is signal in a learning app). The strip is a small pure helper (`stripIndexNoise(md)`),
  unit-tested.

**Files new / modified**
- `drizzle/0006_search_fts.sql` **(new)** —
  - `CREATE VIRTUAL TABLE search_fts USING fts5(kind, title, body, chat_id UNINDEXED,
    message_id UNINDEXED, content='');` (external-content: the source rows in
    `messages/chats/labs/quiz_questions/branch_sources` stay the single source of truth; FTS holds
    only the indexed tokens + unindexed routing keys).
  - `AFTER INSERT/UPDATE/DELETE` triggers on each source table that keep `search_fts` in sync
    (covers **every** write path in both runtimes — drivers are dumb SQL executors, so triggers
    fire uniformly, including the new `deleteBranch` cascade from UX2).
  - One-time **backfill**: `INSERT INTO search_fts(...) SELECT ... FROM ...` across the five
    source tables (apply `stripIndexNoise` via SQL `REPLACE`/regex-free substring ops where
    feasible; complex stripping done by a backfill repo function for the trickier markdown — see
    `search.ts`).
- `src/lib/db/repositories/search.ts` **(new)** —
  - `search(query, { limit, kinds })`: `SELECT ..., bm25(search_fts) AS rank ... WHERE search_fts
    MATCH ? ORDER BY rank` → grouped, snippet/highlight via `snippet()`/`highlight()`.
  - `rebuildIndex()`: `DELETE FROM search_fts;` then re-run the backfill (callable from Settings).
  - `stripIndexNoise(md)` pure helper (used by backfill + exposed for tests).
- `src/lib/db/index.ts` — register `search` repo.
- `src/routes/search/+page.svelte` **(new)** — search box + results grouped by conversation tree,
  each with snippet + highlight, ranked by `bm25()`; each result deep-links to
  `/chat/[id]?m=<messageId>`.
- `src/routes/chat/[id]/+page.svelte` — read `?m=<id>` query param on load → `scrollIntoView` the
  matching message (and optionally highlight it briefly).
- `src/lib/components/AppShell.svelte` (or a new `TopBar`) — header search box → navigates to
  `/search?q=…` (keyboard shortcut `/` or Ctrl/Cmd-K optional).
- `src/lib/components/settings/DataSection.svelte` (from UX3) — **Rebuild search index** button →
  `search.rebuildIndex()`.

**Decision surfaced while planning — search result deep-link mechanism**
Use a query param `/chat/[id]?m=<messageId>` + `scrollIntoView` (not a URL hash), because the chat
route mounts messages dynamically and a hash anchor can race the render. `?m=` is read in
`onMount`/`$effect` after the message list is populated.

**Tests** (Vitest, in-memory driver — assumes FTS5 gate passes; if the in-memory driver lacks FTS5,
gate it behind `RUN_IF_FTS5`)
- Insert a message → it is immediately searchable (trigger). Update → re-indexed. Delete (incl.
  `deleteBranch` from UX2) → removed from results.
- Backfill indexes pre-existing rows; `rebuildIndex()` is idempotent.
- `bm25()` ranking puts a closer lexical match above a worse one; snippet/highlight render.
- `stripIndexNoise` strips mermaid/katex but keeps inline code.

**Manual gate**
- Header search / `/search` → phrase → ranked results across messages/labs/quizzes/titles with
  snippets; click → opens the chat scrolled to that message. Works **fully offline** on desktop.
- Add/edit/delete a message → results stay fresh. "Rebuild search index" in Settings works.

### UX4 — decisions / open items
- **GATED:** FTS5 availability smoke test (top of phase).
- **RESOLVED:** hand-authored FTS5 migration; `unicode61`+`remove_diacritics 2`; strip mermaid/katex
  noise; deep-link via `?m=` + `scrollIntoView`.
- **[DECISION? — at gate time]:** desktop FTS5 missing → add it, or `LIKE` fallback.

---

## UX5 — Semantic search (#6, round 2) — GATED, not scheduled

Deferred per the spec. Do **not** implement until the three gates pass; decide the form with real
UX4 usage data in hand.

### Gates (all must be verified before UX5 starts)
1. **sqlite-vec loads in sqlite-wasm** (the WASM build restricts loadable extensions — likely the
   blocker). Verify in the OPFS worker.
2. **Model chosen:** local `@xenova/transformers` (e.g. all-MiniLM-L6-v2, ~25 MB, offline, free,
   CPU/RAM cost at index time — the user's stated performance worry) **vs.** a provider embedding
   model behind an explicit opt-in flag (breaks offline at index+query time — conflicts with
   principle #1, so only acceptable behind opt-in).
3. **Indexing strategy:** lazy/on-demand per conversation **vs.** global one-time index.

### Decision tree (decide when gates resolve)
- **sqlite-vec in WASM works + local model acceptable:** vector column in SQLite, hybrid
  (FTS5 recall → vector re-rank). Reuses UX4's `/search` route.
- **sqlite-vec blocked, local model acceptable:** store vectors as blobs in SQLite, do JS-side
  cosine at query time (fine at a single-learner's scale, degrades later).
- **Local model too heavy / sqlite-vec blocked:** keep FTS5-only (UX4) as the shipped search; offer
  provider-embedding behind an explicit opt-in (online) flag only.

No file tasks until gates pass. UX5's output is a *new* refinement decision doc, not code.

---

## Decisions surfaced & made while planning (summary)

These are implementation-level decisions the refinement spec did **not** make. Each is resolved
here; the two marked **[DECISION?]** are offered for sign-off (recommendation given).

| # | Decision | Status |
|---|----------|--------|
| A | **UX2:** the recursive-CTE is statement-local in SQLite → materialize the descendant set into a session-scoped `TEMP` table (first batch stmt) referenced by all cascade deletes, dropped last. *(Spec correction.)* | Decided |
| B | **UX3:** browser + in-memory test implement the byte-based `snapshot()`/`restore(bytes)` seam; the desktop user-facing flow uses Rust path-commands `backup_database`/`restore_database` with native dialogs. | Decided |
| C | **UX3:** restore does a full `location.reload()` after `rebootstrap()` (whole-DB replace invalidates all stores). | Decided |
| D | **UX3:** keep one rolling **auto-stored** pre-restore safety snapshot (desktop: next to `mayon.db`; browser: offered as a download) so a bad restore is recoverable. | **[DECISION?]** — recommend accept |
| E | **UX4:** FTS5 DDL is **hand-authored** (`drizzle/0006_search_fts.sql` + journal entry), not drizzle-generated; not added to `schema.ts`. | Decided |
| F | **UX4:** tokenizer = `unicode61` + `remove_diacritics 2`; `trigram` deferred. | Decided |
| G | **UX4:** strip ```` ```mermaid ``` ```` and KaTeX source from indexed text; keep inline/fenced code. | Decided |
| H | **UX4:** search deep-link = `/chat/[id]?m=<messageId>` + `scrollIntoView` (query param, not hash). | Decided |
| I | **UX4:** desktop FTS5 availability is a hard gate; if missing, decide add-it vs `LIKE` fallback at gate time. | **[DECISION?]** — at gate |

## Verification gates (per phase)

| Phase | Automated (`pnpm test`, in-memory) | Manual (OPFS + Tauri) |
|-------|------------------------------------|------------------------|
| UX1 | `computeCenter` unit; store `disabledToolIds` assertion | branch-offer suppression; Mermaid center/reset/resize |
| UX2 | `deleteBranch` cascade + cross-link peer survival + sibling survival; `deleteSubtree` regression | `/tree` per-node delete; active-chat invalidation |
| UX3 | snapshot/restore round-trip; data-only (no keys); validate rejects bad/newer; migrate-forward | download/restore in browser + desktop; key not in DB |
| UX4 | FTS5 trigger sync; backfill/rebuild idempotent; bm25 rank; noise-strip | offline `/search`; deep-link; rebuild index |
| UX5 | n/a (gated) | n/a |

## Suggested order of work

1. **UX1** (quick wins, zero schema risk) — land first.
2. **UX2** (schema-free repo refactor + `/tree` UI).
3. **UX3** (seam extension + Rust + Settings Data section).
4. **UX4** (FTS5 gate → migration/repo/route → reuses UX3's Data section).
5. **UX5** only after its three gates pass, as a fresh decision doc.

## Needs sign-off

- **D** — auto-stored rolling pre-restore safety snapshot (recommend: yes).
- **I** — desktop FTS5-missing fallback (decide at gate; recommendation: add FTS5 to the desktop
  build rather than ship a `LIKE` fallback).
- Confirm the phase split (UX1–UX5) and bundling (UX1a/b together; UX3+#4 together) matches intent.
