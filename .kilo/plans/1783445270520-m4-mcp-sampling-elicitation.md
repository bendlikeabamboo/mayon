# M4 — MCP Sampling + Elicitation (reverse-direction)

> Source design: `refinement/2026-07-07_user-defined-mcp-servers.md`
> Expanded breakdown: `refinement/2026-07-07_user-defined-mcp-servers-plan.md` (§M4)
> Status: implementation-ready. Authored 2026-07-08.
>
> M1/M2/M3 are **already implemented** (`src/lib/mcp/` — 22 files). This plan delivers the
> last, highest-risk phase: server→client callbacks. It also closes a latent gap found during
> exploration (see Prerequisite P0).

## Goal

Enable an MCP server to (a) ask Mayon to run an LLM completion on its behalf
(`sampling/createMessage`) and (b) ask the user for structured input (`elicitation/create`) —
both strictly opt-in, deny-by-default, audited, and cost-bounded. This is the **only**
reverse-direction (server→client request) work in the feature.

## Key decisions (resolved)

- **Reverse requests need new transport plumbing.** The current `McpTransport`
  (`src/lib/mcp/transport.ts:3`) only supports client→server `request()` and server→client
  *notifications* (`onNotification()`). Sampling/elicitation are **JSON-RPC requests with an
  `id` the client must answer**. No transport/client/Rust reader can surface or reply to these
  today. Closing this gap (Task 3) is the load-bearing piece — it is why M4 is L/High-risk,
  not the UI.
- **Active-provider-only sampling (Open Q3 — resolved).** The handler reuses the per-turn
  `ToolContext.model`/`config` (`src/lib/agent/registry.ts:29-30`); it never resolves another
  provider. The model a server can invoke is exactly the one the user configured.
- **Deny-by-default, never silent.** Every refusal path returns a JSON-RPC **error**
  (`-32603 "sampling denied"` / elicitation `declined`), never a hang and never an over-bill.
  Refusal/decline makes **no provider call → zero cost**.
- **Honest capability advertisement.** `initialize` advertises `sampling`/`elicitation` **iff**
  the user opted in per server; an ungranted capability yields `-32601 method not found`.

## Prerequisites / dependencies

- **P0 (was uncovered during exploration, now in scope — Task 1):** the **live session
  connection is not wired.** `spawnAndMount`/`mountMcpServer` (`lifecycle.ts:27`, `mount.ts:16`)
  are used only by Settings "Test connection" (connect→list→close) and tests. The chat turn
  (`chat.svelte.ts:245-291`) only reads configs and derives `disabledToolIds` against
  `getToolDefinitions()`; nothing spawns servers or registers `mcp.*` tools at runtime. Reverse
  requests need a **persistent connection held across the turn** — Task 1 wires this.
- Depends on M1 (strict). M2+M3 already shipped.

## Ordered task list

### Task 1 — Live session connection wiring (P0; M)

Wire spawn-on-turn / disconnect-on-leave so `mcp.*` tools actually reach the model and a
connection persists across the turn (required by Tasks 5/6 for reverse requests).

- `src/lib/mcp/lifecycle.ts` — add `connectSession(configs): Promise<SessionConns>` that spawns
  each **enabled + trusted** server via `spawnAndMount`, **skipping untrusted** servers with a
  toast + trace rather than aborting the turn (today `spawnAndMount` throws on untrusted,
  `lifecycle.ts:29`). Return `{ unmountAll, clients }`.
