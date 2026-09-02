# Phase 1 Data Model: Image-First Chat (Multimodal-Ready)

**Feature**: `018-image-chat-parts` | **Date**: 2026-09-02

## Entity: Message (extended)

Existing row in the `messages` table (`src/lib/db/schema.ts:53-88`). One new column; all
existing columns unchanged.

| Field | Type | Change | Rules |
|---|---|---|---|
| `id` | text PK | unchanged | |
| `chatId` | text FK→chats | unchanged | |
| `kind` | text enum | unchanged | `user_message` for parts-bearing user rows |
| `role` | text enum | unchanged | parts are produced for `user` rows in this release |
| `content` | text NOT NULL | **semantics pinned** | Canonical flat text = concatenation of the message's text parts, in order. Sole input to `search_vec` (generated) and all string consumers. Never contains base64 or part markup. |
| `parts` | text, nullable | **NEW** | JSON string encoding an ordered `MessagePart[]` (below). `null` ⇒ legacy row ⇒ derive `[{type:'text',text:content}]`. Max 8 image parts (validation at intake; DB does not enforce). |
| `ord`, `model`, `tokens`, `toolCallId`, `toolName`, `metadata`, `createdAt` | — | unchanged | |

**Invariant (constitution-gated)**: `search_vec` stays
`GENERATED ALWAYS AS (to_tsvector('simple', strip_search_noise(content))) STORED`
(`packages/shared/src/fts.ts`). Because `content` is kept equal to the text-part text, search
extracts from the text part by construction. No writes to `search_vec`, no reindex path.

**Migration**: one generated drizzle migration (`pnpm db:generate`):
`ALTER TABLE "messages" ADD COLUMN "parts" text;` — additive, nullable, no data backfill
(legacy rows read through the derivation rule). Applied at server boot and in pglite tests;
rides pg_dump/restore unchanged.

## Entity: MessagePart (value object, JSON-encoded inside `messages.parts`)

```jsonc
// messages.parts — JSON string of an ordered array; discriminator: "type"
[
  { "type": "text", "text": "why does this crash?" },
  {
    "type": "image",
    "data": "data:image/jpeg;base64,/9j/4AA...", // downsized data-URL (see D2/D3 in research.md)
    "mimeType": "image/jpeg",                    // always the encoded mime (jpeg after downsize; passthrough keeps source mime)
    "width": 1568,                               // pixel dimensions after downsizing
    "height": 940,
    "bytes": 412345,                             // encoded byte size (base64 decoded length)
    "name": "Screenshot 2026-09-02 at 15.41.03"  // optional, from file attach; absent for paste
  }
]
```

Validation rules (enforced at intake in `src/lib/chat/images.ts` + repo append):

- `type` ∈ `{ text, image }`; other kinds are forward-compat but MUST NOT be produced or
  persisted in this release (FR-014 — later slices add kinds; readers ignore unknown kinds
  gracefully).
- `text` part: non-empty string; text parts concatenate (in order) to form `content`.
- `image` part: `data` MUST be a `data:` URL with an accepted image mime
  (`image/png`, `image/jpeg`, `image/webp`, `image/gif`); `bytes` ≤ ~700 KB post-downsize
  target (soft, enforced at intake before store, not by DB); ≤ 8 image parts per message;
  original inputs > 20 MB rejected pre-decode.
- The array MUST contain ≥ 1 part; a parts-bearing row MUST have `content` equal to its text
  parts' concatenation (asserted in repo tests).

**Derivation rules** (single source of truth in `src/lib/chat/kinds.ts`):

- `partsOf(message): MessagePart[]` — parse `parts` JSON; `null`/malformed ⇒
  `[{type:'text', text: message.content}]`.
- `textOf(message): string` — join text-part texts; equals `message.content` for well-formed
  rows (used by UI/`ts_headline`-adjacent consumers).

## Entity: Provider Vision Capability (extended `ProviderConfig`)

`src/lib/ai/types.ts` `ProviderConfig` gains one optional non-secret handle field:

| Field | Type | Default | Rules |
|---|---|---|---|
| `vision` | `'auto' \| 'on' \| 'off'` | `'auto'` (absent ⇒ `'auto'`) | `'auto'`: resolve via static allowlist of vision-capable model-family prefixes; `'on'`: always advertised; `'off'`: never advertised |

- Resolved by `supportsVision(config, modelId): boolean` in `src/lib/ai/vision-capability.ts`
  (pattern: `toolCapability` resolver, `src/lib/agent/capability.ts`).
- Consumers: Composer paperclip visibility (FR-006); error posture stays permissive — an
  unadvertised model receiving an image yields a clear typed error (FR-007), never silent
  stripping.
- Persisted in settings under the existing `providers` map; no key/secret changes.

## Wire projections (derived, not stored)

| Layer | Shape | Notes |
|---|---|---|
| `ChatMessage` (`src/lib/ai/types.ts`) | `content: string` + optional `parts?: MessagePart[]` | `assembleContext` attaches parts; all existing string consumers keep using `content` |
| AI SDK `ModelMessage` (user row) | `content: [{type:'text',text}, {type:'image',image:dataURL}, …]` | built by `projectEntries` (`src/lib/chat/projection.ts`); SDK serializes per provider; server proxy forwards verbatim |
| Server `/api/llm/proxy` | unchanged opaque `LlmProxyRequest` | zero parsing; only the route `bodyLimit` changes (see contracts/http-limits.md) |

## State transitions

**Attachment (composer-local, not persisted until send)**

```text
intake (paste | paperclip)
  → validate mime/size (reject ⇒ clear message, no state)
  → downsize/encode (Canvas → JPEG ≤ ~500 KB)
  → attached (thumbnail, removable)
  → [send] included in the single user-row append → persisted (terminal, dies with the row)
  → [remove] dropped from draft (never stored)
```

**Send with parts (extends existing send flow)**

```text
send(text, attachments)
  → repos.messages.append(chatId,'user', textContent, { parts })   // one atomic insert
  → assembleContext (ChatMessage + parts)
  → projectEntries → ModelMessage parts → SDK → /api/llm/proxy → provider
  → success: assistant row(s) as today (text only)
  → failure: error surfaced (typed image-unsupported branch when applicable);
             retry deletes dangling user row and restores text + attachments
```

**Failed/malformed rows**: malformed `parts` JSON never blocks rendering — derivation falls
back to `[{type:'text',text:content}]` (self-healing read path, no DB write; mirrors the
existing stale-row self-heal convention).

## Relationships

- `MessagePart` is a value object inside `Message` — no independent identity, lifecycle, or
  table (created with the message, backed up with it, deleted with it; FR-008).
- `Provider Vision Capability` configures behavior of composer + error path; relates to
  `ProviderConfig` (1:1 field), never to messages.
- Forward-compat: future part kinds (voice/file/video) extend the `MessagePart` union only —
  no schema change anticipated beyond new optional part fields (FR-014 contract in
  contracts/message-parts.md).
