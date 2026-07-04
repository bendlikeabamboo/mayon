# Refinement plan — 2026-07-04 "notes on use"

- **Source:** `refinement/2026-07-04 notes on use.md` (six items #1–#6)
- **Status:** Decisions/spec. Not the phased plan — the phased plan is written afterwards from this.
- **Scope of this doc:** For each item, fix the goal, confirm the current behavior against the code, lay out the options with tradeoffs, **take a decision**, define the user journey + acceptance, and flag edge cases + open questions. Anything still genuinely open is marked **[DECISION?]** and surfaced for sign-off at the bottom.

## Guiding principles (reuse across all items)

These are the constraints every decision below respects (from `AGENTS.md` + the codebase):

1. **Offline-first, local-first.** Everything runs against local SQLite. Anything that needs the network at *read/query time* is a regression for the desktop (P5) offline guarantee and is only acceptable behind an explicit opt-in.
2. **One storage seam.** Components/stores call repositories only (`src/lib/db/repositories/*`); the `db` object is private to `src/lib/db/`. Drivers (`src/lib/db/driver/types.ts`) are dumb SQL executors with `query`/`batch`/`exec`. New storage capabilities extend this seam, not the repos.
3. **Two real SQLite runtimes, one file format.** Browser = sqlite-wasm + OPFS (`file:mayon.sqlite`); desktop = Tauri native SQLite (`sqlite:mayon.db`). Both are standard SQLite files and must stay interchangeable. A feature works in **both** or it's behind a runtime flag.
4. **No secrets in the DB.** API keys live in the OS keychain (desktop) / IndexedDB (browser), never in `settings` or any table. Any "backup" of the DB therefore excludes keys by construction.
5. **Write paths go through repositories.** Schema changes are additive migrations; `pnpm db:generate` then `pnpm bundle:migrations` so the SPA runs them offline.

---

## #1 — Delete a chat, cascading to its children + child quizzes & labs (not cross-links)

### Goal
Delete **any** chat node (root or a mid-tree branch) and cascade to its **descendant chats** and the **quizzes/labs attached to those chats**, while **not** touching cross-linked chats (only the cross-link *edges* that reference a deleted chat are removed).

### Current behavior (confirmed against code)
- `chatsRepo.delete(id)` (`src/lib/db/repositories/chats.ts:130`) deletes exactly one row — children FK-orphans / violate.
- `chatsRepo.deleteSubtree(rootId)` (`chats.ts:141-202`) already does the full cascade (messages, branch_sources, labs, quizzes → questions → attempts → answers, agent_traces, cross_link edges, then chats) **but scoped to `root_id = ?`** — i.e. it only nukes an entire tree from the root. It correctly leaves the cross-linked *peer* chat intact (it deletes the `cross_links` rows where either endpoint is in the set, line 193).
- The only delete affordance in the UI is on `/chat/+page.svelte` (`deleteChat`, lines 65-78) and it **only acts on roots** ("Delete this chat and all its branches"), calling `chatStore.deleteChat(id)` → `deleteSubtree`. There is **no** per-node delete on `/tree`, in the breadcrumb, or on the chat header.
- A mid-tree branch therefore cannot be deleted at all today; deleting a root deletes the whole tree (no subtree surgery).

### Decision
**Add `chatsRepo.deleteBranch(id)`** = the existing `deleteSubtree` cascade, but with the target set computed as **`id` plus all descendants reachable via `parent_id`** (a recursive CTE), instead of `WHERE root_id = ?`. Reuse the exact leaf→root dependency ordering already in `deleteSubtree`. Concretely:

- Compute the id-set once: `WITH RECURSIVE desc(id) AS (SELECT id FROM chats WHERE id = ? UNION ALL SELECT c.id FROM chats c JOIN desc ON c.parent_id = desc.id) SELECT id FROM desc`. The driver runs this in the first batch statement; subsequent deletes use `WHERE … IN (SELECT id FROM desc)`. (The batch is one transaction in both drivers — `opfs-worker.ts:73` and `tauri.ts:49` — so the recursive CTE result is visible to the later statements in the same batch.)
- Cross-links: same rule as today — delete edges where either endpoint ∈ set; the peer chat survives. Confirmed compliant with "not cross-linked chats."
- The deleted chat's own `branch_source` row (it points at the parent's message) is removed by the existing `branch_chat_id IN (set)` delete — so no dangling traceability row. A sibling that branched from the same parent message is **not** in the set and is untouched.
- Parent is never orphaned (children hold the FK to parent, not vice-versa), so deleting a subtree never touches the parent row.