- `src/lib/stores/chat.svelte.ts` — at turn start (`:244`, before the `mcpDisabled` derivation),
  call `connectSession` for the globally-enabled + chat-enabled servers; keep the
  `unmountAll`/clients in instance state. After `runAgentTurn` resolves (extend the existing
  `finally`, around `:378`'s abort cleanup), call `unmountAll()` + close clients.
- **Connectivity scope (recommended):** session-scoped — lazy-connect on first turn for a chat,
  reuse on subsequent turns, disconnect on chat navigation/unmount. **Simpler fallback:** spawn
  at turn start, close at turn end. Implementer chooses; per-turn is acceptable for v1 but note
  stdio cold-start cost (e.g. Brave `npx` = seconds).
- Skip servers whose transport can't be created (catch + trace) so one bad server doesn't break
  the turn.
- Re-run the M1 acceptance gate (Brave `/chat` web search) to confirm tools now reach the model.

### Task 2 — Capability advertisement + config fields (S)

- `src/lib/mcp/types.ts:63` — `McpServerConfig` already has `allowSampling?`; add
  `allowElicitation?`, `samplingMaxCallsPerTurn?` (default `1`),
  `samplingMaxTokensPerTurn?` (default `2048`). Non-secret, persisted via `repos.mcp`.
- `src/lib/mcp/client.ts:48` — replace hard-coded `capabilities: {}` with a value computed from
  config: advertise `sampling` iff `allowSampling`, `elicitation` iff `allowElicitation`.
- `src/lib/mcp/lifecycle.ts` — thread these fields into `McpClient` so `initialize()` builds the
  right capabilities.

### Task 3 — Transport reverse-request foundation (the load-bearing piece; L)

Extend every transport + the Rust reader so a server request (`method`+`id`) can be received
and answered while a `tools/call` is in flight (the reader must multiplex an in-flight response
with incoming server requests).

- `src/lib/mcp/transport.ts` — add `onRequest?(handler)` / `removeRequest?(handler)` (mirror
  `onNotification`) and `respond?(id, result, error?)` (the client→server JSON-RPC *response*,
  symmetric to `request()`).
- `src/lib/mcp/fake-transport.ts:122` — add `emitRequest(req)` (analog of `emitNotification`)
  and `respond()` pushing into a `sentResponses` array (analog of `sentNotifications`). **This
  is the entire `pnpm test` surface for the reverse path.**
- `src/lib/mcp/http.ts:87` (`#readSseResponse`) — a frame with **both** `method` and `id` is
  currently dropped unless `id === expectedId` (`:122`); route `method`+`id` frames to
  `onRequest`. `respond()` POSTs `{jsonrpc:'2.0', id, result|error}` to `this.url` (same header
  build / `mcp-session-id` as `request()` at `:41`/`:187`).
- `src/lib/mcp/stdio.ts` + **Rust** (`src-tauri/src/mcp.rs`):
  - Rust reader today classifies each stdout line as *response* (awaited `id` → returned from
    `mcp_call`) or *notification* (`method`, no `id` → `mcp-notification:<server_id>` event,
    consumed at `stdio.ts:72`). Add a **third class — server request** (`method` **and** `id`)
    → new `mcp-request:<server_id>` event carrying `{ id, method, params }`.
  - New command `mcp_respond(server_id, id, response_json)` writes `{jsonrpc:'2.0', id,
    result|error}` to the child's stdin (inverse of `mcp_notify`). Register in
    `src-tauri/src/lib.rs` `invoke_handler![]` beside the existing `mcp_*` commands.
  - `stdio.ts`: `onRequest()` subscribes to `mcp-request:<serverId>` (mirror listener at `:72`);
    `respond()` invokes `mcp_respond`.
- `src/lib/mcp/client.ts` — add a `#requestHandlers: Map<method, handler>` +
  `registerRequestHandler(method, handler)`; wire `transport.onRequest` → dispatch; on success
  `transport.respond(id, result)`, on throw/refusal
  `respond(id, undefined, { code, message })`. **Unknown methods → `-32601`.**
- Tests: `client.test.ts` + `http.test.ts` against fake/fetch-mock — server-request round-trip,
  `respond` result vs error shapes, unknown-method → `-32601`, and a request arriving **during**
  an in-flight `tools/call` is answered (concurrency).

### Task 4 — Per-turn context seam for handlers (S)

So the sampling/elicitation handlers reach the active model + approval + trace:

- `src/lib/agent/registry.ts:24` (`ToolContext`) — add optional `requestApproval?` and
  `onTrace?`.
- `src/lib/agent/loop.ts` — pass both from `deps` at the two `toolsRun` call sites (`:392`,
  `:468`) into the `ToolContext` (alongside the existing `signal`/`model`/`config`).
- `src/lib/mcp/mount.ts:46` — the tool `run` installs the current `ctx` onto the `McpClient`
  before `client.toolsCall()` so the handlers (Tasks 5/6) can read `ctx.model`/`ctx.signal`/
  `ctx.requestApproval`/`ctx.onTrace`; restore prior ctx afterward (re-entrancy safety if a
  server request arrives nested).

### Task 5 — Sampling handler + guard (L)

`src/lib/mcp/sampling.ts` (new) — handles `sampling/createMessage`, registered via
`client.registerRequestHandler`.

- **Guardrail chain, checked in order BEFORE any provider call:** (1) `allowSampling !== true`
  → refuse; (2) per-turn call count `≥ samplingMaxCallsPerTurn` → refuse; (3) cumulative turn
  tokens `≥ samplingMaxTokensPerTurn` → refuse; (4) requested `maxTokens` alone exceeds
  remaining turn budget → refuse; (5) else per-call approval via `ctx.requestApproval` showing
  server + the server's prompt + the model (active one) + token budget.
- **On approve:** one-shot completion against `ctx.model` (accumulate `streamText`, or
  `generateText`), honoring `ctx.signal`; read usage and debit the per-turn budget. **Sanitize
  to assistant text only** — never echo tool calls / reasoning / images to the server. Wrap in
  `withTimeout` (`caps.ts:9`) + `ctx.signal`.
- **On refuse (1–4) or decline (5):** return JSON-RPC error `-32603 "sampling denied"`, **no
  provider call**.
- `src/lib/mcp/sampling.test.ts` — approve→sanitized text + budget debit; decline→error, no
  provider call; each guardrail (1–4) refuses with no provider call; per-turn cap blocks 2nd
  call; `ctx.signal` abort→error; uses `ctx.model` only.

### Task 6 — Elicitation handler + modal (M)

`src/lib/mcp/elicitation.ts` (new) — handles `elicitation/create`, registered via
`client.registerRequestHandler`.

- Server sends a JSON schema describing the input. Render a schema-driven form on the existing
  **shadcn/ui Dialog** set (`src/lib/components/ui/dialog/`, already used by
  `McpServers.svelte:15-21`). One input per top-level property (string/number/boolean);
  unknown/nested types → JSON textarea with validation (graceful fallback, never crash).
- Outcomes per spec: `accept` (validated data), `declined` (dismissed), or error on schema
  violation. `ctx.signal` abort → `declined`. Never block silently.
- `src/lib/mcp/elicitation.test.ts` — submit→`accept`+data; cancel→`declined`; malformed
  schema→text fallback (no crash); abort→`declined`.

### Task 7 — Approval/UX store + components (M)

Generalize the existing approval pattern (`requestApprovalImpl` `chat.svelte.ts:559`,
`ApprovalEntry` `:45`, `pendingApprovals` `:108`).

- `src/lib/stores/chat.svelte.ts` — add `pendingMcpSampling = $state([])` +
  `requestSamplingImpl` + `approveSampling`/`declineSampling`; `pendingElicitation = $state([])`
  + `requestElicitationImpl` + `submitElicitation`/`cancelElicitation`. Mirror the abort
  wiring at `:574`; the abort-clear path at `:378` must also clear both new lists. Bind these
  callbacks into the `McpClient` handlers via the turn context (Task 4).
- `src/lib/components/mcp/` (new): `SamplingApprovalCard.svelte` (model+budget+prompt,
  Approve/Decline) and `ElicitationDialog.svelte` (schema→form). Render beside `ApprovalCard`
  at `src/routes/chat/[id]/+page.svelte:708`.

### Task 8 — Audit trail (S)

- `src/lib/agent/trace.ts:1` (`TraceEvent`) — add `mcp-sampling` / `mcp-elicitation` /
  `mcp-lifecycle` variants; extend the `TraceBuilder.emit` switch (`:112`) and `TurnTrace`
  (`:21`) + `toJSON()` (`:226`).
- Emit `mcp-sampling`/`mcp-elicitation` from handlers (Tasks 5/6) via `ctx.onTrace`; emit
  `mcp-lifecycle` (spawn/connect/close/error) from `lifecycle.ts`.
- `src/lib/components/diagnostics/DiagnosticsPanel.svelte` — render the new rows in trace
  detail.

## Risks & failure modes

- **Cost leak / capability leak** — mitigated by deny-by-default guard chain, honest capability
  advertisement, refusal returns JSON-RPC error (never silent), active-model-only.
- **Server hangs** (unanswered request) — mitigated by always answering: handler error or
  unknown method → `-32601`/`-32603`; `ctx.signal` abort → clean response.
- **Nested/re-entrant server requests** — a `sampling` request could itself trigger another;
  Task 4 saves/restores the per-turn ctx on the client.
- **Reader multiplexing** (Rust + HTTP SSE) — a server request arriving during an in-flight
  `tools/call` must be answered without corrupting the awaited response; covered by Task 3 +
  tests.
- **One bad server breaks the turn** — Task 1 skips untrusted/uncreatable servers with a trace
  instead of aborting.
- **Rust can't build in headless CI** — `pnpm test` covers JS only (fake + fetch-mock); Rust
  reverse-path correctness is a manual/desktop gate.

## Validation

- **Every task:** `pnpm lint && pnpm check && pnpm test` green.
- **Regression:** re-run the P0–P5 acceptance gates — **especially the `/chat` streaming gate**
  (M4 extends `ToolContext` + `TraceEvent` and touches the tool path). M1's Brave web-search gate
  must still pass after Task 1.
- **M4 manual gate (desktop authoritative; Rust is the hard part):** extend the M1.4 stub server
  (`tests/fixtures/stub-mcp-server.mjs`) with canned `sampling/createMessage` +
  `elicitation/create`:
  - Sampling: modal shows server+model+budget; **decline → no provider call, no cost** (trace:
    `mcp-sampling approved:false`, no `usage` row); approve → sanitized reply, budget debited.
  - Elicitation: schema form pops; submit→data, cancel→`declined`.
  - Diagnostics panel shows `mcp-sampling`/`mcp-elicitation`/`mcp-lifecycle` rows.
  - `secret-tool lookup service Mayon` (desktop) → no key leak; `mayon.db` `settings` → no
    secrets.
  - Restart: server reconnects; a **second** sampling call in one turn is refused by the
    per-turn cap.

## Out of scope

- Replacing the per-turn model with a server-chosen model (active-provider-only for v1).
- Per-session connection pooling optimizations beyond Task 1's recommended lazy-connect.
- Sampling of non-text modalities (images/audio) — sanitize-to-text for v1.
- Non-shadcn elicitation widgets / rich schema (object/array) UIs — textarea fallback for v1.

## Open questions

1. **Connectivity scope (Task 1):** session-scoped lazy-connect vs per-turn spawn — confirm
   during impl based on observed stdio cold-start cost; per-turn acceptable for v1.
2. **Sampling completion primitive:** `streamText` accumulate vs `generateText` — pick during
   impl; either fits (`ctx.signal` honored both ways).
3. **Elicitation `accept` result attachment:** whether elicited input should also surface as a
   visible chat note (not just the server's reply) — decide during impl; spec only requires the
   JSON-RPC result.
