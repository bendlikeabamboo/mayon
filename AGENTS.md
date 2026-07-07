# AGENTS.md

Guidance for AI agents (and humans) working in this repo. The authoritative
design source is `docs/dev/architecture.qmd` (rendered in the Quarto docs site).
Historical design notes live in `refinement/`. The active implementation plan lives
in `.kilo/plans/`.

## Stack

- **SvelteKit** (Svelte 5 runes) as a static SPA via `@sveltejs/adapter-static` (no SSR).
- **Tauri v2** desktop shell (thin: window + native SQLite only at this stage).
- **Tailwind v4** (CSS-first, `@import "tailwindcss"`) + **shadcn-svelte** (bits-ui).
- **SQLite** everywhere via one shared **drizzle** schema behind a single
  `StorageDriver` seam (browser = sqlite-wasm + OPFS in a worker; desktop = Tauri SQL
  plugin; tests = in-memory sql.js).
- **Toolchain pins:** Node 22 (`.nvmrc`), pnpm 10 (`packageManager`), Rust 1.95
  (`rust-toolchain.toml`). No bun.

## Commands

| Command                  | What it does                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | Install dependencies.                                                                                                      |
| `pnpm dev`               | Run the SvelteKit SPA dev server (http://localhost:5173).                                                                  |
| `pnpm tauri dev`         | Run the Tauri desktop shell (boots `pnpm dev` internally, opens a window).                                                 |
| `pnpm tauri:dev`         | Run the Tauri desktop shell (`tauri dev`; boots `pnpm dev` internally).                                                    |
| `pnpm tauri:build`       | Build signed desktop installers (`tauri build`). Needs `TAURI_SIGNING_PRIVATE_KEY` env for updater-signed artifacts.       |
| `pnpm tauri:icon`        | Regenerate the full icon set in `src-tauri/icons/` from a source PNG (`tauri icon <src.png>`).                             |
| `pnpm build`             | Build the SPA into `build/` (consumed by Tauri as `frontendDist`).                                                         |
| `pnpm check`             | Type-check with `svelte-check`.                                                                                            |
| `pnpm lint`              | ESLint (flat config) + Prettier `--check`.                                                                                 |
| `pnpm format`            | Prettier `--write`.                                                                                                        |
| `pnpm test`              | Vitest (in-memory driver) — run once.                                                                                      |
| `pnpm test:watch`        | Vitest in watch mode.                                                                                                      |
| `pnpm db:generate`       | Generate a new drizzle migration from `src/lib/db/schema.ts` into `drizzle/`.                                              |
| `pnpm db:studio`         | Open Drizzle Studio against the schema.                                                                                    |
| `pnpm bundle:migrations` | Re-bundle `drizzle/` SQL + journal into `src/lib/db/driver/migrations.ts` (run after every `db:generate` before shipping). |

Always run `pnpm bundle:migrations` after `pnpm db:generate` so the SPA can run the
new migration offline (no runtime `fs`).

### Tauri on Linux — system dependencies

Building/running the desktop shell on Debian/Ubuntu needs the GTK/WebKit dev libs:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

Without these `cargo`/`tauri build` cannot link. macOS/Windows need only the standard
toolchains.

The OS keychain (`keyring` crate) needs a running Secret Service implementation on Linux —
install/run `gnome-keyring` (or `kwallet`) and `libsecret-1-0`. Without it, `key_set` /
`key_has` / `key_delete` surface a clear error instead of silently failing; key-dependent
providers won't work until a secret service is available (the browser/IndexedDB path is
unaffected).

## Architecture boundaries (do not violate)

- **Components/stores call repositories only** — never import `db` directly. The drizzle
  `db` object is private to `src/lib/db/` (exposed via `getDb()` / `repos`).
- **`StorageDriver`** (`src/lib/db/driver/types.ts`) is the single storage seam:
  `query` / `batch` / `exec`. Drizzle + schema + repositories live on the main thread;
  drivers are dumb SQL executors (the OPFS worker literally just runs SQL over `postMessage`).
- **Runtime selection** happens in `src/lib/db/driver/client.ts` via `isTauri()`.
- **No secrets in `settings`.** Provider config holds non-secret handle fields only; API
  keys are a P1 concern (desktop keychain / browser IndexedDB).
  > **P5 (resolved):** secure storage shipped. API keys now live in the OS keychain on
  > desktop (resolved in Rust via the `keyring` crate; the plaintext never enters the
  > webview) and in IndexedDB in the browser. A one-time `migrateLegacyKeys()` boot step
  > moves any legacy `providerKey:<id>` rows out of `settings` into the runtime key store.

## Manual acceptance gates (P0)

There is no chat UI in P0 (lands in P2). The observable persistence signal is the
**theme toggle** (persisted to the `settings` KV) plus the **dev self-check**
(`DbStatus` badge). The self-check is dev-only (`import.meta.env.DEV`): on each boot it
writes/reads/deletes a `chats` row via the repository and shows pass/fail.

