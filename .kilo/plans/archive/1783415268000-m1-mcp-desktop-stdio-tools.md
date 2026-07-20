# Plan — M1: User-Defined MCP Servers (Desktop stdio · tools only · Brave end-to-end)

> Status: implementation-ready. Authored 2026-07-07.
> Expands milestone **M1** of `refinement/2026-07-07_user-defined-mcp-servers-plan.md`
> into concrete, file-level tasks. **Read the design source first**
> (`refinement/2026-07-07_user-defined-mcp-servers.md`) — architecture, seams, security
> model, and locked decisions live there. This plan is the execution breakdown for the
> flagship vertical slice only; M2–M4 stay in the refinement doc.
>
> **Scope of THIS plan:** M1.1 → M1.6 (schema, transport seam + client, registry mounter
> + risk, Rust stdio pool, Settings UI + trust gate, per-chat wiring). Ends with a real
> Brave web search executed by the agent with **no per-call prompt**.

## Grounding (the patterns M1 copies — verify against these, don't reinvent)

- **Settings KV for non-secret config:** `settingsRepo.get/set/delete` with JSON values
  (`src/lib/db/repositories/settings.ts:16-52`); providers live under the `providers` key
  and are seeded at `:49`. MCP servers go under `mcpServers` the same way.
- **Additive nullable column convention:** `chats.brief` (`src/lib/db/schema.ts:32-39`) is
  the template for `chats.mcp_config` — comment + nullable + "old rows get null = unchanged."
  Its setter `updateBrief` (`src/lib/db/repositories/chats.ts:163-170`) is the template for
  `setChatMcpConfig`.
- **Repo barrel:** public namespace `repos` in `src/lib/db/index.ts:19-32`; per-repo exports
  in `src/lib/db/repositories/index.ts`. A new `repos.mcp` slots in identically.
- **Tool registry the mounter feeds:** `registerTool/getToolDefinitions/ToolDefinition/
  Tool/ToolContext/ToolRisk` (`src/lib/agent/registry.ts:7-67`). **The agent loop is NOT
  edited for mounting** — MCP tools are just more registry entries.
- **Existing per-turn disable plumbing:** `AgentTurnDeps.disabledToolIds`
  (`src/lib/agent/loop.ts:50`) → filtered in `buildSdkTools` (`:60-72`) and the trace set
  (`:202-214`). Built at `src/lib/stores/chat.svelte.ts:251-254`. M1.6 *extends* this, it
  does not replace it.
- **Capabilities preamble:** `buildCapabilitiesPreamble()` (`src/lib/chat/brief.ts:243-255`)
  — extended in M1.6 to summarize mounted servers.
- **Rust patterns to mirror:** `transport.rs` — `StreamHandles` managed state (`:16-18`),
  `KeyInjection` descriptor (`:24-28`), keychain resolve-in-Rust (`:83-95`), spawn +
  `JoinHandle` + abort (`:99-202`), `cleanup` helper (`:41-47`); `keys.rs` — `SERVICE =
  "Mayon"` (`:12`); `lib.rs` — `mod` decls (`:1-3`), `.manage(...)` (`:24`), `invoke_handler!`
  (`:35-43`).
- **Secret store seam:** `KeyStore` (`src/lib/ai/keystore/types.ts:10-17`), runtime picker
  `createKeyStore()` (`client.ts:12`), desktop impl (`desktop.ts`). MCP secrets reuse it
  under `mcp:<serverId>:<name>`.
- **Runtime guard:** `isTauri()` (`src/lib/db/driver/client.ts:8`).
- **Settings UI pattern:** `ProviderConfig.svelte` — template picker (`:231-250`), server
  list (`:261-402`), masked "replace key" affordance (`:376-399`). The MCP panel mirrors this.
- **Provider template catalog:** `PROVIDER_TEMPLATES` (`src/lib/ai/registry.ts:47-129`) +
  `findTemplate` (`:132`) — `MCP_SERVER_TEMPLATES` mirrors this shape.
- **JS invoke-over-event pattern:** `tauri-transport.ts:127-140` (the `invoke` + `listen`
  posture) — `StdioMcpTransport` uses `invoke` (sync req/res per call, no event channel).

## Hard rules (from AGENTS.md + design doc — non-negotiable)

- Components/stores call repositories only — MCP clients/storage are reached via `repos.mcp`,
  never imported into UI code.
- **Secrets never enter `settings`.** MCP env-var/header values live in the runtime
  `KeyStore` under `mcp:<serverId>:<name>` — the `providerKey:<id>` posture, copied exactly.
- After `pnpm db:generate` **always run `pnpm bundle:migrations`** before shipping (SPA runs
  it offline).
- The Rust stdio client **cannot build/run in headless CI** (GTK/WebKit + secret-service
  deps). The JS client + `FakeMcpTransport` are the `pnpm test` surface; desktop correctness
  is a manual gate. Every sub-phase keeps `pnpm lint && pnpm check && pnpm test` green.
