# P0 — Foundation & data layer

**Phase:** P0 (entry point; no prior phase).
**Source of truth:** `refinement/architecture.md` (design), `refinement/phased-plan.md` (scope). This
plan is the implementation-ready breakdown of P0. Build against it.

**Goal:** a booting SvelteKit + Tauri skeleton carrying the **full data model**, a
**runtime-agnostic storage abstraction** (`StorageDriver`) that works in browser and desktop, the
typed **repository layer**, and the **settings KV** — all demonstrable in both runtimes.

> This is the "long pole." Getting the storage seam right here pays off in P1–P4.

---

## 1. Resolved decisions (P0-specific)

| Area                 | Decision                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage architecture | ONE shared drizzle schema attached via **`drizzle-orm/sqlite-proxy`** behind a single async **`StorageDriver`** contract (`query`/`batch`). Drizzle + schema + repositories live on the main thread; the worker is a dumb SQL executor. |
| Browser driver       | `@sqlite.org/sqlite-wasm` + **OPFS**, running inside a **Web Worker** (OPFS sync-access handles are worker-only; this is architectural, not optional).                                                                                  |
| Desktop driver       | `@tauri-apps/plugin-sql` (native SQLite), wrapped to the same contract.                                                                                                                                                                 |
| Test driver          | In-memory SQLite (sql.js or `node:sqlite`), same contract — used by Vitest (OPFS unavailable in jsdom/Node).                                                                                                                            |
| Repo layout          | Single SvelteKit app at repo root: `src/` + `src-tauri/` sibling. pnpm as package manager. **No monorepo.** "Workspace" wording in phased plan = pnpm, not packages.                                                                    |
| Migrations           | `drizzle-kit generate` → bundle SQL + journal into the SPA → run via the proxy migrator on first boot.                                                                                                                                  |
| Runtime selection    | Detect Tauri at runtime (`isTauri()`) to pick the driver during bootstrap.                                                                                                                                                              |
| Settings KV scope    | Persist provider **config** (`label`/`baseUrl`/`model`) + `theme`. **No API keys** (P1 — desktop keychain, browser IndexedDB).                                                                                                          |
| Tauri wrapper scope  | Boot + SQL plugin only. **No Rust LLM transport** (that is P1).                                                                                                                                                                         |
| Lint/format          | ESLint flat config + Prettier (`prettier-plugin-svelte`, `eslint-plugin-svelte`) + `svelte-check`.                                                                                                                                      |
| Testing              | Vitest (in-memory driver) for repositories/migrations + a boot-time **self-check**.                                                                                                                                                     |
| CI                   | **Deferred to P5** (phased plan). P0 keeps local `lint`/`test`/`check` green.                                                                                                                                                           |
| Toolchain            | Pin exact: **pnpm 10, Node 22, Rust 1.95** via `packageManager` / `.nvmrc` / `rust-toolchain.toml`.                                                                                                                                     |

**Decided (not to relitigate):** components/stores call **repositories only**, never `db` directly;
drizzle `db` object is private to the `lib/db` boundary. Each runtime uses its **own** driver (Tauri
webview origin ≠ browser origin is fine because they never share a DB file).

---

## 2. Target structure (to be created)

```
mayon/
  src/
    app.html, app.css, app.d.ts, hooks.client.ts
    lib/
      db/
        schema.ts               # ALL tables (drizzle) — see §4
        drizzle.config is at repo root
        driver/
          types.ts              # StorageDriver interface
          proxy.ts              # drizzle() factory over a driver
          migrator.ts           # bundle + run migrations on boot
          migrations.ts         # GENERATED: bundled SQL + journal
          opfs-worker.ts        # browser: sqlite-wasm + OPFS
          tauri.ts              # desktop: plugin-sql wrapper
          memory.ts             # tests: in-memory
          client.ts             # bootstrap: createDriver() by isTauri()
        repositories/           # chats, messages, branch_sources, cross_links,
                               #   labs, quizzes(+questions/attempts/answers), settings
        index.ts                # public exports: getDb(), repositories
      components/ui/            # shadcn-svelte primitives
      components/               # AppShell, Sidebar, ThemeToggle, DbStatus (self-check badge)
      stores/                   # theme.svelte.ts (+ db-ready state)
    routes/
      +layout.svelte, +page.svelte
      chat/+page.svelte, lab/+page.svelte, quiz/+page.svelte,
      tree/+page.svelte, settings/+page.svelte   # placeholder shells
  src-tauri/
    src/main.rs, lib.rs         # plugin-sql registered; window only
    Cargo.toml, tauri.conf.json, build.rs, capabilities/default.json, icons/
  drizzle/                      # GENERATED migration output
  drizzle.config.ts
  package.json, pnpm-lock.yaml, .nvmrc, tsconfig.json,
  svelte.config.js, vite.config.ts, tailwind (v4, CSS-first)
  eslint.config.js, .prettierrc, .prettierignore
  rust-toolchain.toml
  AGENTS.md
```

