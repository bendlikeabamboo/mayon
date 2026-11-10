# Contract: Stream Image Recognition & Finalize

**Feature**: 030 — Model-Generated Images in Chat · **Status**: Draft

How assistant-emitted images travel from the provider stream into the durable row. The single recognition point is `consumeStream` (`src/lib/agent/loop.ts`).

## §1 Recognition

- The consumer recognizes image-bearing AI SDK stream parts (exact part type fixed by the R-2 implementation spike: e.g. `file` parts with `image/*` media type, plus any per-dialect normalization shim for wire shapes the SDK does not map). All provider dialects supported by the app normalize to one internal shape: a finished `ImagePart` candidate.
- Recognized images are **atomic**: there is no partial-image state, no progressive base64 rendering, no pacing of image content.
- Embedded-bytes delivery and remote-URL delivery both normalize to stored bytes before finalize. URL fetches ride the existing keychain/proxy fetch path; an un-fetchable URL yields a contained inline notice part of the reply record, not a broken frame and not a dropped message.

## §2 Turn state

- Text continues to accumulate in the string stream buffer; recognized images accumulate in the per-turn `pendingImages` array, ordered by arrival relative to text.
- Each recognized candidate is additionally **offset-stamped**: its `offset` records the current streaming-text length at arrival, so finalize can place it relative to the text (refined by feature 033).
- Recognition additionally feeds a **caller-owned, turn-scoped accumulator** that an abort cannot discard, plus a separate **recognized-count signal** (`onImageRecognized`) available to the UI layer from recognition time — not only after finalize (refined by feature 033; see `specs/033-image-output-finalize-paths/contracts/finalize-composition.md` §1). `pendingImages` (store) remains the per-row handoff state; the recognized counter is independent and turn-scoped.
- While `pendingImages` is non-empty, live rendering shows a bounded placeholder indicator only.
- The critic phase carries `pendingImages` through correction rounds unchanged.

## §3 Finalize

- `appendAssistantText` is the single finalize point: it composes `parts` and persists the assistant row atomically with `{ model, parts }`, satisfying the message-parts contract (§1 canonical text, §3 limits). The finalize handoff may carry `offset` per image and a `final` marker distinguishing the turn's finalize appends from interim tool-boundary persists (feature 033).
- Composed parts are in **arrival order**: the row's text is split at the (clamped) image offsets into text parts, with image parts interleaved at their positions; text parts concatenate byte-for-byte to the row's canonical `content` (message-parts §1 invariant). Images whose offsets no longer apply (critic-replacement re-emit) append after the corrected text — best-effort, documented. An image-only finalize (no text) persists a row with `content = ''` and image parts only (message-parts §1 image-only rule). (Amended in place by feature 033; was "ordered text part(s) + images".)
- Caps are applied before the append, in order: (1) byte validity — magic-byte sniff; invalid payloads drop with a notice; (2) count — the first `MAX_IMAGES_PER_MESSAGE` (8) in arrival order; extras drop with a notice; (3) size — images exceeding the output-side cap are re-encoded down via the existing canvas pipeline, and a per-image re-encode failure drops that image with a notice instead of rejecting the row. Every drop yields a bracketed plain-language notice appended to the row text; the row always persists. (Refined by feature 033; see `specs/033-image-output-finalize-paths/contracts/finalize-composition.md` §2.)

## §4 Interruption

- On abort/error, **all completed images of the turn** — including those recognized in the iteration in flight and in earlier iterations — persist with the partial text on the interrupted row (`metadata.interrupted: true`), through the same composition rules as §3, including the image-only case (`content = ''` + `interrupted`). An image that never completed is dropped silently — no placeholder rows. Image-less aborts keep the pre-033 exact row shapes. (Amended in place by feature 033; see `specs/033-image-output-finalize-paths/contracts/finalize-composition.md` §3.)

## §5 Diagnostics

- Every unrecognized stream part remains traced (existing behavior). Traces never contain base64 payloads; images appear as placeholders (existing `extractPartContent` behavior).
