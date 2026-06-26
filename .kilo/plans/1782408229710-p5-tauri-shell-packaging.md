# P5 — Tauri shell & packaging

Ship an installable, offline, secure desktop app: a Rust LLM transport (no CORS, no
key in the webview), OS-keychain key storage, hardened native SQLite, auto-update,
real branding/packaging, and minimal CI. The browser runtime is unchanged in behavior.

Spec: `refinement/architecture.md` §2 (transport/key tradeoffs), §6 (Rust reqwest via
commands + event channels; key in OS keychain), `refinement/phased-plan.md` P5.

## State of the world (everything Rust-side is greenfield)

- **`src-tauri/src/lib.rs`** registers only `tauri-plugin-sql` (+ `tauri-plugin-log` in
  debug). **No `#[command]`, no `invoke_handler`, no `.manage`, no event emitter.**
  `src-tauri/src/main.rs` is the 6-line `windows_subsystem` shim.
- **Transport is fetch-only.** `src/lib/ai/transport.ts:30-53` (`streamSse`) and
  `:135-158` (`streamNdjson`) call global `fetch`. All four adapters import these and
  set the secret header directly (e.g. `anthropic.ts:80` `x-api-key`). There is **no
  `isTauri()` branch in the AI layer** and **no `invoke` anywhere in `src/`**. So even in
  the desktop shell, LLM calls go out through the webview `fetch` and hit CORS.
- **API keys are plaintext** in the `settings` KV under `providerKey:<id>`:
  `src/lib/ai/client.ts:53-65` (`setProviderKey`/`getProviderKey`), the **only literal
  `TODO(P5)` marker** (`client.ts:15-16`). The lazy accessor `settingsKeyAccessor`
  (`client.ts:73-75`) returns the secret string to adapters; each adapter sets the header.
- **`isTauri()`** lives at `src/lib/db/driver/client.ts:8-10` (re-exported from
  `$lib/db`); used only for storage selection. Reuse it — no second detector.
- **Native SQLite driver** `src/lib/db/driver/tauri.ts`: only `PRAGMA foreign_keys = ON`;
  `batch` is **not transactional** (loops statements, no `BEGIN/COMMIT`, unlike the OPFS
  worker); `query` flattens rows via `Object.values` (documented column-order assumption).
- **`tauri.conf.json`**: `version 0.0.1`, `identifier com.mayon.app`, single bare window
  (1280×800, no `label`), `security.csp: null`, `bundle.targets: "all"` with no per-platform
  blocks, **no `plugins.updater`**. Icons are unmodified `tauri init` placeholders (no
  source art). `repository = ""` in `Cargo.toml`.
- **`Cargo.toml`** deps: `tauri 2.11.3`, `tauri-plugin-sql`, `tauri-plugin-log`. `reqwest`
  is transitively present (via `tauri`) but **not a direct dep**. No `keyring`,
  `tauri-plugin-single-instance`, `-updater`, `-process`.
- **`capabilities/default.json`**: only `core:default` + `sql:*`. No event/updater perms.
- **`package.json`**: `"tauri": "tauri"` (raw CLI). No `.github/` (CI is greenfield).

## Locked decisions

1. **Custom reqwest transport, not `tauri-plugin-http`.** The architecture doc pins "Rust
   `reqwest` via Tauri commands, streamed over event channels" and the §2 tradeoff states
   "desktop keeps keys out of JS." A hand-rolled command lets Rust **inject the keychain
   secret into the request header itself** — the plaintext key never enters the webview.
   `tauri-plugin-http` would still route the secret through JS (adapter sets the header) and
   requires an open HTTP scope for arbitrary user-entered base URLs. Cost: more Rust + an
   event→stream bridge; benefit: the documented security property + tight abort control.
2. **Key never returns to JS on desktop.** Three keychain commands `key_set` / `key_has` /
   `key_delete` (no `key_get` returning plaintext). The transport receives a `keyInjection`
   descriptor and resolves the value in Rust. The app layer only ever learns a **boolean**
   `hasKey`. The plaintext crosses into Rust **exactly once**, on save.
3. **OS keychain via the `keyring` crate** (macOS Keychain / Windows Credential Manager /
   Linux Secret Service). `tauri-plugin-stronghold` (app-managed encrypted file) is the
   recorded alternative, rejected for OS-native protection + survives reinstalls. Linux
   needs a running secret-service (libsecret/gnome-keyring); document it.
