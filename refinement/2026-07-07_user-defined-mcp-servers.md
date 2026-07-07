# Mayon — User-Defined MCP Servers

> Status: design / brainstorm, authored 2026-07-07.
> Decisions resolved in a planning session (see "Locked decisions" below).
> This is the design source for the feature; once shipped, the authoritative
> summary ports into `docs/dev/architecture.qmd` under a new "MCP / tool
> extensibility" section.

## Context

Mayon is a local-first learning app (branchable chat graph + labs + quizzes) with a
**provider-agnostic AI layer** and a **risk-tiered agent tool loop**. Users today get a
fixed set of built-in tools (`read_checklist`, `branch_chat`, `create_quiz`, …). This
design adds **user-defined MCP (Model Context Protocol) servers** — e.g. the Brave Search
MCP server — so users can extend the agent with arbitrary external capabilities
themselves, without an app release.

MCP is an open JSON-RPC protocol where an **MCP server** exposes *tools / resources /
prompts* (and may request *sampling / elicitation*) to an **MCP client** over a transport
(stdio for local subprocess servers, or HTTP / streamable-HTTP for remote servers). In
this design **Mayon is the MCP host (client)** and mounts each configured server's
capabilities into its existing agent loop.

## Why this is cheap to add

Mayon is *already* structured to be an MCP host. Almost nothing in the agent path changes:

- The agent loop (`src/lib/agent/loop.ts`) already iterates `getToolDefinitions()` → SDK
  tools → `streamText`, dispatches calls via `toolsRun()`, and has a **risk-tiered
  approval gate** (`readonly` auto / `low` notify / `high` → `requestApproval`).
- An MCP server's `tools/list` maps 1:1 onto `ToolDefinition`; `tools/call` maps onto
  `tool.run`. We `registerTool` synthetic IDs (`mcp.<serverId>.<toolName>`) and the loop
  is unchanged.
- The `messages` schema already stores `role: 'tool'` rows with `tool_call_id` /
  `tool_name`.
- The two-runtime / two-secret-store / transport-seam pattern
  (`ProviderTransport`, `KeyStore`, `StorageDriver`) is the exact template to copy for an
  `McpTransport` seam.

So this is a **feature, not a refactor**. The work is: (a) a Rust stdio MCP client,
(b) a JS `McpClient` + registry mounter, (c) settings persistence mirroring providers,
(d) a Settings UI panel, (e) the full protocol surface (resources/prompts/sampling/
elicitation), and (f) wiring risk/approval so untrusted external tools are safe by
default.

## Locked decisions (from planning session)

| Area | Decision |
|---|---|
| Runtime scope | **Both runtimes in v1.** Desktop = stdio JSON-RPC (Rust subprocess pool); browser = HTTP / streamable-HTTP (fetch). Mirrors the existing `ProviderTransport` asymmetry. |
| Protocol surface | **Full MCP.** Tools + resources + prompts + sampling + elicitation. (Sampling/elicitation are gated hard — see §Security.) |
| Trust model | **Tiered:** one-time explicit "trust this command/URL" consent to spawn/connect, re-confirmed on change; then each MCP tool call is `risk: high` (approval) unless the server declares `readOnlyHint` → `readonly` (auto-run). VS Code-style. |
| Enablement | **Global config + per-chat subset.** Servers configured once in Settings; each chat toggles which servers (and which tools) are active for its turns — token-budget hygiene. |

### Key tradeoffs

- **Both runtimes doubles the transport surface.** Stdio (desktop) is where the ecosystem
  lives (Brave, Filesystem, GitHub…); HTTP-remote (browser) inherits the same
  CORS / IndexedDB-key-exposure posture as the browser-provider flow, with the same
  "use the desktop app" fallback. Accepting both is correct for parity, but the browser
  path is strictly best-effort for any server that doesn't send permissive CORS headers.
- **Full surface means reverse-direction callbacks.** Sampling lets a server ask Mayon to
  call the user's LLM (cost + capability leak); elicitation lets a server ask the user
  for input mid-turn. Both are **deny-by-default + per-call approval + budgets**.
- **Tiered trust, not blanket trust.** Lower friction than per-call-only for read-heavy
  servers (search); tighter than trust-once-then-auto-run for arbitrary external actions.

## Architecture

A new `McpTransport` seam (sibling to `ProviderTransport` / `StorageDriver`) feeds an
`McpClient`, which mounts capabilities into the existing agent loop and settings layer.

