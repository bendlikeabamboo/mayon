# Contract: Finalize Composition & Interruption (033)

**Feature**: 033 — Image Output Finalize & Follow-Up Paths
**Refines**: `specs/030-image-generation/contracts/stream-image-parts.md` §2/§3/§4 (amended in place by this feature)

How recognized images travel from the stream through finalize into the durable row, and what
survives interruption.

## §1 Recognition state (extends 030 §2)

- Recognition is atomic (030 §1 unchanged) and additionally **offset-stamped**: each
  recognized candidate records the current streaming-text length as its arrival offset.
- Recognized candidates accumulate in a caller-owned, turn-scoped accumulator that an abort
  cannot discard; a separate recognized-count signal (`onImageRecognized`) is available to the
  UI layer from recognition time (not only after finalize).
- `pendingImages` (store) remains the per-row handoff state; the recognized counter is
  independent and turn-scoped.

## §2 Composition (extends 030 §3)

- `appendAssistantText` remains the single finalize point. The finalize handoff may carry
  `offset` per image and a `final` marker distinguishing the turn's finalize appends from
  interim tool-boundary persists.
- Composed parts are in **arrival order**: the row's text is split at the (clamped) image
  offsets into text parts, with image parts interleaved at their positions. Text parts
  concatenate byte-for-byte to the row's canonical `content` (030 message-parts §1 invariant).
- Images whose offsets no longer apply (critic-replacement re-emit) append after the corrected
  text — best-effort, documented.
- An image-only finalize (no text row) persists a row with `content = ''` and image parts only
  (030 message-parts §1 image-only rule).
- Caps before the append, in order: (1) byte validity — magic-byte sniff; invalid payloads
  drop with a notice; (2) count — first `MAX_IMAGES_PER_MESSAGE` (8) in arrival order, extras
  drop with a notice; (3) size — per-image/per-row output budget re-encodes down, and a
  per-image re-encode failure drops that image with a notice instead of rejecting the row.
- Every drop yields a bracketed plain-language notice appended to the row text; the row always
  persists. Never a raw provider dump; never a dropped message.

## §3 Interruption (extends 030 §4)

- On abort, all completed images of the turn — including those recognized in the iteration in
  flight and in earlier iterations — persist with the partial text on the interrupted row
  (`metadata.interrupted: true`), through the same composition rules (§2), including the
  image-only case (content `''` + `interrupted`).
- Image-less aborts keep the pre-033 exact row shapes.

## §4 Failure & zero-image notices (refurbishes 030 FR-007)

- The failed-image-turn refinement keys on the turn-scoped recognized count: a provider
  failure after ≥1 recognized image surfaces the typed "No image produced" notice naming the
  Image output toggle — regardless of whether finalize ever ran.
- A successful, non-aborted finalize row with non-empty text from an image-output-expected
  model (advisory capability flag) that recognized zero images carries a bracketed
  plain-language no-image notice. The flag never blocks or suppresses anything (030
  capability contract guarantees unchanged).

## §5 Diagnostics (unchanged)

- Traces never contain base64; images appear as placeholders.
