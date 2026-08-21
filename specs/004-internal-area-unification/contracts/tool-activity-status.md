# Contract: Tool Activity Presentation (`ToolActivity`)

**Seam**: `src/lib/components/chat/rows/ToolActivity.svelte`. Inputs: `ToolGroup | OrphanToolResult` (with the derived status fields from [timeline-assembly.md](./timeline-assembly.md)). Classification source: `$lib/agent/registry` only — no UI-side tool-name lists (constitution III / FR-003).

## Status presentation table (FR-002 / FR-003)

| Status                        | Icon                                | Label / line                                   | "No result recorded"                                      |
| ----------------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| awaiting                      | amber hourglass (or pulsing circle) | waiting cue (e.g. "Waiting for your approval") | **never**                                                 |
| running                       | muted pulsing icon                  | tool name only                                 | never                                                     |
| declined / aborted            | muted struck icon                   | outcome word ("Declined" / "Aborted")          | never                                                     |
| succeeded                     | green check (existing)              | summary line (see below)                       | n/a                                                       |
| failed                        | red X (existing vocabulary)         | summary line                                   | n/a                                                       |
| genuine gap (003, kept)       | red X                               | —                                              | **shown** (non-terminal, unpaired, not streaming, no ask) |
| terminal unpaired (003, kept) | muted circle                        | tool name only                                 | never                                                     |

A paired failed result keeps the red X even for terminal tools (it has a result — 003 rule).

## Result body (FR-004 / FR-005)

```text
collapsed (default):
  header row   = icon + tool name (artifact-linked when metadata.artifact exists — unchanged)
  summary line = stored content, single line, CSS truncate (ellipsis)   ← the ONLY visible payload text

expander ("Show result"):
  shown when   = content length > SUMMARY_THRESHOLD (≈160 chars) OR structured detail present
  contents     = full content in <pre class="max-h-60 overflow-y-auto …"> (existing bounded pattern)
                + detail JSON below it when present
  collapsible again; never an unbounded block
```

- Threshold constant lives beside the component (or `kinds.ts`) — presentation-only.
- Stored content is never mutated; provider context sees it verbatim (golden tests).
- Short summaries (deterministic tools) render exactly as before — no expander, no clamp visible.

## Sources row

`ToolSources` rendering (extracted URLs) is unchanged.

## Regression bars

1. Awaiting fixture (live pending or undecided row) renders **no** failure icon and **no** "No result recorded" — fails on current code.
2. The 8KB brave_web_search fixture renders one truncated line collapsed by default with a bounded expander — fails on current code (wall of text).
3. Genuine-gap fixture (abort mid non-terminal call, not streaming) keeps failure mark + message; terminal fixture keeps neutral mark — guards the 003 contract.
4. Declined fixture is distinguishable from failed fixture by icon/label.
5. `ok: false` paired fixture → red X; legacy (no `ok`) paired fixture → green check.
