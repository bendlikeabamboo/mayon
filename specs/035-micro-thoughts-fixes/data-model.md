# Data Model: Micro-Thoughts Follow-Up Fixes (035)

**Feature**: 035-micro-thoughts-fixes | **Date**: 2026-11-10

No schema change. All amendments are transient state, callback surface, and pure view-model
shapes; durable row shapes are untouched (029 persistence contract rows stay
byte-identical).

## Entities

### 1. LiveBlock (store, amended — 029 data-model §3)

```ts
type LiveBlock =
  | { kind: 'reasoning'; text: string; open: boolean }
  | { kind: 'text'; start: number; open: boolean };
```

Shape unchanged; semantics amended:

| Rule | Before (029) | After (035) |
|---|---|---|
| Clear points | turn start / load / teardown | + iteration boundaries (`onIterationBoundary` dep) |
| `open` on reasoning | only closed at teardown | closed when the next reasoning/text segment starts |
| `open` in `liveItems` | ignored for reasoning | surfaced as `streaming` on the live reasoning entry |

Validation: a reasoning block pushed by `onReasoningSegmentStart` starts `open: true`; any
later block-start closes every open block; an iteration boundary replaces the list with
`[]` (durable rows already persisted).

### 2. LiveReasoningEntry (view model, amended)

```ts
interface LiveReasoningEntry {
  source: 'live';
  live: 'live_reasoning';
  buffer: string;
  streaming: boolean; // NEW: block.open at emit time
}
```

Consumed by `MessageList` → `ReasoningEntry` (live variant shows the pulsing dot only
while `streaming !== false`). `LiveTextEntry` / `LiveAskEntry` unchanged.

### 3. AgentTurnDeps (callback surface, amended)

```ts
onIterationBoundary?: () => void; // NEW (optional): fired by the loop after each
                                  // iteration's persist sites and at critic
                                  // correction re-emit start
```

All existing callbacks keep their signatures (029 stream-segments contract note preserved).
The store's implementation clears `liveBlocks`. Firing sites are normative in
[contracts/iteration-boundary.md](./contracts/iteration-boundary.md).

### 4. PersistBlock (loop-internal, unchanged shape)

```ts
type PersistBlock = { kind: 'reasoning'; text: string } | { kind: 'text'; start: number };
```

Amended lifecycle: a critic-corrected finalize consumes the reasoning entries (one
`appendReasoning` per non-whitespace block, arrival order, then clear) before the single
corrected text append. The no-correction path keeps the exclusive `walkPersist` consume —
exactly one writer per iteration, no double-persist (see
[contracts/corrected-persist.md](./contracts/corrected-persist.md)).

### 5. Assistant turn (timeline notion, new — for regenerate)

- Definition: the maximal run of non-`user` messages following a `user` message (up to the
  next `user` message or end). Includes reasoning, assistant text, self-corrected, tool
  call/result, and ask rows.
- `lastRegeneratableAssistantId(timeline)` (new pure export, `src/lib/chat/entries.ts`):
  from the timeline end, skip durable `reasoning` items whose metadata `anchored === true`;
  the next item must be a durable `assistant_message` — return its entry id, else `null`.
  Unanchored (legacy) trailing reasoning does NOT qualify.
- `deleteLastAssistantTurn(assistantRowId)` (new store method): deletes every message after
  the previous `user` row and returns `{userText, attachments}` for the resend. See
  [contracts/regenerate-scope.md](./contracts/regenerate-scope.md).

### 6. Trace iteration state (amended — reasoningSegments only)

`reasoningSegments: string[]` gains two prune points: a trailing whitespace-only segment is
dropped when its segment closes (`reasoning-end`) or the stream finishes (`finish`), in
addition to the existing next-`reasoning-start` prune. Non-whitespace trailing segments are
never dropped.
