# Contract: Message Parts (storage + repository + composer)

**Feature**: `018-image-chat-parts` | **Status**: Draft (Phase 1)

The internal data contract for parts-based messages: how parts are encoded at rest, how the
repository exposes them, and how the composer hands them to the send flow. Consumers: chat
store, projection, message UI, search (indirectly via `content`).

## 1. At-rest encoding

- Column: `messages.parts` — nullable `text`, JSON string of `MessagePart[]`.
- Shape and validation rules: see [data-model.md](../data-model.md#entity-messagepart-value-object-json-encoded-inside-messagesparts).
- `messages.content` remains the canonical text: exactly the ordered concatenation of text
  parts. Writers MUST keep them consistent in the same INSERT; readers MUST NOT trust that
  consistency for safety (derive via `partsOf`, never parse `content` into parts).

## 2. Repository contract (`src/lib/db/repositories/messages.ts`)

```ts
// extended (backward compatible — all new parameters optional)
append(chatId, role, content: string, opts?: {
  model?: string; tokens?: number; toolCallId?: string; toolName?: string;
  metadata?: string; kind?: EntryKind;
  parts?: MessagePart[];        // NEW — serialized to JSON by the repo; validated:
                                //   ≥1 part, ≤8 image parts, text-parts concat === content
}): Promise<Message>
```

- When `parts` is provided, the repo serializes and stores it in the same INSERT as
  `content` (atomic — no orphaned images; FR-008/FR-015).
- When `parts` is omitted, the row is written exactly as today (`parts` stays NULL).
- No other repo functions change signature; `listByChat`/`getById` return the raw row and
  callers use `partsOf(message)` from `src/lib/chat/kinds.ts` to read parts.

## 3. Derivation helpers (`src/lib/chat/kinds.ts`)

```ts
function partsOf(m: Message): MessagePart[]   // null/malformed ⇒ [{type:'text',text:m.content}]
function textOf(m: Message): string           // ordered concat of text-part texts
```

- Readers (UI, store, projection, diagnostics) MUST use these instead of touching the
  `parts` column directly.
- Unknown part `type`s are preserved (not dropped) for forward-compat (FR-014) but rendered
  as nothing in this release.

## 4. Composer → store contract

```ts
// Composer.svelte onSend (extends the existing (text, effort) signature)
onSend(text: string, effort: ReasoningEffort, attachments?: ComposerAttachment[])

interface ComposerAttachment {
  part: ImagePart;        // fully downsized + encoded (see data-model.md); ready to store/send
  thumbnailDataUrl: string; // same data as part.data in v1 (single copy; no separate thumbnail asset)
}

// chat.svelte.ts send()
send(prompt: string, opts: { effort: ReasoningEffort; attachments?: ComposerAttachment[] })
```

- The composer owns intake: validation (mime, 20 MB pre-decode cap, ≤8 images), downsizing
  (1568 px / JPEG q0.85 / ≤500 KB target), thumbnail UI, removal. `send()` receives finished
  parts only — no async image work on the send path itself (keeps SC-007).
- Failure/retry: `lastFailedPrompt` state carries the attachments so Retry restores text +
  images; the dangling user row delete on retry already removes parts-bearing rows.

## 5. Wire projection contract (`src/lib/chat/projection.ts`)

- A user row with parts projects to AI SDK `ModelMessage` user content as ordered parts:
  `[{type:'text',text}, {type:'image',image:<dataURL>}, …]`.
- Rows without parts project exactly as today (text content) — byte-identical wire behavior
  for image-less conversations is a hard requirement (no regressions in existing tests).
- Provider request serialization is owned by the AI SDK; the server proxy forwards the body
  verbatim (pass-through; see contracts/http-limits.md).

## 6. Search contract (invariant)

- `search_vec` expression is NOT modified and MUST NOT be modified by implementation tasks.
- Searchable text for a parts-bearing row = its `content` = its text parts. Image data is
  never searchable (FR-010).
- Regression test required: append a parts-bearing row (text + image), assert full-text search
  finds it by its text-part words and returns a `ts_headline` snippet (extends
  `src/lib/db/repositories/search.test.ts`).
