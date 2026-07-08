# Plan — M3: User-Defined MCP Servers (Resources + Prompts surfaces)

> Status: implementation-ready. Authored 2026-07-08.
> Expands milestone **M3** of `refinement/2026-07-07_user-defined-mcp-servers-plan.md`
> into concrete, file-level tasks. **Read the design source first**
> (`refinement/2026-07-07_user-defined-mcp-servers.md`) — architecture, seams, security
> model, and locked decisions live there. This plan is the execution breakdown for the
> client→server read-only surfaces beyond tools; M4 (sampling/elicitation) stays in the
> refinement doc.
>
> **Prerequisite:** **M1 and M2 are done.** This plan assumes their deliverables are merged
> and green: the `McpTransport` seam, `McpClient` (tools surface), the registry mounter +
> risk mapping, the `repos.mcp` store + `chats.mcp_config`, the keystore wrapper, trust
> hashing, the lifecycle orchestration, both transports (stdio + HTTP), and the Settings MCP
> panel + Composer "Tools" affordance. M3 is a **read-only surface extension** — it touches
> **no** agent-loop dispatch, no approval gate, no risk model, and no transports.
>
> **Scope of THIS plan:** M3.1 → M3.2 (resources `list`/`read` + the internal
> `mcp_read_resource` auto-tool + the per-chat Resources panel + attach-into-context;
> prompts `list`/`get` + the composer "Insert MCP prompt" menu). Ends with a server's
> resource attachable into a chat (visible to the model on the next turn) and a server's
> prompt insertable as an editable draft.

## Grounding (the patterns M3 copies — verify against these, don't reinvent)

M3 is almost entirely "do what M1 already did for tools, but for two more client→server
surfaces." Verify each of these before writing new code — M3 should reuse, not reimplement.

- **The client method shape M3 extends:** `McpClient` already has `toolsList()` /
  `toolsCall()` / `subscribeToolsListChanged()` (`src/lib/mcp/client.ts:46-68`) and stores
  `#serverCapabilities` from the `initialize` handshake (`:38-40`, exposed via the
  `serverCapabilities` getter at `:23-25`). Resources/prompts are **two more method pairs**
  on the same client, gated on `capabilities.resources` / `capabilities.prompts`.
- **The mounter M3 extends:** `mountMcpServer(serverId, client, opts)` (`mount.ts:14-96`)
  already does `toolsList()` → `registerTool` per tool → subscribes to
  `tools/list_changed` → returns an `UnmountFn` that deregisters + detaches. M3 reuses this
  exact lifecycle: after tools, mount resources/prompts; on unmount, unmount them.
- **The fake transport M3 extends:** `FakeMcpTransport.request` (`fake-transport.ts:28-51`)
  already dispatches by `method` and its `initialize` returns `capabilities: {}`. M3 adds
  `resources/*` + `prompts/*` branches and an opt-in `capabilities` override so tests can
  flip `hasResources`/`hasPrompts`. `emitNotification` (`:69-71`) is already generic.
