# Mayon — User-Defined MCP Servers: Phased Implementation Plan

> Status: implementation-ready plan. Authored 2026-07-07.
> Pairs with the design source: `refinement/2026-07-07_user-defined-mcp-servers.md`
> (read that first — architecture, seams, security model, and locked decisions live
> there; this doc is the execution breakdown).
>
> Locked scope (from the planning session): **both runtimes · full MCP surface · tiered
> trust-on-spawn + per-call approval · global config + per-chat subset.**

## How to read this plan

Four phases, **M1 → M4**. Each phase is independently shippable and has its own acceptance
gate. The design's "Phasing within v1" is the headline; this plan expands each milestone
into concrete, file-level tasks with dependencies, effort (S/M/L), validation (CI vs
manual), and a Definition of Done.

**Hard rules carried over from AGENTS.md and the design doc:**

- Components/stores call repositories only — MCP clients/storage are reached via a new
  `repos.mcp` seam, never imported directly into UI code.
- Secrets never enter `settings`; MCP env-var/header values live in the runtime
  `KeyStore` under `mcp:<serverId>:<name>` — the `providerKey:<id>` pattern, copied.
- After any `pnpm db:generate`, **always run `pnpm bundle:migrations`** before shipping.
- The Rust stdio client cannot build/run in headless CI (GTK/WebKit + secret-service
  deps). The JS client + fake transport are the `pnpm test` surface; desktop correctness
  is a manual gate. Every phase keeps `pnpm lint && pnpm check && pnpm test` green.
- Risk lands last: M4 (sampling/elicitation) is the only reverse-direction work.

**Effort legend:** S = ~0.5–1 day · M = 1–2 days · L = 2–4 days. Estimates assume one
engineer who knows the codebase.

## Phase summary

| Phase | Scope | Effort | Risk | Ships standalone |
|---|---|---|---|---|
| **M1** | Desktop stdio · tools only · Brave end-to-end | L | Medium (new Rust surface) | Yes — the flagship demo |
| **M2** | Browser HTTP/streamable-HTTP transport · same tool path | M | Low (mirrors M1 JS) | Yes |
| **M3** | Resources + Prompts surfaces | M | Low (read-only, client→server) | Yes |
| **M4** | Sampling + Elicitation (reverse-direction) | L | High (cost/capability leak) | Yes |

**Critical path:** M1 → (M2 ‖ M3) → M4. M2 and M3 are independent once M1 lands.

---

## M1 — Desktop stdio, tools only, Brave end-to-end

**Goal:** the flagship vertical slice. Proves the `McpTransport` seam, the Rust subprocess
pool, the registry mounter, risk mapping, approval gate, keychain secrets, and the
Settings UI. Ends with a real Brave web search executed by the agent without a per-call
prompt.

**Why this first:** it's the largest new surface and the one everything else builds on.
It also lands the lowest-risk protocol surface (tools only, client→server only) and the
exact config/secret/settings UI that M2/M3/M4 reuse unchanged.

### M1.1 — Schema + persistence (M)

- `src/lib/db/schema.ts` — add `chats.mcp_config` (`text('mcp_config')`, nullable,
  additive — old rows get `null` = "inherit all globally-enabled servers"). Follow the
  `brief` column convention exactly (comment + nullable + additive).
- `pnpm db:generate` → new migration in `drizzle/`.
- **`pnpm bundle:migrations`** (mandatory — SPA runs it offline).
- `src/lib/db/repos/mcp.ts` (new) — `listServers()`, `getServer(id)`, `saveServers(map)`,
  `getChatMcpConfig(chatId)`, `setChatMcpConfig(chatId, cfg)`. Wire into the `repos`
  barrel the same way `repos.settings` / `repos.labs` are. **Non-secret fields only.**
- Unit test: round-trip server config through the settings KV; chat MCP-config read/write.

**DoD:** migration applies clean on a fresh in-memory DB; `pnpm test` green.

### M1.2 — `McpTransport` seam + `McpClient` (M)

- `src/lib/mcp/types.ts` (new) — `McpServerInfo`, `McpTool`, `McpResource`,
  `McpPrompt`, `McpNotification`, the protocol-version constant (pin to 2025-06-18
  streamable-HTTP; revisit per design §Open questions).