> Exact filenames may vary by scaffolder output; the **boundaries** (`db/driver`,
> `db/repositories`, `components`) are what matter.

---

## 3. Ordered tasks

Each task ends with its own mini-acceptance so progress is verifiable incrementally.

### Task 1 — Scaffold + toolchain + hygiene

- Scaffold SvelteKit (Svelte 5, TypeScript) in SPA/static mode (`@sveltejs/adapter-static`),
  pnpm. Add `src-tauri/` (Tauri v2) and wire `pnpm tauri dev` to the SvelteKit dev server.
- Replace the **Python `.gitignore`** with a Node/Rust/SvelteKit-appropriate one
  (node_modules, build/`dist`, `.svelte-kit`, `src-tauri/target`, OPFS/`.tauri`, env).
- Pin toolchain: `packageManager: pnpm@10`, `.nvmrc` → 22, `rust-toolchain.toml` → 1.95.
- Add `engines` to `package.json`. Create `AGENTS.md` (see §6 for required commands).
- **Acceptance:** `pnpm install` clean; `pnpm dev` serves the SPA; `pnpm tauri dev` opens a window
  showing the SPA. Repo has no Python-template leftovers.

### Task 2 — UI stack + app shell

- Install/config **Tailwind v4** (CSS-first `@import "tailwindcss"` in `app.css`) +
  **shadcn-svelte** (bits-ui) + **lucide-svelte**.
- Build `AppShell` (collapsible sidebar + content region), placeholder routes
  `/chat /lab /quiz /tree /settings`, and a `ThemeToggle` (light/dark/system).
- `theme` persisted to the settings KV once Task 6 lands (for now, local store; wire to KV in Task 6).
- **Acceptance:** navigating between routes works in both runtimes; theme toggle reflects and
  (after Task 6) survives reload. `pnpm check` (svelte-check) green.

### Task 3 — Schema + migration generation

- Implement `src/lib/db/schema.ts` with **all** tables from `architecture.md` §5.1: `chats`,
  `messages`, `branch_sources`, `cross_links`, `labs`, `quizzes`, `quiz_questions`,
  `quiz_attempts`, `quiz_answers`, `settings`.
- drizzle encoding conventions: IDs = `text` UUIDs; timestamps = epoch-ms `integer`; JSON columns
  (`labs.checklist`, `quiz_questions.payload`) = `text` (app parses); enums (`role`,
  `quiz_questions.type`) = `text` with a string-union type.
- `drizzle.config.ts` (dialect sqlite, schema path, out `./drizzle`). Run `drizzle-kit generate`
  to produce migration #0 (create-all).
- **Acceptance:** `pnpm db:generate` emits a single first migration whose SQL matches the spec;
  schema compiles and type-checks.

### Task 4 — StorageDriver interface + proxy + migrator bundling

- `driver/types.ts`: the contract:
  ```ts
  interface StorageDriver {
  	query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  	batch(stmts: { sql: string; params?: unknown[] }[]): Promise<{ rows: unknown[] }[]>;
  	exec(sql: string): Promise<void>;
  }
  ```
- `driver/proxy.ts`: `createDb(driver, schema)` → `drizzle({ schema, mode: 'default',
remoteCallback: (sql, params) => driver.query(...), batchRemoteCallback: (b) => driver.batch(...) })`
  (confirm exact proxy options against the pinned drizzle version).
- `driver/migrator.ts` + build step: bundle `drizzle/**/*.sql` (raw) + `drizzle/meta/_journal.json`
  into `driver/migrations.ts`; expose `runMigrations(db)` that feeds them to the proxy migrator.
- **Acceptance:** `createDb` returns a schema-aware drizzle instance; migration bundling produces a
  static module importable by the SPA (no runtime `fs`).

### Task 5 — Three drivers + bootstrap

- `opfs-worker.ts`: Web Worker loading `@sqlite.org/sqlite-wasm`, opens an OPFS-backed DB
  (e.g. `file:mayon.sqlite?vfs=opfs`), implements `StorageDriver` over `postMessage`.
  Main-thread bridge owns the `MessageChannel`/port and exposes the async `query/batch/exec`.
- `tauri.ts`: wraps `@tauri-apps/plugin-sql` `Database.load("sqlite:mayon.db")` → `select/execute`,
  mapping to `query/batch/exec`.
- `memory.ts`: in-memory SQLite for tests.
- `client.ts`: `createDriver()` returns OPFS-worker driver or Tauri driver via `isTauri()`;
  `bootstrapDb()` runs migrations then resolves the drizzle `db` + repositories.
- Wire bootstrap into `hooks.client.ts` (or `+layout.ts`); surface a "DB initializing/ready/error"
  state consumed by the shell + a `DbStatus` badge.
- **Acceptance:** on boot in **both** runtimes, migrations run and the app reaches DB-ready state;
  a failure shows a clear, non-silent error in the UI.

### Task 6 — Repository layer + settings KV

