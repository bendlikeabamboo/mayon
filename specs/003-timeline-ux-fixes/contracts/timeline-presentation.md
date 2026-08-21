# Contract: Timeline Presentation Rules (fixes)

The repaired presentation seam for `assembleTimeline` + row renderers. Internal UI contract (no external interfaces change in this feature).

## assembleTimeline contract

```
assembleTimeline(messages: Message[], liveItems?: LiveEntry[]): TimelineItem[]
```

1. **Visibility**: hidden user prompts suppressed; choices-paired legacy results suppressed; everything else renders exactly once. No input row may vanish silently (orphan tool results get result-only presentation).
2. **Pairing**: `tool_call` ↔ `tool_result` join on `toolCallId` (never row id). Paired group sits at the result's position; unpaired call at the call's position. No end-of-timeline flush.
3. **Choices**: `kind === 'choices'` rows become `DurableEntry` items rendered by `ChoicesOffer` at their stored position (options + taken mark when a linked `user_message` exists).
4. **Canonical order pass** (post-assembly, stable, within turn — turn = span between visible user messages): a `reasoning` item positioned after an `assistant_message` with no tool activity between them moves to immediately before that assistant message. No other moves. Multi-iteration turns stored correctly are untouched.
5. **Live items**: appended after durable items (unchanged from 002); live reasoning/text positions must match where their durable forms will land (no reorder jump at persist).

## Renderer status rules (ToolActivity)

| Group state                           | Icon                     | Message                                   |
| ------------------------------------- | ------------------------ | ----------------------------------------- |
| paired, result ok                     | existing ok mark         | summary + collapsible detail (unchanged)  |
| paired, result failed                 | existing fail mark       | summary (unchanged)                       |
| unpaired, tool registry says terminal | neutral/muted tool glyph | none ("no result recorded" suppressed)    |
| unpaired, non-terminal                | existing fail mark       | "No result recorded" (genuine gap — kept) |

Terminality comes exclusively from `getToolDefinition(toolName)?.terminal === true` (the tool registry). The presentation layer MUST NOT contain a tool-name list.

## Spinner contract (AssistantMessage)

- Orbit spinner (label row) and "Thinking…" body render **only** for `live === true` items; durable rows never show either.
- Live → durable replacement removes the indicator in the same update (continuity rule from 002).

## Diagnostics rows contract (DiagnosticsPanel)

- Every keyed loop's key MUST be unique across its collection for any captured log, including repeated identical events. The MCP events loop keys by `kind + serverId + position`; other keyed loops in the panel are audited to the same bar.

## Regression bars (what the tests must prove)

1. Production-shaped pairing (distinct row id vs `toolCallId`) groups correctly — fails on the 002 code.
2. `choices` renders as an offer entry, never a tool group — fails on 002 code.
3. Unpaired call renders at its own position; terminal unpaired call carries no failure state; non-terminal unpaired keeps it.
4. Reorder pass turns `[text, reasoning]` into `[reasoning, text]` within the turn and no-ops correct order; never moves anything across a user message.
5. Loop persist order per iteration: reasoning before text/tool rows — fails on 002 code.
6. Diagnostics render with duplicated same-server lifecycle events does not throw.
7. Durable assistant row renders no spinner (component contract).
8. All 002 golden projection fixtures pass unmodified.