- **The shared cap/timeout helpers (reuse, don't rewrite):** `truncateResult` +
  `withTimeout` (`src/lib/mcp/caps.ts:1-53`). `resources/read` truncation uses
  `truncateResult(text, capBytes)`; the resource read timeout uses `withTimeout` — exactly
  as the tools `run()` does at `mount.ts:49-53`.
- **The capability-preamble seam (extend, don't fork):** `buildCapabilitiesPreamble()`
  (`src/lib/chat/brief.ts:244-274`) already summarizes mounted MCP **tools** by reading
  `buildMcpRuntimeState()` (`:257-271`). M3 appends a one-liner about the
  `mcp_read_resource` tool + available resources (same string-join posture; no loop edit).
- **The system-note injection seam (the attach path):** `assembleContext(targetChatId)`
  (`src/lib/chat/context.ts:41-85`) already prepends leading **system** notes —
  `briefSystemNoteFor` (`:69`, `:129-135`) and `excerptSystemNoteFor` (`:70`, `:142-149`) —
  by pushing `{ role:'system', content }` into `out`. The loop routes every `role:'system'`
  context message into the system prompt (`loop.ts:203`:
  `ctx.filter((m) => m.role === 'system').map((m) => m.content)` → `sysParts`). **An
  attached resource is just one more leading system note** built the same way.
- **The settings-KV persistence pattern (no migration):** `mcpRepo` stores server configs
  under the `mcpServers` key (`repositories/mcp.ts:8,12`) and per-chat enablement in
  `chats.mcp_config` (`:37-60`). M3 stores **attached-resource snapshots** under a new
  `mcp.attachments:<chatId>` key the same way — JSON in settings KV, no schema touch.
- **The Composer MCP pattern M3 extends:** `Composer.svelte` already loads per-chat MCP
  state through `repos.mcp` + `buildMcpRuntimeState()` (`:108-151`), renders a "Tools"
  `DropdownMenu` (`:189-219`), and persists toggles via `repos.mcp.setChatMcpConfig`
  (`:139-151`). The Resources panel and Prompts menu are **two more affordances** in the
  same component, reading live catalogs through the lifecycle seam (sanctioned, like
  `buildMcpRuntimeState` at `:12`).
- **The per-chat disable plumbing M3 nudges:** `chatStore.send` already computes
  `mcpDisabled` from `getChatMcpConfig` + `enabledServers` (`chat.svelte.ts:245-265`) and
  merges it into `disabledToolIds` (`:274-278`). M3 adds one line: disable
  `mcp_read_resource` when no chat-enabled server exposes resources.
- **The DTOs already exist:** `McpResource` (`types.ts:33-38`) and `McpPrompt`
  (`types.ts:40-44`) were defined in M1.2 "so the client interface is stable." M3 adds the
  *result* shapes (`resources/read`, `prompts/get`) it did not need yet.
- **Protocol version is pinned and reused:** `MCP_PROTOCOL_VERSION = '2025-06-18'`
  (`types.ts:1`); resources/prompts ride the same transport the server already speaks.

## Hard rules (from AGENTS.md + design doc — non-negotiable)

- Components/stores call repositories only — live MCP catalogs are reached through the
  `lifecycle` surface modules (sanctioned, mirroring the existing `buildMcpRuntimeState`
  import in `Composer.svelte:12`), never by importing `McpClient`/transports into UI code.
- **Secrets never enter `settings`.** Attached-resource *content* is data the server served
  and the user explicitly attached — treated like brief/excerpt context (plaintext in
  SQLite), **not** a secret. Server env/header secrets stay in the `KeyStore` unchanged.
- MCP surface errors resolve to `ToolResult { ok:false }` (for `mcp_read_resource`) or a
  clear UI error string (for the panel/menu) — never a raw throw into the loop or the chat.
- `resources/read` and `prompts/get` are **client→server read-only** — no new approval gate,
  no risk-tier change. `mcp_read_resource` is `risk: 'readonly'` (auto-run after trust), the
  same tier Brave's readonly tools already use.
- After `pnpm db:generate` always run `pnpm bundle:migrations` — **N/A for M3** (no schema
  change; attachments live in the settings KV, no new column).
- `pnpm lint && pnpm check && pnpm test` green after every sub-phase. All of M3 is pure JS
  against `FakeMcpTransport` — **no** desktop/manual dependency for `pnpm test`. The primary
  acceptance gate is a manual resources/prompts run (either runtime); a short desktop parity
  check is included since both transports carry the new surfaces.

**Effort legend:** S ≈ 0.5–1 day · M ≈ 1–2 days · L ≈ 2–4 days.

## M3 design forks (resolved in the planning interview)

All four forks were resolved during planning; recorded here so an implementer understands
the *why* behind each locked choice.

1. **Attached-resource injection shape — RESOLVED: settings-KV snapshot + system note in
   `assembleContext`.** The design offered "a system note / a `tool_result`-shaped message
   (decide during impl)." **Decision: system note.** On attach, the panel reads the resource
   once (`resources/read`, truncated to the per-server cap), and stores a **snapshot** under
   settings key `mcp.attachments:<chatId>` as `McpAttachedResource[]`. `assembleContext`
   builds a leading system note per attachment (parallel to `briefSystemNoteFor` /
   `excerptSystemNoteFor` at `context.ts:129-149`).
   - **Why snapshot, not live read at turn time:** decouples the context from server
     availability (the server can be offline/restarted and the attached context survives),
     matches "attach into context" intent, and keeps `assembleContext` pure (no live client
     calls — it reads via `repos` only, preserving the architecture boundary).
   - **Why system note, not a `tool_result`-shaped message / a `system` message row:** the
     loop already routes `role:'system'` context into the system prompt (`loop.ts:203`); a
     message row would also leak into `chatStore.messages` and the message renderer. The
     settings-KV + system-note path keeps attachments **out of the message stream** (they
     render as removable chips in the Composer, not as bubbles) and needs **no migration**.
   - **Why settings KV, not a new `chats.mcp_attachments` column:** the snapshot is
     non-secret, per-chat, and small (each entry is capped at `resultCapBytes`, default
     ~8KiB). A settings key avoids a schema migration + re-bundle and mirrors how
     `mcpServers` config is stored. Revisit as a column only if query patterns demand it.
   - Re-attach refreshes the snapshot (re-reads + overwrites); detach deletes the entry.

2. **`mcp_read_resource` tool scope — RESOLVED: one global tool, routed by `serverId`.** The
   design said "register one internal auto-tool `mcp_read_resource`." **Decision: a single
   global tool** (id `mcp_read_resource`, `risk: 'readonly'`), schema
   `{ serverId: string; uri: string }`, routed via a shared `Map<serverId, {client, opts}>`
   in `src/lib/mcp/resources.ts`.
   - **Why global, not per-server / per-resource tools:** resource URIs are often templated
     and dynamic; enumerating one tool per resource would balloon the toolset (token-budget
     hygiene — the >40 soft / 64 hard caps from M1.6) and still miss dynamic URIs. One tool
     with `{serverId, uri}` is the minimal surface; the preamble + Resources panel tell the
     model which `serverId`/`uri` pairs are valid.
   - **Per-server cap/timeout honored:** the registry stores each server's
     `callTimeoutMs`/`resultCapBytes` (the mounter has them as `MountOpts`), so a read uses
     *its* server's limits — the design's "same `resultCapBytes`" requirement.
   - The tool is registered **idempotently** (guarded by `getToolDefinition`) when the first
     resource-capable server mounts, and deregistered when the last one unmounts — so the
     toolset only carries it when something can answer.

3. **Capability gating + backward compatibility — RESOLVED: derive `hasResources`/
   `hasPrompts` from stored capabilities; mount is a no-op when absent.** The `initialize`
   response carries `capabilities` (`client.ts:38-40`). **Decision:** add `hasResources` =
   `!!serverCapabilities.resources` and `hasPrompts` = `!!serverCapabilities.prompts`
   getters; the surface `mount*` helpers early-return when false. M1/M2 fakes return
   `capabilities: {}` → both false → **zero behavior change**, so all existing
   `client.test.ts` / `mount.test.ts` keep passing untouched.

4. **Prompts render target — RESOLVED: flatten to plain text, insert as an editable draft.**
   The design said "inserts the rendered template text as a user-authored draft (not
   auto-sent)." `prompts/get` returns `{ messages: [{ role, content }] }`. **Decision:**
   flatten text parts to a string, prefix each message with its role (`User:` / `Assistant:`)
   when there's more than one, and **set the Composer `prompt` state** (never auto-send). The
   user reviews/edits and sends with ⌘/Ctrl+Enter like any draft. Non-text content parts
   (image/audio) are dropped with a `[unsupported content type: …]` placeholder (v1 is
   text-only; the composer is a text area).

---

## M3.1 — Resources surface (M)

### M3.1a — Types + DTOs
- `src/lib/mcp/types.ts` — add the result shapes M1 deferred (the list-element DTOs
  `McpResource`/`McpPrompt` already exist at `:33-44`):
  ```ts
  /** One item in a `resources/read` result. Text resources carry `text`. */
  export interface McpResourceContents {
  	uri: string;
  	mimeType?: string;
  	type: 'text' | 'blob';
  	text?: string;
  	[key: string]: unknown;
  }
  export interface McpResourceReadResult {
  	contents: McpResourceContents[];
  }
  /** One message in a `prompts/get` result. v1 consumes only `type:'text'`. */
  export interface McpPromptMessage {
  	role: 'user' | 'assistant';
  	content: { type: 'text'; text: string } | { type: string; [k: string]: unknown };
  }
  export interface McpPromptGetResult {
  	description?: string;
  	messages: McpPromptMessage[];
  }
  /** Snapshot of an attached resource, persisted in settings KV (non-secret). */
  export interface McpAttachedResource {
  	serverId: string;
  	serverName: string;
  	uri: string;
  	name: string;
  	mimeType?: string;
  	content: string; // flattened text, already truncated to resultCapBytes at attach time
  	attachedAt: number;
  }
  ```

### M3.1b — `McpClient` resource + prompt methods + capability getters
- `src/lib/mcp/client.ts` — extend the class (no change to existing methods):
  - Getters derived from the stored `#serverCapabilities` (`:11`):
    `get hasResources(): boolean { return !!this.#serverCapabilities.resources; }` and
    `get hasPrompts(): boolean { return !!this.#serverCapabilities.prompts; }`.
  - `async resourcesList(): Promise<McpResource[]>` →
    `(await this.transport.request('resources/list')) as { resources: McpResource[] }`.
    Return `result.resources ?? []` (tolerate a server returning no `resources` field).
  - `async resourcesRead(uri: string): Promise<McpResourceReadResult>` →
    `request('resources/read', { uri })` (cast). Missing/empty `contents` →
    `{ contents: [] }`.
  - `async promptsList(): Promise<McpPrompt[]>` → `request('prompts/list')` →
    `result.prompts ?? []`.
  - `async promptsGet(name: string, args?: Record<string, unknown>): Promise<McpPromptGetResult>`
    → `request('prompts/get', { name, arguments: args ?? {} })`.
  - `subscribeResourcesListChanged(cb)` / `subscribePromptsListChanged(cb)` — copy
    `subscribeToolsListChanged` (`:58-68`) filtering on `notifications/resources/list_changed`
    and `notifications/prompts/list_changed` respectively.

### M3.1c — Resources surface module + the global `mcp_read_resource` tool
- `src/lib/mcp/resources.ts` (new) — the resource registry + the single auto-tool. Pure,
  unit-tested against a fake client:
  - Module map `RESOURCE_SERVERS = new Map<string, { client: McpClient; resources: McpResource[]; callTimeoutMs: number; resultCapBytes: number; subs: Set<() => void> }>()`.
  - `async mountResources(serverId, client, opts: MountOpts): Promise<void>`:
    - Early-return if `!client.hasResources`.
    - `const resources = await client.resourcesList();` store the entry (with
      `callTimeoutMs ?? 30000`, `resultCapBytes ?? 8192`).
    - Subscribe `client.subscribeResourcesListChanged` → re-fetch `resourcesList` and update
      the entry's `resources` (debounce not needed; rare). Track the unsub in `subs`.
    - `registerReadResourceTool()` (idempotent) so the tool exists once any resource server
      is mounted.
  - `unmountResources(serverId): void` — run + clear the entry's `subs`, delete the entry;
    if `RESOURCE_SERVERS` is now empty, `deregisterTool('mcp_read_resource')` (keeps the
    toolset clean when nothing can answer).
  - `readResource(serverId, uri): Promise<ToolResult>` (the tool's core, also reused by the
    attach path):
    - Look up the entry; missing → `{ ok:false, summary:'unknown resource server' }`.
    - `withTimeout(client.resourcesRead(uri), entry.callTimeoutMs)` (reuse `caps.ts:9`);
      flatten `contents` → text (join `c.text ?? ''`; non-text →
      `[unsupported content type: ${c.type}]`). `isError`/missing → `ok:false`.
    - `truncateResult(text, entry.resultCapBytes)` (`caps.ts:1`). Map to
      `{ ok:true, summary: truncated, detail:{ serverId, uri, mimeType } }`.
    - Catch → `{ ok:false, summary: … }` (timeout/Abort → `'resource read timed out'`).
      **Never throws into the loop** (defense-in-depth alongside `toolsRun`'s catch at
      `registry.ts:63-70`).
  - `registerReadResourceTool()` — guarded by `getToolDefinition('mcp_read_resource')`
    (`registry.ts:54`); if absent, `registerTool` a def:
    ```ts
    {
      id: 'mcp_read_resource',
      description: 'Read the contents of an MCP resource by server id and URI. Use only URIs listed in the Resources context.',
      parameters: { type:'object', properties:{ serverId:{ type:'string' }, uri:{ type:'string' } }, required:['serverId','uri'] },
      risk: 'readonly',
      generative: false
    }
    ```
    whose `run(args, ctx)` validates `args` is an object with string `serverId`+`uri`
    (reject → `{ ok:false, summary:'rejected: invalid args' }`, mirroring the tools path at
    `mount.ts:46-48`), honors `ctx.signal` via `withTimeout`'s signal param, then delegates
    to `readResource`.
  - `listMountedResources(): Array<{ serverId: string; resources: McpResource[] }>` —
    snapshot of the registry for the UI/preamble.
  - `resourceServerIds(): Set<string>` — the set of mounted resource-capable server ids (for
    the per-chat subset check in M3.1f).

### M3.1d — Mounter integration
- `src/lib/mcp/mount.ts` — in `doMount()` (`:24-75`), after the tools loop, call
  `await mountResources(serverId, client, { callTimeoutMs: timeoutMs, resultCapBytes: capBytes })`
  and (M3.2) `await mountPrompts(serverId, client)`. In the returned `UnmountFn` (`:87-96`),
  call `unmountResources(serverId)` and `unmountPrompts(serverId)` before clearing
  `registeredIds`. The `tools/list_changed` remount path (`:79-85`) re-runs `doMount`, which
  re-runs the resource/prompt mounts — **idempotent** (`mountResources` overwrites the entry
  by `serverId`). **The tools loop itself is untouched.**
  - Import `mountResources`/`unmountResources` from `./resources` and
    `mountPrompts`/`unmountPrompts` from `./prompts`.

### M3.1e — Attached-resource persistence + context injection
- `src/lib/db/repositories/mcp.ts` — add attachment CRUD under key
  `mcp.attachments:<chatId>` (settings KV, JSON `McpAttachedResource[]`), mirroring the
  `getChatMcpConfig`/`setChatMcpConfig` read/write shape (`:37-60`):
  - `listAttachments(chatId): Promise<McpAttachedResource[]>` — `settingsRepo.get(key) ?? []`.
  - `addAttachment(chatId, att): Promise<void>` — read list, filter out any existing entry
    with the same `serverId`+`uri` (re-attach refreshes), append `att`, write back.
  - `removeAttachment(chatId, serverId, uri): Promise<void>` — filter out the matching
    entry, write back.
  - `clearAttachments(chatId): Promise<void>` — `settingsRepo.delete(key)`.
- `src/lib/chat/context.ts` — add `async attachmentSystemNotesFor(chatId):
  Promise<ChatMessage[]>` (parallel to `excerptSystemNoteFor` at `:142-149`): read
  `repos.mcp.listAttachments(chatId)`; for each, build
  `{ role:'system', content: \`[Attached MCP resource — \${serverName}: \${name} (\${uri})]\n\${content}\` }`.
  In `assembleContext` (`:69-74`), after the excerpt note, spread them: `out.push(...(await
  attachmentSystemNotesFor(target.id)))`. **Pure (repos only); no live client calls.**
- `src/lib/db/repositories/mcp.test.ts` — extend: `addAttachment`/`listAttachments`/
  `removeAttachment` round-trip; re-attach overwrites; `clearAttachments` empties.
- `src/lib/chat/context.test.ts` — extend: a chat with an attachment → its content appears as
  a `role:'system'` message in the assembled context (and thus reaches the system prompt).

### M3.1f — Per-chat subset for the resource tool
- `src/lib/stores/chat.svelte.ts` — in `send`, after the `mcpDisabled` loop (`:247-265`),
  add: build the set of **chat-enabled** server ids (a server is chat-enabled when
  `chatMcpConfig === null` — inherit-all — or `chatMcpConfig[id]?.enabled !== false`); if
  none of them are in `resourceServerIds()` (imported from `$lib/mcp/resources`), push
  `'mcp_read_resource'` into `mcpDisabled`. This keeps the global tool out of chats that have
  no resource server enabled. (When `chatMcpConfig === null` and any resource server is
  mounted, the tool stays enabled — inherit-all.)
- No `loop.ts` edit: the existing `disabledToolIds` filter (`loop.ts:210-211, 218-222`)
  handles it.

### M3.1g — Capabilities preamble mention
- `src/lib/chat/brief.ts` — in `buildCapabilitiesPreamble()` (`:257-271`, the MCP block),
  after the tools summary, if `listMountedResources()` is non-empty, append one line:
  e.g. `"You can read MCP resources on demand with the mcp_read_resource tool (pass serverId + uri); available resources are listed in the Resources panel/attachments."`
  Keep it a pure string join (no loop change). Extend `brief.test.ts` accordingly.

**DoD:** a resource-capable server's resources appear in the registry; the
`mcp_read_resource` tool is registered (readonly) only while such a server is mounted;
attaching a resource injects its content as a system note visible to the model on the next
turn; detaching removes it; `resources/read` is truncated + timed out + never throws. The
agent loop, approval gate, risk model, and transports are **untouched**.
**Depends on:** M1 (client + mounter + lifecycle). Independent of M2 (works on both
transports — both carry the same `McpClient`).

---

## M3.2 — Prompts surface (S)

### M3.2a — Prompts surface module
- `src/lib/mcp/prompts.ts` (new) — the prompt registry + render helper. Mirrors
  `resources.ts` minus the auto-tool:
  - Module map `PROMPT_SERVERS = new Map<string, { client: McpClient; prompts: McpPrompt[]; subs: Set<() => void> }>()`.
  - `async mountPrompts(serverId, client): Promise<void>` — early-return if
    `!client.hasPrompts`; `prompts = await client.promptsList()`; store; subscribe
    `subscribePromptsListChanged` → refresh the cache (track unsub).
  - `unmountPrompts(serverId): void` — run+clear `subs`, delete the entry.
  - `listMountedPrompts(): Array<{ serverId: string; serverName?: string; prompts: McpPrompt[] }>`
    — snapshot for the composer menu. (`serverName` resolved by the caller from
    `repos.mcp.listServers()` since the module is client-only; or pass it in at mount —
    pick the lighter: resolve in the lifecycle helper, see M3.2c.)
  - `async renderPrompt(serverId, name, args?): Promise<{ text: string; error?: string }>` —
    `client.promptsGet(name, args)`; flatten `messages` to text:
    - For each message, take `content.type === 'text'` → `content.text`; else
      `[unsupported content type: ${content.type}]`.
    - If exactly one message, return its text. If multiple, prefix each with its role label
      (`User:` / `Assistant:`) on its own line (so the user sees the intended structure).
    - Catch → `{ text:'', error: msg }` (the composer shows a toast; never throws into the
      UI). No cap/timeout here — prompts are small template text (the attach cap is for
      resource *content*); but wrap in `withTimeout(..., 30000)` to avoid a hang.

### M3.2b — Mounter integration
- Already wired in M3.1d (`mountPrompts`/`unmountPrompts` called alongside the resources
  pair). No further mounter edit.

### M3.2c — Lifecycle helpers for the UI
- `src/lib/mcp/lifecycle.ts` — re-export the UI-facing surface accessors so the Composer
  imports from the sanctioned lifecycle seam (not the surface modules directly), matching the
  existing `buildMcpRuntimeState` export (`:60-74`):
  - `export { listMountedResources, listMountedPrompts, renderPrompt } from './resources'` /
    `'./prompts'` (re-export; or thin wrappers that join `serverName` from
    `repos.mcp.listServers()`). Pick thin wrappers so the UI gets `serverName` without a
    second import: `getMountedResources()` and `getMountedPrompts()` map server ids → names.
  - `async readResourceForAttach(serverId, uri, opts?): Promise<{ content: string; name: string; mimeType?: string } | { error: string }>`
    — the attach path: call `readResource`-equivalent on the registered client (or reuse
    `readResource` and pull the summary), return the truncated text + the resource's
    `name`/`mimeType` (looked up from the cached `resources` list by `uri`). Errors →
    `{ error }` so the panel can toast. This is the **only** UI→live-client touch for
    resources (parallel to M1's `testConnection`).

**DoD:** a prompt-capable server's prompts are listable from the composer; selecting one
fetches `prompts/get`, flattens to text, and inserts it as an editable draft (not auto-sent);
non-text parts degrade gracefully; a failing `prompts/get` surfaces a toast, not a throw.
**Depends on:** M3.1 (shares the mounter hooks + client methods).

---

## M3 — UI: Resources panel + Prompts menu (folded into M3.1/M3.2)

Both live in `src/lib/components/chat/Composer.svelte`, which already loads MCP state
(`:103-154`) and renders the Tools dropdown (`:189-219`). Model the new affordances on that
dropdown + the existing `Plug` icon button.

### Resources (per-chat)
- A **Resources** dropdown (icon button, e.g. `FileText` from `@lucide/svelte`), shown when
  `getMountedResources()` is non-empty. Content: grouped by server → a `DropdownMenuItem`
  per resource (`name` + `uri` muted); clicking calls
  `readResourceForAttach(serverId, uri)` → on success `repos.mcp.addAttachment(chatId, …)`
  and reloads the attachment list; on error, `toastState.push`.
- **Attached-resource chips** above the textarea (next to the suggested-replies row,
  `:171-179`): one removable chip per `repos.mcp.listAttachments(chatId)` entry showing
  `serverName: name`; an `×` calls `repos.mcp.removeAttachment`. These re-render via an
  `$effect` keyed on `chatId` (like `loadMcpServers` at `:134-137`).
- Attachments are read-only context (the chips make that visible); the model sees them as the
  system note from M3.1e on the next turn — no separate "send" step.

### Prompts (composer)
- An **Insert MCP prompt →** dropdown (icon button, e.g. `MessageSquarePlus`), shown when
  `getMountedPrompts()` is non-empty. Content: grouped by server → prompt name + muted
  description. Selecting one:
  - If the prompt declares `arguments`, render a minimal prompt() / inline inputs is **out of
    scope for v1** — instead, if `arguments` exist and are required, insert a placeholder
    template with the arg names for the user to fill (e.g. `"<arg1>"`) and toast
    "fill in the placeholders"; if no arguments, call `renderPrompt(serverId, name)` and set
    `prompt = text`. (Argument UI is a documented v1 limitation — prompts with args still
    work, just via placeholder substitution.)
  - Always **set `prompt`** (the bindable draft), never call `onSend` — the user reviews and
    sends. Append to existing draft text rather than overwriting (separate with `\n\n`).
  - On `renderPrompt` error → toast, leave the draft unchanged.

### Settings discovery (small, optional but recommended)
- `src/lib/mcp/lifecycle.ts` `testConnection` (`:42-58`) — extend the success return to also
  carry `resources` and `prompts` (call `client.resourcesList()`/`promptsList()` inside the
  same try, tolerating absence). `McpServers.svelte`'s Test-connection result render already
  lists tools — add resources/prompts counts beside it. This makes the M3 surfaces visible at
  config time without new UI machinery.

**DoD:** from `/chat`, a resource-capable server's resources are browsable + attachable (chip
appears, model sees the content next turn, chip removable); a prompt-capable server's prompts
are insertable as an editable draft.

---

## M3 — Acceptance gate (manual, either runtime)

1. **Resources — attach into context.** Configure a resource-capable MCP server (e.g. a
   server exposing `resources/list` + `resources/read` — the `tests/fixtures/stub-mcp-server.mjs`
   from M1 can be extended with a canned resource, or use a real one like the Filesystem
   server). In `/chat` → open the **Resources** dropdown → attach a resource → a chip
   appears. Send any prompt → the model's reply references the attached resource content
   (proving the system-note injection). Reload → the chip + its snapshot survive (settings
   KV); detach (×) → the content is gone on the next turn.
2. **Resources — agent pull-on-demand.** With the server enabled for the chat, ask the agent
   to "read the resource at `<uri>`" → it calls `mcp_read_resource` (readonly, **no
   per-call approval prompt**) → the truncated content renders as a tool result. In a chat
   with the server disabled, `mcp_read_resource` is **not** offered to the model.
3. **Prompts — insert as draft.** Configure a prompt-capable server → composer **Insert MCP
   prompt →** menu lists its prompts → select one → the rendered text lands in the composer
   as an **editable draft** (not auto-sent) → edit + send normally. A multi-message prompt
   shows role labels.
4. **Capability honesty.** A server that does **not** advertise `resources`/`prompts` shows
   no Resources/Prompts affordances and never errors (the mount is a no-op).
5. **Both runtimes.** Repeat 1–3 in the browser (HTTP server) and on desktop (stdio server).
   No per-call change vs M1/M2 — the mounter/loop/approval path is untouched.
6. **Security check:** attached-resource snapshots live under `mcp.attachments:<chatId>` in
   the `settings` table (inspect with a SQLite client); server env/header secrets remain in
   the `KeyStore` (unchanged from M1/M2).

`pnpm lint && pnpm check && pnpm test` green. Re-run the existing P1 `/chat` streaming gate,
the M1 Brave gate, and the M2 browser-HTTP gate — all unchanged with no MCP servers
configured, and unchanged behavior for tools-only servers (resources/prompts mounts are
no-ops when the capability is absent).

---

## Dependency graph + recommended sequence

```
M3.1a (types) ─┬─→ M3.1b (client methods) ─┬─→ M3.1c (resources module + tool) ──→ M3.1d (mounter) ──→ M3.1e (attach + context) ──→ M3.1f (per-chat) ─┐
               │                            │                                                                                                              │
               └─→ (prompts DTOs in M3.1a) ─┴─→ M3.2a (prompts module) ──→ M3.2c (lifecycle helpers) ───────────────────────────────────────────────────┤
                                                                                                                                                  ↓
                                                                                                                            UI (Resources panel + Prompts menu)
```

- **M3.1a** (types/DTOs) is the root — it unblocks both surfaces. Do it first; it's tiny and
  CI-green on its own.
- **M3.1b** (client methods + capability getters) depends only on M3.1a. Land it next;
  `client.test.ts` extends against the fake. **At this point all existing M1/M2 tests still
  pass** (fakes return `capabilities: {}`).
- **M3.1c** (resources module + global tool) and **M3.2a** (prompts module) are independent
  of each other — do them in parallel; each is pure + unit-tested against a fake client.
- **M3.1d** (mounter hooks) wires both modules into `mountMcpServer`; needs M3.1c + M3.2a.
  Extend `mount.test.ts`: a capabilities-advertising fake mounts resources/prompts; a `{}`-
  capabilities fake is a no-op.
- **M3.1e** (attach persistence + context injection) and **M3.2c** (lifecycle helpers) land
  once their modules exist.
- **M3.1f** (per-chat `mcp_read_resource` disable) + **M3.1g** (preamble) + the **UI** land
  last; they're the integration layer.
- Land in order **M3.1a → M3.1b → (M3.1c ‖ M3.2a) → M3.1d → (M3.1e ‖ M3.2c) → M3.1f/g → UI**,
  keeping the tree green after each. All of M3 is `pnpm test`-covered (no manual/desktop
  dependency for CI).

## Risks (M3-specific)

- **Resource-content size / context blowup.** A large resource attached (or many attached)
  bloats the system prompt. Mitigation: `resultCapBytes` (default ~8KiB) is enforced at
  attach **and** at `mcp_read_resource` time; attachments are explicit user actions
  (chip-visible, removable); the snapshot is per-chat. Flag if real servers routinely exceed
  the cap — the note already carries the `[truncated]` marker.
- **Stale snapshots.** The attached content is a point-in-time read; the underlying resource
  may change. Mitigation: documented (attach = snapshot); re-attach refreshes; the chip makes
  "this is attached context" explicit. (Live re-read at turn time was explicitly rejected —
  fork 1 — for decoupling + purity.)
- **`mcp_read_resource` discoverability.** The model must know valid `serverId`/`uri` pairs
  to call the tool. Mitigation: the preamble line (M3.1g) + attached resources (M3.1e) name
  them; the tool description restricts to "URIs listed in the Resources context." If the
  model hallucinates a URI, `readResource` returns `ok:false` cleanly (no throw).
- **Capability negotiation drift.** Servers vary in whether they populate
  `capabilities.resources`/`prompts` even when they support the methods. Mitigation:
  `hasResources`/`hasPrompts` gate the mount (honest negotiation); a server that omits the
  capability simply shows no surface (safe). An opt-in "try anyway" is out of scope for v1.
- **`prompts/get` with arguments.** v1 has no argument UI (placeholder substitution only).
  Mitigation: documented limitation; prompts with required args insert placeholders + a toast.
  A real arg form is a small future addition (the `McpPrompt.arguments` schema is already
  typed at `types.ts:43`).
- **Per-server cap lookup correctness.** `mcp_read_resource` is global but uses the
  *looked-up* server's cap/timeout. If two servers share a URI scheme the `serverId` arg
  disambiguates (the model passes it). Edge case: a server unmounts mid-turn → the entry is
  gone → `readResource` returns `ok:false 'unknown resource server'` (clean, no throw).

## Out of scope for M3 (defer)

- Argument UI for `prompts/get` (placeholder substitution only in v1).
- `roots` (filesystem scoping); the lazy `search_mcp_tools` meta-tool.
- Live resource re-read at turn time (snapshots only — fork 1).
- Sampling + elicitation (M4 — the reverse-direction, cost-bearing surfaces).
- Resource *subscriptions* (`resources/subscribe` + `notifications/resources/updated` for
  live-updating attached snapshots) — v1 uses point-in-time snapshots; subscriptions are an
  M3+ refinement if live updates are requested.
- `docs/guide/mcp.qmd` resources/prompts walkthrough (fold in after the M3 gate passes).
