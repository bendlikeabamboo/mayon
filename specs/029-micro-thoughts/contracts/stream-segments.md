# Contract: Stream Segments (fullStream → segment assembly)

**Feature**: 029-micro-thoughts | **Owner**: `src/lib/agent/loop.ts` (`consumeStream`) →
`src/lib/stores/chat.svelte.ts`

This is the internal contract between the agent loop's stream consumption and the chat
store. It extends the existing `AgentTurnDeps` callback surface
(`src/lib/agent/loop.ts:20-63`); existing callbacks keep their signatures.

## Part stream facts (verified against installed packages)

- `ai@7.0.4` fullStream part types (TextStreamPart, `node_modules/ai/dist/index.d.ts:2944-2975`):
  `{type:'reasoning-start', id}`, `{type:'reasoning-delta', id, text}`, `{type:'reasoning-end', id}`,
  `{type:'text-start', id}`, `{type:'text-delta', id, text}`, `{type:'text-end', id}`,
  `tool-call`, `finish`, `error`, `abort`, …
- `@ai-sdk/openai-compatible@3.0.2` (`dist/index.js:834-884`): parses SSE
  `choice.delta.reasoning_content ?? choice.delta.reasoning`; emits `reasoning-start`
  (id fixed `"reasoning-0"`), closes on first `content`/`tool_calls` delta, **re-opens** a
  new `reasoning-start` if reasoning resumes after text; `flush()` closes open segments.
- Consequence: **segment identity is positional; `id` MUST NOT be used to merge.**

## Segment state machine

```
state: no-open-segment | reasoning-open
on reasoning-start    → close any open reasoning segment; open NEW segment (ordinal++)
on reasoning-delta    → if no open segment, implicitly open one (defensive); append p.text
on reasoning-end      → close open segment (if any)
on text-start         → close open reasoning segment; if text previously streamed in this
                        iteration, record a text-split boundary at current buffer length
on text-delta         → append p.text to streamBuffer (unchanged)
on tool-call          → close open reasoning segment (existing generative-buf-clearing keeps today's semantics)
on finish | error | abort → close any open segment (no data loss; partial text kept)
```

## Callback contract (loop → store)

```ts
// Added/extended AgentTurnDeps surface (signatures normative):
onReasoningSegmentStart?: () => void;                    // opens a new live reasoning block
updateReasoningBuffer: (next: string) => void;           // RETAINED but now means:
                                                         //   text of the CURRENT (open/last) block
                                                         //   [see note]
onTextSegmentStart?: (startOffset: number) => void;      // records a text-split boundary
```

**Note on `updateReasoningBuffer`**: retained under its existing name to limit churn in
tests, but the store interprets it as "replace the text of the active reasoning block"
(it is always preceded by `onReasoningSegmentStart` in practice). Final persistence does
NOT read this buffer; it reads the store's block list (see
[persistence-and-display.md](./persistence-and-display.md)).

## Store contract (normative for `ChatState`)

- Live state: ordered `liveBlocks: LiveBlock[]` per
  [data-model.md §3](../data-model.md); updated synchronously on each callback (no
  debounce beyond the existing rAF render flush, `RENDER_INTERVAL_MS = 80`).
- `streamBuffer` remains the full concatenated text (pacer input, critic input, usage —
  all unchanged).
- On turn start: `liveBlocks = []`; on teardown/abort: all blocks closed, then cleared
  (existing `finally` block site, `chat.svelte.ts:794-900`).
- Error/abort MUST leave no `open: true` block rendered as live (lifecycle rule; prevents
  perpetual "thinking" spinner).

## Invariants

1. Block list order == stream arrival order (never re-sorted live).
2. Reasoning blocks never merge (no id-keyed accumulation).
3. Single-segment turns produce exactly the same live sequence as today:
   `[reasoning?, text]`.
4. `consumeStream` remains provider-agnostic — no provider names or wire fields appear in
   loop code; only SDK part types.
5. Whitespace-only reasoning segments are not surfaced as blocks.