- `Command::new(cmd).args([...])` — **never** `sh -c`. Warn if `command` is not absolute.
- MCP tool errors resolve to `ToolResult { ok:false }`, never a raw throw into the loop.

**Effort legend:** S ≈ 0.5–1 day · M ≈ 1–2 days · L ≈ 2–4 days.

## M1-blocking open questions (resolved here)

1. **Protocol-version string.** Pin to **`"2025-06-18"`** in `MCP_PROTOCOL_VERSION`
   (`src/lib/mcp/types.ts`). Confirm against a live Brave server during the M1.4 desktop
   manual gate; if it negotiates down, feature-detect in `McpClient.initialize` rather than
   unpinning. (Streamable-HTTP fallback is an M2 concern, not M1.)
2. **`mcp.json` import shape.** Support the **Claude Desktop `mcpServers` map** only (per
   design §Open questions). Parser lives in `src/lib/mcp/import.ts` (M1.5); unsupported
   shapes throw a clear, user-facing error. Document the limitation in the trust banner.
3. **(M4, flagged now)** Sampling model exposure = active-provider-only. Out of M1 scope.

---

## M1.1 — Schema + persistence (M)

### M1.1a — Add the `chats.mcp_config` column
- `src/lib/db/schema.ts` — in the `chats` table (`:19-42`), add a column mirroring `brief`
  (`:32-39`) verbatim:
  ```ts
  /**
   * Per-chat MCP server enablement, stored as a JSON string
   * (`ChatMcpConfig` in `src/lib/mcp/types.ts`). `NULL` = "inherit all
   * globally-enabled servers"; an explicit `{}` disables all MCP tools for the
   * chat. Nullable + additive: old rows get `NULL` and behave exactly as before.
   */
  mcpConfig: text('mcp_config'),
  ```
  Place it adjacent to `brief` for readability. Export the inferred type via the existing
  `Chat = typeof chats.$inferSelect` (`:188`) — no new type export needed.
- Run **`pnpm db:generate`** → new migration appears under `drizzle/`.
- Run **`pnpm bundle:migrations`** (mandatory) → `src/lib/db/driver/migrations.ts` updated.

### M1.1b — New `mcp` repository
- `src/lib/db/repositories/mcp.ts` (new) — mirror `labsRepo` shape
  (`src/lib/db/repositories/labs.ts`) and the `awaitDb()` posture:
  - **Server config (non-secret)** lives in the settings KV under key `'mcpServers'` exactly
    like providers under `'providers'` (`settings.ts:49`). Type it as `Record<string,
    McpServerConfig>` (`McpServerConfig` from `src/lib/mcp/types.ts`).
    - `listServers(): Promise<McpServerConfig[]>` — `settingsRepo.get('mcpServers') ?? {}`,
      return `Object.values()` sorted by `createdAt`.
    - `getServer(id): Promise<McpServerConfig | null>`.
    - `saveServers(map: Record<string, McpServerConfig>): Promise<void>` —
      `settingsRepo.set('mcpServers', map)`. The UI computes the full map and calls this
      (single source of truth, like `saveProviders`).
    - `upsertServer(config): Promise<void>` and `deleteServer(id): Promise<void>` thin
      wrappers over `saveServers`.
  - **Per-chat enablement** lives in the new `chats.mcp_config` column. Mirror
    `chatsRepo.updateBrief` (`chats.ts:163-170`) for the setter:
    - `getChatMcpConfig(chatId): Promise<ChatMcpConfig | null>` — read
      `chatsRepo.getById(chatId)`; `JSON.parse(row.mcpConfig)` (return `null` on
      parse-failure/absence = inherit-all).
    - `setChatMcpConfig(chatId, cfg: ChatMcpConfig | null): Promise<void>` —
      `.update(chats).set({ mcpConfig: cfg ? JSON.stringify(cfg) : null, updatedAt: now() })`.
- Wire into the barrel:
  - `src/lib/db/repositories/index.ts` — `export { mcpRepo } from './mcp';`
  - `src/lib/db/index.ts:19` — add `mcp: mcpRepo,` to the `repos` object (import it above).

### M1.1c — Unit test
- `src/lib/db/repositories/mcp.test.ts` (new, in-memory driver like the other repo tests):
  - round-trip a `McpServerConfig` (stdio + an http-shaped one) through `saveServers` →
    `listServers`/`getServer`.
  - `getChatMcpConfig` returns `null` on a fresh chat (inherit-all); `setChatMcpConfig`
    persists and re-reads; passing `null` clears it back to inherit-all.

**DoD:** migration applies clean on a fresh in-memory DB; `pnpm test` green.
**No dependency on any other M1 task** — do this first.

---

## M1.2 — `McpTransport` seam + `McpClient` (M)