- `src/lib/mcp/transport.ts` (new) — the `McpTransport` interface (start / request /
  notify / close / onNotification) — mirrors `ProviderTransport` shape.
- `src/lib/mcp/client.ts` (new) — `McpClient`: `initialize` handshake, `tools/list`,
  `tools/call`, reconnection, subscribes to `notifications/tools/list_changed`. Holds
  one transport. Agnostic of which transport.
- `src/lib/mcp/fake-transport.ts` (new) — **in-memory echo** for tests (the analog of
  the in-memory `StorageDriver`). Scripts tool lists, call results, notifications.
- `src/lib/mcp/client.test.ts` (new) — handshake, list, call, list_changed re-mount,
  timeout, malformed-response handling. All against `FakeMcpTransport`.

**DoD:** `McpClient` fully unit-tested against the fake transport; no Rust dependency yet.

### M1.3 — Registry mounter + risk mapping (M)

- `src/lib/mcp/risk.ts` (new) — `annotationsToRisk(annotations)`: `readOnlyHint === true`
  → `'readonly'`; `destructiveHint === true` or `openWorldHint === true` → `'high'`;
  default (absent/ambiguous) → `'high'` (safe-by-default per the locked tiered model).
- `src/lib/mcp/mount.ts` (new) — `mountMcpServer(serverId, client)`:
  1. `client.tools/list` → for each tool synthesize id `mcp.<serverId>.<toolName>`.
  2. Re-validate each `inputSchema` is a parseable JSON Schema; skip + trace-log if not.
  3. `registerTool({ def, run })` where `run` calls `client.request('tools/call', …)`,
     wrapped in: arg re-validation against schema, per-server `callTimeoutMs` (default
     30s, honors `ctx.signal`), per-server `resultCapBytes` truncation (default ~8KiB),
     catches → `ToolResult { ok: false }` (never throws into the loop).
  4. Returns an unmount handle; subscribes to `tools/list_changed` to re-mount.
- `src/lib/mcp/mount.test.ts` — namespacing (no collision with built-ins or across
  servers), annotation→risk mapping table, truncation, timeout, arg-rejection path.

**DoD:** MCP tools appear in `getToolDefinitions()` with correct risk tiers; the agent
loop is **untouched** (zero edits to `loop.ts` for this).

### M1.4 — Rust stdio subprocess pool (L)

This is the largest single piece. Model `transport.rs` directly — it already shows the
keychain-in-Rust, event-emission, managed-state, and spawn+abort patterns.

- `src-tauri/src/mcp.rs` (new):
  - `McpHandles` managed state — `HashMap<server_id, ChildHandle>` (like `StreamHandles`).
  - `mcp_spawn(app, server_id, command, args, env_key_ids, cwd)`:
    - Resolve each `env_key_id` from the OS keychain via `keyring::Entry::new("Mayon", …)`
      and inject into `Command::env(...)` — **plaintext never crosses into JS** (same
      posture as `KeyInjection` in `transport.rs:83`).
    - `Command::new(command).args([...])` — **never** `sh -c`. Log a warning if
      `command` is not an absolute path (PATH lookup risk).
    - Spawn; own the `tokio` pipe framing (newline-delimited JSON-RPC over stdin/stdout;
      a dedicated reader task lines up with `stream.next()` in `transport.rs:146`).
    - Spawn-idle + on-exit kill of the child; cleanup on app shutdown.
  - `mcp_call(server_id, request_json)` → reads response off the pipe; returns the JSON.
    Honors a timeout; surfaces a typed error string JS maps to a `ToolResult`.
  - `mcp_notify(server_id, notification_json)` → one-way write.
  - `mcp_close(server_id)` → kill + remove handle (like `llm_stream_cancel`).
- `src-tauri/src/lib.rs` — `mod mcp;`, `.manage(mcp::McpHandles::default())`, register
  the four commands in `invoke_handler![]`.