**UI:** expose delete on **non-root nodes on the `/tree` page only** (row/hover menu), reusing the existing confirm dialog wording ("Delete \"<title>\" and all its branches?"). `/tree` is the discovery surface for the whole forest, so it is the single place per-node delete lives. Root delete on `/chat` stays as-is (it already says "and all its branches").

### User journey / acceptance
- `/tree`: hover a branch node → Delete → confirm → that subtree (node + all descendants + their labs/quizzes) disappears; siblings and the parent/ancestors remain; the page re-renders.
- A chat that is the **target** of a cross-link is deleted: the cross-link source chat still exists and opens; only the now-dangling edge is removed.
- Root delete on `/chat` is unchanged.

### Edge cases / risks
- **Self-reference / cycle:** `parent_id` forms a tree (no cycle by construction via `createChild`); the recursive CTE terminates.
- **Currently-open chat deleted via `/tree`:** if the deleted subtree contains the active `chatStore` chat, navigate the app back to `/chat` (or the parent) so we don't render a deleted chat. Since delete lives on `/tree`, the active conversation is not the focused view — but a stale `chatStore` must be invalidated.
- **Pagination:** after a delete that empties the current page, clamp page to 1 (already the rule from the pagination work; `routes/chat/+page.svelte:60-63`).
- **`agent_traces` with `lab_id`/`quiz_id` ON DELETE NO ACTION:** the cascade deletes `agent_traces` by `chat_id` first, so the dangling `lab_id`/`quiz_id` FKs are gone before labs/quizzes are removed — same ordering `deleteSubtree` already relies on.

### Decisions (resolved)
- **DECIDED:** Per-node Delete lives on **`/tree` only**. Root delete on `/chat` unchanged.

---

## #2 — Hide the LLM branching tool when a branch is created manually

### Goal
When the user branches manually — either the **Branch** button (`branchFromMessage`/`branchFromSelection`) or **expounding an excerpt** (`createExpoundBranch`) — the model in the new branch must **not** propose another branch (the `branch_chat` tool) on the turn that immediately follows, to avoid "double branching."

### Current behavior (confirmed against code)
- The agent loop already supports per-turn tool suppression: `AgentTurnDeps.disabledToolIds` (`src/lib/agent/loop.ts:49`) filters the tool set in `buildSdkTools` (`loop.ts:59-71`), and is threaded from `chatStore.send` (`src/lib/stores/chat.svelte.ts:230`) today as `disabledToolsForBrief(rootBriefRaw)` (`src/lib/chat/brief.ts:233`) — which disables `save_brief` when a brief exists.
- Manual branch entry points all go through the store helpers:
  - `branchFromMessage` (`chat.svelte.ts:601`) and `createBranchChild` (`chat.svelte.ts:611`) — `createChild` + optional `branchSources.create`.
  - `createExpoundBranch` (`chat.svelte.ts:566`) — same, plus stages `pendingPrompt` (`chat.svelte.ts:596`) which the route drains and `send`s once (`routes/chat/[id]/+page.svelte:219-220`).
- The **LLM-suggested** branch goes through the `branch_chat` tool itself (`src/lib/agent/deterministic-tools.ts:35` → `repos.chats.createChild`), which does **not** touch the store — so a store-side "manual branch" signal naturally excludes LLM branches. This is exactly the distinction we want.

### Decision
**One-shot, first-turn suppression.** Add a transient store flag, e.g. `manualBranchPending = $state<boolean>(false)`, set to `true` whenever a manual branch child is created (`branchFromMessage`, `branchFromSelection`/`createBranchChild`, `createExpoundBranch`). In `send`, merge `'branch_chat'` into the `disabledToolIds` passed to `runAgentTurn` **only while** `manualBranchPending` is true, then clear it at the end of that `send` (success or abort). 

- For the **expound** path this covers the staged auto-send; for the **Branch** button path it covers the first message the user types into the new branch.
- Suppression is **first turn only**: after the seeded turn completes, the flag is cleared and the LLM regains `branch_chat` for the rest of the conversation (so a later, legitimate "let's branch deeper" still works).
- No schema, no migration, no prompt change — purely a store/loop plumbing addition, building on the existing `disabledToolIds` contract and the `disabledToolsForBrief` precedent.

