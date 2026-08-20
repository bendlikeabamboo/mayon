# Contract: Presentation Registry & Timeline Items

The single presentation seam: every timeline item — durable or live — renders through exactly one `kind → presentation` mapping. No role-based or column-combination branching may remain in any timeline presentation path (spec FR-008).

## TimelineItem union

```ts
type TimelineItem =
	| { source: 'durable'; entry: Entry } // one messages row (kind ∈ 10 values)
	| { source: 'durable'; group: ToolGroup } // tool_call + tool_result paired by toolCallId
	| { source: 'live'; live: LiveEntry }; // live_text | live_reasoning | live_ask
```

- `ToolGroup` pairs exactly one `tool_call` with at most one `tool_result` (`toolCallId` join at assembly time). Unpaired `tool_call` renders "no result recorded"; orphan `tool_result` renders standalone. A `tool_result` whose paired call is a `choices` offer is folded into the offer's unit and never rendered as a tool unit.
- Assembly is a pure function of the chat's ordered entries; `LazyMount` virtualization and the perf render counter carry over unchanged.

## Registry table

| kind / item                             | lane     | side  | chrome                                                                                                                 | collapsible              | collapsed by default   | renderer                |
| --------------------------------------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------- | ----------------------- |
| `user_message`                          | user     | right | foreground bubble (`--highlight`)                                                                                      | no                       | —                      | `UserMessage`           |
| `assistant_message`                     | external | left  | bordered bubble; Markdown + Highlighter + branch affordances; legacy `metadata.reasoning` renders as decoration toggle | reasoning: yes           | reasoning: yes         | `AssistantMessage`      |
| `reasoning`                             | internal | left  | quiet, no bounding box                                                                                                 | yes                      | yes                    | `ReasoningEntry`        |
| `tool_call`+`tool_result` (group)       | internal | left  | header (tool name, ok/fail from result), one-line summary                                                              | yes (detail)             | **yes**                | `ToolActivity`          |
| `tool_call` (unpaired)                  | internal | left  | header + "no result recorded"                                                                                          | yes                      | yes                    | `ToolActivity`          |
| `approval` / `sampling` / `elicitation` | internal | left  | ask line + outcome chip (approved/declined/allowed/denied/answered/undecided)                                          | yes (args/prompt detail) | yes                    | `AskEntry`              |
| `choices`                               | internal | left  | offer line: options as read-only chips; taken option marked when the linked `user_message` exists                      | no                       | —                      | `ChoicesOffer`          |
| `self_corrected`                        | internal | left  | note line                                                                                                              | yes (issues detail)      | yes                    | `SelfCorrected`         |
| `live_text`                             | external | left  | same bordered bubble as `assistant_message` (same renderer, `live` prop)                                               | no                       | —                      | `AssistantMessage live` |
| `live_reasoning`                        | internal | left  | same quiet styling as `reasoning` (same renderer, `live` prop)                                                         | yes                      | yes                    | `ReasoningEntry live`   |
| `live_ask`                              | internal | left  | interactive card (same `AskEntry` renderer, pending state with resolve callbacks)                                      | yes                      | expanded while pending | `AskEntry live`         |

### Hide rules (registry-level, from kind + decoration only)

- `user_message` with `metadata.hidden = true` → not rendered (synthetic note injection remains an assembly-time concern).
- `tool_call` with empty content renders only inside its group (never a blank standalone row).
- `tool_result` paired with a `choices` call → folded into `ChoicesOffer`, not rendered as a tool unit.

### Renderer props contract

Every renderer receives: `{ item, live?: boolean, personaName? }` plus the shared callbacks (`onExpound`, `onCopy`, `onBranchWhole`, `onRegenerate`) where the kind supports them (only `assistant_message`/`live_text` support expound/branch — content and offsets are untouched by this feature). Expanded/collapsed is component `$state` seeded from the registry; never persisted.

### Live/durable unification rule

A live item and its durable counterpart MUST resolve to the same renderer component; the only permitted differences are carried by the `live` prop (buffers, pending state, resolve callbacks). When a durable entry replaces its live counterpart, position, styling, and content are continuous (spec Story 4) — the registry guarantees this by construction because there is no second presentation path.
