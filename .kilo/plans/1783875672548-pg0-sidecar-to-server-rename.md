# Plan — P-pg-0: Rename "sidecar" → "server"

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-0, lines
> 98–127). This file expands that phase into implementation-ready tasks.
> Status: implementation-ready. Authored 2026-07-13.
> Scope: **this plan only**. Phases P-pg-1 … P-pg-7 (Postgres, schema, FTS, boot-gating,
> backup/restore, OPFS→PG importer, dead-code removal, architectural doc rewrite) are
> explicitly out of scope and get their own plans later.

## Goal

Make the codebase say what it means *before* any Postgres logic lands, so the PG work
reads cleanly. A purely mechanical, atomic rename of the optional "sidecar" component to
"server" across code, config, tests, and docs. **Zero behavior change**: no Postgres, no
schema change, no new caps, OPFS remains the sole primary store, the server stays
**optional** (it becomes required only in P-pg-3).

The single source of truth for naming is the terminology table in the parent epic
(`refinement/2026-07-12_postgres-migration-plan.md` §0). Every rename below follows it.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| R1 | Use the §0 **final** names now (one atomic rename, no second pass in P-pg-3). | Avoids re-renaming `SidecarDriver`→`RemotePgDriver` / `sidecar.ts`→`pg.ts` again later. |
| R2 | `SidecarDriver`→`RemotePgDriver` and file `src/lib/db/driver/sidecar.ts`→`pg.ts` despite still backing the **sandbox SQLite** over `/api/db/query` until P-pg-3. | Per §0: "the name describes the *pattern* (remote driver), not the current backing DB." Mitigate the transient lie with a file-header comment. |
| R3 | Rename compose **service** `sidecar`→`server` (safe; nginx hostname follows). **Keep** the volume name `sidecar-data` unchanged. | Renaming a docker volume = data movement = behavior change, violating "zero behavior change." The volume holds only non-critical sandbox scratch data; its rename is deferred to P-pg-7 (which owns cleanup + a documented migration step). |
| R4 | Keep the word **"sandbox"** everywhere it refers to the MCP-tool scratch DB (`sandbox-db.ts`, `sandbox-backup.ts`, `SandboxDbSection.svelte`, `/api/backup/sandbox`, `sandboxDbPath`, the `sandbox-db` cap). | Per §0: "Keep the word 'sandbox' for the MCP-tool scratch DB." Only `sidecar`→`server` is in scope. |
| R5 | Docs (`AGENTS.md`, `README.md`, `docs/dev/architecture.qmd`, `docs/dev/seams.qmd`) get a **mechanical** `sidecar`→`server` pass that preserves every architectural claim verbatim. | Satisfies the "server terminology everywhere" gate without touching architecture. The *architectural* rewrite (OPFS→PG, new gates) is P-pg-7. |
| R6 | No `'pg'` cap is advertised; the caps array stays `['stdio-mcp','llm-proxy','sandbox-db','backup']`. | `'pg'` lands in P-pg-1. Adding it now would be a behavior change. |

## Grounding (verified current state)

- `StorageDriver` seam — `src/lib/db/driver/types.ts:17` (unchanged this phase).
- Boot — `src/routes/+layout.svelte:17` `bootstrapDb()` (OPFS, untouched) and `:32`
  `detectSidecar()` (rename target) run independently.
- Sidecar web dir — `src/lib/sidecar/` holds: `client.ts`, `detect.ts`, `status.svelte.ts`,
  `llm-proxy-fetch.ts`, `sandbox-db.ts`, `sandbox-backup.ts` + tests.
- Status store — `src/lib/sidecar/status.svelte.ts:3` class `SidecarStatusState`, export
  `sidecarStatus` (`:31`); `SidecarCap` import from `@mayon/shared`.
- Probe — `src/lib/sidecar/detect.ts:3` `detectSidecar()`; client `src/lib/sidecar/client.ts:1`
  `SidecarClient` / `sidecarClient`.
- Driver — `src/lib/db/driver/sidecar.ts:4` `createSidecarDriver()` (sandbox-over-HTTP; never
  primary). Test `sidecar.test.ts:23` `describe('SidecarDriver')` + `:87` contract proof.
- MCP stdio transport — `src/lib/mcp/sidecar-stdio.ts:9` `SidecarStdioMcpTransport`; thrown
  string `:36` `'stdio MCP servers require the Mayon sidecar (run: docker compose up)'`.
- Badge — `src/lib/components/SidecarStatus.svelte` (label `Sidecar: connected/off`,
  title `Mayon sidecar capabilities`); imported by `AppShell.svelte:18` and `Sidebar.svelte:14`.