### User journey / acceptance
- Expound an excerpt with "I want to deep dive into this topic…" → the branch streams its summary **without** a "Branch" approval/offer; subsequent turns behave normally (branch tool available again).
- Click **Branch** on a message → type the first message → no branch offer; turn 2 onward: normal.
- An LLM-suggested branch (`branch_chat`) still works exactly as today (the flag is never set for it).

### Edge cases / risks
- **User never sends after a manual Branch:** the flag stays set until the first `send` in that chat; if they navigate away and the store reloads the chat later, the flag is `$state` (not persisted) so it resets to `false` on reload — i.e. suppression is lost across a reload. Acceptable: the reported problem is the immediate seeded turn; a later reload is a fresh context. (Alternative: persist a "suppress once" marker on the chat — **[DECISION?]** — but that's more state for a minor edge.)
- **Abort mid-turn:** clear the flag in the `finally` of `send` so a failed/aborted first turn doesn't leave suppression stuck on.

### Decisions (resolved)
- **DECIDED:** **First-turn-only** suppression. After the seeded turn completes (or aborts), `manualBranchPending` clears and `branch_chat` returns. Keeps the tool available for a genuine later "branch deeper." No persistence across reload (acceptable; the reported issue is the immediate seeded turn).

---

## #3 — Backup (download) the database

### Goal
In Settings, download a full backup of the local database (all chats, trees, labs, quizzes, traces, settings KV) for archival.

### Current behavior (confirmed against code)
- No export/backup anywhere. Settings is `routes/settings/+page.svelte` (a thin composition of config components).
- The DB file is the source of truth and is a standard SQLite file in both runtimes: browser `file:mayon.sqlite` (OPFS, owned by the worker `src/lib/db/driver/opfs-worker.ts:44`), desktop `sqlite:mayon.db` (app-data dir).
- The driver seam (`driver/types.ts`) exposes only `query`/`batch`/`exec` — no byte-level access.

### Options
- **(A) Binary SQLite snapshot via `VACUUM INTO`.** Run `VACUUM INTO '<temp>'` to produce a clean, consistent, defragmented copy of the live DB, then read its bytes. Fidelity is exact; includes `__drizzle_migrations`; interchangeable across both runtimes (both are real SQLite). Fast; tiny code.
- **(B) Portable JSON dump.** Enumerate every table, dump rows to JSON with a version header. Human-readable and version-tolerant, but high maintenance (every new table/column), slow for large DBs, and must re-insert in FK order on import.

### Decision
**(A) Binary snapshot.** Extend the storage seam with an optional method and implement it per runtime:

- `StorageDriver.snapshot?(): Promise<Uint8Array>` (additive, optional — the in-memory test driver can stub it).
- **Browser:** add a `snapshot` op to the OPFS worker protocol; in the worker, `db.exec("VACUUM INTO 'file:mayon-snapshot.sqlite?vfs=opfs'")`, read that OPFS file's bytes, return them (transferable), then remove the temp file. The main thread turns the bytes into a `Blob` and triggers a download (`mayon-YYYYMMDD.sqlite`).
- **Desktop:** a Rust command (`backup_database`) that `VACUUM INTO` to a temp path (or copies the WAL-checkpointed file) and writes it to a user-chosen path via Tauri's save dialog (`@tauri-apps/plugin-dialog` + `plugin-fs`).

Keys are **not** included (principle #4) — the backup is data only. This is documented in the UI.

### User journey / acceptance
- `/settings` → **Data** section → **Download backup** → file saves as `mayon-YYYYMMDD.sqlite`. Desktop shows a native save dialog; browser downloads the file.
- Re-opening the file in a SQLite client shows all chats/messages/labs/quizzes/settings intact; the `settings` table contains **no** `providerKey:*` rows.

### Edge cases / risks
- **Concurrent writes during snapshot:** `VACUUM INTO` takes a consistent snapshot without locking writers out for long; acceptable for a local app.
- **OPFS space:** the temp snapshot file is deleted right after reading; fine.
- **Large DBs / big Blob:** local-only; not a real concern at expected scale.

### Decisions (resolved)
- **DECIDED:** **Binary SQLite snapshot** (`VACUUM INTO`) via a new optional `StorageDriver.snapshot()`; keys excluded (data-only backup). Cross-runtime exact fidelity.

---

## #4 — Import (restore) data

### Goal
Restore a previously-backed-up database (archival / disaster recovery).

### Decision
**Replace semantics, with a safety net.** Import = replace the entire live DB with the imported file, then re-bootstrap:

- `StorageDriver.restore?(bytes: Uint8Array): Promise<void>` (additive, optional).
- **Before** replacing: take an automatic snapshot of the current DB (reuse #3) so a bad import is reversible.
- **Replace:** Browser — worker writes the bytes to `file:mayon.sqlite` (overwriting; OPFS), closes/reopens the handle. Desktop — Rust command writes bytes to `mayon.db` (overwrite). Then **tear down + re-bootstrap**: reset `driverRef`/`dbRef`/`driverPromise` (`driver/client.ts:35-37`), re-run `runMigrations` (the imported file's schema may be older → migrations forward it), reload `dbStatus`, and force a UI reload of the open route.
- **Validate before commit:** open the bytes in-memory, sanity-check it's a SQLite DB and that required tables exist (chats/messages/…); reject with a clear error if not. Also block importing a file whose `user_version`/schema is **newer** than the app understands (avoid silent data loss).

Keys are again untouched: provider keys stay in the keychain/IndexedDB as they are. A backup made on machine A restored on machine B will have A's chat data but B's (or no) keys — documented.

### Options (merge vs replace) — why replace
"Merge" (import a tree/selected chats into an existing DB) sounds nice but is genuinely hard: UUID collisions across two independent DBs are unlikely but `__drizzle_migrations`, cross-link targets, and branch-source message ids won't line up; dedup heuristics are fragile. The stated need is **archival / disaster recovery**, which is replace. Merge is deferred (possible future: "import a single chat tree" as a separate, bounded feature).

### User journey / acceptance
- `/settings` → **Data** → **Restore from backup** → pick a `*.sqlite` file → confirm the "this replaces all current data" warning → app reloads into the restored DB; chats/trees/labs/quizzes/theme are back.
- Bad file (not SQLite / wrong schema) → clear error, nothing changed.
- Restore an **older** backup → app runs pending migrations on it → opens clean.

### Edge cases / risks
- **WAL/desktop:** flush/checkpoint before overwrite so no committed data is lost; the Rust side checkpoints (`PRAGMA wal_checkpoint(TRUNCATE)`) on the live DB before the safety snapshot.
- **Active streaming turn during import:** gate the button while `chatStore.streaming` / a lab/quiz run is active; refuse with a message.
- **Schema drift:** migration-forward on import relies on the bundled journal (`migrator.ts`); an imported file with an *unknown newer* schema is rejected (above).

### Decisions (resolved)
- **DECIDED:** **Replace** semantics (with an automatic pre-restore safety snapshot + validate + migrate-forward). Merge is deferred — it's genuinely hard (UUID/migration/cross-link conflicts) and not the stated need.
- **DECIDED:** **No key restore.** Backups are data-only; provider keys stay in the keychain/IndexedDB as-is. A restore on another machine yields the backed-up data with that machine's (or no) keys — documented in the UI.

---

## #5 — Center Mermaid diagrams when opened in the preview dialog

### Goal
When a Mermaid diagram is opened in the full-screen preview, it should start **centered** in the viewport (today it sits at the top-left and the user must pan).

### Current behavior (confirmed against code)
`src/lib/components/chat/MermaidPreview.svelte` uses `panzoom`. On open it initializes panzoom (`onMount`, lines 55-70) but never centers: panzoom applies a `transform` to the SVG that overrides the container's `flex items-center justify-center`, so the diagram renders anchored at the origin. `resetPanZoom` (lines 49-53) resets to `moveTo(0,0)`/`zoomAbs(0,0,1)` — i.e. back to top-left, not to center.

### Decision
**Compute and apply a centering transform on open and on reset.** After the SVG is in the DOM and panzoom is initialized, measure the SVG (`svgContainer.firstElementChild` bounding box) and the viewport (the `flex-1 overflow-hidden` pane), then call `pzInstance.moveTo(cx, cy)` so the diagram's center coincides with the viewport's center; keep `zoomAbs(…, 1)` as the initial zoom. Apply the same centering math inside `resetPanZoom` (replace the hardcoded `0,0`).

- Centering offset: `dx = (viewportWidth  - svgWidth)  / 2`, `dy = (viewportHeight - svgHeight) / 2` (panzoom's `moveTo` works in the transformed coordinate space; a one-time measurement after the SVG settles is enough). Re-measure if the viewport resizes (`ResizeObserver`) so reset stays correct.
- No data/schema impact; pure component behavior. SVGs already render synchronously into the container before panzoom init (mermaid `render` returns the SVG string), but guard for a 0-size SVG and retry one frame later.

### User journey / acceptance
- Click a Mermaid diagram → preview opens with the diagram **centered** in the pane.
- Pan/zoom around freely → click **Reset** → diagram recenters (not top-left).
- Resize the window → re-open or reset → still centered.

### Edge cases / risks
- **Large diagrams** (wider/taller than the pane): centering still applies; the user can pan/zoom out (minZoom 0.5 already allows shrink-to-fit).
- **Measurement timing:** if the SVG isn't laid out yet on first `onMount`, center off-by-zero — mitigate with a `requestAnimationFrame`/short retry until `svgWidth > 0`.

### Open questions
- None material.

---

## #6 — Search (incl. semantic search feasibility)

### Goal
Search across conversations and artifacts. The user explicitly wants **semantic** search if feasible, and is concerned about **performance**.

### Current state
No search exists anywhere. All data is local SQLite (browser OPFS sqlite-wasm; desktop native SQLite). `@sqlite.org/sqlite-wasm` **ships FTS5**; the desktop bundled SQLite (Tauri plugin-sql) almost certainly does too but **must be verified** (a `CREATE VIRTUAL TABLE … USING fts5` smoke test in both runtimes is the first task). There is **no embeddings/vector** capability in the AI layer today (`src/lib/ai/` has no embedding client; providers are chat-only via the `ai` SDK).

### Options

**(A) Keyword / full-text search (FTS5)** — index `messages.content`, `chats.title`, `labs.title`+`content`, `quiz_questions.prompt`, optionally `branch_sources.excerpt`, into an FTS5 table; query with `MATCH`, rank with `bm25()`.
- Pros: pure SQL, **offline**, deterministic, fast, ~zero runtime cost, works in both runtimes, small index, no model/API dependency. Genuinely high ROI.
- Cons: lexical only — no synonyms/paraphrase/meaning.

**(B1) Semantic — remote embeddings** via the active provider's embedding model.
- Pros: real semantic match.
- Cons: needs **network + API key + cost** at index *and* query time; not every configured provider exposes embeddings; breaks the offline guarantee; first-time indexing embeds the whole history. **Conflicts with principle #1.**

**(B2) Semantic — local embeddings** in-browser (transformers.js, e.g. all-MiniLM-L6-v2) + a vector store.
- Pros: offline + private + free.
- Cons: heavy — model download (~25–90 MB), CPU/RAM at index time (the user's stated performance worry); vector search in SQLite needs **sqlite-vec**, which must be loadable in **sqlite-wasm** (extensions are restricted in the WASM build — **unverified, likely the blocker**) and separately on desktop. Big bundle + complexity.

**(C) Hybrid** — FTS5 recall + embeddings re-rank/semantic fallback. Most powerful, most complex.

### Decision (recommended)
**Ship FTS5 (A) now as the search foundation and UX; treat semantic as a later, opt-in phase gated on verification.** Rationale: FTS5 is offline, fast, cheap, deterministic, and already covers the 80% case ("find where we talked about X"); it directly respects the offline-first principle and the user's performance concern. Semantic search is genuinely possible but the two viable forms each have a real cost (B1 breaks offline; B2 is heavy and hinges on sqlite-vec-in-wasm, which must be proven first). Sequencing it **after** FTS5 also lets us decide with real data instead of speculatively.

**FTS5 design:**
- **One FTS5 table, external-content over the source tables** (`CREATE VIRTUAL TABLE search_fts USING fts5(...)`) so text isn't duplicated and the source rows stay the single source of truth.
- **Keep in sync via triggers**, not app-layer writes: triggers are pure DDL created by a migration and therefore guarantee consistency for **every** write path in **both** runtimes (the drivers are just SQL executors). This avoids scattering FTS writes across repositories.
- **Indexable text:** message content (user + assistant), chat titles, lab title + content, quiz prompts, branch excerpts. Store unindexed foreign keys (`chat_id`, `message_id`, `kind`) for result routing.
- **Backfill:** a one-time `INSERT INTO search_fts(…) SELECT … FROM …` run as part of the migration (and re-runnable from Settings) to index existing rows.
- **Query UX:** a **`/search` route** + a header search box; results grouped by conversation tree with a snippet + highlight, ranked by `bm25()`, each result deep-links to the chat (and scrolls to the message).

**Semantic (phase 2, gated):** before committing, verify (1) sqlite-vec loads in sqlite-wasm; (2) pick a model (local transformers.js vs a provider embedding model behind a flag); (3) decide indexing strategy (lazy/on-demand per conversation vs global). If sqlite-vec-in-wasm is blocked, the only offline path is a JS-side cosine over vectors stored as blobs (works at small scale, degrades at scale) — likely good enough for a single learner's history.

### User journey / acceptance (FTS5 round)
- Header search or `/search` → type a phrase → ranked results across messages/labs/quizzes/titles, each with a snippet and a link; clicking opens the chat at that message.
- Works **fully offline** on desktop (P5) and in the browser.
- Adding/editing/deleting a message/lab/quiz keeps results fresh (trigger-backed); a "Rebuild search index" action exists in Settings for safety.

### Edge cases / risks
- **FTS5 not compiled into desktop SQLite:** the very first task verifies this; if absent, the desktop build of the plugin must be configured to include it (or we fall back to `LIKE` queries — slower, no ranking, but functional).
- **Markdown/noise in content:** index the rendered text or strip code fences so code blocks don't dominate matches; decide whether to strip mermaid/katex source.
- **Index size/perf:** FTS5 is compact and fast well beyond expected scale; backfill is a one-time cost.
- **Deletions (#1) and FTS:** triggers handle row removal automatically, so the new `deleteBranch` cascade cleans the index for free.

### Decisions (resolved)
- **DECIDED:** **FTS5 now, semantic later.** External-content FTS5 + triggers (write-path consistency in both runtimes); `/search` route for results. Respects offline-first and the performance concern.
- **DEFERRED (semantic, gated):** before committing, verify (1) sqlite-vec loads in sqlite-wasm; (2) pick local transformers.js vs a provider embedding model behind a flag; (3) indexing strategy (lazy per-conversation vs global). Decided when we revisit, with real usage data.

---

## Cross-cutting decisions (resolved)

| # | Decision | Status |
|---|----------|--------|
| 1 | New `chatsRepo.deleteBranch(id)` (recursive-CTE subtree cascade); per-node Delete on **`/tree` only** | Decided |
| 2 | One-shot **first-turn-only** `branch_chat` suppression via a store flag (builds on existing `disabledToolIds`) | Decided |
| 3 | Backup = **binary SQLite snapshot** via `VACUUM INTO`; new optional `StorageDriver.snapshot()`; keys excluded | Decided |
| 4 | Restore = **replace** (+ auto safety snapshot + validate + migrate-forward); `StorageDriver.restore()`; no key restore | Decided |
| 5 | Center Mermaid on open + on reset (panzoom centering math + `ResizeObserver`) | Decided |
| 6 | **FTS5 now** (external-content + triggers + `/search` route); semantic deferred behind verification | Decided |

## Suggested sequencing (for the next doc — the phased plan)

- **Quick wins (independent, low risk):** #2 (tool suppression, plumbing only), #5 (Mermaid centering, one component).
- **Schema + repo:** #1 (`deleteBranch` + per-node delete UI).
- **Seam extension + UI:** #3 + #4 together (snapshot/restore share the new driver methods and the Settings "Data" section).
- **Largest, split:** #6 FTS5 first (migration + triggers + `/search`); semantic as a separate, gated follow-up.

## Resolved sign-offs (this session)

1. **#1** — per-node Delete: **`/tree` only**.
2. **#2** — suppression scope: **first-turn only**.
3. **#3/#4** — **binary `.sqlite`** backup; restore = **replace**.
4. **#6** — **FTS5 now + `/search` route**; semantic deferred.

All items are decided. Next step: the phased plan (sequencing + file-level tasks), built from this doc.