4. **Transport seam at `streamSse`/`streamNdjson`, not in each adapter's body.** A new
   `HttpStreamTransport` (`getHttpTransport()` picks fetch vs Tauri by `isTauri()`) returns
   a `ReadableStream<Uint8Array>` fed to the **existing** `parseSseStream`/`parseNdjsonStream`.
   Adapters stop reading the secret; they pass an `auth` descriptor instead.
5. **Browser parity: keys move to IndexedDB** (out of the `settings` sqlite table), per the
   doc ("browser keeps them in IndexedDB"). Same `KeyStore` interface; the browser transport
   reads the key internally into the header (no secure enclave exists in a browser).
6. **One-time migration on boot:** any legacy `providerKey:<id>` rows in `settings` move to
   the runtime `KeyStore`, then are deleted from `settings`. Guarded by a `keysMigrated`
   flag so it runs once. Removes the `TODO(P5)` debt.
7. **Harden native SQLite** (cheap, all in `tauri.ts`): add `journal_mode=WAL`,
   `synchronous=NORMAL`, `busy_timeout=5000` (keep `foreign_keys=ON`); make `batch`
   transactional (`BEGIN`/`COMMIT`/`ROLLBACK`) like the OPFS worker. **No SQLCipher** this
   phase — once keys leave the DB it holds no secrets (chat content is personal/local);
   encryption-at-rest is a recorded future seam.
8. **Auto-update is real but minimal:** `tauri-plugin-updater` + `-process`, signed against a
   `TAURI_SIGNING_PRIVATE_KEY` (env, never committed), feed = `latest.json` on GitHub Releases.
   UI = a passive check on desktop boot + a "Check for updates" action in Settings; progress
   bar; install + relaunch. No silent force-update.
9. **Strict CSP on desktop.** Because LLM calls go through `invoke` (not webview fetch),
   the desktop webview makes **no cross-origin requests** → `connect-src 'self' ipc:
   http://ipc.localhost`. sqlite-wasm/OPFS never load on desktop (native SQL plugin), so no
   `worker-src`/`wasm-unsafe-eval` needed there. CSP is verified as a manual gate.
