# Plan — P-pg-3: Boot & gating (server required, full failure UX)

> Parent epic: `refinement/2026-07-12_postgres-migration-plan.md` (Phase P-pg-3, lines 234–276).
> Prerequisite: **P-pg-2 is merged** — verified present in tree:
> `bootstrapDb()` (`src/lib/db/driver/client.ts:33`) already flips to `createRemotePgDriver()` and
> minimally gates on `serverStatus.has('pg')`; the server runs native PG `migrate()` and advertises
> the `'pg'` cap (pool + migrations) via `/api/health`.
> Scope: **this plan only**. P-pg-4 (FTS), P-pg-5 (`pg_dump`/`pg_restore`), P-pg-6 (OPFS→PG
> importer), P-pg-7 (dead-code/docs removal) are out of scope.

## What P-pg-2 left for P-pg-3

P-pg-2 absorbed the driver-wiring the epic assigned to P-pg-3 (forced: a single `pg-core` schema
can't run on OPFS/SQLite). So P-pg-3 shrinks to the four things P-pg-2 explicitly deferred:

1. **Failure UX** — a full-screen "Server unreachable" screen instead of the app shell.
2. **Browser retry** — `bootstrapDb()` currently does a *single* `detectServer()` (1500ms timeout);
   a fresh `docker compose up` frequently hits "server up, `'pg'` cap absent" during PG boot+migrate.
3. **Dev workflow** — `pnpm dev` (vite, proxies `/api`→`:4319`) now *requires* `db`+`server`.
4. **AGENTS.md gate** + a `runtimeLabel('pg')` fix.

## Locked decisions (this phase)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Typed `reason` on the error state.** Add `reason: DbErrorReason \| null` (`'server-unreachable' \| 'generic'`) to `DbStatusState`; `markError(msg, reason='generic')` sets it. Layout gates the fullscreen on `status==='error' && reason==='server-unreachable'`. Existing `'ready'`/`'initializing'`/`'error'` badge branches stay; only the error label/source forks. Single source of truth = `dbStatus`. | User-locked. Minimal branching vs. a 4th status value; preserves the existing badge contract. |
| L2 | **Browser retry = bounded poll 2s × 10 (~20s)** in a new `waitForServerPg()` (`src/lib/server/detect.ts`). Succeeds only when `/api/health` returns `ok` **and** `caps` includes `'pg'`. Covers both "no response" and "up-but-pending" during cold compose boot. | User-locked. Server-side `probePg` already retries the pool 5×500ms; the browser waits out server boot + migration. |
| L3 | **Recovery = manual "Retry" button + background auto-poll (5s)**, both ending in `location.reload()`. In-page re-bootstrap skips the layout's post-boot chain (`seedDefaults`, theme hydrate, `runSelfCheck`), so a reload is the clean recovery. | User-locked. Auto-recovers when the user starts the server; button gives instant feedback. |
| L4 | **Unify the probe into `bootstrapDb()` + add a `Connecting…` screen.** `bootstrapDb()` owns `serverStatus` (`markConnected` on success, `markDisconnected` on failure). Remove `+layout.svelte:32`'s independent `detectServer()` call (currently a 2nd `/api/health` probe). Layout renders by `dbStatus`: `'initializing'`→Connecting fullscreen; `error+server-unreachable`→ServerUnreachable fullscreen; else→`AppShell`. No app-shell flash during the ~20s window. | User-locked. Single probe path; no pages hit `repos` before boot resolves. |
| L5 | **Dev workflow = `dev:deps` npm script + docs, no override file.** `dev:deps` runs `docker compose up -d db server` (named services already skip the `web` build). Document `pnpm dev:deps` then `pnpm dev` in `AGENTS.md` (Commands table + a P-pg-3 gate note). | User-locked. `docker compose up db server` already excludes `web`; an override file adds maintenance for little gain. |
| L6 | **Cleanup = fix `runtimeLabel('pg')` only.** Return `'Postgres'` so the header `<span>` (AppShell.svelte:116, Sidebar.svelte:108) stops rendering empty in the PG world. **Defer** the `DbRuntime` union trim (`'tauri'`/`'browser'` dead values) and all OPFS/WASM/COEP removal to P-pg-7. | User-locked. P-pg-7 owns dead-code removal; this just makes the visible badge honest. |

## Grounding (verified current state)

- `src/lib/db/driver/client.ts:33` `bootstrapDb()` — sets `runtime='pg'`, awaits `detectServer()`,
  `markError('Server/PG unavailable — run docker compose up')` on missing `'pg'`, throws. The
  generic `catch` (client.ts:49) calls `markError(err.message)` with **no reason** — would clobber
  a typed reason (see T1 guard).
- `src/routes/+layout.svelte:17` fires `bootstrapDb().then(seedDefaults/theme/selfCheck).catch(noop)`;
  `:32` **also** calls `detectServer()` independently to populate `serverStatus` → duplicated probe.
- `src/lib/stores/db.svelte.ts` — `DbStatusState` has `status/runtime/error/selfCheck`; `markError(msg)`
  sets `status='error'` + `error`. No `reason` field yet.
- `src/lib/server/detect.ts` — `detectServer()` single-shot, `AbortSignal.timeout(1500)`, returns
  `HealthResponse | null`. Tested in `src/lib/server/detect.test.ts` (fetch-mock pattern to reuse).
- `src/lib/server/status.svelte.ts` — `serverStatus` store: `markConnected({version,caps,sandboxDbPath?})`,
  `markDisconnected(err?)`, `has(cap)`. `HealthResponse` is structurally compatible with `markConnected`.
- `src/lib/components/AppShell.svelte:117` + `Sidebar.svelte:110` render `<DbStatus />` / `<ServerStatus />`
  inside the shell — i.e. only visible once the shell renders. The fullscreen must gate *outside*
  `AppShell` (in `+layout.svelte`).
- `src/lib/components/DbStatus.svelte:33` — the red "Database error" box (with Reload) is the current
  only error surface; rendered inside the shell. Stays as the in-shell badge for `reason==='generic'`.
- No `+error.svelte`; no fullscreen/boot-gate component; no `docker-compose.dev.yml`.
- `src/lib/utils/runtime.ts` — `runtimeLabel('pg')` falls through to `default: ''`.
- `package.json:18` scripts — no `dev:deps`; `dev:server` exists (`pnpm --filter @mayon/server dev`).
- `docker-compose.yml` — `db` (postgres:17-alpine, healthcheck) + `server` (depends_on db healthy,
  `DATABASE_URL`) + `web`. `docker compose up db server` starts only deps.
- `server/src/server.ts:65` — server retries PG via `probePg` (5×500ms) then `runPgMigrations`; `'pg'`
  cap means pool+migrations. No server change needed this phase.
- `vite.config.ts:44` proxies `/api`→`:4319`, `/ws`→`:4319`. `pnpm dev` routes through it.

## Hard rules (non-negotiable this phase)

- **Fullscreen only for `reason==='server-unreachable'`.** `reason==='generic'` falls through to the
  app shell + existing red badge (no new UX fork).
- **No server-side change required** (probePg/migrations/caps already correct from P-pg-2). If a
  server tweak surfaces, stop — it's likely out of scope.
- **Recovery = `location.reload()`.** Do not add in-page re-bootstrap as the recovery path (it skips
  the layout post-boot chain).
- **No OPFS/WASM/COEP removal, no `DbRuntime` union trim, no FTS, no backup, no importer.**
- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green
  (unchanged — no server edits).

---

## Tasks

> Order is a suggested dependency sequence. After all edits: verification block.

### T1 — `dbStatus` typed error reason (`src/lib/stores/db.svelte.ts`)
- Add `export type DbErrorReason = 'server-unreachable' | 'generic';`.
- `DbStatusState`: add `reason = $state<DbErrorReason | null>(null);`.
- `markError(message: string, reason: DbErrorReason = 'generic')` → sets `status='error'`,
  `error=message`, `reason=reason`.
- `markReady(runtime)` → also clears `this.reason = null;` (and `error`, as today).
- (No other consumer breaks: `markError` gains an optional 2nd arg; all current single-arg callers
  default to `'generic'`.)

### T2 — `waitForServerPg()` retry helper (`src/lib/server/detect.ts`)
- New exported `waitForServerPg(opts?: { attempts?: number; delayMs?: number }): Promise<HealthResponse | null>`.
  - Defaults: `attempts = 10`, `delayMs = 2000`.
  - Loop `attempts` times: `const h = await detectServer();` if `h && h.ok && h.caps.includes('pg')`
    → return `h`; else `await sleep(delayMs)`. After the last attempt, return `null`.
  - Reuse `detectServer()` (which already has the 1500ms `AbortSignal.timeout`); do **not** widen the
    per-attempt timeout here.
  - Add a tiny `sleep` (private) — `new Promise((r) => setTimeout(r, ms))`.
- Keep `detectServer()` exported/unchanged (the background poll in T5 reuses it).

### T3 — `bootstrapDb()` owns the probe + retry + typed reason (`src/lib/db/driver/client.ts`)
- `bootstrapDb()` body (`driverPromise` IIFE):
  - `const { waitForServerPg } = await import('$lib/server/detect');`
  - `const { serverStatus } = await import('$lib/server/status.svelte');`
  - `const health = await waitForServerPg();`
  - **If `!health`:** `serverStatus.markDisconnected();` `dbStatus.markError('<msg>',
    'server-unreachable');` then `throw new Error('<msg>')`. Message =
    `'Cannot reach the Mayon server. Start it with `docker compose up`, then retry.'`.
  - **Else (health present, and `'pg'` guaranteed by `waitForServerPg`):**
    `serverStatus.markConnected(health);` then `const driver = createRemotePgDriver();` and
    `return await bootstrapWithDriver(driver, runtime);`.
  - **Catch guard (critical):** in the `catch`, only call `dbStatus.markError(...)` (default
    `'generic'`) **if `dbStatus.status !== 'error'`** — otherwise the typed `'server-unreachable'`
    reason set moments earlier gets clobbered by `'generic'`. Always reset `driverPromise = null` and
    rethrow.
- Remove the now-redundant inline `detectServer()` import/call (replaced by `waitForServerPg`).

### T4 — Layout: boot gate + `Connecting…` + `Server unreachable` (`src/routes/+layout.svelte`)
- Remove the standalone `detectServer().then(...)` block (`:32`) — `bootstrapDb()` now drives
  `serverStatus`. Keep the `bootstrapDb().then(seedDefaults → theme → selfCheck).catch(noop)` chain.
- Replace `<AppShell>{@render children()}</AppShell>` with a boot gate:
  - `connecting = $derived(dbStatus.status === 'initializing')`
  - `unreachable = $derived(dbStatus.status === 'error' && dbStatus.reason === 'server-unreachable')`
  - `{#if connecting}` → `<BootGate variant="connecting" />`
  - `{:else if unreachable}` → `<BootGate variant="unreachable" />` (reads `dbStatus.error` +
    `serverStatus.connected` to tailor the headline)
  - `{:else}` → `<AppShell>{@render children()}</AppShell>` (covers `ready` and `reason==='generic'`)
- Keep the `bootstrapDb()` fire-and-forget at module top-level so first paint is the Connecting screen.

### T5 — `BootGate.svelte` (`src/lib/components/BootGate.svelte`, new)
- Props: `variant: 'connecting' | 'unreachable'`.
- Fullscreen (`fixed inset-0 grid place-items-center bg-background`), centered card, consistent with
  the app's Tailwind tokens + `Button` (shadcn-svelte) + lucide icons.
- **`connecting`:** spinner (`Loader2`, animate-spin) + "Connecting to the Mayon server…" + muted
  "Waiting for the database to come online."
- **`unreachable`:**
  - Headline tailors on `serverStatus.connected`:
    - `false` → "Cannot reach the Mayon server."
    - `true` → "Database not ready." (server up, `'pg'` cap absent)
  - Body: the `docker compose up` one-liner in a `<code>` block, plus `dbStatus.error` (muted).
  - **Manual "Retry" button** → `location.reload()`.
  - **Background auto-poll:** `onMount` starts `setInterval(5000)` calling `detectServer()`; if it
    returns health with `caps.includes('pg')` → `location.reload()`. `onDestroy` (or `onMount` return)
    clears the interval. Guard against firing after unmount/reload.
  - Import `detectServer` from `$lib/server/detect` (single-shot, not the 20s waiter — lighter tick).

### T6 — `runtimeLabel('pg')` (`src/lib/utils/runtime.ts`)
- `case 'pg': return 'Postgres';` (and keep the others as-is — union trim is P-pg-7).

### T7 — Dev workflow (`package.json`, `AGENTS.md`, `README.md`)
- `package.json` `scripts`: add `"dev:deps": "docker compose up -d db server"`.
- `AGENTS.md`:
  - **Commands table:** add `pnpm dev:deps` row — "Start db + server in Docker (deps for `pnpm dev`)."
  - **New "Manual acceptance gates (P-pg-3)" section** (mirror the P-pg-2 block's format):
    - `docker compose up` → app boots past `Connecting…` to the shell; badge "Server: connected" /
      "DB ready (pg)"; theme toggle persists; dev self-check passes.
    - `docker compose stop server` → reload → **full-screen "Server unreachable"** with the
      `docker compose up` hint + working Retry; background auto-poll recovers after `docker compose
      start server` (reload fires automatically).
    - `docker compose stop db` (keep server up) → reload → fullscreen "Database not ready" variant
      (server connected, `'pg'` absent); recovers when db is healthy again.
    - Dev loop: `pnpm dev:deps` then `pnpm dev` → SPA works against the Dockerized server+pg via the
      vite `/api` proxy.
  - Update the P-pg-2 "Server-down" line (AGENTS.md:59) — strike "(full-screen "Server unreachable"
    UX is P-pg-3)" and point to the new P-pg-3 section.
- `README.md`: if the dev/quickstart section implies `pnpm dev` is standalone, add the
  `pnpm dev:deps` prerequisite (one line). (Only if such a claim exists — verify before editing.)

### T8 — Tests
- `src/lib/server/detect.test.ts`: add a `describe('waitForServerPg')` suite (reuse the file's
  `fetch` mock pattern):
  - returns health when a `'pg'`-bearing response arrives on attempt N < attempts.
  - returns `null` when responses never include `'pg'` within `attempts` (use small `attempts`/`delayMs`
    to keep the test fast, e.g. `attempts: 2, delayMs: 10`).
  - returns `null` when `fetch` always rejects (server down).
- New `src/lib/stores/db.test.ts`: `markError(msg, 'server-unreachable')` sets `reason` to
  `'server-unreachable'`; `markError(msg)` defaults to `'generic'`; `markReady('pg')` clears `reason`
  to `null`. (Cheap, pins the L1 contract the layout depends on.)
- No Svelte component test (the repo has no component-test harness); `BootGate` logic stays trivial
  and is covered by the manual gate + the store/detect unit tests.

### T9 — Verify
- `pnpm check` — no type errors (new `DbErrorReason`, `BootGate` props, `reason` reads).
- `pnpm lint && pnpm check && pnpm test` (root) — green (new detect/db tests pass; no server edits).
- `pnpm --filter @mayon/server test` — green (unchanged).
- `docker compose up`:
  - Fresh boot: brief `Connecting…` screen → shell; badge **Server: connected** / **DB ready (pg)**;
    theme toggle persists across reload; dev self-check passes.
  - `docker compose stop server` → reload → **full-screen "Cannot reach the Mayon server."** with the
    `docker compose up` hint; **Retry** reloads; `docker compose start server` → background poll
    auto-reloads into the app.
  - `docker compose stop db` (server up) → reload → **"Database not ready."** variant; recovers when
    `db` is healthy again.
  - Dev loop: `pnpm dev:deps && pnpm dev` → http://localhost:5173 works (DB via the `/api` proxy).
- Grep guards:
  - `rg "detectServer\(\)\.then" src/routes` → no hits (the independent layout probe is gone).
  - `rg "reason === 'server-unreachable'" src/routes` → the layout gate present.

---

## Definition of Done

- `dbStatus` carries a typed `reason`; the layout renders `Connecting…` / `Server unreachable` /
  `AppShell` off it. `bootstrapDb()` retries via `waitForServerPg()` (2s×10) and owns `serverStatus`.
- `BootGate.svelte` fullscreen with tailored headlines, manual Retry, and a 5s background auto-poll;
  all recovery paths `location.reload()`.
- `runtimeLabel('pg')` → `'Postgres'`; `dev:deps` script + `AGENTS.md` P-pg-3 gate + Commands row;
  P-pg-2 "Server-down" note updated.
- `pnpm lint && pnpm check && pnpm test` (root) green; `pnpm --filter @mayon/server test` green.
- Manual acceptance (T9) passes for fresh boot, server-down, db-down, and the `pnpm dev:deps` +
  `pnpm dev` loop.

## Risks

- **`bootstrapDb` catch clobbers the typed reason.** Mitigation: T3 guard (`markError` in catch only
  if `status !== 'error'`). Covered by the db store unit test.
- **`waitForServerPg` false-negatives on slow cold boot** (>20s). Mitigation: 20s covers server boot
  + `probePg` (2.5s) + migrations for a personal DB; the background poll + Retry cover the long tail.
  Tunable via opts if observed.
- **Background poll fires after unmount/reload** (double reload / leaked timer). Mitigation: T5
  clears the interval on destroy and guards the reload.
- **`location.reload()` loop** if the server flaps. Mitigation: reload only triggers on a confirmed
  `'pg'`-bearing health in the background poll; the 20s waiter prevents rapid re-fail flashing.
- **App-shell flash before `bootstrapDb` resolves.** Mitigation: `dbStatus` starts at
  `'initializing'` → `Connecting…` renders on first paint (T4 gate runs before any repo call).
- **Over-editing the server.** Mitigation: hard rule — no server change this phase; `probePg`/caps
  are already correct.

## Out of scope (explicit)

- P-pg-4: FTS (`tsvector`/GIN/`ts_headline`), real `search.ts`, removing `translatePlaceholders`.
- P-pg-5: `pg_dump -Fc` / `pg_restore` app-DB backup/restore (the suspended `backup.ts` stub stays).
- P-pg-6: OPFS→PG importer.
- P-pg-7: `DbRuntime` union trim, OPFS/WASM/`sql.js`/COEP removal, `sidecar-data` volume rename,
  full architectural doc rewrite.
- Server-side retry/caps/migration changes (already correct from P-pg-2).
- A dev compose *override* file (L5 — `dev:deps` script + docs instead).