```
┌──────────────────────────────────────────────────────────────────┐
│ SvelteKit SPA                                                    │
│  routes: ... + /settings (MCP Servers panel) + /chat (per-chat)  │
│  lib/mcp/                                                        │
│    client.ts          McpClient (initialize, list, call, ...)    │
│    transport.ts       McpTransport interface                     │
│    stdio.ts           StdioMcpTransport  → Rust commands         │
│    http.ts            HttpMcpTransport   → fetch (streamable-HTTP/SSE) │
│    mount.ts           mountMcpServer() → registerTool() wrappers │
│    risk.ts            annotations → ToolRisk mapping             │
│    sampling.ts        server→client sampling guard               │
│    elicitation.ts     server→client elicitation → approval UI    │
│    templates.ts       Brave / Filesystem / GitHub / Custom       │
│  lib/agent/loop.ts   ← unchanged dispatch; MCP tools are just    │
│                         more entries in the Tool registry        │
├────────────────────────────────────────────────┬─────────────────┤
│ Tauri runtime (Rust)                           │ Browser runtime │
│ • MCP stdio JSON-RPC over a tokio subprocess   │ • MCP over      │
│   pool (mcp_spawn / mcp_call / mcp_notify /    │   streamable-   │
│   mcp_close / mcp_list)                        │   HTTP + SSE    │
│ • env vars injected from OS keychain           │ • secrets in    │
│   (plaintext never enters JS)                  │   request       │
│ • no shell; explicit args; kill on exit/idle   │   headers (IDB) │
└────────────────────────────────────────────────┴─────────────────┘
```

### Seams

**`McpTransport`** (`src/lib/mcp/transport.ts`) — mirrors `ProviderTransport`:

```ts
export interface McpTransport {
	start(): Promise<McpServerInfo>;            // initialize handshake
	request(method: string, params?: unknown): Promise<unknown>;  // JSON-RPC req/res
	notify?(method: string, params?: unknown): void;              // JSON-RPC one-way
	close(): Promise<void>;
	onNotification?(handler: (n: McpNotification) => void): void; // tools/list_changed etc.
}
```

- `StdioMcpTransport` (desktop): delegates to Rust commands. Rust owns the subprocess
  pool, framing (newline-delimited JSON-RPC over stdin/stdout), and lifetime.
- `HttpMcpTransport` (both runtimes, primary in browser): MCP 2025-06 streamable-HTTP,
  with the older SSE transport as a fallback for servers that haven't upgraded.
  Feature-detected via the `initialize` handshake.

**`McpClient`** (`src/lib/mcp/client.ts`) — one per configured server. Speaks the MCP
protocol: `initialize` → `tools/list`, `resources/list`, `prompts/list`, `tools/call`,
`resources/read`, `prompts/get`, and handles server→client `sampling/createMessage` /
`elicitation/create` callbacks. Owns reconnection + `notifications/tools/list_changed`.

**Registry mounter** (`src/lib/mcp/mount.ts`) — on (re)connect, calls `tools/list` and
for each tool:

1. Synthesizes id `mcp.<serverId>.<toolName>` (namespaced so it cannot collide with
   built-ins or other servers).
2. Maps MCP annotations → `ToolRisk` (see §Security).
3. Registers a `Tool` whose `run()` delegates to `client.request('tools/call', …)`,
   wrapped in timeout + result-size cap + arg re-validation.
4. Subscribes to `tools/list_changed` to re-mount dynamically.

The agent loop (`buildSdkTools`, `getToolDefinitions`) needs no change — MCP tools are
just more registry entries. The only loop touch is honoring the **per-chat active
subset** (extend the existing `disabledToolIds` plumbing already in `loop.ts:202`).

## Protocol surface (full MCP, per locked decision)