10. **Single instance** (`tauri-plugin-single-instance`): focus the existing window instead
    of spawning a second (a local-first single-user app shouldn't run twice against one DB).

## Interface change

### `src/lib/ai/registry.ts` — key accessor becomes a boolean probe

```ts
export interface ProviderKeyAccessor {
	// was: getKey(providerId): Promise<string | null>
	hasKey(providerId: string): Promise<boolean>;
}
```

Each adapter stops reading the secret. Example (`anthropic.ts`):

```ts
// was: const key = await deps.getKey(); if (!key) throw ...; headers['x-api-key'] = key;
const hasKey = await deps.hasKey();
if (!hasKey) throw new MissingKeyError(undefined, config.id);
yield* streamSse(endpoint, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION },
	auth: { header: 'x-api-key', keyId: config.id },   // transport resolves the secret
	body
}, opts.signal);
```

Per-adapter `auth` (header + scheme):
- `openai-compatible`: `{ header: 'Authorization', scheme: 'Bearer', keyId }`
- `anthropic`: `{ header: 'x-api-key', keyId }` (no scheme); the `anthropic-dangerous-direct-browser-access` header becomes desktop-only-noise but stays harmless — drop it on desktop via the transport (it's a browser-CORS concern).
- `gemini`: `{ header: 'x-goog-api-key', keyId }`
- `ollama`: no `auth` (no key).

### `src/lib/ai/transport.ts` — transport seam

```ts
export interface HttpStreamRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Transport resolves the keychain/IDB secret into this header; never enters JS on desktop. */
	auth?: { header: string; keyId: string; scheme?: string };
}
export interface HttpStreamTransport {
	request(req: HttpStreamRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
```

`streamSse`/`streamNdjson` become: `const body = await getHttpTransport().request(req, signal); yield* parseSseStream(body, signal);` (parsers unchanged — still tested). Errors stay typed (`classifyFetchError`/`httpStatusToError` for fetch; the Tauri command reports status/429/network which the transport maps to the same classes).

### `src/lib/ai/client.ts` — `KeyStore` replaces plaintext KV

```ts
export interface KeyStore {
	has(id: string): Promise<boolean>;
	set(id: string, key: string): Promise<void>;
	delete(id: string): Promise<void>;
}
// setProviderKey/getProviderKey (plaintext settings) are removed.
// getProviderKey(id) -> hasProviderKey(id): Promise<boolean>
```

`getActiveProvider()` fail-fast check (`client.ts:99-102`) uses `hasProviderKey`.
`settingsKeyAccessor` becomes `{ hasKey: (id) => hasProviderKey(id) }`.

## Data flow

### A request (desktop)
adapter builds (url, headers-minus-secret, body, `auth`) → `streamSse` → `tauriHttpTransport.request`
→ `invoke('llm_stream', { url, method, headers, body, keyInjection: {header, scheme, keyId}, streamId })`
→ Rust spawns `tauri::async_runtime::spawn`: `reqwest` POST with the keychain key injected into
`keyInjection.header`; emits `llm-stream` events (`headers`/`chunk`/`error`/`end`, filtered by
`streamId`) → JS bridge enqueues chunks into a `ReadableStream<Uint8Array>` → `parseSseStream` →
adapter. Abort (`opts.signal`) → `invoke('llm_stream_cancel', { streamId })` aborts the reqwest
future via a stored `AbortHandle` in managed `State`.

### A request (browser)
`fetchHttpTransport` reads the key from the `BrowserKeyStore` (IndexedDB) into the `auth` header,
then the current `fetch` path (unchanged). CORS still applies → `CorsBlockedError` + desktop hint.

### Key lifecycle
- **Save** (Settings UI, `ProviderConfig.svelte`): `keyStore.set(id, raw)` → desktop `key_set`
  (into keychain), browser IDB put. Plaintext transits to Rust once on desktop.
- **Has** (UI masked "replace key" affordance, fail-fast): `keyStore.has(id)`.
- **Delete:** `keyStore.delete(id)`.
- **Migration** (`migrateKeys()`, runs in `bootstrapDb` after driver init, guarded by
  `settings.keysMigrated`): scan `settings` for `providerKey:*` keys → `keyStore.set` each →
  delete the row → set the flag. Idempotent.

### Update check (desktop only)
`updater.svelte.ts` store → on boot (debounced) + Settings action → `check()` (`@tauri-apps/
plugin-updater`) → if available, `downloadAndInstall()` with progress → `relaunch()`
(`@tauri-apps/plugin-process`). Status surfaced as a small banner / Settings row.

## Tasks (ordered)

### 1. Transport seam (TS) — `src/lib/ai/http-transport.ts`
- New module: `HttpStreamRequest`, `HttpStreamTransport`, `getHttpTransport()` (picks by `isTauri()`).
- `fetchHttpTransport`: extract the current fetch handshake from `transport.ts` (status→error via
  `httpStatusToError`, `classifyFetchError`); resolve `auth` by reading the browser `BrowserKeyStore`
  into `headers[auth.header]` (scheme-prefixed). Returns `res.body`.
- Refactor `transport.ts` `streamSse`/`streamNdjson` to call `getHttpTransport().request(...)` then
  feed the existing `parseSseStream`/`parseNdjsonStream` (zero parser changes).
- Keep `streamSse`/`streamNdjson` signatures (adapters pass `auth` through the same `init`).

### 2. KeyStore — `src/lib/ai/keystore/`
- `types.ts`: the `KeyStore` interface (+ `hasProviderKey`/`setProviderKey`/`deleteProviderKey`
  wrappers live in `client.ts`).
- `desktop.ts`: `invoke('key_set'|'key_has'|'key_delete')` (used when `isTauri()`).
- `browser.ts`: tiny IndexedDB wrapper (object store `providerKeys`, key = id). No new dep (hand-rolled
  `indexedDB.open` + `get/put/delete`); if IDB is unavailable, throw a clear error.
- `client.ts`: `createKeyStore()` picks by `isTauri()`; remove `getProviderKey`/`setProviderKey`
  plaintext impl + the `TODO(P5)` marker; add `hasProviderKey`/`setProviderKey`(→`set`)/`delete`.

### 3. Wire adapters to the new seam
- `registry.ts`: `ProviderKeyAccessor` → `hasKey` (`registry.ts:19-22`).
- All four adapters: replace `const key = await deps.getKey()` + header-set with `const hasKey =
  await deps.hasKey()` + `auth` descriptor (per-adapter header/scheme above). Anthropic: drop the
  dangerous-browser header on desktop (or leave it — harmless; transport can strip it).
- `client.ts` `getActiveProvider` fail-fast: `hasProviderKey`.

### 4. Rust keychain commands — `src-tauri/src/keys.rs` + `lib.rs`
- `key_set(id, secret)`, `key_has(id) -> bool`, `key_delete(id)` via the `keyring` crate
  (`keyring::Entry::new("Mayon", &id)`). Errors → typed results the JS maps to `NetworkError`/generic.
- Register in `lib.rs` `invoke_handler![...]`; manage no state here.

### 5. Rust LLM transport — `src-tauri/src/transport.rs` + `lib.rs`
- `llm_stream { url, method, headers, body, key_injection: Option<{header, scheme, key_id}>, stream_id }`:
  - Spawn a task; resolve the key (if `key_injection`) from keychain; build the header
    (`scheme ? "{scheme} {key}" : key`); `reqwest::Client` POST with streaming `bytes_stream`.
  - Emit `llm-stream` events keyed by `stream_id`: `Headers{status}` (2xx) | `Chunk{text}` |
    `Error{status?, message}` | `End`. Non-2xx → `Error` (with status for 429 mapping).
  - Store an `AbortHandle`/cancel sender in `State<HashMap<String, …>>` keyed by `stream_id`.
- `llm_stream_cancel { stream_id }`: aborts the stored handle (no-op if gone).
- `lib.rs`: add the two commands to `invoke_handler`; `.manage(StreamHandles::default())`;
  register `core:event` capability for `llm-stream` listening.

### 6. TS Tauri transport bridge — `src/lib/ai/http-transport.ts` (desktop branch)
- `tauriHttpTransport.request`: gen `streamId` (crypto.randomUUID), `invoke('llm_stream', {...})`,
  listen on `llm-stream` via `@tauri-apps/api/event` filtered by `streamId`; pump events into a
  `ReadableStream<Uint8Array>` controller (TextEncoder on `Chunk`); map `Error{status}` → typed
  (`RateLimitError` on 429 else `ProviderHttpError`), `End` → close, abort → cancel invoke.
- Unit-testable with a **mocked** Tauri event/inject source (no real shell): see Tasks §10.

### 7. Harden native SQLite — `src/lib/db/driver/tauri.ts`
- After `Database.load`: `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`,
  `PRAGMA busy_timeout=5000`, keep `PRAGMA foreign_keys=ON`.
- `batch`: wrap in `BEGIN`/`COMMIT` (rollback on error) to match `opfs-worker.ts`.
- Keep the `Object.values` read-flatten (documented gate); add a one-line invariant note.

### 8. Key migration — `src/lib/ai/keystore/migrate.ts`
- `migrateLegacyKeys()`: read `settings.keys()`; for each `providerKey:*` → `keyStore.set(id, value)`
  → `settings.delete(key)`; set `settings.keysMigrated = true`. Call from `bootstrapDb` (desktop +
  browser) after the driver is ready. Idempotent (flag-guarded).

### 9. Packaging & metadata — `src-tauri/tauri.conf.json`, icons, `Cargo.toml`
- **Icons:** provide source art (required input) → `pnpm tauri icon <src.png>` regenerates the full
  set into `src-tauri/icons/` (replaces the placeholders). If no art yet, keep placeholders and flag.
- `tauri.conf.json`: bump `version` semantics (release-driven); add `bundle.publisher/category/
  copyright/shortDescription/longDescription`; per-platform blocks (macOS `minimumSystemVersion` +
  signing identity env-gated; Windows `wix`/`nsis`; Linux deb+appimage). `security.csp` strict
  (§Locked 9). Window: `label:"main"`, `center`, keep min/max, add `title`/decorations.
- `Cargo.toml`: `repository`/metadata; pin new crate versions.

### 10. Single-instance + plugins — `src-tauri/src/lib.rs`, capabilities
- Register `tauri_plugin_single_instance` (focus existing window). Add Rust deps: `reqwest`
  (`stream`, `rustls-tls`, `json`; `default-features=false`), `keyring`, `uuid`, `futures-util`
  (and `tokio` only if `tauri::async_runtime` is insufficient).
- `capabilities/default.json`: add `core:event:default` (for `llm-stream` listening) and the
  updater/process permissions when those ship (Tasks §11).

### 11. Auto-update — `src-tauri` + `src/lib/updater.svelte.ts`
- Rust: `tauri-plugin-updater` + `tauri-plugin-process`; `tauri.conf.json`
  `plugins.updater { endpoints, pubkey }`. JS: `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`.
- `updater.svelte.ts` (runes store, desktop-only, no-op when `!isTauri()`): `status`, `progress`,
  `check()`, `downloadAndInstall()`, `relaunch()`.
- UI: passive boot check (debounced) → small banner if update available; "Check for updates" +
  progress in Settings/About.
- Release infra (document, env-gated): `TAURI_SIGNING_PRIVATE_KEY` + password; `latest.json` hosted
  on GitHub Releases; a `release` flow (below).

### 12. CI — `.github/workflows/`
- `ci.yml` (push/PR): Node 22 (`.setup-node`) + pnpm 10 (`cache:pnpm`) → `pnpm install` →
  `pnpm lint` → `pnpm check` → `pnpm test`. (No desktop build — it can't link in the headless
  sandbox without GTK/WebKit dev libs; per AGENTS.md.)
- `release.yml` (on tag `v*`): matrix [ubuntu (install the apt GTK/WebKit dev libs from AGENTS.md),
  macos, windows] → `pnpm tauri build` → upload installers + generate+sign `latest.json` → GitHub
  Release. Updater `endpoints` point at the release assets.

### 13. package.json scripts + docs
- Add: `tauri:dev` (`tauri dev`), `tauri:build` (`tauri build`), `tauri:icon` (`tauri icon`).
- Update `AGENTS.md`: command table (new scripts), the **P5 manual acceptance gates** (below), and
  the Linux system-deps note (already present; add the secret-service/libsecret note for keychain).

### 14. Tests (Vitest, in-memory/headless — mirror existing transport/error tests)
- `http-transport.test.ts`: fetch-transport error mapping parity (unchanged behavior); `auth`
  header injection for the browser branch against a fake `KeyStore`.
- `tauri-transport.test.ts`: the event→`ReadableStream` bridge with a **mock** invoke/event source —
  assert chunk ordering, `End` closes the stream, `Error{429}`→`RateLimitError`, abort cancels.
- `keystore.test.ts`: `desktopKeyStore` invokes the right commands (mocked `invoke`);
  `migrateLegacyKeys` moves `providerKey:*` settings → store and deletes them, idempotent.
- The real Rust transport/keychain/updater are **manual/desktop gates** (can't run headless), like
  the SQL driver.

## Validation (acceptance)

Automated: `pnpm test` (new suites), `pnpm check`, `pnpm lint`. All must pass.
Manual (desktop, real machine — needs the GTK/WebKit dev libs + a secret service on Linux):
- **Installable + offline:** `pnpm tauri build` produces an installer; install it; run **fully offline**
  (disable network) — app boots, existing chats/labs/quizzes load (native SQLite WAL), theme persists.
- **Secure key storage:** add a provider + key in Settings → the key is **not** present in the `mayon.db`
  `settings` table (inspect with a SQLite client) and **not** in the webview (DevTools `invoke`
  never returns plaintext — only `key_has` booleans). Confirm it lives in the OS keychain
  (Keychain Access / Credential Manager / `secret-tool`). Stream works for **all** providers
  including Anthropic (no CORS, no `dangerous-direct-browser-access` needed).
- **Migration:** with a pre-P5 DB that has `providerKey:<id>` rows, first P5 launch moves them to the
  keychain and removes the rows; streaming still works afterward.
- **Streaming + provider switch + abort:** stream, add a second provider, set active, stream again;
  Stop aborts cleanly (cancel invoke fires).
- **Update:** with a staged signed `latest.json` at a higher version, boot → banner → download +
  progress → install → relaunch lands on the new version; `pnpm tauri build` version bump reflected.
- **Single instance:** launch a second time → focuses the existing window (no second instance/DB lock).
- **CSP:** DevTools shows no CSP violations; no cross-origin provider requests (all via `invoke`).

## Risks / notes

- **`reqwest` TLS:** pin `rustls-tls` (no native OpenSSL link) to keep the Linux build self-contained;
  avoid `default-features` pulling `native-tls`.
- **Event→stream backpressure / ordering:** the JS bridge must preserve chunk order and close exactly
  once on `End`; the mock test (§14) guards this. Keep events keyed by `streamId` so concurrent streams
  (e.g. chat + a short-answer grade) don't cross.
- **Keychain availability on headless Linux / CI:** `keyring` needs a secret service; document the
  libsecret requirement. If absent at runtime, `key_set` must surface a clear error, not crash.
- **Updater signing is mandatory** for `tauri build` to emit signed artifacts; the private key is an
  env-only secret (never committed). Without it the release workflow is blocked — gate the job on the
  secret being present.
- **`targets: "all"`** today attempts every platform's bundlers on the host; the release matrix scopes
  one target per OS. Dev `tauri dev`/`build` still work locally.
- **Adapter change is mechanical but touches all 4 adapters** — keep the per-adapter `auth` header/scheme
  table (§Interface change) as the source of truth and grep for leftover `deps.getKey` references.
- **No schema migration** (keys leaving `settings` is data-level, handled by `migrateLegacyKeys`, not a
  drizzle migration). The `settings` table schema is unchanged.
- Browser behavior is intentionally unchanged (still fetch, still CORS-possible) — P5 hardening is
  desktop-focused per the architecture; the `DESKTOP_FALLBACK_HINT` copy finally becomes accurate.
