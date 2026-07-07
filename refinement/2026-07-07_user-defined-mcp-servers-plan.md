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

**Goal:** server→client callbacks. **Highest-risk phase** — lands last so the rest of the
feature is stable and well-tested before we open a direction that lets a server spend the
user's LLM budget and ask the user for input.

**Dependency:** M1. (Practically also M2/M3 so the full surface is coherent, but strictly
only M1.)

### M4.1 — Sampling guard (M)

- Per-server opt-in `allowSampling` (default `false`). The `initialize` handshake
  advertises the `sampling` capability **only** when this is set — so servers see a
  faithful picture and never probe a capability we don't honor.
- `src/lib/mcp/sampling.ts` (new) — handle `sampling/createMessage`:
  - **Deny by default.** Per-call `requestApproval` (reuse the existing approval modal)
    showing: which server, the requested prompt, the model to be used (**active provider
    only** — never a model the user didn't configure), and the token budget.
  - **Per-turn cap** (default 1 sampling call/turn) and **per-server token budget**.
  - Refusal → returns a clean error to the server (not a silent over-bill).
  - Result is sanitized assistant text only.
- `src/lib/mcp/sampling.test.ts` — approval granted/denied, budget exceeded → refusal,
  per-turn cap, active-model-only enforcement.

### M4.2 — Elicitation modal (S)

- `src/lib/mcp/elicitation.ts` (new) — handle `elicitation/create`. Map onto the existing
  approval modal: generic "Server *X* requests input" built from the JSON schema the
  server provides. User can decline → returns `declined`.

### M4.3 — Audit trail (S)

- Every spawn / connect / call / sampling request / elicitation logged to the existing
  `onTrace` `TraceEvent` stream. Dev panel renders the audit log. (The trace table
  `agent_traces` already exists; MCP events are just more trace rows.)

### M4 — Acceptance gate (manual)

A server calling `sampling/createMessage` → approval modal shows model + budget; declining
returns a clean denial (no provider call, no cost). A server using `elicitation/create` →
schema-driven input modal; declining returns `declined`. Trace panel shows the audit
entries. `pnpm lint && pnpm check && pnpm test` green.

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
3. **Sampling model exposure** (M4, but flag now): active-provider-only for v1.

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
