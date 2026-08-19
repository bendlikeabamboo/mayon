# Data Model: Brave Search MCP Service

**Feature**: specs/001-brave-search-mcp | **Revised**: 2026-08-19 (research.md R-9)

**Headline**: no database migrations. Every entity is either (a) an existing structure
gaining a new instance/value, or (b) a transient derived value.

## Entities

### 1. Search Connection (existing `McpServerConfig` in `settings['mcpServers']`)

New instance created from the template, with:

| Field              | Value                                                                               | Notes                                                       |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `transport`        | `'stdio'`                                                                           | existing union member                                       |
| `command` / `args` | `npx` / `['-y', '@brave/brave-search-mcp-server@<pinned>', '--transport', 'stdio']` | pinned package; upgrades ride app releases                  |
| `env`              | `{ BRAVE_API_KEY: { secretRef: '<keystore id>' } }`                                 | reference only — the key itself never enters this structure |
| `enabled`          | user toggle                                                                         | existing global control                                     |
| `trustedHash`      | set after trust prompt                                                              | existing `requiresTrust: true` flow                         |

- **Validation**: spawn requires the referenced secret to exist (`MissingKeyError`
  otherwise); key validity is checked by Brave at search time, not at handshake.
- **Lifecycle**: identical to every other stdio MCP server (add → key → trust →
  enable → per-session spawn via `connectSession`, unmount at turn end).

### 2. Search Credential (existing app secret store)

- The user's Brave API key, stored via the MCP keystore (`mcp:<serverId>:BRAVE_API_KEY`)
  in IndexedDB and injected as child-process env at spawn time over the same-origin WS
  bridge. Rotation = save in app; next session picks it up.

### 3. Search Tool (existing registry entries, transient per session)

- Mounted as `mcp.<serverId>.<toolName>` (e.g. `brave_web_search`) by `mount.ts`;
  subject to the existing 64-tools-per-call cap and per-chat allow/deny lists.
- No new tool shapes; the official server's toolset is taken as given.

### 4. Per-conversation toggles (existing `ChatMcpConfig` on `chats.mcpConfig`)

- Unchanged shape `{ [serverId]: { enabled, tools? } }`; participates automatically
  through the existing Composer toggle UI.

### 5. Search Citation (derived, transient — NOT persisted)

- **Source of truth**: existing `messages` rows with `role='tool'`, whose `metadata`
  column stores `{ serverId, toolName, content: McpContent[] }` (unchanged pipeline:
  `mount.ts` detail → `messagesRepo.appendToolResult`).
- **Derivation**: `extractSources(detail)` (src/lib/mcp/sources.ts) parses text content
  as JSON, collects `title`/`url` (plus `source`/`origin` page URLs), dedupes by URL,
  caps at 10; pure, never throws; renders retroactively for old messages.

## Removed in the R-9 revision

The `brave-search` server capability, the `/api/brave-search/*` proxy route, and the
companion-container deployment configuration (`BRAVE_API_KEY` / `BRAVE_SEARCH_URL` /
compose profile) no longer exist. See research.md R-9.

## Migration impact

None. No schema change, no drizzle migration, no settings-key changes beyond the
ordinary `mcpServers` map gaining one entry per user-added connection.
