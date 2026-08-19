# Contract: Tool-result sources (citations) rendering

**Feature**: specs/001-brave-search-mcp | **Consumers**: `MessageRow.svelte`,
`src/lib/mcp/sources.ts`. Satisfies FR-004 / SC-003.

## Input (existing persisted shape — no changes)

`messages` rows with `role='tool'` carry:

```jsonc
// metadata column (already written today by mount.ts → messagesRepo.appendToolResult)
{
	"serverId": "<mcp server id>",
	"toolName": "brave_web_search",
	"content": [{ "type": "text", "text": "<JSON produced by the Brave tool>" }]
}
```

Brave v2.x tools return JSON (arrays/objects) whose items include `title` and `url`
fields (web/news/image/video/local results all carry `url`; v2 removed base64 payloads
in favor of URLs).

## Extractor — `extractSources(detail: unknown): ToolSource[]`

Pure function, `src/lib/mcp/sources.ts`, `ToolSource = { title: string; url: string }`:

1. For each content item with `type === 'text'`, attempt `JSON.parse(text)`; on failure,
   scan the raw text for `https?://` URLs and use the host as title fallback.
2. Walk the parsed value (array or object) collecting objects that have a string `url`
   matching `^https?://`; take `title` (string, trimmed, max ~120 chars) defaulting to
   the URL.
3. Dedupe by URL, preserve first-seen order, cap the list (e.g. 10).
4. Any malformed input (missing content, non-array, unparseable) yields `[]` — never
   throws. Only Brave-shaped data produces sources; other MCP tools' results typically
   produce none, which renders nothing.

## Renderer — `ToolSources.svelte`

- Mounted from `MessageRow.svelte` for non-hidden `role='tool'` rows:
  `extractSources(parsedMetadata)` → if non-empty, render under the existing muted
  tool-summary label.
- Visual: a compact list of external links (`target="_blank" rel="noopener noreferrer"`),
  styled with the existing muted-foreground/text-xs vocabulary (constitution III); no
  new primitives.
- Sources are derived at render time from persisted metadata: historical messages gain
  citations retroactively; no write path, no re-indexing, idempotent re-renders.

## Out of scope

- Re-contextualization: model-visible tool summaries (`content`) are unchanged — the
  model already receives Brave's result text.
- Persisting sources as a first-class table (rejected in research R-6).