### M1.2a — Types
- `src/lib/mcp/types.ts` (new):
  - `export const MCP_PROTOCOL_VERSION = '2025-06-18';`
  - Protocol DTOs: `McpServerInfo` (`{ name; version }`), `McpTool`
    (`{ name; description?; inputSchema; annotations? }`), `McpResource`, `McpPrompt`
    (shapes from the MCP spec — keep them minimal/literal for M1; resources/prompts are
    consumed in M3 but define the types now so the client interface is stable).
  - `McpNotification` — `{ method: string; params?: unknown }` (e.g.
    `notifications/tools/list_changed`).
  - `McpServerConfig` and `ChatMcpConfig` **moved here from anywhere else** — they are the
    canonical shapes referenced by the repo (M1.1b) and the UI (M1.5). Match the design doc
    (`McpServerConfig` at design lines 192-211; `ChatMcpConfig` at 221-223). Non-secret only.
  - Re-export these types from `$lib/mcp` if a barrel is added.

### M1.2b — Transport interface
- `src/lib/mcp/transport.ts` (new) — `McpTransport` interface (mirror the design seam,
  lines 104-112):
  ```ts
  export interface McpTransport {
    start(): Promise<McpServerInfo>;                              // initialize handshake
    request(method: string, params?: unknown): Promise<unknown>;  // JSON-RPC req/res
    notify?(method: string, params?: unknown): void;              // JSON-RPC one-way
    close(): Promise<void>;
    onNotification?(handler: (n: McpNotification) => void): void; // tools/list_changed etc.
  }
  ```
  Intentionally parallel to `HttpStreamTransport`/`ProviderTransport` — one method per RPC
  direction, transport-agnostic.

### M1.2c — Client
- `src/lib/mcp/client.ts` (new) — `McpClient`:
  - Constructor takes one `McpTransport`. Owns a monotonically-increasing JSON-RPC `id`.
  - `initialize()` → `transport.request('initialize', { protocolVersion:
    MCP_PROTOCOL_VERSION, capabilities: {...client caps}, clientInfo: {...} })`, store
    `McpServerInfo` + server capabilities. **For M1 advertise no sampling/elicitation** —
    those flags only flip on at M4 (`allowSampling`).
  - `toolsList(): Promise<McpTool[]>` → `request('tools/list')`.
  - `toolsCall(name, args): Promise<McpToolCallResult>` → `request('tools/call', { name,
    arguments: args })`. Return shape: `{ content: McpContent[]; isError?: boolean }`
    (content items `{ type:'text', text }`).
  - `subscribeToolsListChanged(cb)` → `transport.onNotification` filters
    `notifications/tools/list_changed` → invokes `cb`.
  - `close()` → `transport.close()`.
  - Reconnection: keep a `state: 'idle'|'connected'|'closed'`; expose `onRemount` for the
    mounter. Hard errors (transport throws) propagate as rejected promises; the *caller*
    (mounter/lifecycle) decides to retry — the client does not silently loop.

### M1.2d — Fake transport + tests
- `src/lib/mcp/fake-transport.ts` (new) — `FakeMcpTransport implements McpTransport`.
  In-memory JSON-RPC echo (the analog of the in-memory `StorageDriver`). Scriptable:
  constructor takes `{ serverInfo?, tools?, callHandler?, notifications? }`; `request`
  dispatches by method, `notify` queues, `emitNotification` lets tests push
  `tools/list_changed`. Never touches Rust.
- `src/lib/mcp/client.test.ts` (new) — against `FakeMcpTransport`: `initialize` handshake
  stores server info; `toolsList` returns scripted tools; `toolsCall` round-trips; a pushed
  `tools/list_changed` notification fires the remount callback; a `request` that the fake
  rejects propagates; malformed/empty responses are handled without throwing raw into the
  caller.

**DoD:** `McpClient` fully unit-tested against the fake transport; **no Rust dependency yet.**
**Depends on:** nothing (M1.1 types only). Can start in parallel with M1.1.

---

## M1.3 — Registry mounter + risk mapping (M)

### M1.3a — Risk mapping
- `src/lib/mcp/risk.ts` (new) — `annotationsToRisk(annotations?: McpToolAnnotations):
  ToolRisk` (`ToolRisk` from `$lib/agent/registry`):
  - `readOnlyHint === true` → `'readonly'`.
  - `destructiveHint === true` **or** `openWorldHint === true` → `'high'`.
  - default (absent/ambiguous) → `'high'` (**safe-by-default** per the locked tiered model).
  - Note the precedence: a tool claiming both `readOnlyHint` and `destructiveHint` resolves
    to `'high'` (destructive wins).