| Capability | Direction | v1 | How it integrates |
|---|---|---|---|
| **Tools** | client→server | yes | `tools/list` → register; `tools/call` → `tool.run`. Primary surface. |
| **Resources** | client→server | yes | `resources/list` + `resources/read`. Surfaced in a per-chat Resources panel; attach injects content into context (as a system note / a `tool_result`-shaped message). Also exposed as an internal auto-tool `mcp_read_resource` so the agent can pull on demand. |
| **Prompts** | client→server | yes | `prompts/list` + `prompts/get`. Surfaced as "Insert MCP prompt →" in the composer; inserts the rendered template text as a user-authored draft. |
| **Sampling** | server→client | yes (gated) | `sampling/createMessage`. **Deny by default**; per-server opt-in `allowSampling`; per-call `requestApproval`; per-turn + per-server budget (calls + max-tokens); only the **active provider's model** is exposed (never a model the user didn't configure); result is sanitized assistant text only. |
| **Elicitation** | server→client | yes (gated) | `elicitation/create`. Maps onto the existing approval modal — generic "Server *X* requests input" built from the JSON schema it provides; user can decline. |
| Roots | client→server | defer | Filesystem scoping. Mentioned as future; not in v1. |

Capabilities are declared honestly in `initialize`: we advertise `sampling`/`elicitation`
only when the per-server opt-ins are set, so a server sees a faithful picture.

## Security & trust model

User-installed MCP servers are **untrusted external code/endpoints**. This is the highest-
risk part of the feature; the tiered model below is mandatory, not optional.

1. **Trust-on-spawn / trust-on-connect.** First launch of a stdio command (or first
   connect to an HTTP URL) requires explicit user confirmation showing the exact
   `command`, `args`, env-var *names*, and endpoint. Stored as `trustedHash` (a hash of
   command+args+url). **Any change to those fields re-prompts** — a tampered/updated
   command never silently inherits trust.
2. **Per-call approval by default.** Every MCP tool is `risk: 'high'` unless the server's
   tool `annotations.readOnlyHint === true` → mapped to `risk: 'readonly'` (auto-run).
   `destructiveHint` / `openWorldHint` are forced to `'high'` regardless. The existing
   loop `requestApproval` path handles this with zero new code.
3. **Subprocess hardening (Rust).** `Command::new(cmd).args([...])` — **never** `sh -c`.
   Warn if `command` resolves via PATH rather than an absolute path. Optional working-dir
   pin; resource limits; kill the pool on app exit and after an idle timeout.
4. **Argument re-validation.** Re-check tool args against the server's JSON schema before
   sending (defense against prompt-injected malformed args). Reject on mismatch → returns
   a `ToolResult` error, never a raw throw into the loop.
5. **Result-size cap.** Truncate `tools/call` + `resources/read` results to N chars
   (default ~8 KiB, configurable per server) to protect the context window and guard
   against resource exhaustion. The summary field always carries the truncation note.
6. **Timeouts.** Per-call default 30 s, configurable per server; aborted cleanly via the
   existing `AbortSignal` in `ToolContext`.
7. **Audit trail.** Every spawn / connect / call / sampling request / elicitation is
   logged to the existing `onTrace` `TraceEvent` stream; a dev panel renders the audit log.
8. **Sampling guard (extra).** Beyond opt-in + approval: hard per-turn cap (default 1
   sampling call) and per-server token budget; refusal returns a clean error to the
   server rather than silently over-billing the user.

## Persistence & schema

Mirrors the provider pattern exactly (non-secret config in `settings`; secrets in the
runtime `KeyStore`).

- New settings key `mcpServers`: `{ [id]: McpServerConfig }`.

```ts
interface McpServerConfig {
	id: string;
	name: string;
	transport: 'stdio' | 'http';
	// stdio only:
	command?: string;                       // e.g. "npx"
	args?: string[];                        // ["-y","@modelcontextprotocol/server-brave-search"]
	env?: Record<string, { secretRef: string }>;   // env-var NAME -> keychain key (value never here)
	cwd?: string;
	// http only:
	url?: string;                          // e.g. "https://mcp.example.com/mcp"
	headers?: Record<string, { secretRef?: string; value?: string }>;
	// common:
	enabled: boolean;
	trustedHash?: string;                  // re-prompt on change
	allowSampling?: boolean;               // opt-in for server→client sampling
	callTimeoutMs?: number;                // default 30000
	resultCapBytes?: number;               // default ~8192
	createdAt: number;
}
```

- Secrets: reuse the existing `KeyStore` under keys `mcp:<serverId>:<envName>`
  (desktop OS keychain / browser IndexedDB). Settings holds only the *name* + `secretRef`
  handle — identical posture to `providerKey:<id>`. The existing boot-time
  `migrateLegacyKeys()` pattern is the template if a migration is ever needed.
- Per-chat enablement: new column `chats.mcp_config TEXT NULL` (JSON):

