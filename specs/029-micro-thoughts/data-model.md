# Data Model: Micro-Thought Streams (Interleaved Reasoning)

**Feature**: 029-micro-thoughts | **Date**: 2026-11-09

No schema change. All entities below reuse existing tables/seams; new shapes are additive
in-memory state and additive metadata flags.

## Entities

### 1. ReasoningSegment (stream-level, transient)

A contiguous burst of the model's reasoning within one agent-loop iteration.

| Field | Type | Notes |
|---|---|---|
| `ordinal` | number | Arrival index among reasoning segments of the iteration |
| `text` | string | Accumulated delta text (from `reasoning-delta.text`) |
| `open` | boolean | `true` from `reasoning-start` until a close event |

**Boundary rules** (from `consumeStream`, contract: [contracts/stream-segments.md](./contracts/stream-segments.md)):
- Every `reasoning-start` opens a NEW segment — SDK `id` is ignored (openai-compatible
  reuses `"reasoning-0"`; `@ai-sdk/openai-compatible@3.0.2 dist/index.js:834-884`).
- A segment closes on: `reasoning-end`, `text-start` (text resumes), `tool-call`,
  `finish`, error, or abort.
- Segments whose accumulated text is empty/whitespace-only are dropped (never rendered,
  never persisted).

**State transitions**: `closed → open` on `reasoning-start`; `open → closed` on any close
event; deltas only append while open (deltas outside an open segment are tolerated by
implicitly opening a segment — defensive, mirrors provider flush behavior).

### 2. TextSegment boundary (stream-level, transient)

Text remains a single concatenated `streamBuffer`; an ordered `textBreaks: number[]` (or
equivalent offsets carried by live text blocks) marks where a NEW text stretch begins
(after a closed reasoning segment resumed text). Text block *i* =
`streamBuffer.slice(breaks[i], breaks[i+1] ?? end)`.

- First `text-start` of an iteration records offset 0 (no split); a subsequent
  `text-start` after reasoning records the current buffer length (split).
- Critic, usage, self-corrected, and abort-residual logic operate on the concatenated
  buffer, unchanged.

### 3. LiveBlock (store live state, transient)

Ordered display model for the streaming turn, replacing the single `reasoningBuffer`:

```ts
type LiveBlock =
  | { kind: 'reasoning'; text: string; open: boolean }        // rendered by ReasoningEntry (live)
  | { kind: 'text'; start: number; open: boolean };           // text = slice of paced streamBuffer
```

- Stored on `ChatState` (replaces `reasoningBuffer`), updated by the loop's segment
  callbacks in arrival order; cleared at turn start/teardown
  (`chat.svelte.ts:502-511, 825-834` pattern).
- `liveItems` getter (`chat.svelte.ts:293-355`) emits one timeline entry per block, in
  list order: reasoning → `LiveReasoningEntry` (per block, keyed per segment); text →
  `LiveTextEntry` whose `buffer` is the block's slice of the **paced visible prefix**
  (`flushRender`, `chat.svelte.ts:231-246`) with `pending: true` only on the last open
  text block.

### 4. Persisted rows (durable — `messages` table, unchanged shape)

Walk of the iteration's blocks at stream end or abort, persisted in arrival order via
`repos.messages.append` (ord = sequential integer appends, `repositories/messages.ts:21-82`):

| Block | Row |
|---|---|
| reasoning block | `kind:'reasoning'`, `role:'assistant'`, `content` = segment text, `metadata` = `{"iteration": N, "anchored": true}` |
| text block | `kind:'assistant_message'`, `role:'assistant'`, `content` = block text, `metadata` = `{"model": ...}` (as today) |

Rules:
- **Single-segment turns** (1 reasoning block + 1 text block, the common case) persist
  exactly today's rows: `[reasoning?, assistant_message]` — byte-identical to
  `loop.ts:430-436` + `chat.svelte.ts:711-718` behavior (FR-005, SC-003).
- **Interleaved turns** (≥2 reasoning or ≥2 text blocks) persist multiple rows in
  `ord` order; consecutive `assistant_message` rows project as ONE assistant turn to the
  model (projection merges consecutive same-role parts, `projection.ts:258-272`) — the
  model never sees the split (FR-006 unchanged).
- Reasoning rows stay in `EXCLUDED_KINDS` (`projection.ts:12-18`) — never re-sent.
- Usage (`repos.messages.recordUsage`, guard `kind==='assistant_message'`,
  `repositories/messages.ts:232-266`) anchors to the **final** text row;
  `builder.assistantMessageId` = last persisted text row.
- Abort persists the blocks received so far (partial text/reasoning kept) before the
  interrupted-text handling in `chat.svelte.ts:815-824` (FR-008).
- Empty blocks produce no rows.

### 5. `ReasoningMeta` (metadata contract, additive)

```ts
// src/lib/chat/kinds.ts:86-89 (extended)
type ReasoningMeta = SharedMetadata & {
  iteration: number;
  model?: string;
  anchored?: true;   // NEW: position is authoritative — display order must NOT be repaired
};
```

- `anchored` is written by this feature's persistence path only. Legacy rows lack it and
  remain fully valid (no migration).

### 6. Display canonicalizer (presentation rule, `entries.ts`)

`reorderTurn` v2 (`entries.ts:279-300`):
- Reasoning row **with** `anchored: true` → keep persisted position (never spliced).
- Reasoning row **without** `anchored` → repaired to directly before its turn's
  `assistant_message`, exactly as today (003 US3 semantics preserved).
- Both variants: never cross tool activity or user boundaries (unchanged).

**Validation rules recap** (from spec): history reload must reproduce segment count,
content, and order (SC-002); single-block providers unchanged (SC-003); interleaved rows
excluded from context (FR-006); anchored rows immune to hoisting (FR-004).

### 7. Trace (diagnostics, minor)

`TurnTrace.iterations[]` (`src/lib/agent/trace.ts:48-63`) gains
`reasoningSegments: string[]` alongside the existing concatenated `reasoning: string`
(retained for continuity); raw `reasoning-start`/`reasoning-end` parts already flow into
`partSequence` (`TraceBuilder.emit`, `trace.ts:165-208`) — no trace-event schema change.
DiagnosticsPanel keeps working from existing fields; segment list is a read-side nicety.

## Relationships

```text
Assistant turn (1 reply)
├── LiveBlock[] (ordered, transient)          ──persist-as→  rows in ord order
│     ├── ReasoningSegment(s)                 ──→   messages{kind:'reasoning', metadata.anchored}
│     └── TextSegment(s) (streamBuffer slices)──→   messages{kind:'assistant_message'}  (1..n rows)
└── projection → one assistant ModelMessage (text parts merged; reasoning dropped)
```

## Consumer audit (required by D3 risk note)

Tasks must verify tolerance of multiple `assistant_message` rows per iteration for:
branch/backprop `builder.assistantMessageId` consumers, `present_choices` turn-scoping
(`appendAssistantToolCall`, `chat.svelte.ts:653-679`), `self_corrected`
`finalTextLength`, expound offsets (per-row source maps — rows are self-contained), and
Dev strategy lint. Each consumer keys off the last/whole-turn text; expected verdict:
compatible, but the audit is a checklist item, not an assumption.