- Implement typed repositories over drizzle for every table (CRUD + the ordering/tree helpers that
  P0 can already encode: e.g. `chats` create root/child, `messages` append by `ord`, `settings`
  get/set JSON by key). Keep `assembleContext` for P1/P2 but the tree-walk primitives may be stubbed.
- `settings` KV: typed `getSetting<T>(key)` / `setSetting(key, value)` (JSON in/out). Seed defaults:
  `{ providers: {} }`, `theme`. Wire `ThemeToggle` to persist here.
- **Acceptance:** repositories are the only consumers of `db`; `pnpm check` green; toggling theme
  persists across reload in both runtimes.

### Task 7 — Self-check + tests + docs

- Boot-time self-check (dev/gated): after bootstrap, insert a `chats` row via the repository, read
  it back, delete it; expose pass/fail on `DbStatus` + console. This is the "persists across
  restart" demonstration vehicle.
- Vitest suite against `memory.ts`: migrations clean on empty DB; repository write/read `chats`
  (and at least messages + settings); `ord`/ordering behavior.
- Populate `AGENTS.md` with commands: install, `dev`, `tauri dev`, `db:generate`, `db:studio`,
  `check`, `lint`, `format`, `test`; and the **manual acceptance gates** (how to verify
  persistence in browser vs desktop).
- **Acceptance:** `pnpm test`, `pnpm lint`, `pnpm check` all green; self-check passes in both
  runtimes; manual persistence gate documented and run.

---

## 4. Schema notes (encoding specifics)

Full column specs are in `architecture.md` §5.1. Drizzle specifics:

- Foreign keys: `references(() => chats.id)` on `parent_id`, `root_id`, `branch_point_message_id`,
  `chat_id`, `source_message_id`, `branch_chat_id`, `from_chat_id`, `to_chat_id`, `quiz_id`,
  `question_id`, `attempt_id`. Make back-references nullable where the spec says nullable.
- `settings.key` is the **primary key** (`text().primaryKey()`).
- Do not store secrets in `settings` (keys are P1). Provider config holds non-secret handle fields only.

---

## 5. Risks & mitigations

| Risk                                                                       | Mitigation                                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proxy migrator needs `fs`** (won't run as-is in SPA).                    | Bundle migrations via the Task 4 build step; validate the exact migrator API against the pinned drizzle version before coding the bridge.       |
| **OPFS VFS quirks** (origin-scoped, worker-only, partial browser support). | Confine to the worker; feature-detect OPFS, surface a clear "browser unsupported" state if absent; file path per sqlite-wasm OPFS convention.   |
| **drizzle proxy batch semantics** differ from driver.batch.                | Map `batchRemoteCallback` carefully; cover with a Vitest case (multi-statement insert).                                                         |
| **sqlite-wasm + Vite** asset/worker bundling.                              | Use the official `@sqlite.org/sqlite-wasm` distribution; configure Vite `optimizeDeps.exclude` / worker format as needed; verify in `pnpm dev`. |
| **Tauri SQL plugin API drift** (v2).                                       | Pin plugin version; wrap so only `query/batch/exec` touch plugin internals.                                                                     |
| **Wrong DB file location** (native) / OPFS path.                           | Use Tauri app-data dir via plugin (`sqlite:` scheme); document both paths in `AGENTS.md`.                                                       |

---

## 6. Validation / P0 acceptance gates

Automated (must be green): `pnpm install`; `pnpm lint`; `pnpm check` (svelte-check); `pnpm test`
(Vitest, in-memory driver — migrations clean on empty DB + repository write/read `chats`).
Boot (both runtimes): `pnpm dev` and `pnpm tauri dev` initialize the DB and reach DB-ready.
Self-check: boot-time write/read `chats` passes in both runtimes.
**Manual gate (documented in `AGENTS.md`):** write a `chats` row, **restart the runtime**, confirm
the row persists — in browser (OPFS) **and** desktop (native SQLite). Migrations run clean on an
emptied/first-run DB in both runtimes.

---

## 7. Explicitly out of scope for P0

- AI/provider layer, transports, streaming, API-key storage (all P1).
- `assembleContext` full implementation, highlighter, branching UX, tree sidebar (P2).
- Labs/quizzes generation & runners (P3/P4).
- Tauri packaging, auto-update, hardened key storage, CI (P5).
- Cloud sync (future seam).

---

## 8. Open questions to confirm at implementation time

- Exact `drizzle-orm/sqlite-proxy` options + migrator signature for the **pinned** drizzle version
  (proxy + browser bundling approach is settled; the precise call may differ by minor version).
- Whether `@sqlite.org/sqlite-wasm`'s current OPFS API wants `file:…?vfs=opfs` or the worker1
  bootstrap — pin a version and follow its docs.
- Confirm `isTauri()` is exported from `@tauri-apps/api/core` in the pinned v2; else fall back to
  the `'__TAURI_INTERNALS__' in globalThis` check.
- shadcn-svelte + Tailwind v4 + Svelte 5 CLI compatibility at setup time (use current docs).
