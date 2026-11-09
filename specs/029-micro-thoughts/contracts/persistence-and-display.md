# Contract: Persistence & Display (anchored rows, reorderTurn v2, live timeline)

**Feature**: 029-micro-thoughts | **Owners**: `src/lib/stores/chat.svelte.ts`,
`src/lib/agent/loop.ts`, `src/lib/chat/entries.ts`, `src/lib/chat/kinds.ts`

## Persistence contract (loop → store, at iteration end or abort)

```ts
// Loop walks the iteration's blocks and calls, in arrival order:
appendReasoning(text: string, iteration: number)   // → row {kind:'reasoning',
                                                   //    metadata:{iteration, anchored:true}}
appendAssistantText(content: string, opts?)        // called ONCE PER text block when the
                                                   //  iteration has >1 text block; called
                                                   //  once with the full buffer otherwise
                                                   //  (single-segment case identical to today)
```

Normative rules:

1. **Order**: rows are appended in arrival order → monotonic `ord`
   (`repos.messages.append`, `repositories/messages.ts:21-82`). No fractional `ord` is
   needed by this feature (appends are strictly ordered at iteration end).
2. **Reasoning rows**: `content` = segment text; `metadata` =
   `{"iteration": N, "anchored": true}` (`ReasoningMeta`, `kinds.ts:86-89`). Empty or
   whitespace-only segments produce NO row.
3. **Text rows**: single-block iterations persist one `assistant_message` row with the
   full buffer (today's exact behavior, `chat.svelte.ts:622-652`). Multi-block
   iterations persist one row per text block, concatenated contents equal the buffer
   (lossless split — verified by test).
4. **Anchors**: `builder.assistantMessageId` and usage (`repos.messages.recordUsage`,
   guarded to `assistant_message`, `repositories/messages.ts:232-266`) bind to the LAST
   text row of the turn.
5. **Abort**: blocks received so far are persisted (partial text and partial reasoning
   kept) before the interrupted-text row handling (`chat.svelte.ts:815-824`); an open
   block at abort is closed and persisted with its partial text (FR-008).
6. **Critic/self-corrected/usage inputs remain the concatenated buffer** — unchanged
   code paths; `self_corrected.finalTextLength` refers to the concatenated length as
   today.
7. **Projection is untouched**: `EXCLUDED_KINDS` keeps `reasoning`
   (`projection.ts:12-18`); consecutive `assistant_message` rows merge into one
   assistant turn for the model (`projection.ts:258-272`) — the model never observes the
   split (FR-006).

## Display contract — durable timeline (`entries.ts`)

`reorderTurn` v2 (replacing `entries.ts:279-300` semantics):

- Parse `metadata` as `ReasoningMeta`; `anchored === true` ⇒ the row's position is
  **authoritative** — `reorderTurn`/`canonicalizeOrder` MUST NOT move it.
- `anchored` absent (legacy rows) ⇒ repair exactly as today: splice directly before the
  turn's `assistant_message`, stopping at tool rows and user boundaries
  (003 US3 preserved; all pre-029 data keeps rendering as before — SC-003).
- Multi-row interleaved turns: `MessageList` renders each `assistant_message` row as its
  own message entry (existing per-row rendering); each `reasoning` row renders as its own
  `ReasoningEntry` collapsible in `ord` position (existing component, existing keys by
  message `id` — `MessageList.svelte:190-191, 107-114`).

## Display contract — live timeline (`chat.svelte.ts` `liveItems`)

- `liveItems` emits one entry per `LiveBlock` in list order:
  - reasoning block → `{source:'live', live:'live_reasoning', buffer: block.text}`
    (rendered by `ReasoningEntry live` variant — pulsing dot, auto-expanded while
    streaming, `rows/ReasoningEntry.svelte:20-44`);
  - text block → `{source:'live', live:'live_text', buffer: visibleSlice(block),
    pending: block is last && open}` where `visibleSlice` derives from the paced visible
    prefix over `streamBuffer` (`flushRender`, `chat.svelte.ts:231-246`; pacer untouched).
- Entry keys must be unique per block (live reasoning entries gain a per-block key —
  `itemId()` extension, `MessageList.svelte:107-114`).
- Rapid successive blocks: append-only list; already-rendered entries keep their keys ⇒
  no layout jumping of visible content (FR-011).
- Collapsed-by-default after completion comes free from the durable `ReasoningEntry`
  (durable variant defaults collapsed).

## Invariants / acceptance hooks for tests

1. Interleaved scripted stream `[R-start, Rδ, R-end, Tδ…, R-start, Rδ, R-end, Tδ…]`
   persists rows in order `[reasoning, text, reasoning, text]` with `anchored:true` on
   reasoning rows, and survives reload with identical order (SC-001/SC-002).
2. Single-segment stream persists `[reasoning?, text]` and renders identically to
   pre-029 (FR-005) — asserted as a byte-level row-shape test.
3. Legacy fixture (unanchored reasoning row after an assistant row) is still repaired to
   pre-answer (US3 regression guard).
4. Reasoning rows of any flavor never appear in `projectEntries` output.
5. Abort mid-interleave persists received blocks; nothing after abort; no open live
   entries remain.
