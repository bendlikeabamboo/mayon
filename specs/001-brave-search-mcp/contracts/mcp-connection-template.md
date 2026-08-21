# Contract: MCP connection template (stdio + keystore)

**Feature**: specs/001-brave-search-mcp | **Consumers**: `McpServers.svelte`
(template gallery), `client-factory.ts`, `ServerStdioMcpTransport`
Revised 2026-08-19 per research.md R-9 — the earlier self-hosted HTTP template and the
capability/proxy path it depended on were removed.

## Template: "Brave Search"

The single Brave entry in `MCP_SERVER_TEMPLATES` (src/lib/mcp/templates.ts):

```ts
{
  label: 'Brave Search',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@brave/brave-search-mcp-server@<pinned-2.x>', '--transport', 'stdio'],
  env: { BRAVE_API_KEY: { secretRef: '' } },
  requiresTrust: true,
  discoverableTools: 'web search, local search, image search, video search, news search, summarizer, LLM context',
  platforms: ['desktop']
}
```

- **Availability**: gated on the existing `stdio-mcp` capability (Mayon server
  connected), like every stdio template; no feature-specific capability exists.
- **Instantiation**: one click pre-fills the draft config; the user enters the API key
  through the existing env-secret flow (stored via `setMcpSecret`, referenced by
  `secretRef` — never in the config payload persisted to settings) and completes the
  existing trust prompt.
- **Validation**: key presence is enforced at spawn (`MissingKeyError` when the
  referenced secret is absent); key _validity_ surfaces only when a search actually
  runs (the MCP handshake succeeds with a bad key).

## Runtime behavior (existing machinery, no changes)

- Per-session lifecycle: `connectSession()` spawns the pinned package inside the
  Mayon server via the WS stdio bridge with `BRAVE_API_KEY` resolved from the browser
  keystore at spawn (server-stdio.ts), mounts `mcp.<serverId>.<toolName>` tools,
  and unmounts at turn end.
- Global toggle: `McpServerConfig.enabled`. Per-chat toggle: `ChatMcpConfig`
  (`chats.mcpConfig`) via the Composer UI (FR-009).
- Key rotation: save the new key in the app; the next session's spawn uses it. No
  restarts (FR-005).
- Failure surface: missing key → `MissingKeyError` at connect; spawn/timeout failures
  and invalid key/quota errors → tool-result errors, turn completes with a notice
  (FR-006/FR-007).

## Retained general capability (from the removed container path)

`HttpMcpTransport` accepts root-relative same-origin URLs (in addition to absolute
`http(s)://`) for custom HTTP MCP servers; covered by tests in `http.test.ts`. No
shipped template currently uses it.