```ts
type ChatMcpConfig = {
	[serverId: string]: { enabled: boolean; tools?: string[] }; // tool allowlist; omitted = all
};
```

  `NULL` = "inherit all globally-enabled servers." (A dedicated `chat_mcp` join table was
  considered; the JSON column wins on simplicity since tool lists are per-server and
  mutable. Revisit if query patterns demand it.)

This is a schema migration — run `pnpm db:generate` then **`pnpm bundle:migrations`**
(per AGENTS.md) so the SPA can apply it offline.

## Token budget / context hygiene

Every tool definition consumes context tokens; MCP servers commonly expose 10–40+ tools.

- **Per-chat active subset** (locked decision) is the primary lever.
- **Soft cap + warn** at >40 enabled tool definitions; **hard cap** at 64 definitions
  sent in a single `streamText` call. Overflow is dropped from the SDK `tools` object but
  still listed in the trace; a future P2 "indirect" mode would expose a single
  `search_mcp_tools` meta-tool to reclaim them lazily (out of scope for v1).
- `buildCapabilitiesPreamble` (system note) is extended to summarize mounted MCP servers
  and their tool counts so the model knows what's available without enumerating every def.

## UI

**Settings → MCP Servers:**

- List of configured servers: name, transport badge (stdio/http), trusted + connected
  status, discovered tool count.
- **Add** via template (Brave, Filesystem, Fetch, GitHub, Custom stdio, Custom HTTP) **or**
  paste an `mcpServers` JSON snippet (Claude Desktop / Cursor config import — a DX win
  that lets users copy a config they already have).
- **Edit**: command/args/url, env vars (masked, "replace" affordance — identical UX to
  provider keys), `allowSampling` toggle, timeout, result cap.
- **Test connection**: runs `initialize` + `tools/list` + `resources/list` +
  `prompts/list` and shows what was discovered.
- Per-server: enable/disable, remove (also wipes its secrets from the `KeyStore`).
- **Trust banner** on first spawn: *"This will run `npx -y …`. Continue?"*

**Per-chat (in `/chat`):**

- A "Tools" affordance in the composer area listing active servers + a tool multi-select;
  one-click to enable a whole server for the current chat.
- **Resources** tab: browse a server's resources and attach one into context.
- **Prompts** menu: insert a server prompt template as a draft.

## Flagship template — Brave Search

The "it works" demo and the manual acceptance gate anchor:

```
name:    Brave Search
command: npx
args:    ["-y","@modelcontextprotocol/server-brave-search"]
env:     { BRAVE_API_KEY: { secretRef: "mcp:<id>:BRAVE_API_KEY" } }
```

The Brave server exposes `brave_web_search` and `brave_local_search`, both annotated
`readOnlyHint: true` → mapped to `risk: 'readonly'` → **auto-run after the one-time trust
prompt**. This is the cleanest end-to-end proof of the tiered model: configure → trust →
key → ask the agent "search the web for X" → tools fire without per-call nag, results
surface in the chat.

## Phasing within v1

Even at maximalist scope, the build is sequenced to land risk last. Each milestone is
independently shippable.

- **M1 — Desktop stdio, tools only, Brave end-to-end.** Proves the `McpTransport` seam,
  the Rust subprocess pool, the registry mounter, risk mapping, approval gate, keychain
  secrets, and the Settings UI. Vertical slice + the acceptance gate.
- **M2 — Browser HTTP transport (streamable-HTTP + SSE fallback).** Same tool path, just
  a transport swap; CORS fallback notice reuses `formatProviderError`.
- **M3 — Resources + Prompts.** New read/insert paths and the per-chat Resources/Prompts
  panels; the internal `mcp_read_resource` auto-tool.
- **M4 — Sampling + Elicitation.** Reverse-direction callbacks, budgets, the sampling
  opt-in, the elicitation modal. Riskiest; lands last.

## Manual acceptance gates

(These augment the existing P0–P5 gates. The desktop build can't run in the headless CI
sandbox — per AGENTS.md — so desktop gates are manual/desktop-only.)

