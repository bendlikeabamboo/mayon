# Contract: Stream Image Recognition & Finalize

**Feature**: 030 — Model-Generated Images in Chat · **Status**: Draft

How assistant-emitted images travel from the provider stream into the durable row. The single recognition point is `consumeStream` (`src/lib/agent/loop.ts`).

## §1 Recognition

- The consumer recognizes image-bearing AI SDK stream parts (exact part type fixed by the R-2 implementation spike: e.g. `file` parts with `image/*` media type, plus any per-dialect normalization shim for wire shapes the SDK does not map). All provider dialects supported by the app normalize to one internal shape: a finished `ImagePart` candidate.
- Recognized images are **atomic**: there is no partial-image state, no progressive base64 rendering, no pacing of image content.
- Embedded-bytes delivery and remote-URL delivery both normalize to stored bytes before finalize. URL fetches ride the existing keychain/proxy fetch path; an un-fetchable URL yields a contained inline notice part of the reply record, not a broken frame and not a dropped message.

## §2 Turn state

- Text continues to accumulate in the string stream buffer; recognized images accumulate in the per-turn `pendingImages` array, ordered by arrival relative to text.
- While `pendingImages` is non-empty, live rendering shows a bounded placeholder indicator only.
- The critic phase carries `pendingImages` through correction rounds unchanged.

## §3 Finalize

- `appendAssistantText` is the single finalize point: it composes `parts` = ordered text part(s) + images, and persists the assistant row atomically with `{ model, parts }`, satisfying the message-parts contract (§1 canonical text, §3 limits).
- Caps are applied before the append: images exceeding the output-side cap are re-encoded down via the existing canvas pipeline.

## §4 Interruption

- On abort/error, complete `pendingImages` persist with the partial text on the interrupted row (`metadata.interrupted: true`). An image that never completed is dropped silently — no placeholder rows.

## §5 Diagnostics

- Every unrecognized stream part remains traced (existing behavior). Traces never contain base64 payloads; images appear as placeholders (existing `extractPartContent` behavior).