- Error hint — `src/lib/ai/errors.ts:25` `SIDECAR_FALLBACK_HINT` (string mentions "Mayon
  sidecar"); consumed `:51`; asserted `src/lib/ai/errors.test.ts:27`.
- Copy sites — `mcp/templates.ts` (5× "Requires the Mayon sidecar"), `McpServers.svelte`
  (`:559,:569,:1156`), `settings/DataSection.svelte:159`, `mcp/lifecycle.ts:71` log.
- Shared types — `packages/shared/src/protocol.ts:1` `SidecarCap`; re-exported `index.ts:2`.
- Package — `sidecar/package.json:2` `"@mayon/sidecar"`; workspace `pnpm-workspace.yaml:3`;
  root `package.json:31` script `dev:sidecar`; `eslint.config.js:20` ignore `sidecar/dist/`.
- Compose — `docker-compose.yml`: service `sidecar` (`:8`), `depends_on: [sidecar]` (`:6`),
  volume `sidecar-data` (`:15,:18`); `docker/nginx.conf:9,:15` `proxy_pass http://sidecar:4319`.
- Dockerfile — `sidecar/Dockerfile` references `@mayon/sidecar` at `:10,:14,:19` and
  `sidecar/{package.json,src,dist}` paths.
- Server internals — `sidecar/src/server.ts:48` log `'sidecar listening on'`, `:53`
  `'Failed to start sidecar:'`; `server.test.ts:5` `describe('sidecar server')`.
  (`mcp.ts`/`llm-proxy.ts`/`db.ts`/`backup.ts`/`version.ts` have **no** sidecar strings.)

## Hard rules (non-negotiable this phase)

- **Zero behavior change.** No PG, no schema, no new caps, no boot-gating change, no
  removed code. OPFS stays sole primary; server stays optional.
- **Pure rename.** A reviewer must be able to confirm logic is unchanged via
  `git diff --diff-filter=R` + a no-op logic diff. One PR (or a small stack of
  rename-only commits).
- **Keep "sandbox".** Do not rename sandbox-named files/identifiers/strings/caps.
- **No secrets moved.** Nothing about the `KeyStore`/IndexedDB changes.

## Prerequisite (verify before merging)

`refinement/2026-07-12_notes_on_use.md` reports the server Docker image fails at runtime
with `Cannot find package 'fastify'` (from the `pnpm deploy --prod --legacy` step in
`sidecar/Dockerfile:19`). This blocks the final `docker compose up` acceptance gate. Since
this phase rewrites Dockerfile paths anyway, **confirm the image builds and starts**; if
`pnpm deploy --prod --legacy` still drops prod deps (`fastify`, `better-sqlite3`), fix the
deploy step (e.g. drop `--legacy`, or copy a complete `node_modules`). This fix is in
scope for this phase because the rename changes the build context.

---

## Tasks

> Order is a suggested dependency sequence, but most are independent. `git mv` for file
> moves so history is preserved. After all edits: `pnpm install` (regenerates lock), then
> the verification block.

### T1 — Package, directory & Docker rename
- `git mv sidecar server`.
- `server/package.json`: `"name": "@mayon/sidecar"` → `"@mayon/server"`.
- `pnpm-workspace.yaml`: `'sidecar'` → `'server'`.
- Root `package.json`: script `"dev:sidecar"` → `"dev:server"` (`pnpm --filter @mayon/server dev`).
  Leave `pnpm.onlyBuiltDependencies` (`better-sqlite3`) unchanged.
- `server/Dockerfile`: `COPY sidecar/package.json sidecar/`→`COPY server/package.json server/`;
  `COPY sidecar sidecar`→`COPY server server`; `--filter @mayon/sidecar`→`@mayon/server`
  (`:10,:14,:19`); `COPY .../sidecar/dist`→`server/dist` (`:27`). **Verify/fix prod-dep
  shipping** (see Prerequisite).
- `docker-compose.yml`: service `sidecar:`→`server:`; `build.dockerfile: sidecar/Dockerfile`
  →`server/Dockerfile`; `depends_on: [sidecar]`→`[server]`; **keep** volume `sidecar-data`
  (referenced unchanged at `:15,:18`); `expose: '4319'` unchanged.
- `docker/nginx.conf`: `proxy_pass http://sidecar:4319`→`http://server:4319` (`:9` and `:15`).
- `eslint.config.js:20`: `'sidecar/dist/'`→`'server/dist/'`.
- `pnpm-lock.yaml`: regenerated by `pnpm install` (do not hand-edit).

### T2 — Shared protocol types
- `packages/shared/src/protocol.ts`: `export type SidecarCap` → `ServerCap` (`:1`) and its
  use in `HealthResponse.caps` (`:5`). Shape unchanged.
- `packages/shared/src/index.ts`: re-export `ServerCap` (was `SidecarCap`, `:2`).

### T3 — Web dir `src/lib/sidecar/` → `src/lib/server/` + core identifiers
- `git mv src/lib/sidecar src/lib/server`.
- `src/lib/server/status.svelte.ts`: class `SidecarStatusState`→`ServerStatusState`; export
  `sidecarStatus`→`serverStatus`; `SidecarCap`→`ServerCap` (import + the two type sites).
- `src/lib/server/detect.ts`: `detectSidecar`→`detectServer`.
- `src/lib/server/client.ts`: class `SidecarClient`→`ServerClient`; export
  `sidecarClient`→`serverClient`.
- `src/lib/server/llm-proxy-fetch.ts`: `sidecarStatus`→`serverStatus` (import `:1` + usage `:36`).
- `src/lib/server/sandbox-db.ts`: `sidecarClient`→`serverClient`; error string
  `'sidecar DB request failed'`→`'server DB request failed'` (`:11`). **Keep filename.**
- `src/lib/server/sandbox-backup.ts`: `sidecarClient`→`serverClient`, `sidecarStatus`→
  `serverStatus`; `'Sidecar backup cap not available'`→`'Server backup cap not available'`
  (`:14,:24`). **Keep filename.**
- Update every `$lib/sidecar/...` import → `$lib/server/...` in: `routes/+layout.svelte`,
  `routes/settings/+page.svelte`, `ai/http-transport.ts`, `ai/sdk-fetch.ts`,
  `mcp/sidecar-stdio.ts` (→renamed in T4), `mcp/lifecycle.ts`, `mcp/client-factory.ts`,
  `components/settings/DataSection.svelte`, `components/settings/SandboxDbSection.svelte`,
  `components/mcp/McpServers.svelte`, `components/SidecarStatus.svelte` (→renamed in T6),
  `db/driver/sidecar.ts` (→renamed in T5), and all their tests (T9).

### T4 — MCP stdio transport
- `git mv src/lib/mcp/sidecar-stdio.ts src/lib/mcp/server-stdio.ts`;
  `git mv src/lib/mcp/sidecar-stdio.test.ts src/lib/mcp/server-stdio.test.ts`.
- class `SidecarStdioMcpTransport`→`ServerStdioMcpTransport`.
- imports `$lib/sidecar/{client,status.svelte}`→`$lib/server/{client,status.svelte}`;
  `sidecarClient`→`serverClient`, `sidecarStatus`→`serverStatus`.
- thrown string `'stdio MCP servers require the Mayon sidecar (run: docker compose up)'`→
  `'… Mayon server (run: docker compose up)'` (`:36`).
- `mcp/client-factory.ts`: import `SidecarStdioMcpTransport`→`ServerStdioMcpTransport` from
  `./server-stdio`; same thrown-string update (`:11`); `sidecarStatus`→`serverStatus` + import path.

### T5 — Driver `sidecar.ts` → `pg.ts`
- `git mv src/lib/db/driver/sidecar.ts src/lib/db/driver/pg.ts`;
  `git mv src/lib/db/driver/sidecar.test.ts src/lib/db/driver/pg.test.ts`.
- export `createSidecarDriver`→`createRemotePgDriver`.
- import `$lib/sidecar/client`→`$lib/server/client`; `sidecarClient`→`serverClient`.
- error string `'sidecar DB request failed'`→`'server DB request failed'` (`:13`).
- **Add file-header comment** (R2): until P-pg-3 this driver still backs the sandbox SQLite
  over `POST /api/db/query`; the `RemotePgDriver`/`pg.ts` name reflects the target
  architecture, not the current backing store.
- `pg.test.ts`: `describe('SidecarDriver'…)`→`describe('RemotePgDriver'…)` (`:23,:87`);
  `createSidecarDriver`→`createRemotePgDriver`; local var `sidecarDriver`→`remotePgDriver`;
  import path `$lib/db/driver/sidecar`→`$lib/db/driver/pg`.

### T6 — Status badge component
- `git mv src/lib/components/SidecarStatus.svelte src/lib/components/ServerStatus.svelte`.
- import `$lib/sidecar/status.svelte.js`→`$lib/server/status.svelte.js`; `sidecarStatus`→`serverStatus`.
- labels: `Sidecar: v…`→`Server: v…`, `Sidecar: connected`→`Server: connected`,
  `Sidecar: off`→`Server: off`.
- title: `Mayon sidecar capabilities: …`→`Mayon server capabilities: …`;
  `Browser-only (run docker compose up for the sidecar)`→`… for the server)`.
- `components/AppShell.svelte:18` and `components/Sidebar.svelte:14`: import
  `SidecarStatus`→`ServerStatus` from `./ServerStatus.svelte`; tags `<SidecarStatus …/>`→`<ServerStatus …/>`.

### T7 — User-facing copy
- `mcp/templates.ts`: 5× `'Requires the Mayon sidecar.'`→`'Requires the Mayon server.'`.
- `components/mcp/McpServers.svelte`: `'Requires sidecar'`→`'Requires server'` (`:569`);
  `'This template requires the Mayon sidecar.'`→`'… Mayon server.'` (`:559`);
  `'Run the Mayon sidecar (<code>docker compose up</code>)…'`→`'Start the Mayon server (…)'` (`:1156`);
  `sidecarStatus`→`serverStatus` + import path (`:33`).
- `components/settings/DataSection.svelte`: `'Back up the sidecar sandbox DB…'`→
  `'Back up the server sandbox DB…'` (`:159`); `sidecarStatus`→`serverStatus` + import path
  (`:6`); `$lib/sidecar/sandbox-backup`→`$lib/server/sandbox-backup` (`:7`).
- `components/settings/SandboxDbSection.svelte`: import paths → `$lib/server/…`;
  `sidecarStatus`→`serverStatus`.
- `mcp/lifecycle.ts`: log `'(sidecar not connected)'`→`'(server not connected)'` (`:71`);
  `sidecarStatus`→`serverStatus` + import path (`:2`).
- `ai/errors.ts`: `SIDECAR_FALLBACK_HINT`→`SERVER_REQUIRED_HINT` (`:25`); string
  `'Run the Mayon sidecar (docker compose up) for CORS-free access'`→
  `'Start the Mayon server (docker compose up) for CORS-free access'` (`:26`); usage `:51`.
- `ai/errors.test.ts`: import `SIDECAR_FALLBACK_HINT`→`SERVER_REQUIRED_HINT` (`:2,:27`).

### T8 — Server package internals + test labels
- `server/src/server.ts`: `console.log('sidecar listening on :…')`→`'server listening on :…'`
  (`:48`); `'Failed to start sidecar:'`→`'Failed to start server:'` (`:53`).
- `server/src/server.test.ts`: `describe('sidecar server', …)`→`describe('server', …)` (`:5`).
  **Caps array stays `['stdio-mcp','llm-proxy','sandbox-db','backup']`** (R6).
- `server/src/{mcp,llm-proxy,db,backup,version}.ts`: verified no sidecar strings — no change.

### T9 — Test assertions on renamed identifiers/strings
Update every test that references a renamed symbol or asserts a renamed string (full list
verified by grep):
- `src/lib/mcp/server-stdio.test.ts` (renamed in T4): `SidecarStdioMcpTransport`→
  `ServerStdioMcpTransport`; mock path `$lib/sidecar/status.svelte`→`$lib/server/status.svelte`
  (`:12`); `sidecarStatus`→`serverStatus`; describe/it labels "sidecar"→"server" (`:60,:125`);
  `toThrow('… Mayon sidecar')`→`'… Mayon server'` (`:133`).
- `src/lib/server/detect.test.ts`: `detectSidecar`→`detectServer`; describe label (`:11`).
- `src/lib/server/sandbox-db.test.ts`: import path; `toThrow('sidecar DB request failed')`→
  `'server DB request failed'` (`:65`).
- `src/lib/server/sandbox-backup.test.ts`: mock path (`:3`); `sidecarStatus`→`serverStatus`;
  `toThrow('Sidecar backup cap not available')`→`'Server backup cap not available'` (`:45,:88`);
  it-label `'PUTs valid SQLite file to sidecar'`→`'… to server'` (`:97`).
- `src/lib/server/llm-proxy-fetch.test.ts`: mock path (`:3`); `sidecarStatus`→`serverStatus`.
- `src/lib/db/driver/pg.test.ts` (T5).
- `src/lib/mcp/client-factory.test.ts`: mock path (`:12`); `sidecarStatus`→`serverStatus`;
  `SidecarStdioMcpTransport`→`ServerStdioMcpTransport` (`:18,:52`); it-labels (`:26,:41`);
  `toThrow('… Mayon sidecar')`→`'… Mayon server'` (`:38`).
- `src/lib/ai/errors.test.ts` (T7).
- `src/lib/ai/http-transport.test.ts`: mock path `$lib/sidecar/status.svelte`→
  `$lib/server/status.svelte` (`:3`); `sidecarStatus`→`serverStatus`.

### T10 — Docs mechanical rename (preserve architecture)
Mechanical `sidecar`→`server` only; **do not** alter any architectural claim (OPFS stays
primary, server stays optional, no PG, no new gates). Deeper rewrite is P-pg-7.
- `AGENTS.md`: `@mayon/sidecar`→`@mayon/server` (commands table `:26,:33` + prose `:116,:143,
  :144,:169,:170`); `dev:sidecar`→`dev:server`; `docker compose restart sidecar`→`restart
  server` (`:161`); badge copy `Sidecar: connected/off`→`Server: connected/off`; "Run the Mayon
  sidecar"→"Start the Mayon server" (`:90,:132,:133`); "the sidecar"→"the server" throughout;
  `SidecarStdioMcpTransport`→`ServerStdioMcpTransport` (`:114`); `SidecarDriver`→`RemotePgDriver`
  (`:167`); `detectSidecar`→`detectServer` (`:50`). **Leave `sidecar-data`** volume name (`:193`)
  and add a one-line note that its rename is deferred to P-pg-7.
- `README.md:20`: "An optional local sidecar"→"An optional local server".
- `docs/dev/architecture.qmd` + `docs/dev/seams.qmd`: `SidecarDriver`→`RemotePgDriver`
  (`seams.qmd:33`); `detectSidecar`→`detectServer` (`seams.qmd:41`); "sidecar"→"server" in
  prose; preserve "optional" framing and the OPFS-primary claim verbatim.

### T11 — Reinstall & verify
- `pnpm install` (regenerates `pnpm-lock.yaml` with `@mayon/server`).
- `pnpm lint && pnpm check && pnpm test` (root) — green.
- `pnpm --filter @mayon/server test` — green.
- `docker compose build && docker compose up` — server starts (resolve the fastify
  prerequisite if still broken); header badge reads **"Server: connected"**; sandbox
  inspector, stdio MCP, HTTP MCP, and LLM CORS proxy behave exactly as before.
- **Grep guard:** `rg -i 'sidecar' -g '!refinement/**' -g '!.kilo/**' -g '!**/pnpm-lock.yaml'`
  returns hits **only** for the intentionally-kept `sidecar-data` volume (in `docker-compose.yml`
  + the `AGENTS.md` deferral note) — everything else is `server`. (`refinement/` historical
  docs are excluded.)

---

## Definition of Done

- `pnpm lint && pnpm check && pnpm test` (root) green.
- `pnpm --filter @mayon/server test` green.
- `docker compose up` → server starts; badge "Server: connected"; no behavioral regression
  (sandbox DB, MCP, LLM proxy, theme persistence all work as before).
- Grep guard passes (only `sidecar-data` + `refinement/` remain).
- Reviewer confirms a no-op logic diff (`git diff --diff-filter=R` shows renames; logic
  diff is empty aside from renamed identifiers/strings).

## Risks

- **Missed reference** → the grep guard + `svelte-check`/`tsc` catch stragglers; the
  `pnpm-lock` regen catches workspace-filter drift.
- **Docker image still broken (fastify)** → blocks the final gate; addressed as the
  Prerequisite. If `pnpm deploy --prod --legacy` cannot ship prod deps, switch the deploy
  step before merging.
- **Transient naming lie** (`RemotePgDriver`/`pg.ts` still backing sandbox SQLite for 3
  phases) → mitigated by the file-header comment added in T5; acceptable per §0.
- **Volume name inconsistency** (`sidecar-data` under service `server`) → documented,
  deferred to P-pg-7; no data loss.
- **Renaming the compose service** changes `docker compose … sidecar` commands → AGENTS.md
  updated in T10; no code impact.

## Out of scope (explicit)

- Anything in P-pg-1 … P-pg-7: Postgres, `pg-core` schema, `pg-proxy`, FTS→`tsvector`,
  `RemotePgDriver` becoming primary, server-required boot gating, `pg_dump`/`pg_restore`
  backup/restore, OPFS→PG importer, test-strategy change, OPFS/WASM/COEP dead-code removal.
- Renaming the `sidecar-data` docker volume (deferred to P-pg-7).
- Any architectural doc rewrite (OPFS→PG claims, new acceptance gates) — P-pg-7.
- The `DbStatus`/OPFS badge and the `dbStatus` store (untouched; the `'server-unreachable'`
  failure mode is P-pg-3).
- Resolving the open epic-wide decisions D2 (JSON `text` vs `jsonb`) and D7 (test strategy)
  — those belong to the P-pg-2 and P-pg-7 plans respectively.