- **M1 (desktop, stdio, Brave):** `pnpm tauri dev` → Settings → Add MCP → Brave → enter
  `BRAVE_API_KEY` → **Trust** → **Test connection** shows `brave_web_search` /
  `brave_local_search`. In `/chat`: "Search the web for the latest Rust release" → the
  agent calls the tool **without** a per-call prompt (readonly) → results render. Restart
  the app → the server reconnects and the key survives (keychain). Inspect `mayon.db`:
  `BRAVE_API_KEY` is **not** in `settings`; `secret-tool lookup service Mayon` (Linux)
  finds it under `mcp:<id>:BRAVE_API_KEY`.
- **M2 (browser, HTTP):** `pnpm dev` → configure a remote streamable-HTTP MCP server →
  same flow. A CORS-blocking server surfaces the "use the desktop app" notice, not a raw
  error. Key persists across tab reloads (IndexedDB).
- **M3 (resources/prompts):** a server exposing resources → attach one into a chat → its
  content is visible to the model; a server exposing prompts → insert template works.
- **M4 (sampling/elicitation):** a server calling `sampling/createMessage` → per-call
  approval modal shows model + token budget; declining returns a clean denial. A server
  using `elicitation/create` → schema-driven input modal; declining returns `declined`.
  The trace panel shows the audit entries.

## Testing strategy

The JS layer is fully unit-testable with an **in-memory fake transport** (the analog of
the in-memory `StorageDriver`):

- `FakeMcpTransport` — an in-memory JSON-RPC echo that scripts `tools/list`,
  `tools/call`, `resources/read`, sampling, elicitation responses.
- Unit tests cover: `McpClient` handshake, registry mounter + namespacing, annotation →
  risk mapping, arg re-validation, result-size truncation, timeout, the per-chat subset
  filtering into `buildSdkTools`, the sampling budget/refusal, the elicitation approval
  flow, and `migrateLegacyKeys`-style secret handling.
- **Desktop/manual only:** an integration test with a tiny stub stdio server
  (`tests/fixtures/stub-mcp-server.mjs`) exercises the Rust subprocess pool end-to-end —
  cannot run in headless CI.
- `pnpm lint && pnpm check && pnpm test` must stay green; the Rust client is gated by the
  manual desktop acceptance above.

## Risks

- **Sampling cost/abuse.** A malicious or buggy server can run up the user's provider
  bill via `sampling/createMessage`. Mitigated by opt-in + per-call approval + per-turn
  cap + per-server token budget + active-model-only. Residual risk is nonzero by design
  (it's the cost of the full surface the user chose).
- **Subprocess supply chain.** `npx -y <pkg>` runs arbitrary npm code at the user's
  privileges. Trust-on-spawn + a clear warning is the maximum mitigation; this is the same
  trust model as Claude Desktop / Cursor and cannot be fully solved client-side. Document
  it loudly in the UI and in `docs/guide/`.
- **Context-window blowup.** Many tools balloon the system prompt. Capped + per-chat
  subset; lazy meta-tool mode deferred to P2.
- **CORS in browser.** HTTP MCP servers must send permissive CORS headers or fail; the
  existing `CorsBlockedError` → "use the desktop app" path covers it.
- **Protocol drift.** MCP is young and moving (2024-11 → 2025-03 → 2025-06 streamable-
  HTTP). **Pin to a declared protocol version** in `initialize`; feature-detect
  capabilities rather than assuming. Bump deliberately.
- **Tauri sandbox.** The Rust stdio client cannot be built/run in headless CI; only the
  JS client + fake transport are covered by `pnpm test`. Desktop correctness is a manual
  gate (consistent with the rest of the P5 posture).

## Open questions

1. **Protocol version pin.** Target the latest stable (2025-06-18 streamable-HTTP) with
   SSE fallback; confirm the exact version string during M1.
2. **Sampling model exposure.** Only the active provider, or a separate "utility model"
   config for sampling so a cheap model handles server-driven calls? Recommend:
   active-provider-only for v1 (simplest, least surprise), revisit if cost complaints
   arise.
3. **`roots` (filesystem scoping).** Defer to a future phase; flagged here so the
   capability negotiation leaves room for it.
4. **`mcp.json` import compatibility.** Decide exact supported shapes (Claude Desktop
   `mcpServers` map; Cursor format). Recommend: import the Claude Desktop shape (most
   common), document the limitation.

## Out of scope for v1

- `roots` capability, the lazy `search_mcp_tools` meta-tool mode, a separate utility model
  for sampling, server-side prompt caching hints, and any cloud/remote *hosting* of MCP
  servers by Mayon (Mayon is strictly a client/host, local-first).
