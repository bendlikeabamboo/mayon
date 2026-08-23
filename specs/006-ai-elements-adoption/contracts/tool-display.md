# Contract — Tool Display (transcript rows)

UI contract for the P3 surface: tool-call presentation in the chat transcript,
ported onto the community tool-block structure (collapsible shell + status badge).

## Public surface

`ToolActivity.svelte` (same mount point, same `item: ToolGroup | OrphanToolResult`
prop) internally re-composed from:

```ts
// ui vocabulary (bits-ui Collapsible) + local pieces
Collapsible / CollapsibleTrigger / CollapsibleContent; // a11y-correct expand/collapse
Badge; // status chip
ToolHeader / ToolInput / ToolOutput; // ported structure (local files)
ToolResultBody; // RETAINED shape-driven renderer
ToolSources; // RETAINED source list
```

## Behavior contract

| ID   | Contract                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TD-1 | Every tool entry renders collapsed by default; the header always shows status icon/badge and tool name.                                                                                                                                                |
| TD-2 | Expand/collapse is available for every entry with input or output content (not only "verbose" ones); keyboard toggle uses the collapsible primitive's semantics (button + aria-expanded), replacing the hand-rolled `role="button"` + keydown handler. |
| TD-3 | Status set and derivation are unchanged: `awaiting / declined / aborted / running / failed / succeeded / terminal / gap` (logic retained from current implementation; covered by tests).                                                               |
| TD-4 | `failed`, `declined`, and `aborted` are distinguishable from `succeeded` in the collapsed header without expanding (color + icon + label).                                                                                                             |
| TD-5 | Artifact links (chat/lab/quiz) and source lists behave exactly as today, including click-through routing.                                                                                                                                              |
| TD-6 | Output bodies render via the retained `ToolResultBody` (shape-driven: records, artifacts, raw fallback) — no second code-rendering path is introduced.                                                                                                 |
| TD-7 | No auto-open/auto-close on streaming state changes: expansion is user-controlled only.                                                                                                                                                                 |
| TD-8 | Render-count perf marks (`incRender('TimelineRow')`) continue; row render cost must not regress measurably (perf probe comparison when enabled).                                                                                                       |

## Invariant guard (spec FR-006)

The tool row sits outside the markdown/expound DOM. Contract: no change to
`src/lib/markdown/**`, `src/lib/chat/selection.ts`, or message rendering; the expound
and tree test suites passing unchanged is the acceptance evidence.

## Consumers

`MessageList` → row dispatcher (unchanged prop contract: `item`).
