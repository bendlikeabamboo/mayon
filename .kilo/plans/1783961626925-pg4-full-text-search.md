# Plan — P-pg-4: Full-text search (FTS5 → Postgres `tsvector`/GIN/`ts_headline`)

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-4, lines
> 279–325). Status: **implementation-ready**. Authored 2026-07-14.
> Prerequisite: **P-pg-3 is merged** — app boots against PG via `RemotePgDriver`,
> server-required gating works, `'pg'` cap advertised. `search.ts` is currently a stub
> (`search()`→`[]`, `fts5Available()`→`false`, `rebuildIndex()`→no-op).
> Scope: **this plan only**. P-pg-5 (`pg_dump`/`pg_restore`), P-pg-6 (OPFS→PG importer),
> P-pg-7 (OPFS/WASM/COEP removal + docs rewrite) are out of scope.

## Goal

Port `searchRepo` from FTS5 to native Postgres full-text search, preserving the `SearchHit`
shape, the `\x01`/`\x02` snippet-marker convention (`renderSnippet`), ranked results, and
the `kind` filter — while keeping mermaid/`$$…$$` noise out of the index.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Noise stripping via an `IMMUTABLE` SQL function `strip_search_noise(text)` referenced inside `GENERATED ALWAYS AS (...) STORED` tsvector columns.** Strips fenced ```` ``` ```` code blocks (incl. mermaid) and `$$…$$` display math via `regexp_replace`. Inline `$…$` math stripping is dropped (PG regex lacks lookbehind). | User-locked. Preserves the high-value stripping (this app renders heavy mermaid + KaTeX) **without** reintroducing triggers; `GENERATED` columns self-maintain on every write. `IMMUTABLE` is required for a function used in a generation expression. |
| L2 | **FTS schema delivered as idempotent boot DDL, outside drizzle.** A shared `FTS_BOOTSTRAP_SQL: string[]` (1 function + 4 GENERATED columns + 4 GIN indexes) run after `migrate()` — on the server at boot (`runFtsBootstrap`) and in the pglite test driver `init()`. FTS stays **out of `schema.ts`** (matches the old "FTS is not a drizzle table" philosophy). | User-locked. No drizzle snapshot/`db:generate` drift surgery; no drizzle-kit quirks with GENERATED tsvector + expression GIN. `db:generate` never sees these columns → never tries to drop them. |
| L3 | **Tokenizer = `'simple'`** (no `unaccent` for v1). Matches `unicode61` (no stemming; split on non-alphanumeric). | Epic D6/§3. Diacritic folding via `unaccent` is a documented follow-up if users ask. |
| L4 | **Query = `websearch_to_tsquery('simple', $1)` with the raw user query.** `buildMatchQuery` becomes a legacy pure helper (kept + tested, **unused** by the PG path — its `"foo" "bar"` output is FTS5 syntax that breaks PG `to_tsquery`). | `websearch_to_tsquery` gives AND semantics for space-separated words (matches old UX), supports quoted phrases, and is robust to special chars (no injection). |
| L5 | **Ranking = `ts_rank_cd(vec, tsq)`, `ORDER BY rank DESC`**, store the positive `ts_rank_cd` value in `SearchHit.rank`. | Epic D6. (SQLite `bm25` was ascending/negative; PG is descending/positive — direction flips.) |
| L6 | **Snippets = `ts_headline('simple', <col>, tsq, E'MaxWords=… StartSel=\x01 StopSel=\x02 …')`** — body `MaxWords=12`, title `MaxWords=8`. Preserves the `\x01`/`\x02` markers consumed by `renderSnippet` (unchanged). | Parity with the old `snippet(...,char(1),char(2),'…',N)` calls. |
| L7 | **Rename `fts5Available()` → `searchAvailable()`.** It now probes `pg_ts_config` and always returns `true` with the `'pg'` cap; update the 2 references in `routes/search/+page.svelte` + the test. | User-locked. The old name references a dialect the app no longer uses. |
| L8 | **`rebuildIndex()` is a true no-op; remove the Settings "Rebuild search index" button + handler.** GENERATED columns self-maintain. | User-locked. Keep `rebuildIndex()` on the repo as a documented no-op for API compat. |
| L9 | **`search.ts` uses PG-native `$n` placeholders. `translatePlaceholders` STAYS.** | `chats.ts` (`deleteBranch`/`deleteSubtree` cascade) still emits raw `?`, so the translator cannot be removed yet. **This corrects the P-pg-2 plan's L7** ("removed in P-pg-4") — that claim was wrong; removal is deferred to whenever `chats.ts` is ported (or P-pg-7). The translator is idempotent on `$n`, so search's `$n` passes through untouched. |
| L10 | **No new dependencies, no new server cap.** `@electric-sql/pglite` (root devDep), `pg` (server dep), `@mayon/shared` (already imported by both runtimes) are present. Search degrades to `[]` (try/catch) if FTS is unavailable — no `'fts'` cap needed. | Bounds scope; matches the existing graceful-degradation pattern. |

## Grounding (verified current state)

- **Stub** — `src/lib/db/repositories/search.ts`: `search()`→`[]`, `fts5Available()`→`false`,
  `rebuildIndex()`→`async(){}`; pure helpers `stripIndexNoise`/`buildMatchQuery`/`renderSnippet`/`deepLink` kept.
- **Old FTS5 design** (git `cedc6dd`): `search_fts` virtual table (`kind,title,body,chat_id,ref_id,quiz_id`;
  `unicode61 remove_diacritics 2`) fed by **12 triggers** indexing *raw* text; `rebuildIndex()` re-inserted with
  `stripIndexNoise`; `bm25()` ascending; `snippet(search_fts,<col>,char(1),char(2),'…',N)`. `SearchHit` fields:
  `kind,chatId,refId,quizId,title,chatTitle,rootId,snippetBody,snippetTitle,rank`.
- **Row contract** — drivers return **positional** rows (`row[i]`); proven by `src/lib/db/driver/pg.test.ts`
  (`expect(result.rows).toEqual([[1,'x']])`) and the old `search.ts` `row[0..9]` reads. Both `RemotePgDriver`
  (server `toResult` → positional) and the pglite test driver return positional arrays. `search.ts` keeps
  `getDriver().query(sql, params)` + positional indexing.
- **Server PG** — `server/src/pg.ts`: `translatePlaceholders` (`?`/`?n`→`$n`, idempotent on `$n`), `pgQueryHandler`
  (`query`/`batch`/`exec`), `runPgMigrations` (drizzle native `migrate()`). `server/src/server.ts` `start()`:
  `probePg` → `runPgMigrations` → `buildApp({pgPool,pgReady})`; caps `[...,BASE_CAPS,'pg']`.
- **Test driver** — `src/lib/db/driver/pg-test.ts`: `createPgTestDriver()` runs pglite `migrate()` in `init()`;
  `bootstrapTestDb()` returns `{db,driver}`. Repo tests then call `bootstrapWithDriver(driver,'pg')` to set the
  globals (`getDriver()`/`awaitDb()`). Pattern (verified in `repositories.test.ts`/`mcp.test.ts`):
  `const {driver} = await bootstrapTestDb(); await bootstrapWithDriver(driver,'pg');`
- **drizzle** — `drizzle/0000_curved_frog_thor.sql` + `meta/_journal.json` (single entry). `drizzle.config.ts`
  `dialect:'postgresql'`. No bundled `migrations.ts`/`bundle-migrations.ts` (removed in P-pg-2).
- **Cross-package wiring** — `@mayon/shared` (`packages/shared/src/index.ts`, exports point at source — no build
  step) is imported by both server and SPA. `@mayon/schema` is a server path-alias → `../src/lib/db/schema.ts`.
- **Consumers** — `routes/search/+page.svelte` (`repos.search.search(q,{limit:50})` + `fts5Available` gate);
  `components/settings/DataSection.svelte` ("Rebuild search index" button → `repos.search.rebuildIndex()`).
  Re-exports in `src/lib/db/index.ts` + `repositories/index.ts` (helpers + types; repo methods live on the
  `searchRepo` object, so the `searchAvailable` rename needs **no** re-export changes).
- **`chats.ts` still raw-`?`** — `cascadeStatements` (`'root_id = ?'`) + `deleteBranch` (`WHERE id = ?`,
  recursive CTE). ⇒ `translatePlaceholders` must stay (L9).

## Hard rules (non-negotiable this phase)

- FTS schema is **idempotent boot DDL outside drizzle** (L2). Do **not** add tsvector columns to `schema.ts`;
  do **not** hand-edit `drizzle/meta` snapshots.
- `search.ts` reads **positional** rows; uses `$n` placeholders; degrades to `[]` on any query error (try/catch).
- `renderSnippet`, `deepLink`, `SearchHit`/`SearchKind` types, and the pure-helper tests stay byte-for-byte.
- `pnpm test` (root) green with only Node (pglite in-process); `pnpm --filter @mayon/server test` green.
- No `pg_dump`/`pg_restore` (P-pg-5), no OPFS→PG importer (P-pg-6), no OPFS/WASM removal (P-pg-7).

---

## Tasks

> Order is a suggested dependency sequence. After all edits: `pnpm install` (no-op — no new deps),
> then the T9 verification block.

### T1 — Shared FTS bootstrap SQL (`packages/shared/src/fts.ts`, new + re-export)

- New `packages/shared/src/fts.ts` exporting `FTS_BOOTSTRAP_SQL: string[]` — **9 ordered, standalone
  statements** (each is a single SQL statement; run individually, never batched into one `pool.query`).
  Re-export from `packages/shared/src/index.ts` (`export * from './fts';`). Store each statement as a
  **double-quoted JS string** so the triple-backtick pattern is literal (backticks aren't special in `"..."`).

  ```sql
  -- 1. noise stripper (IMMUTABLE ⇒ usable in a GENERATED expression)
  CREATE OR REPLACE FUNCTION strip_search_noise(input text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(
             regexp_replace(coalesce(input, ''), '\$\$[\s\S]*?\$\$', ' ', 'g'),
             '```[\s\S]*?```', ' ', 'g');
  $$;
  -- 2-5. GENERATED tsvector columns (IF NOT EXISTS ⇒ idempotent; backfilled for existing rows on first add)
  ALTER TABLE messages       ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(content))) STORED;
  ALTER TABLE chats          ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(title))) STORED;
  ALTER TABLE labs           ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(title || ' ' || content))) STORED;
  ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS search_vec tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(prompt))) STORED;
  -- 6-9. GIN indexes
  CREATE INDEX IF NOT EXISTS messages_search_vec_idx       ON messages       USING gin (search_vec);
  CREATE INDEX IF NOT EXISTS chats_search_vec_idx          ON chats          USING gin (search_vec);
  CREATE INDEX IF NOT EXISTS labs_search_vec_idx           ON labs           USING gin (search_vec);
  CREATE INDEX IF NOT EXISTS quiz_questions_search_vec_idx ON quiz_questions USING gin (search_vec);
  ```

  - `content`/`title`/`prompt` are `NOT NULL` ⇒ no `coalesce` inside `strip_search_noise` calls; `labs`
    concatenates two `NOT NULL` cols.
  - Regex note: `[\s\S]*?` matches across newlines (PG has no DOTALL). If pglite rejects `[\s\S]`, fall back
    to `(.|\n)*?` — the T7 noise-stripping test catches any mismatch.
  - No `unaccent` (L3).

### T2 — Server: run FTS bootstrap after migrate (`server/src/fts.ts` new + `server/src/server.ts`)

- New `server/src/fts.ts`:
  ```ts
  import type { PgPoolLike } from './pg';
  import { FTS_BOOTSTRAP_SQL } from '@mayon/shared';
  export async function runFtsBootstrap(pool: PgPoolLike): Promise<void> {
    for (const sql of FTS_BOOTSTRAP_SQL) await pool.query(sql); // no params; no translatePlaceholders
  }
  ```
  (`pool.query` runs exactly one statement — hence one entry per array element.)
- `server/src/server.ts` `start()`: after `runPgMigrations` succeeds, `try { await runFtsBootstrap(pool);
  console.log('pg: fts ready'); } catch (err) { console.error('pg: fts bootstrap failed —', ...); }`.
  **FTS failure is non-fatal** — do not unset `pgReady` (the app still works; `search.ts` try/catch returns
  `[]`). No new cap. `buildApp`/`BuildAppOptions` unchanged.

### T3 — Test driver: run FTS bootstrap in init (`src/lib/db/driver/pg-test.ts`)

- In `createPgTestDriver().init()`, after `await migrate(db, { migrationsFolder: MIGRATIONS_DIR });`, loop:
  ```ts
  import { FTS_BOOTSTRAP_SQL } from '@mayon/shared';
  // ...
  for (const sql of FTS_BOOTSTRAP_SQL) await client.exec(sql);
  ```
  Every `bootstrapTestDb()` call now yields a DB with the FTS columns/indexes/function.

### T4 — Rewrite `search.ts` (`src/lib/db/repositories/search.ts`)

- Restore `import { getDriver } from '$lib/db/driver/client';`.
- **`searchAvailable()`** (renamed): `SELECT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgname='simple') AS ok`
  → return `Boolean(row[0])`; try/catch → `false`.
- **`search(query, opts?)`**:
  - If `!query.trim()` → `[]`.
  - Build the UNION-ALL SQL below (CTE computes the tsquery once). Headline option strings carry the
    `\x01`/`\x02` markers via PG `E'...'` escape syntax; in JS source write them double-backslashed
    (`"MaxWords=12 MinWords=5 ShortWord=2 StartSel=\\x01 StopSel=\\x02"`) so the emitted SQL contains
    single-backslash `\x01`/`\x02` for PG's `E''` parser.
  - Optional `kinds` filter: append `WHERE hits.kind IN ($2, $3, …)` (placeholders numbered sequentially
    after `$1`). Param array = `[query, ...(opts?.kinds ?? []), limit]`; the limit placeholder is the
    **last** `$n`. (Placeholder textual order is irrelevant to PG; numbering follows the params array.)
  - Execute `const { rows } = await getDriver().query<unknown[]>(sql, params);` inside try/catch → `[]`.
  - Map positional rows (0=kind,1=chat_id,2=ref_id,3=quiz_id,4=title,5=chat_title,6=root_id,
    7=snippet_body,8=snippet_title,9=rank) → `SearchHit` (same indices as the old code).

  Reference SQL (substitute `<BODY>`/`<TITLE>` headline option strings; omit the kind clause when no kinds):
  ```sql
  WITH tsq AS (SELECT websearch_to_tsquery('simple', $1) AS q)
  SELECT kind, chat_id, ref_id, quiz_id, title, chat_title, root_id, snippet_body, snippet_title, rank
  FROM (
    SELECT 'message'::text AS kind, m.chat_id, m.id AS ref_id, NULL::text AS quiz_id,
           ''::text AS title, c.title AS chat_title, c.root_id,
           ts_headline('simple', m.content, tsq.q, E'<BODY>') AS snippet_body,
           ''::text AS snippet_title,
           ts_rank_cd(m.search_vec, tsq.q) AS rank
    FROM messages m CROSS JOIN tsq JOIN chats c ON c.id = m.chat_id
    WHERE m.search_vec @@ tsq.q
    UNION ALL
    SELECT 'chat'::text, c.id, c.id, NULL::text, c.title, c.title, c.root_id, ''::text,
           ts_headline('simple', c.title, tsq.q, E'<TITLE>'),
           ts_rank_cd(c.search_vec, tsq.q)
    FROM chats c CROSS JOIN tsq WHERE c.search_vec @@ tsq.q
    UNION ALL
    SELECT 'lab'::text, l.chat_id, l.id, NULL::text, l.title, c.title, c.root_id,
           ts_headline('simple', l.content, tsq.q, E'<BODY>'),
           ts_headline('simple', l.title, tsq.q, E'<TITLE>'),
           ts_rank_cd(l.search_vec, tsq.q)
    FROM labs l CROSS JOIN tsq JOIN chats c ON c.id = l.chat_id
    WHERE l.search_vec @@ tsq.q
    UNION ALL
    SELECT 'quiz_question'::text, qz.chat_id, qq.id, qq.quiz_id, ''::text, c.title, c.root_id,
           ts_headline('simple', qq.prompt, tsq.q, E'<BODY>'), ''::text,
           ts_rank_cd(qq.search_vec, tsq.q)
    FROM quiz_questions qq CROSS JOIN tsq
    JOIN quizzes qz ON qz.id = qq.quiz_id JOIN chats c ON c.id = qz.chat_id
    WHERE qq.search_vec @@ tsq.q
  ) AS hits
  <KIND_CLAUSE>      -- optional: WHERE hits.kind IN ($2, $3, ...)
  ORDER BY rank DESC
  LIMIT <LAST_$n>    -- limit placeholder
  ```
  (quiz_question `chat_id` resolved at query time via `quiz→chat` join; messages/labs via their `chat_id`.)
- **`rebuildIndex()`**: `async () => {}` with a comment: "No-op — `search_vec` GENERATED columns
  self-maintain (P-pg-4)."
- Keep `stripIndexNoise` (note: legacy JS helper; the **index** is cleaned by the SQL `strip_search_noise`),
  `buildMatchQuery` (legacy, unused by the PG path), `renderSnippet`, `deepLink`, `SearchHit`/`SearchKind`.

### T5 — UI consumers

- `src/routes/search/+page.svelte`: rename the local `fts5Available` state → `searchAvailable`; change
  `repos.search.fts5Available()` → `repos.search.searchAvailable()`; update the
  `{#if searchAvailable === false}` gate (keep as a defensive check; copy unchanged).
- `src/lib/components/settings/DataSection.svelte`: remove the "Rebuild search index" `<Button>` and the
  `handleRebuildIndex` function (GENERATED columns self-maintain). Leave the rest of the Data section intact.
- `src/lib/db/index.ts` + `repositories/index.ts`: **no change** (methods live on the `searchRepo` object;
  helper/type re-exports unchanged).

### T6 — Tests (`src/lib/db/repositories/search.test.ts`, `server/src/fts.test.ts` new)

- `search.test.ts`: replace the stub assertions. Mirror the repo-test bootstrap:
  ```ts
  beforeEach(async () => {
    const { driver } = await bootstrapTestDb();
    await bootstrapWithDriver(driver, 'pg');
  });
  ```
  Seed via `repos` (chat, message, lab, quiz+question). Cases:
  1. `await repos.search.searchAvailable()` → `true`.
  2. Search a token in a message → ≥1 hit, `kind==='message'`, `chatId`/`refId` correct, and
     `renderSnippet(hit.snippetBody)` yields a segment with `mark:true` containing the token (proves the
     `\x01`/`\x02` markers round-trip).
  3. A token present in a lab title and a quiz prompt → hits include `kind:'lab'` and `kind:'quiz_question'`.
  4. `search(token, { kinds: ['lab'] })` → only lab hits (kind filter).
  5. Ranking: two messages with differing term frequency → higher-`rank` hit sorts first.
  6. **Noise stripping**: a message whose *only* occurrence of `uniquemermaidtoken` is inside a
     ```` ```mermaid … ``` ```` block → `search('uniquemermaidtoken')` returns **no** message hit; the same
     token in plain text → hit. (Proves `strip_search_noise` runs in the GENERATED expression.)
  7. `await repos.search.rebuildIndex()` resolves without error (no-op).
  8. Keep **all** existing pure-helper tests verbatim (`stripIndexNoise`/`buildMatchQuery`/`renderSnippet`/`deepLink`).
- `server/src/fts.test.ts` (hermetic, mock pool): assert `runFtsBootstrap(mockPool)` executes one `query()`
  per `FTS_BOOTSTRAP_SQL` entry, and that calling it **twice** does not throw (idempotent). Real SQL
  correctness is covered by `search.test.ts` via pglite, so the server test only proves wiring + idempotency.

### T7 — Docs (`AGENTS.md`)

- Update the P-pg-2 line "Search stubbed … (FTS port … is P-pg-4)" → note search is now live.
- Add a **P-pg-4 acceptance-gate** section (mirror the existing phase-gate format): browser+server+PG →
  `/search` returns ranked hits with highlighted snippets across messages/chats/labs/quizzes; kind filter
  works; a term inside a mermaid/`$$` block is **not** matched (noise stripping); server-down or FTS failure
  → search degrades to `[]` (no crash); `searchAvailable()` is `true` with the `'pg'` cap; the Settings
  "Rebuild search index" button is gone. Note `translatePlaceholders` **stays** (correcting P-pg-2 L7).

### T8 — Verify

- `pnpm check` — types fine (no schema.ts change).
- `pnpm lint && pnpm check && pnpm test` (root) — green (pglite in-process).
- `pnpm --filter @mayon/server test` — green.
- `docker compose build && docker compose up`:
  - Server logs `pg: ready` → `pg: migrations applied` → `pg: fts ready`.
  - `GET /api/health` → `caps: ['stdio-mcp','llm-proxy','sandbox-db','backup','pg']` (unchanged).
  - `/search`: create a chat+message+lab+quiz via the app, search a token → ranked hits with highlighted
    snippets; kind filter; a token only inside a ```` ```mermaid ```` block is not matched.
  - Sandbox inspector regression: `/api/sandbox/query` still works (untouched).
- Grep guards:
  - `rg 'fts5Available' src/` → no hits (renamed).
  - `rg 'rebuildIndex' src/lib/components` → no hits (button removed).
  - `rg 'search_fts|MATCH \?|bm25\(' src/` → no hits (old FTS5 gone).

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green.
- `docker compose up` → search returns ranked, snippet-highlighted hits across all 4 kinds; kind filter +
  noise stripping verified; `searchAvailable()` true; "Rebuild search index" button gone.
- FTS schema is idempotent boot DDL (shared `FTS_BOOTSTRAP_SQL`), applied on the server after `migrate()` and
  in the pglite test driver `init()`; nothing FTS-related added to `schema.ts` or `drizzle/meta`.
- `search.ts` uses `$n` placeholders + positional rows; `translatePlaceholders` retained (chats.ts);
  `renderSnippet`/`deepLink`/`SearchHit` unchanged.

## Risks

- **`[\s\S]` regex in pglite.** Mitigation: T1 notes the `(.|\n)` fallback; T7 noise-stripping test catches it.
- **`\x01`/`\x02` markers lost through JSON/escape-string handling.** Mitigation: T4 specifies double-backslash
  in JS + `E'...'` in SQL; T7 test #2 asserts `renderSnippet` yields a `mark:true` segment.
- **GENERATED `ADD COLUMN … IF NOT EXISTS` behavior.** First add backfills all rows (fast for a personal DB);
  later boots are no-ops. If a column pre-exists with a different expression, PG silently skips (acceptable).
- **`websearch_to_tsquery` vs old `buildMatchQuery` semantics.** Both yield AND-of-terms; quoted-phrase support
  is now also available (additive). No UX regression expected; T7 covers multi-token + filter.
- **`runFtsBootstrap` runs per-test in pglite (~9 statements).** Negligible vs the per-test `migrate()`; revisit
  only if the suite slows (P-pg-7).
- **`translatePlaceholders` retained though "P-pg-4 was supposed to remove it."** This is intentional (L9) —
  `chats.ts` is the remaining raw-`?` caller. Documented in T7 to prevent confusion.

## Out of scope (explicit)

- `unaccent`/diacritic folding (L3 follow-up); true BM25 via `paradedb` (epic D6 fallback only if quality
  regresses); `timestamptz`/`jsonb`/`CREATE TYPE` enum cleanups (deferred).
- Removing `translatePlaceholders` — blocked on porting `chats.ts` raw-`?` SQL (not this phase).
- P-pg-5 `pg_dump`/`pg_restore`; P-pg-6 OPFS→PG importer; P-pg-7 OPFS/WASM/COEP removal + full doc rewrite.
- Folding the sandbox SQLite into PG (separate epic, D11).