### M1.3b — Mounter
- `src/lib/mcp/mount.ts` (new) — `mountMcpServer(serverId, client, opts): Promise<UnmountFn>`
  where `UnmountFn = () => void`:
  1. `client.toolsList()` → for each `McpTool` synthesize id `mcp.<serverId>.<toolName>`.
     **Validate no collision:** if `getToolDefinition(id)` already exists (built-in or another
     server), skip + trace-log — never silently overwrite a registry entry.
  2. Re-validate each `inputSchema` is a parseable JSON Schema object (has `type`); skip +
     trace-log if not. Coerce into `ToolDefinition.parameters` unchanged.
  3. `registerTool({ def, run })` (`registry.ts:42`) where:
     - `def = { id, description: tool.description ?? tool.name, parameters: inputSchema,
       risk: annotationsToRisk(tool.annotations), generative: false }`.
     - `run(args, ctx)`:
       - **Arg re-validation** against `inputSchema` (lightweight: required keys present,
         types match). Mismatch → `return { ok:false, summary:'rejected: invalid args' }`.
       - Race a `setTimeout`/`AbortSignal.timeout` against the per-server `callTimeoutMs`
         (default **30000**); honor `ctx.signal` too (whichever fires first). On timeout →
         `{ ok:false, summary:'tool timed out' }`.
       - `client.toolsCall(tool.name, args)` → flatten `content[].text` into a string.
       - **Truncate** to per-server `resultCapBytes` (default **8192**); if truncated, append
         a `\n…[truncated]` note in `summary`.
       - Wrap everything in try/catch → `ToolResult { ok:false, summary }` (**never throws
         into the loop** — the loop's `toolsRun` already catches, but be defense-in-depth).
       - `isError === true` from the server → `ok:false`.
       - Map to `ToolResult { ok, summary, detail: { serverId, toolName, content } }`.
  4. Subscribe to `tools/list_changed` via `client.subscribeToolsListChanged`: on fire, call
     the returned `unmount()` (deregister this server's ids) then re-run the mount. Debounce
     is unnecessary for M1 (these events are rare).
  - `UnmountFn` deregisters every id this mount registered (track the set locally) and
    detaches the list_changed subscription.

### M1.3c — Shared cap/timeout helpers
- `src/lib/mcp/caps.ts` (new, small) — `truncateResult(text, capBytes)` and
  `withTimeout(promise, ms, signal?)`. Reused by M3.1 (`resources/read`). Keep pure and
  unit-tested.

### M1.3d — Tests
- `src/lib/mcp/mount.test.ts` (new, against `FakeMcpTransport` + `McpClient`):
  - namespacing: a tool mounts as `mcp.<serverId>.<toolName>` and appears in
    `getToolDefinitions()`; a colliding id (with a built-in / another server) is skipped.
  - annotation→risk table (readonly/low-via-default-absent→high, destructive→high,
    openWorld→high, readOnly+destructive→high).
  - truncation at the cap (and the `[truncated]` note).
  - timeout path returns `ok:false`.
  - arg-rejection path returns `ok:false` without calling `toolsCall`.
  - `tools/list_changed` triggers a remount (a newly-added tool appears; a removed one is
    deregistered).

**DoD:** MCP tools appear in `getToolDefinitions()` with correct risk tiers; mounting needs
**no change to `loop.ts`** — MCP tools are just more registry entries, dispatched by the
existing risk-tiered path. (The only `loop.ts` edit in all of M1 is the 64-def hard-cap slice
in M1.6's `buildSdkTools`; mounting itself touches no loop code.)
**Depends on:** M1.2.

---

## M1.4 — Rust stdio subprocess pool (L) ← largest single piece

Model `src-tauri/src/mcp.rs` directly on `transport.rs` (handles, keychain-in-Rust, spawn +
abort) and `keys.rs` (service constant). **Desktop-only; cannot run in CI.**

### M1.4a — Rust module
- `src-tauri/src/mcp.rs` (new):
  - `McpHandles` managed state — `Mutex<HashMap<String, McpChild>>` where `McpChild` owns the
    `tokio::process::Child`, a stdin writer handle, and the reader task's `JoinHandle`
    (parallel to `StreamHandles` at `transport.rs:16-18`). `#[derive(Default)]`.
  - **`mcp_spawn(app, server_id, command, args, env_key_ids, cwd)`**:
    - For each `env_key_id` in `env_key_ids`, resolve from the OS keychain via
      `keyring::Entry::new("Mayon", env_key_id)` and inject into `Command::env(name, value)`
      — **plaintext never crosses into JS** (same posture as `KeyInjection` resolution at
      `transport.rs:83-95`). JS sends only `{ name, keyId }` pairs, never values.
    - **`Command::new(command).args([...])` — never `sh -c`.** Log a warning via
      `tauri_plugin_log` if `command` is not an absolute path (PATH-lookup risk; matches the
      locked hardening rule).
    - Optional `cwd` pin. `stdin`/`stdout` piped; `stderr` inherited-to-log.
    - Own the framing: spawn a dedicated reader task that buffers `stdout` line-by-line
      (newline-delimited JSON-RPC), parses each line, and routes the response to the pending
      request keyed by JSON-RPC `id` (a `Mutex<HashMap<i64, oneshot::Sender<Value>>>`).
      Notifications (no `id`) are forwarded via an `mpsc`/event channel. This mirrors the
      "dedicated reader task lines up with `stream.next()`" posture at `transport.rs:146`.
    - Spawn-idle + on-exit kill of the child; register a shutdown hook so app exit kills the
      whole pool (Tauri `RunEvent::ExitRequested`/`Exit`).
  - **`mcp_call(server_id, request_json)`** → allocates/parses the JSON-RPC envelope,
    registers the response `oneshot` by `id`, writes the line to stdin, awaits the response
    with a timeout (`tokio::time::timeout`, default 30s — JS passes the per-server value),
    returns the serialized response JSON. Errors → typed error string JS maps to
    `ToolResult { ok:false }`.
  - **`mcp_notify(server_id, notification_json)`** → one-way stdin write; returns `Ok(())`.
  - **`mcp_close(server_id)`** → kill the child, drop the reader task, remove the handle
    (mirror `llm_stream_cancel` at `transport.rs:190-202`). Idempotent (unknown id → `Ok`).
- `src-tauri/src/lib.rs`:
  - `mod mcp;` (with the other `mod` decls, `:1-3`).
  - `.manage(mcp::McpHandles::default())` (next to `transport::StreamHandles`, `:24`).
  - Register the four commands in `invoke_handler![...]` (`:35-43`):
    `mcp::mcp_spawn, mcp::mcp_call, mcp::mcp_notify, mcp::mcp_close`.

### M1.4b — JS stdio transport
- `src/lib/mcp/stdio.ts` (new) — `StdioMcpTransport implements McpTransport`:
  - `start()` → `invoke('mcp_spawn', { serverId, command, args, envKeyIds, cwd })`. The
    `initialize` JSON-RPC handshake is issued via `request` *after* spawn succeeds.
  - `request(method, params)` → build the JSON-RPC envelope `{ jsonrpc:'2.0', id, method,
    params }`, `invoke<string>('mcp_call', { serverId, requestJson })`, parse the returned
    JSON, surface `error` as a thrown `Error` (the mounter catches → `ToolResult`).
  - `notify(method, params)` → `invoke('mcp_notify', { serverId, notificationJson })`.
  - `close()` → `invoke('mcp_close', { serverId })`.
  - `onNotification(handler)` → subscribe to a Tauri event channel `mcp-notification:<serverId>`
    emitted by the Rust reader task for server→client notifications; filter by `method`.
  - **Runtime guard:** constructor/`start` assert `isTauri()` (`client.ts:8`) and throw a
    clear `"StdioMcpTransport is desktop-only"` otherwise — a stray browser import fails
    loudly, not silently.
- `src/lib/ai/tauri-transport.ts` is the reference for the `invoke` posture (`:127-140`); the
  difference is MCP is **request/response per call** (no streaming `ReadableStream`), so no
  `listen('llm-stream')` machinery is needed beyond the notification channel.

### M1.4c — MCP keystore wrapper
- `src/lib/mcp/keystore.ts` (new) — thin wrapper over the existing `KeyStore`
  (`createKeyStore()` from `$lib/ai/keystore/client`):
  - `setMcpSecret(serverId, name, value)` → `ks.set(\`mcp:${serverId}:${name}\`, value)`.
  - `hasMcpSecret(serverId, name)` → `ks.has(...)`.
  - `deleteMcpSecret(serverId, name)` → `ks.delete(...)`.
  - `deleteServerSecrets(serverId, names)` → loop `delete` (called on server remove, M1.5).
  On desktop the value crosses into Rust exactly once via `key_set` (the existing
  `DesktopKeyStore.set`); the env value is then re-read *in Rust* during `mcp_spawn` — it
  never re-enters JS.

### M1.4d — JS-shape test (CI-safe) + stub server (desktop-only)
- `src/lib/mcp/stdio.test.ts` (new) — `StdioMcpTransport` shape with `invoke` **mocked**
  (vitest `vi.mock('@tauri-apps/api/core')`): asserts `start`/`request`/`notify`/`close`
  build the right `invoke` args and serialize JSON-RPC correctly; asserts the `isTauri()`
  guard throws in a non-Tauri environment. **Does not spawn a real process** (CI-safe).
- `tests/fixtures/stub-mcp-server.mjs` (new) — a ~40-line stdio MCP server (plain Node, no
  deps) that replies to `initialize` + `tools/list` (one canned `echo` tool annotated
  `readOnlyHint:true`) + `tools/call` (echoes args back). **Desktop/manual integration only**
  — referenced by the M1 acceptance gate, not by `pnpm test`.

**DoD (manual, desktop-only):** the stub server spawns, `tools/list` returns, a `tools/call`
round-trips; the child is killed on `mcp_close` and on app exit. CI covers only the JS shape
via the mocked `invoke`.
**Depends on:** M1.2 (the `McpTransport` interface it implements).

---

## M1.5 — Settings UI + trust gate (M)

### M1.5a — Server templates
- `src/lib/mcp/templates.ts` (new) — `MCP_SERVER_TEMPLATES: McpServerTemplate[]`, mirroring
  `PROVIDER_TEMPLATES` (`registry.ts:47-129`) + a `findMcpTemplate(label)`:
  - **Brave Search** (the flagship): `transport:'stdio'`, `command:'npx'`,
    `args:['-y','@modelcontextprotocol/server-brave-search']`,
    `env:{ BRAVE_API_KEY:{ secretRef:'' } }` (secretRef filled with the `mcp:<id>:...` key on
    save). Both Brave tools declare `readOnlyHint:true` → `risk:'readonly'`.
  - **Filesystem**, **Fetch**, **GitHub** (stdio). GitHub/Fetch carry an env secret.
  - **Custom stdio** (blank command/args). **Custom HTTP** (inert until M2 — present in the
    picker but disables the "Test" button with a "browser/HTTP support lands in M2" note;
    on desktop it can still be added but won't connect until M2's transport exists). Keep
    the M2 stub minimal so the picker is complete.
  - `McpServerTemplate` carries the prefilled `McpServerConfig` fields + a `requiresTrust:
    true` (always, for M1) + a `discoverableTools` hint for the UI.

### M1.5b — Trust gate
- `src/lib/mcp/trust.ts` (new):
  - `computeTrustHash(config): string` — stable hash (e.g. `crypto.subtle` SHA-256 → hex, or
    a deterministic string-join + simple hash if `subtle` is awkward in the worker) of
    `transport|command|args.join(' ')|url|cwd`. **Env *names* are part of the hash; env
    *values* never are** (they're secret).
  - `isTrusted(config): Promise<boolean>` — `config.trustedHash === await computeTrustHash(...)`.
  - `trustNow(config): McpServerConfig` — returns `{ ...config, trustedHash: hash }` (called
    when the user confirms the trust banner; persisted via `repos.mcp.upsertServer`).
  - **Any change** to command/args/url/cwd → hash differs → untrusted → re-prompt on next
    spawn (the mount/lifecycle refuses to spawn an untrusted server and surfaces the banner).

### M1.5c — mcp.json import
- `src/lib/mcp/import.ts` (new) — `parseClaudeDesktopConfig(jsonText): McpServerConfig[]`:
  parse `{ mcpServers: { [name]: { command, args, env } } }`, map each entry to a
  `McpServerConfig` (transport `'stdio'`, env values → `{ secretRef }` placeholders the user
  fills). Throw a clear, user-facing error on an unsupported shape (e.g. missing
  `mcpServers`, or a non-object command). Document the supported shape in the trust banner.

### M1.5d — Settings MCP panel
- `src/lib/components/mcp/McpServers.svelte` (new) — model on
  `src/lib/components/ai/ProviderConfig.svelte`:
  - Header "MCP Servers" + **Add** (template picker `:231-250` pattern) **and** a "Paste
    `mcpServers` JSON" affordance (calls `parseClaudeDesktopConfig`).
  - List (`:261-402` pattern): per server — name (editable), transport badge (stdio/http),
    **trusted ✓**, connected status, discovered tool count.
  - Edit: command/args/url inputs, env vars (**masked + "replace" affordance verbatim from
    `ProviderConfig.svelte:376-399`** — never echo a stored value), `callTimeoutMs`,
    `resultCapBytes`, enable/disable, **Test connection** (`initialize` + `tools/list` → show
    discovered tools), remove.
  - **Trust banner** on first spawn / after a config change: explicit confirm of the exact
    `command`, `args`, env-var *names* (not values), and endpoint. Calls `trustNow` + persists.
  - **Remove** also wipes secrets via `deleteServerSecrets(serverId, names)`.
  - Reaches storage **only** through `repos.mcp` (never imports the client/transport
    directly) — except the "Test connection" button, which constructs a transient
    `StdioMcpTransport` + `McpClient` for a one-shot `initialize`/`tools/list` (this is the
    one sanctioned UI→transport touch; keep it isolated in a small `testConnection(config)`
    helper in `src/lib/mcp/lifecycle.ts` so the panel stays thin).
- `src/routes/settings/+page.svelte` — add `<McpServers />` inside the `<ProviderConfig>`
  snippet (the page already renders extra sections as `children`, `+page.svelte:9-13`). This
  keeps the page chrome (title + max-width + padding) in one place.

### M1.5e — Lifecycle + mounting orchestration
- `src/lib/mcp/client-factory.ts` (new) — `createMcpTransport(config): McpTransport`. M1 ships
  the **stdio** branch only (`new StdioMcpTransport(config)`); the http branch throws
  `'HTTP transport lands in M2'` so invalid/incomplete combos fail loudly. M2.2 later
  *extends* this file with `HttpMcpTransport` rather than introducing it.
- `src/lib/mcp/lifecycle.ts` (new) — the app-level glue (the only place that wires transport
  → client → mounter), so UI/stores don't import transports:
  - `spawnAndMount(config): Promise<{ client; unmount }>` — `isTrusted(config)` gate →
    `createMcpTransport(config)` → `new McpClient(transport)` → `initialize` →
    `mountMcpServer(config.id, client, { callTimeoutMs, resultCapBytes })`. Returns handles.
  - `testConnection(config): Promise<{ tools; serverInfo } | { error }>` — one-shot, no
    registry mutation; auto-closes.
  - A singleton `mcpRuntime` (svelte `$state`) tracking `{ [serverId]: { connected, toolIds,
    error } }` for the UI badges. Spawns enabled+trusted servers on boot (after
    `bootstrapDb`); respawns on enable; unmounts+`mcp_close` on disable/remove.

**DoD:** add Brave from template → set `BRAVE_API_KEY` → **Trust** → **Test** → see the two
Brave tools (`brave_web_search`, `brave_local_search`) listed.
**Depends on:** M1.1 (repo), M1.2 (client), M1.3 (mounter), M1.4 (transport + keystore).

---

## M1.6 — Per-chat enablement wiring (S)

### M1.6a — Derive per-chat disabled MCP tool ids
- `src/lib/stores/chat.svelte.ts` — at the existing `disabledToolIds` construction
  (`:251-254`), merge a computed set of MCP tool ids to disable. Logic:
  - Read `chatMcpConfig = await repos.mcp.getChatMcpConfig(chatId)` and the global
    `enabledServers = (await repos.mcp.listServers()).filter(s => s.enabled)`.
  - For each globally-enabled server: if `chatMcpConfig === null` (inherit-all) → enabled; if
    `chatMcpConfig[id]?.enabled === false` → disabled; if enabled with a `tools` allowlist →
    every `mcp.<id>.*` *not* in the allowlist is disabled.
  - Append all `mcp.<disabledServer>.*` ids (and allowlist-excluded ids) to the
    `disabledToolIds` array. Use the live `mcpRuntime` map (server → mounted tool ids) so the
    namespacing stays correct as servers remount.
  - Guard against a server not yet connected: if its tool ids are unknown, disable the whole
    `mcp.<id>.*` prefix defensively (the loop already works on exact ids, so enumerate the
    known ones; unknown = none exposed yet = effectively disabled).
- `src/lib/agent/loop.ts` — **no change to dispatch or approval**: the `disabledToolIds`
  mechanism at `:60-72`, `:202-214` already filters, so per-chat MCP enablement is pure
  store plumbing. (This is the design's "loop untouched for mounting/dispatch" claim made
  good.)
- `src/lib/agent/loop.ts` (`buildSdkTools`, `:60-72`) — **the single sanctioned `loop.ts`
  edit in M1**: enforce the 64-def hard cap by slicing the SDK `ToolSet` beyond 64 entries
  and trace-logging the dropped ids (the >40 soft-warn is preamble-only, M1.6b). Keep MCP
  registry entries eligible for the cap identically to built-ins (no special-casing).
- Loop tests (`loop.test.ts`, near the existing `disabledToolIds filtering` block at
  `:1008-1039`): (a) a `mcp.foo.*` id in `disabledToolIds` is excluded from the SDK toolset;
  (b) with >64 definitions registered, exactly 64 reach the SDK and the rest are logged.

### M1.6b — Capabilities preamble
- `src/lib/chat/brief.ts` — extend `buildCapabilitiesPreamble()` (`:243-255`): append a
  summary of mounted MCP servers + per-server tool counts (e.g. "MCP tools available: Brave
  Search (2 tools: web, local). Use them to search the web when asked."). Read from the live
  `mcpRuntime` (pass it in, or have the preamble read a module-level snapshot updated by the
  lifecycle). Keep it a pure string join (no behavior change to the loop's `system` assembly
  at `loop.ts:196-201`). Add/extend `brief.test.ts`.

### M1.6c — Composer affordance
- `/chat` composer — a compact "Tools" affordance (popover) listing active servers + a tool
  multi-select; one-click to enable/disable a whole server for the current chat. Persists via
  `repos.mcp.setChatMcpConfig(chatId, cfg)`. Lives in the chat route's existing bottom pane
  (model the placement on the generative-status chip area). Reaches data only via
  `repos.mcp` + the `mcpRuntime` store.

**DoD:** enabling/disabling a server for a chat changes which MCP tools reach the model on
the next turn; persists across reload. The loop's dispatch/approval path is unchanged; the
**only** `loop.ts` edit in M1 is the 64-def hard-cap slice in `buildSdkTools` (`:60-72`,
this sub-phase), covered by its own test.
**Depends on:** M1.5 (`mcpRuntime`, mounted tool ids).

---

## M1 — Acceptance gate (manual, desktop)

1. `pnpm tauri dev` → **Settings → MCP Servers → Add → Brave Search** → enter
   `BRAVE_API_KEY` → **Save key** → **Trust** banner confirms exact `npx -y
   @modelcontextprotocol/server-brave-search` → **Test connection** shows
   `brave_web_search` + `brave_local_search`.
2. `/chat`: "Search the web for the latest Rust release" → the agent calls
   `mcp.<id>.brave_web_search` **without** a per-call approval prompt (readonly, trusted) →
   results render in the chat.
3. **Restart** the app → the Brave server reconnects (spawned by `mcpRuntime` on boot); the
   key survives (OS keychain).
4. **Security check:** inspect `mayon.db` → `BRAVE_API_KEY` is **not** in the `settings`
   table; `secret-tool lookup service Mayon` (Linux) / Keychain Access (macOS) / Credential
   Manager (Windows) finds it under `mcp:<id>:BRAVE_API_KEY`. DevTools `invoke` never returns
   the plaintext.
5. **Trust regression:** edit the Brave `args` → the trusted badge clears → next spawn
   re-prompts the trust banner (no silent inheritance).
6. **Remove:** delete the Brave server → its keychain entry is gone (`hasMcpSecret` → false)
   and the subprocess is killed.

`pnpm lint && pnpm check && pnpm test` green. Re-run the existing P1 `/chat` streaming gate
(MCP touches the tool path) — unchanged behavior with no MCP servers configured.

---

## Dependency graph + recommended sequence

```
M1.1 (schema/repo) ──┐
                     ├─→ M1.3 (mounter/risk) ──┐
M1.2 (seam/client) ──┤                         ├─→ M1.5 (UI/trust/lifecycle) ──→ M1.6 (per-chat)
                     └─→ M1.4 (Rust/stdio) ────┘
```

- **M1.1 + M1.2** are independent of each other (M1.2 needs only the type shapes, which it
  defines itself) — start both first, in parallel. Both are CI-green on their own.
- **M1.3** needs M1.2; **M1.4** needs M1.2 (the interface). Start M1.3 and M1.4 in parallel
  once M1.2 lands.
- **M1.5** needs everything (repo, client, mounter, transport, keystore) — it's the
  integration point; land it last among the build tasks.
- **M1.6** needs M1.5 (the `mcpRuntime` store); it's small and lands last.
- Land in order **M1.1 ‖ M1.2 → M1.3 ‖ M1.4 → M1.5 → M1.6**, keeping the tree green after
  each. The desktop manual gate only becomes runnable once M1.4's Rust side compiles
  (verify on a real machine, not in CI).

## Risks (M1-specific)

- **Rust framing complexity (M1.4).** Newline-delimited JSON-RPC over a duplex pipe with
  async response routing (by `id`) + a notification side-channel is the riskiest single
  piece. Mitigation: model the reader task on `transport.rs`'s spawn pattern; keep the
  `id→oneshot` map simple; the stub server (`tests/fixtures/stub-mcp-server.mjs`) is the
  deterministic manual probe before Brave.
- **npx PATH-lookup supply chain.** `npx -y <pkg>` runs arbitrary npm code. Trust-on-spawn +
  the absolute-path warning is the maximum client-side mitigation (same model as Claude
  Desktop). Document loudly in the trust banner + `docs/guide/mcp.qmd` (post-M1 doc task).
- **Keychain secret-service on Linux CI/dev.** Without `gnome-keyring`/`libsecret-1-0`,
  `mcp_spawn`'s env resolve surfaces a clear error (matches the P5 posture); the JS path is
  unaffected. The manual gate machine must have a running secret service.
- **Subprocess leak on crash.** If the app crashes mid-spawn, children can orphan. The
  shutdown hook + spawn-idle kill mitigate; verify children die on app exit during the gate.
- **Tool-id explosion vs. token budget.** A server exposing 40+ tools bloats the system
  prompt. M1 mitigates via per-chat enablement (M1.6) + the preamble summary (M1.6b). The
  soft/hard caps (>40 warn, 64 hard) land in M1.6 as the **single sanctioned `loop.ts` edit
  in all of M1**: the hard cap slices the SDK `ToolSet` in `buildSdkTools` (`loop.ts:60-72`)
  beyond 64 and trace-logs the dropped ids; the >40 warn is preamble-only. (The lazy
  `search_mcp_tools` meta-tool is explicitly out-of-scope for v1.)
- **Trust-hash drift.** A future field added to the hashed set (e.g. a new transport field)
  silently un-trusts every server. Mitigation: the hash inputs are an explicit, commented
  list in `trust.ts`; adding a field is a deliberate, reviewed change.

## Out of scope for M1 (defer to later phases)

- Browser HTTP transport (M2), resources/prompts (M3), sampling/elicitation (M4).
- The lazy `search_mcp_tools` meta-tool / indirect mode.
- `roots` (filesystem scoping).
- `docs/guide/mcp.qmd` authoring (fold in after the M1 gate passes).
