# Contract: Message Parts (user + assistant sides)

**Feature**: 030 — Model-Generated Images in Chat · **Status**: Draft
**Supersedes/restates**: the 018-era `contracts/message-parts.md` (removed with specs/018; still cited by code comments — see research R-12).

This is the durable storage-and-rendering contract for typed parts on chat message rows. It extends the 018 user-side contract to assistant-originated and artifact-carried parts.

## §1 Canonical text

- `messages.content` is the canonical flat text of the row.
- The row's text parts, concatenated in order, MUST equal `content` byte-for-byte. Enforced at `messagesRepo.append` (`src/lib/db/repositories/messages.ts`); violating sends are rejected.
- Image-only rows have `content = ''` and no text parts; they are intentionally unsearchable (full-text search extracts from `content` only, `packages/shared/src/fts.ts`).

## §2 Parts shape and origin

- `parts` is a nullable JSON-text column holding `MessagePart[]` (`src/lib/chat/kinds.ts`); `NULL` means legacy text-only and readers derive `[{type:'text', text: content}]`.
- `ImagePart = { type:'image'; data: <base64 data-URL>; mimeType; width; height; bytes; name? }` — identical shape regardless of origin.
- Origins: `user_message` (user-attached, 018), `assistant_message` (model-generated, 030), `branch_artifact` (propagated from branch turns, 030).
- The union is open: unknown part kinds MUST survive storage round-trips untouched and MUST be ignored by text derivation (`partsOf`/`textOf`).

## §3 Limits and atomicity

- At most 8 image parts per row, any origin.
- A row is appended in a single atomic operation carrying text and parts together; a failed append leaves no row.
- Persisted image payload MUST fit the 16 MiB `/api/db/query` request envelope: output-side caps are enforced before finalize; oversized generated images are re-encoded down (existing canvas pipeline), not rejected.

## §4 Rendering

- Image parts render **outside the Markdown pipeline** as ordered segments: contiguous text parts render through `Markdown`, image parts render as thumbnail grids between them, in `parts` order. The sanitize schema keeps stripping `data:` URIs from markdown; no markdown extension for images may be introduced.
- Image-less messages render exactly as before this contract's assistant extension (single markdown block).
- Text anchoring/selection for multi-segment messages either derives offsets from the concatenation invariant (preferred) or disables the selection menu for that message (containment fallback). Substring heuristics and full-span fallbacks remain prohibited.
- One shared presentation (thumbnail grid + fullscreen lightbox with download) serves all origins.

## §5 Provider projection

- `user_message` rows project their image parts onto the wire when the active model is vision-capable (018 behavior, unchanged), as AI SDK user image parts (`{ type: 'image', image: <stored data URL> }` — legal for user content).
- `assistant_message` rows project their image parts under the same vision-capability condition (030), as **provider file parts** — the AI SDK's assistant-legal image-bearing shape: `{ type: 'file', mediaType: <full IANA type from the stored part's mimeType>, data: <base64-only body, data-URL prefix stripped> }`. Assistant content accepts no image part (`AssistantContent` in `@ai-sdk/provider-utils@5.0.2` carries text/file/reasoning/tool parts only), so a stored image part must not project as `{ type: 'image' }` on assistant rows. A stored part whose payload cannot produce a base64 body is skipped silently. (Amended in place by feature 033 — see `specs/033-image-output-finalize-paths/contracts/assistant-projection.md`.)
- `branch_artifact` rows project as text only; images ride the artifact for the user's record, not the model's context.
- Trace/diagnostic views never emit base64 (placeholder rendering, existing `extractPartContent` behavior).
