# Contract: Assistant Projection Wire Shape (033)

**Feature**: 033 — Image Output Finalize & Follow-Up Paths
**Refines**: `specs/030-image-generation/contracts/message-parts.md` §5 (amended in place by this feature)

How stored assistant image parts project onto follow-up request contexts.

## §1 Shape

- `assistant_message` image parts project as **provider file parts** — the AI SDK's
  assistant-legal image-bearing content shape: `{ type: 'file', mediaType: <full IANA type>,
  data: <base64-only string> }` (data-URL prefix stripped; `mediaType` taken from the stored
  part's `mimeType`).
- `user_message` image parts keep the 018 image-part shape, unchanged (legal for user content).
- A stored part whose payload cannot produce a base64 body is skipped silently (defensive;
  composition upstream guarantees a data URL).

## §2 Gating (unchanged from 030 §5)

- Assistant image parts ride the wire only when the active target model is vision-capable;
  otherwise the row projects text-only, silently.
- `branch_artifact` rows stay text-only.

## §3 Validity guarantee

- Every emitted assistant content array must be constructible from the SDK's assistant part
  union (text / file / reasoning / tool parts…) — an invalid shape would make **every
  subsequent turn** of the chat fail before any provider call. Regression tests pin the emitted
  part-type set against that union.
- A provider that nonetheless rejects assistant-borne image context surfaces a normal per-turn
  provider error; the projection itself must never be the failure.

## §4 Diagnostics (unchanged)

- Traces never carry base64; image parts appear as placeholders (existing
  `extractPartContent` behavior).