- **Browser (OPFS):** `pnpm dev` → open http://localhost:5173 → the header badge reaches
  **DB ready** (`browser`) and (in dev) self-check passes; toggle the theme and **reload
  the tab** → the theme survives (proving OPFS persistence). Storage lives in the origin's
  OPFS as `file:mayon.sqlite`.
- **Desktop (native SQLite):** `pnpm tauri dev` → same flow; storage is the
  `sqlite:mayon.db` file in the Tauri app-data dir, which persists across app restarts.
- **First-run/empty DB:** migrations run clean in both runtimes (covered by the automated
  Vitest suite against the in-memory driver).
- **Unsupported browser:** if OPFS is unavailable, the badge shows a clear **DB error**
  with a "use the desktop app" message (never silent).

> The desktop build needs the GTK/WebKit dev libs (above). It cannot be compiled or run
> in the headless CI sandbox; verify it on a real machine.

## Manual acceptance gates (P1)

P1 delivers the provider/AI layer: configure a provider, persist its config + key,
and stream a real reply. The `/chat` route is an **ephemeral streaming demo** (no
persistence — the real chat lands in P2); `/settings` has the provider config UI.

- **Browser:** `pnpm dev` → open `/settings` → **Add provider** → pick a template
  (Z.AI/GLM is OpenAI-compatible and the default; OpenRouter and Kilo Gateway are
  OpenAI-compatible gateways; OpenAI, Anthropic, Gemini, and a local Ollama server
  are also available) → edit base URL / default model if needed → paste the
  **API key** → **Save key** → **Set active**. The gateways (OpenRouter / Kilo
  Gateway / Z.AI) auto-discover their model catalog via the `/models` endpoint and
  offer a searchable model picker; **Reload the tab** → the provider config and key
  survive (proving settings-KV persistence). Then go to `/chat`, type a prompt, and
  tokens stream in live.
- **Desktop:** `pnpm tauri dev` → same flow → key + config survive an **app restart**.
- **Provider switch:** add a second provider, **Set active** to it, stream again.
- **CORS fallback (best-effort):** configure Anthropic in the browser; if the provider
  blocks the request, `/chat` shows the **"use the desktop app"** notice (from
  `formatProviderError` on a `CorsBlockedError`) rather than a raw error.

> The streaming transport, adapters, error mapping, and context assembly are covered by
> the automated Vitest suite (`pnpm test`). Provider keys are never echoed back in the
> UI after save (the key field is masked with a "replace key" affordance).

## Manual acceptance gates (P5)

P5 ships the installable, offline, secure desktop shell: a Rust LLM transport (no CORS, no
key in the webview), OS-keychain key storage, hardened native SQLite (WAL), auto-update,
single-instance, and strict CSP. The browser runtime is unchanged in behavior.

- **Installable + offline:** `pnpm tauri:build` → produces an installer; install it, then run
  **fully offline** (network off) → app boots, chats/labs/quizzes load (native SQLite WAL),
  and the theme persists.
- **Secure key storage:** add a provider + key in Settings → the key is **not** in the
  `mayon.db` `settings` table (inspect with a SQLite client) and **not** in the webview
  (DevTools `invoke` returns only `key_has` booleans, never plaintext). It lives in the OS
  keychain (Keychain Access / Credential Manager / `secret-tool lookup service Mayon`).
  Streaming works for **all** providers including Anthropic (no CORS, no
  `dangerous-direct-browser-access` needed).
- **Migration:** with a pre-P5 DB containing `providerKey:<id>` rows, the first P5 boot moves
  them to the keychain and removes the rows; streaming still works afterward.
- **Streaming + provider switch + abort:** stream a reply; add a second provider, **Set
  active**, stream again; **Stop** aborts cleanly (`llm_stream_cancel` fires).
- **Update:** with a staged signed `latest.json` at a higher version → boot banner →
  download + progress → install → relaunch lands on the new version.
- **Single instance:** launch a second time → focuses the existing window (no second instance
  / DB lock).
- **CSP:** DevTools shows no CSP violations; no cross-origin provider requests (all via
  `invoke`).

> The desktop build needs the GTK/WebKit dev libs + a running secret service on Linux
> (above). It cannot be compiled or run in the headless CI sandbox; verify it on a real
> machine. The transport bridge, keychain wrappers, and migration are covered by the
> automated Vitest suite (`pnpm test`); the real Rust transport/keychain/updater are
> manual/desktop-only gates.

> The updater `endpoints` in `tauri.conf.json` must point at the real GitHub Release
> `latest.json` (currently a placeholder owner/repo). The `TAURI_SIGNING_PRIVATE_KEY` (and
> its password) is an env-only secret (never committed) required for signed releases —
> without it, `pnpm tauri:build` cannot emit updater-signed artifacts.