- `src/lib/mcp/stdio.ts` (new) — `StdioMcpTransport`: `start()` → `invoke('mcp_spawn')`,
  `request()` → `invoke('mcp_call')` (serialize JSON-RPC, await deserialized result),
  `notify()` → `invoke('mcp_notify')`, `close()` → `invoke('mcp_close')`.
  - Runtime-guarded: only usable when `isTauri()`; throws a clear error otherwise (so a
    stray import in the browser fails loudly, not silently).
- `src/lib/mcp/keystore.ts` (new) — `setMcpSecret(serverId, name, value)`,
  `hasMcpSecret`, `deleteMcpSecret`, `deleteServerSecrets(serverId)` (used on remove).
  Thin wrapper over the existing `KeyStore` with the `mcp:<serverId>:<name>` key prefix.
- `tests/fixtures/stub-mcp-server.mjs` (new) — a ~40-line stdio MCP server that replies
  to `initialize` + `tools/list` + `tools/call` with canned data. **Desktop/manual
  integration test only** (cannot run in headless CI).

**DoD (manual, desktop-only):** the stub server spawns, `tools/list` returns, a
`tools/call` round-trips; the child is killed on `mcp_close` and on app exit. (CI covers
only `StdioMcpTransport`'s JS shape via a mocked `invoke`.)

### M1.5 — Settings UI + trust gate (M)

- `src/lib/mcp/templates.ts` (new) — `MCP_SERVER_TEMPLATES`: Brave Search, Filesystem,
  Fetch, GitHub, plus "Custom stdio" / "Custom HTTP" (HTTP template is inert until M2).
  Brave entry pins `npx -y @modelcontextprotocol/server-brave-search` + env
  `BRAVE_API_KEY: { secretRef }`. Mirror `PROVIDER_TEMPLATES` structure in `registry.ts:47`.
- `src/lib/mcp/trust.ts` (new) — `computeTrustHash(config)` = hash of
  `transport|command|args|url|cwd`; `isTrusted(config)` compares to stored `trustedHash`.
  **Any change to those fields → untrusted → re-prompt.**
- Settings MCP panel (`src/routes/settings/+page.svelte`, new section — model on the
  existing Providers panel):
  - List configured servers: name, transport badge, trusted ✓, connected status,
    discovered tool count.
  - Add via template picker **or** paste `mcpServers` JSON (Claude Desktop import — the
    DX win from the design).
  - Edit: command/args/url, env vars (masked + "replace" affordance — copy provider-key
    UX verbatim), `callTimeoutMs`, `resultCapBytes`, enable/disable, remove (also wipes
    secrets via `deleteServerSecrets`).
  - **Trust banner** on first spawn: explicit confirm of exact command/args/env-names.
  - **Test connection** button → `initialize` + `tools/list` → shows what was discovered.

**DoD:** add Brave from template → set key → trust → test → see the two Brave tools.

### M1.6 — Per-chat enablement wiring (S)

- Extend the loop's existing `disabledToolIds` plumbing (`loop.ts:202`): derive it from
  the chat's `mcp_config` in addition to its current sources. A server not enabled for
  the chat → all its `mcp.<server>.*` ids added to the disabled set.
- `/chat` composer: a compact "Tools" affordance listing active servers + a tool
  multi-select; one-click to enable a whole server for the current chat. Persists via
  `repos.mcp.setChatMcpConfig`.
- Extend `buildCapabilitiesPreamble()` (`brief.ts:243`) to summarize mounted MCP servers
  + tool counts so the model knows what's available without full enumeration.

**DoD:** enabling/disabling a server for a chat changes which MCP tools reach the model
on the next turn; persists across reload.

### M1 — Acceptance gate (manual, desktop)

`pnpm tauri dev` → Settings → Add MCP → Brave → enter `BRAVE_API_KEY` → **Trust** →
**Test** shows `brave_web_search` / `brave_local_search`. In `/chat`: "Search the web
for the latest Rust release" → agent calls the tool **without** a per-call prompt
(readonly) → results render. Restart → server reconnects, key survives (keychain).
Inspect `mayon.db`: `BRAVE_API_KEY` is **not** in `settings`;
`secret-tool lookup service Mayon` finds `mcp:<id>:BRAVE_API_KEY`.

`pnpm lint && pnpm check && pnpm test` green.

---

## M2 — Browser HTTP / streamable-HTTP transport

**Goal:** the same tool path works in the browser for remote MCP servers. No new agent
loop, registry, or settings code — a transport swap.

**Dependency:** M1 (reuses client, mounter, settings, per-chat wiring). **Independent
of M3** — can be done in parallel.

### M2.1 — HTTP transport (M)

- `src/lib/mcp/http.ts` (new) — `HttpMcpTransport`: streamable-HTTP (2025-06-18) primary,
  with the older SSE transport as a fallback. Feature-detect in `start()` via the
  `initialize` handshake response.
- Secrets in headers: resolve from the browser `KeyStore` (IndexedDB) at request time,
  inject into headers — same exposure posture as the browser-provider flow (key re-enters
  JS to set the header). Document this in the trust banner ("this key will be visible to
  the browser").
- CORS failure → reuse the existing `CorsBlockedError` → `formatProviderError` →
  "use the desktop app" notice. No new error type.
- `src/lib/mcp/http.test.ts` — against a fetch mock: handshake, call, list_changed via
  SSE/streamable-HTTP, timeout, CORS-error mapping.

### M2.2 — Runtime selection (S)

- `src/lib/mcp/client-factory.ts` (new) — `createMcpTransport(config)`:
  `isTauri() && config.transport === 'stdio'` → `StdioMcpTransport`;
  `config.transport === 'http'` → `HttpMcpTransport` (either runtime);
  invalid combos throw a clear error.

### M2 — Acceptance gate (manual, browser)

`pnpm dev` → configure a remote streamable-HTTP MCP server → same add/trust/test/flow as
M1. A CORS-blocking server surfaces the "use the desktop app" notice, not a raw error.
Key persists across tab reloads (IndexedDB). `pnpm lint && pnpm check && pnpm test` green.

---

## M3 — Resources + Prompts surfaces

**Goal:** the client→server read-only surfaces beyond tools. Both runtimes.

**Dependency:** M1. **Independent of M2** — can be done in parallel.

### M3.1 — Resources (M)

- Extend `McpClient` with `resources/list` + `resources/read`.
- `src/lib/mcp/mount.ts` — register one **internal auto-tool** `mcp_read_resource`
  (`risk: readonly`) so the agent can pull a resource on demand, plus a per-chat
  **Resources panel** (browse + attach). Attaching injects the resource content into the
  chat context as a system note / `tool_result`-shaped message (decide the shape during
  impl; both fit the existing `ChatMessage` union).
- Result-size cap applies to `resources/read` (same `resultCapBytes`).
- `src/lib/mcp/mount.test.ts` — extend: resource attach path; truncation.

### M3.2 — Prompts (S)

- Extend `McpClient` with `prompts/list` + `prompts/get`.
- Composer: an "Insert MCP prompt →" menu that lists a server's prompts; selecting
  inserts the rendered template text as a **user-authored draft** (not auto-sent) so the
  user reviews it.

### M3 — Acceptance gate (manual)

A server exposing resources → attach one into a chat → its content is visible to the
model on the next turn. A server exposing prompts → insert template → editable draft.
`pnpm lint && pnpm check && pnpm test` green.

---

## M4 — Sampling + Elicitation (reverse-direction)

**Goal:** server→client callbacks. **Highest-risk phase** — the only direction in which a
server can spend the user's LLM budget (`sampling/createMessage`) and interrupt the user for
input (`elicitation/create`). Lands last so tools/resources/prompts and the config/secret/
trust/trace plumbing from M1–M3 are stable and audited before we open it.

**Dependency:** M1 (strict). Practically M2 + M3 so the full surface is coherent.

> **Prerequisite discovered against the current code (confirm before starting M4):** the
> **live session connection is not yet wired.** `spawnAndMount` / `mountMcpServer` exist
> (`src/lib/mcp/lifecycle.ts:27`, `src/lib/mcp/mount.ts:16`) but are invoked only by the
> Settings "Test connection" path (`testConnection` → connect → list → close, `lifecycle.ts:45`)
> and by tests. The chat turn (`src/lib/stores/chat.svelte.ts:245-291`) only *reads configs*
> and derives `disabledToolIds` against `getToolDefinitions()`; nothing spawns servers or
> populates the `TOOLS` map with `mcp.*` entries at runtime, and `+layout.svelte`'s boot has
> no MCP step. Sampling/elicitation require a **persistent connection held across the turn**,
> so the spawn-on-turn / disconnect-on-leave wiring must land with (or be confirmed present
> before) M4.0. **Reverse requests cannot run over a connection that closes after
> `tools/list`.**

> **The load-bearing gap (read first):** the current `McpTransport`
> (`src/lib/mcp/transport.ts:3`) only supports *client→server* requests (`request()`) and
> *server→client* **notifications** (`onNotification()`). MCP sampling and elicitation are
> **server→client JSON-RPC requests** — messages carrying a `method` **and** an `id` that the
> client **must answer** with a response/error of the same `id`. No transport, no client, and
> no Rust reader can currently surface or reply to these. **M4.0 closes that gap; everything
> else builds on it.** (This is why M4 is rated L / High-risk — not the UI.)

### M4.0 — Transport reverse-request foundation (L)

The largest piece. Extends the seam so a server can ask and the client can answer, *while a
`tools/call` is in flight* (the reader must multiplex an in-flight response with incoming
server requests).

- `src/lib/mcp/transport.ts` — extend `McpTransport`:
  - Add `onRequest?(handler: (req: { id: string | number; method: string; params?: unknown }) => void): void` and `removeRequest?(handler): void`.
  - Add `respond?(id: string | number, result: unknown, error?: { code: number; message: string }): Promise<void>` — the client→server JSON-RPC *response*, keyed by the server's `id` (the symmetric counterpart of `request()`).
  - Mirror the existing `onNotification`/`notify` pairing exactly.
- `src/lib/mcp/fake-transport.ts` — add `emitRequest(req)` (analog of `emitNotification` at `:122`) that fires the `onRequest` handler, and implement `respond()` by pushing into a `sentResponses` array (analog of `sentNotifications`). **This is the entire `pnpm test` surface for the reverse path.**
- `src/lib/mcp/http.ts` — in `#readSseResponse` (`:87`) and the trailing-read loops
  (`:136-178`): today a frame with `method` + `id` is dropped unless `id === expectedId`
  (`:122`). Route any frame carrying **both** `method` and `id` to `onRequest` instead.
  `respond()` POSTs a `{jsonrpc:'2.0', id, result|error}` body to `this.url` (same endpoint /
  `mcp-session-id` / header build as `request()`, `:41`/`:187`).
- `src/lib/mcp/stdio.ts` + **Rust** (`src-tauri/src/mcp.rs`):
  - The Rust reader task currently classifies each stdout line as either a response (has the
    awaited `id`, returned from `mcp_call`) or a notification (has `method`, no `id`, emitted
    as the `mcp-notification:<server_id>` event consumed at `stdio.ts:72`). Add a **third
    class — a server request** (`method` *and* `id`) — emitted as a new
    `mcp-request:<server_id>` Tauri event carrying `{ id, method, params }`.
  - Add a new command `mcp_respond(server_id, id, response_json)` that writes
    `{jsonrpc:'2.0', id, result|error}` to the child's stdin (the inverse of `mcp_notify`).
  - Register `mcp_respond` in `src-tauri/src/lib.rs` `invoke_handler![]` beside
    `mcp_spawn`/`mcp_call`/`mcp_notify`/`mcp_close`.
  - `stdio.ts`: `onRequest()` subscribes to `mcp-request:<serverId>` (mirror the listener at
    `:72`); `respond()` invokes `mcp_respond`.
- `src/lib/mcp/client.ts` — add a server-request dispatcher:
  - A `#requestHandlers: Map<method, handler>` + `registerRequestHandler(method, handler)` /
    `unregisterRequestHandler(method)`.
  - After `transport.start()` (`:45`), wire `transport.onRequest` → look up the handler by
    `method`; on success call `transport.respond(id, result)`; on throw / refusal call
    `respond(id, undefined, { code, message })`. **Unknown methods → `respond(id, undefined,
    { code: -32601, message: 'method not found' })`** so the server gets a clean denial
    instead of hanging.
- `src/lib/mcp/client.test.ts` + `http.test.ts` — extend against the fake / fetch-mock: server
  request round-trip, `respond` shapes (result vs error), unknown-method → `-32601`, and a
  request arriving **during** an in-flight `tools/call` is answered (concurrency).

**DoD:** `McpClient` receives a `sampling/createMessage`-style server request from
`FakeMcpTransport`, dispatches it to a registered handler, and delivers the response back via
`transport.respond`. No Rust exercised in CI. `pnpm test` green.

### M4.1 — Honest capability advertisement + config fields (S)

- `src/lib/mcp/types.ts` — `McpServerConfig` already has `allowSampling?: boolean` (`:63`); add
  `allowElicitation?: boolean` and sampling guardrails: `samplingMaxCallsPerTurn?: number`
  (default `1`), `samplingMaxTokensPerTurn?: number` (default e.g. `2048`). All non-secret,
  persisted via `repos.mcp` (`src/lib/db/repositories/mcp.ts`).
- `src/lib/mcp/client.ts:48` — replace the hard-coded `capabilities: {}` with a capabilities
  object computed from the server config: advertise `sampling` **only when `allowSampling`**,
  `elicitation` **only when `allowElicitation`**. Per the locked decision we never advertise a
  capability we won't honor — the server sees a faithful picture and can't probe.
- `src/lib/mcp/lifecycle.ts` — thread `allowSampling`/`allowElicitation`/budget from `config`
  into the `McpClient` so `initialize()` builds the correct capabilities.

**DoD:** a server's `initialize` exchange shows `capabilities.sampling` iff the user opted in;
a server that wasn't granted the capability gets `-32601` if it tries anyway (never a silent
over-bill).

### M4.2 — Sampling handler + guard (L)

`src/lib/mcp/sampling.ts` (new) — handles `sampling/createMessage`.

- **Active-model-only, automatic.** Sampling runs *inside* an MCP tool's `run`, so the
  per-turn `ToolContext` already carries `model` and `config` (`src/lib/agent/registry.ts:29-30`).
  Use **those** — never resolve a fresh provider, never surface a model the user didn't
  configure. This is the locked v1 posture (Open question 3 — now decided: active-provider-only).
- **Per-turn context seam.** Extend `ToolContext` (`registry.ts:24`) with optional
  `requestApproval?` and `onTrace?`, wired from the loop's existing `deps.requestApproval` /
  `deps.onTrace` at the two `toolsRun` call sites (`loop.ts:392` and `:468`). The mount's tool
  `run` (`mount.ts:46`) installs the current `ctx` onto the `McpClient` before calling
  `client.toolsCall()` so the sampling handler can reach `ctx.model` / `ctx.signal` /
  `ctx.requestApproval` / `ctx.onTrace`.
- **Deny-by-default guardrail chain** (checked in order, *before* any provider call):
  1. `config.allowSampling !== true` → refuse.
  2. per-turn call count `≥ samplingMaxCallsPerTurn` → refuse.
  3. cumulative tokens this turn `≥ samplingMaxTokensPerTurn` → refuse.
  4. the requested `maxTokens` alone exceeds the remaining turn budget → refuse.
  5. else → **per-call approval modal** via `ctx.requestApproval` showing: which server, the
     server's requested prompt, the model that will be used (the active one), and the token
     budget.
- **On approve:** one-shot completion against `ctx.model` (accumulate `streamText`, or
  `generateText`), honoring `ctx.signal`; read usage from the result and debit the per-turn
  budget. **Sanitize to assistant text only** — never echo tool calls, reasoning, or images
  back to the server. Wrap in `withTimeout` (`src/lib/mcp/caps.ts:9`) with a sane cap and
  `ctx.signal`.
- **On refuse (1–4) or decline (5):** return a clean JSON-RPC **error** to the server
  (`-32603 "sampling denied"`) — *not* a silent over-bill and *not* a hang. **No provider
  call on refusal/decline → zero cost.**
- `src/lib/mcp/sampling.test.ts` (new) — approve path returns sanitized text + debits budget;
  decline → error response, no provider call; each guardrail (1–4) refuses with an error and
  no provider call; per-turn cap blocks a second call; `ctx.signal` abort → error;
  active-model enforcement (handler uses `ctx.model`, never resolves another).

**DoD:** `sampling/createMessage` from a fake server resolves to sanitized text on approval,
or a JSON-RPC error on refusal/decline, using the active model only with no cost on refusal.

### M4.3 — Elicitation handler + modal (M)

`src/lib/mcp/elicitation.ts` (new) — handles `elicitation/create`.

- The server sends a JSON schema describing the input it wants. Render a schema-driven form on
  the existing **shadcn/ui Dialog** set (`src/lib/components/ui/dialog/`) — the same Dialog
  already used by `McpServers.svelte` (`:15-21`). Title: "Server *X* requests input"; one input
  per top-level schema property (string/number/boolean); nested/unknown types degrade to a JSON
  textarea with validation.
- Three terminal outcomes returned as the JSON-RPC result per spec: `accept` (with validated
  data), `decline` (user dismissed), or an error on schema violation. **Never block silently** —
  declining returns `declined` immediately. On `ctx.signal` abort → respond `declined`.
- `src/lib/mcp/elicitation.test.ts` (new) — submit → `accept` + data; cancel → `declined`;
  malformed schema → graceful text fallback (no crash); abort → `declined`.

**DoD:** `elicitation/create` from a fake server renders (mocked store) and resolves to
`accept`/`decline`; malformed schemas don't crash the turn.

### M4.4 — Approval/UX store + components (M)

Generalize the existing approval pattern (currently tool-call-only) to sampling + elicitation.
Mirror `requestApprovalImpl` (`chat.svelte.ts:559`), `ApprovalEntry` (`:45`), and
`pendingApprovals` (`:108`).

- `src/lib/stores/chat.svelte.ts`:
  - `pendingMcpSampling = $state<...>([])` + `requestSamplingImpl(req)` (server/model/budget/
    prompt) + `approveSampling(id)` / `declineSampling(id)`. Same abort wiring as `:574`.
  - `pendingElicitation = $state<...>([])` + `requestElicitationImpl(req)` +
    `submitElicitation(id, data)` / `cancelElicitation(id)`.
  - The abort path that clears `pendingApprovals` (`:378`) must also clear both new lists.
- Components (new, `src/lib/components/mcp/`):
  - `SamplingApprovalCard.svelte` (or small Dialog) — model + budget + prompt, Approve/Decline;
    rendered beside `ApprovalCard` at `src/routes/chat/[id]/+page.svelte:708`.
  - `ElicitationDialog.svelte` — the schema→form Dialog from M4.3.
- Wire the `McpClient` sampling/elicitation handlers (M4.2/M4.3) to these store methods: the
  handler's approval callback resolves the promise it awaits, and the mount installs the turn
  context that carries the bound store callbacks.

**DoD (running app):** a server sampling request pops a modal showing model + budget; declining
sends a clean denial with no provider call. A server elicitation pops a schema form; both
submit and cancel answer the server.

### M4.5 — Audit trail (S)

Every reverse-direction event is traceable. The trace table (`agent_traces`) already exists;
MCP events are just more trace rows.

- `src/lib/agent/trace.ts` — extend `TraceEvent` (`:1`) with:
  - `{ kind: 'mcp-sampling'; serverId: string; model: string; approved: boolean; tokens?: number; refused?: string }`
  - `{ kind: 'mcp-elicitation'; serverId: string; action: 'accept' | 'declined'; error?: string }`
  - `{ kind: 'mcp-lifecycle'; serverId: string; event: 'spawn' | 'connect' | 'close' | 'error'; detail?: string }`
  - Extend the `TraceBuilder.emit` switch (`:112`) and `TurnTrace` (`:21`) to accumulate them;
    surface in `toJSON()` (`:226`).
- Emit from the handlers (M4.2/M4.3) via `ctx.onTrace`, and emit `mcp-lifecycle` from
  `spawnAndMount` / `close` in `lifecycle.ts`.
- `src/lib/components/diagnostics/DiagnosticsPanel.svelte` — render the new rows in the
  selected-trace detail.

**DoD:** a sampling approve/decline and an elicitation accept/decline each produce a trace row
visible in the dev Diagnostics panel.

### M4 — Acceptance gate (manual)

Both runtimes; **desktop is authoritative** because the Rust reader (`mcp.rs`) is the hard
part. Extend the M1.4 stub server (`tests/fixtures/stub-mcp-server.mjs`) with canned
`sampling/createMessage` + `elicitation/create` handlers.

- `pnpm tauri dev` (desktop) / `pnpm dev` (browser) → trigger a server sampling request:
  - The approval modal shows **server + model (the active one) + token budget**. **Declining**
    returns a clean denial — **no provider call, no cost** (confirm in the trace: no `usage`
    row, an `mcp-sampling` row with `approved:false`). Approving streams a sanitized assistant
    reply back to the server and debits the budget.
- Trigger a server elicitation: the schema form pops; **submit** returns the data, **cancel**
  returns `declined`.
- The Diagnostics panel shows `mcp-sampling` / `mcp-elicitation` / `mcp-lifecycle` audit rows.
- `secret-tool lookup service Mayon` (desktop) shows no key leakage; `mayon.db` `settings`
  holds no secrets.
- Restart: the server reconnects; a **second** sampling call within one turn is refused by the
  per-turn cap.
- `pnpm lint && pnpm check && pnpm test` green; the existing P0–P5 acceptance gates —
  **especially the `/chat` streaming gate**, since M4 touches the tool path and extends
  `ToolContext`/`TraceEvent` — still pass.

---

## Cross-cutting work (folded into the phases that need them)

| Concern | Lands in | Notes |
|---|---|---|
| Protocol-version pin + feature-detection | M1.2 | Pin 2025-06-18; negotiate capabilities honestly (advertise sampling/elicitation only at M4). |
| Token-budget hygiene (soft/hard tool caps) | M1.6 | Soft-warn >40 defs, hard-cap 64 in `streamText`; extend `buildCapabilitiesPreamble`. |
| `mcp.json` (Claude Desktop) import | M1.5 | Parse `mcpServers` map → our `McpServerConfig[]`. Document the shape limit. |
| Argument re-validation | M1.3 | Re-check args vs schema before send; reject → `ToolResult`. |
| Result-size cap | M1.3 (tools) · M3.1 (resources) | Shared helper. |
| Migration bundling | M1.1 | `pnpm db:generate` then **`pnpm bundle:migrations`** every schema touch. |
| Docs (`docs/guide/mcp.qmd`, SECURITY note) | After M1 / M4 | Brave walkthrough + supply-chain warning. |

## Open questions blocking M1 (resolve before starting)

1. **Exact protocol-version string.** Confirm during M1.2 against a real Brave server.
2. **`mcp.json` import shape.** Recommend Claude Desktop format; lock in M1.5.
3. **Sampling model exposure** — **resolved.** v1 is active-provider-only: the sampling
   handler (M4.2) reuses the per-turn `ToolContext.model`/`config` and never resolves another
   provider, so the model a server can invoke is exactly the one the user configured.

## Validation ladder (per phase)

- **Every phase:** `pnpm lint && pnpm check && pnpm test` green.
- **M1:** manual desktop Brave run (above). + Rust stub-server integration (desktop-only).
- **M2:** manual browser remote-server run + CORS fallback.
- **M3:** manual resources/prompts run.
- **M4:** manual sampling/elicitation run + audit-trail inspection.
- **Regression:** existing P0–P5 acceptance gates (theme toggle, provider streaming,
  keychain, updater, single-instance, CSP) must all still pass — MCP touches the agent
  loop's tool path, so re-run the `/chat` streaming gate after every phase.

## Sequencing rationale (why this order)

- **M1 first** because it's the seam everything sits on, and it lands the lowest-risk
  surface (client→server tools only) plus all the config/UI/secret plumbing that M2–M4
  reuse without change. Shipping it standalone gives the flagship Brave demo.
- **M2 ‖ M3** because they're independent extensions (a new transport vs new read surfaces)
  and both are low-risk client→server work.
- **M4 last** because sampling/elicitation are the only reverse-direction, cost-bearing,
  capability-leak-prone features. Everything stable and audited first; risk lands last and
  alone, so if M4 needs to be deferred or scoped down it does not block the rest of the
  feature shipping.
