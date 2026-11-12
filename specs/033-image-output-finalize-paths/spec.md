# Feature Specification: Image Output Finalize & Follow-Up Paths

**Feature Branch**: `033-image-output-finalize-paths`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "image output (030): follow-up turns fail, image-only replies vanish, and abort/oversize paths lose images — seven failure modes of the same finalize/persist path found in the v0.9.0..main delta review (issue #70)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A conversation keeps working after an image reply (Priority: P1)

The user receives a reply that contains a generated image and then continues the conversation with a follow-up question. The follow-up request is accepted and delivered to the model provider, and the user gets a real answer — never a spurious network-style error caused by the earlier image being re-sent as part of the conversation context. This holds for vision-capable models (which may receive the prior image as context, in whatever form the provider accepts) and for text-only models (which receive the reply's text alone, silently, as before). Whatever wire representation is used for a prior assistant image, it MUST be one the AI SDK accepts for an assistant turn, because an invalid part shape makes every subsequent turn in that chat fail permanently.

**Why this priority**: The defect makes the affected chat permanently unusable — the row keeps its parts, so every follow-up errors before any provider call. Nothing else in this feature matters if the conversation itself breaks.

**Independent Test**: In a chat where an assistant reply carries a generated image, send a follow-up text turn against a vision-capable model: the request reaches the provider and a reply streams back; repeat against a text-only model: the request also succeeds, with the prior image omitted from context.

**Acceptance Scenarios**:

1. **Given** a chat whose last assistant reply contains a generated image, **When** the user sends a follow-up message and the active model accepts image input, **Then** the request is accepted and reaches the provider, and the prior image rides along in a provider-acceptable assistant-content form.
2. **Given** the same chat with a text-only model active, **When** the user sends a follow-up, **Then** the request succeeds and the model receives only the text of the image reply, with no error surfaced to the user.

---

### User Story 2 - Every complete image reaches the conversation record (Priority: P1)

A model reply that consists of images only — no accompanying text — is persisted, rendered, and traced like any other reply. Today such a reply produces nothing: no row, no render, no trace, and nothing recoverable. After this story, an image-only reply becomes a durable conversation entry (empty text, its images in order), and a mixed reply's images are never lost just because of where they arrived relative to text. More generally, any image the model finished delivering during the turn is either persisted or the user is told, in plain language, why it could not be kept.

**Why this priority**: Equal in severity to Story 1 — the user's entire request (produce an image) silently vanishes, which is the core promise of image output (spec 030 Story 1) failing outright.

**Independent Test**: Ask an image-capable model for a picture in a way that yields an image with no text; after the turn ends the conversation shows a persisted image-only reply, and reloading the chat still shows it.

**Acceptance Scenarios**:

1. **Given** a model that streams one or more images and no text, **When** the reply completes, **Then** an assistant entry persists carrying exactly those images (and no text), renders inline, and still renders after reload.
2. **Given** a reply mixing text and images, **When** it completes, **Then** every completed image of the turn persists with the reply.

---

### User Story 3 - Stopping mid-reply keeps what already arrived (Priority: P2)

The user presses Stop after an image has arrived but before the reply finishes. The completed image is not discarded: it persists on the interrupted entry together with whatever partial text exists, and the entry is marked as interrupted exactly as text-only aborts are (image-less aborts keep today's exact row shape). This holds no matter where the abort lands — mid-stream, between model iterations, or during a retry — and regardless of whether the images arrived in the current or an earlier iteration of the turn.

**Why this priority**: Data loss on an explicit user action, but bounded to the moment of stopping; below the always-broken stories, above cosmetic issues.

**Independent Test**: Start an image reply, press Stop after the image has arrived; the conversation shows an interrupted entry containing the image and partial text; reload preserves it.

**Acceptance Scenarios**:

1. **Given** a streaming reply that already delivered an image, **When** the user stops the turn before it finishes, **Then** the persisted interrupted entry carries that image (and any prior completed images of the turn) plus the partial text, flagged as interrupted.
2. **Given** an aborted turn with no text buffered but with a completed image, **When** the turn ends, **Then** an interrupted image-only entry persists rather than nothing.

---

### User Story 4 - Too many images degrades, never destroys (Priority: P2)

A reply with more images than the storage limit allows (eight per entry) keeps the first eight in arrival order and informs the user with a contained plain-language notice naming how many were dropped — instead of the entire reply failing and being lost. The cap is applied on the finalize path before persistence, so every persistence route (normal finish, abort, budget-exhaustion) inherits it.

**Why this priority**: Whole-reply loss on a legitimate (if unusual) model response; bounded blast radius once Stories 1–2 hold.

**Independent Test**: Force a reply that produces nine images; the entry persists with the first eight images and a notice about the ninth; no error is shown and the text (if any) survives.

**Acceptance Scenarios**:

1. **Given** a reply carrying nine or more completed images, **When** it finalizes, **Then** the entry persists with the first eight images and a notice stating how many images were not kept.
2. **Given** the same over-cap reply, **When** it is aborted mid-way, **Then** the interrupted entry still honors the cap with the same notice behavior.

---

### User Story 5 - Text and images keep their produced order (Priority: P2)

When a reply interleaves text and images (`text → image → text`), the stored entry and its render preserve the model-produced sequence after reload, honoring spec 030's ordering promise (FR-003/SC-001) instead of pinning every image to the end of the final text. Order is recorded at arrival time on the finalize path and survives the round trip through storage.

**Why this priority**: Fidelity defect, not data loss: content is present but mis-ordered on reload, contradicting an existing acceptance criterion of spec 030.

**Independent Test**: Produce a `text → image → text` reply; on first render and after reload the image appears between the two text stretches.

**Acceptance Scenarios**:

1. **Given** a reply whose image arrived between two text stretches, **When** the reply finalizes, **Then** the persisted entry's parts encode the image at its arrival position relative to the text.
2. **Given** that entry, **When** the conversation is reloaded, **Then** the rendered sequence still shows the image between the two text stretches.

---

### User Story 6 - Corrupt or oversized image bytes stay contained (Priority: P2)

A model may deliver image bytes that are corrupt, truncated, or not a displayable image; it may also deliver an image that cannot be squeezed under the output-size discipline. Today the corrupt case renders as a silently broken image (no notice) and the over-cap case can reject the whole finalize, losing the text and all other valid images. After this story, damage is evaluated per image: an invalid image is dropped (or replaced) with a contained plain-language notice inside that reply, and the surrounding text and sibling images always survive. Byte validation happens before an image is passed through to storage.

**Why this priority**: One bad payload taking out an entire otherwise-good reply is unacceptable data loss, but it requires a misbehaving provider to trigger.

**Independent Test**: Inject a reply containing one valid image and one corrupt payload followed by text; the entry persists with the valid image and text plus a per-image notice; nothing else in the conversation is affected.

**Acceptance Scenarios**:

1. **Given** a reply containing a corrupt or non-image payload within the size cap, **When** it finalizes, **Then** that image is dropped with a contained notice and the reply's text and other images persist.
2. **Given** a reply containing an image whose bytes cannot be brought under the output-size cap (or cannot be re-encoded at all), **When** it finalizes, **Then** only that image is dropped with a notice; the turn never fails wholesale.

---

### User Story 7 - Image-failure notices fire when they claim to (Priority: P3)

When a turn that the user expected to produce an image fails at the provider mid-stream, the user sees the dedicated plain-language "no image produced" notice (naming the Image output capability toggle) rather than a raw provider error dump — the refinement must key on images actually recognized during streaming, not on state that only populates after a successful finalize. Conversely, when a turn completes normally with text and zero images while the user's request was an image ask, the user receives a plain-language no-image notice instead of silence, refurbishing spec 030's FR-007 for the zero-image case.

**Why this priority**: A reachable-but-mislabeled error and a missing notice — quality-of-communication defects; no data is lost.

**Independent Test**: Stream a turn where the provider rejects with a 4xx after an image part was recognized: the conversation shows the typed no-image notice. Then run a text-only "successful" turn against an image-expected ask: a contained no-image notice appears with the reply.

**Acceptance Scenarios**:

1. **Given** a provider failure during a streaming turn in which image content had already been recognized, **When** the failure surfaces, **Then** the user sees the typed image-output notice (never the raw provider error, never "network error").
2. **Given** a turn that finishes with text and no images while image output was expected of the model, **When** the reply completes, **Then** a contained plain-language notice informs the user that no image was produced.

---

### Edge Cases

- What if the abort lands exactly between model iterations, after images were collected in the just-finished iteration? Those images must persist too (they are complete).
- What if the critic phase re-emits the reply as one corrected stretch? Block offsets no longer apply; images persist with the corrected text (order best-effort, appended after text) — the correction path must not lose them.
- What if an image arrives before any text has started (image-first reply)? Its position is the start of the entry; the entry may end up image-only if no text follows.
- What if a model sends more than eight images and the user then stops the turn? Cap and interrupt-flagging compose: first eight kept, interrupted marking still applies.
- What if the image payload is valid but its declared media type is missing or wrong? Byte-level sniffing decides displayability, not the declared type.
- What if the runtime has no image decoder available (tests, unusual environments)? Validation must not depend on decoding alone: byte-signature checks gate passthrough; absent decoders degrade to existing best-effort behavior rather than dropping every image.
- What if a follow-up turn targets a model whose provider rejects assistant-borne image context despite accepting the request shape? The failure must surface as a provider error for that turn, not as a permanent client-side rejection of the whole conversation (the projection itself must be shape-valid).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST project prior assistant image parts onto follow-up request contexts in a shape the AI SDK accepts for assistant content, preserving the existing vision-capability gate (images ride only for vision-capable targets; otherwise text-only, silently).
- **FR-002**: The system MUST persist an assistant entry for a reply that completed images but produced no text — empty canonical text, its images in order — and render it like any other reply.
- **FR-003**: On abort, the system MUST persist all completed images of the turn (from the current and earlier iterations) together with the partial text, and MUST mark the resulting entry interrupted whenever images are present, matching the text-only abort contract.
- **FR-004**: The finalize path MUST cap each entry at the storage image limit (eight), keeping the earliest images in arrival order, and MUST append a contained notice stating how many images were dropped; the capped entry MUST persist instead of failing.
- **FR-005**: The finalize path MUST record each image's arrival position relative to the reply's text and MUST persist parts in that order, so reload and re-render preserve the model-produced sequence.
- **FR-006**: The finalize path MUST validate image bytes before passthrough and MUST contain any per-image failure (corrupt, undecodable, un-shrinkable) to that image — dropping or replacing it with a plain-language notice — never rejecting the entry or losing sibling content.
- **FR-007**: Image-output failure refinement MUST key on images recognized during streaming (not on post-finalize state), so a provider failure mid-stream after a recognized image surfaces the typed "no image produced" notice; and a normally-completed image-expecting turn that produced zero images MUST emit a contained no-image notice.
- **FR-008**: Every fix MUST ship with a regression test that fails without it; the abort-path tests MUST exercise the real streaming abort behavior (not a mock that replaces the whole turn loop).

### Key Entities

- **Assistant reply entry (extended)**: may carry zero text with images only (empty canonical text), interleaved text/image parts in arrival order, a dropped-images notice, and the interrupted flag on abort — all within the existing message-parts storage contract.
- **Stream-recognized image (extended)**: an image the model finished delivering during a turn, now carrying its arrival position relative to the reply text and a turn-visible recognized count that survives until the turn ends.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of follow-up turns sent after an image-bearing reply reach the provider (zero client-side prompt rejections) across vision-capable and text-only targets.
- **SC-002**: 100% of image-only replies persist and re-render after reload (zero silent vanishings).
- **SC-003**: 100% of aborts issued after a completed image persist that image on an interrupted-flagged entry.
- **SC-004**: Replies exceeding the eight-image cap persist with the first eight images plus a drop notice in 100% of cases (zero whole-reply losses).
- **SC-005**: Text/image sequence after reload matches the model-produced order in 100% of interleaved replies.
- **SC-006**: Zero replies lost and zero raw provider dumps when a reply contains corrupt or over-cap image bytes; every affected image yields a contained notice.

## Assumptions

- The AI SDK version in this repo accepts `file` parts (full IANA media type + data) as assistant content; the assistant projection switches to that shape rather than degrading image-bearing history to text-only, because follow-up context fidelity is worth more than the minimal risk of a provider rejecting it (which would surface as a normal provider error for that turn, not a permanent break). Documented as the chosen default for the FilePart-vs-text-only question.
- The eight-per-entry cap stays where storage enforces it today; the finalize path applies the same number proactively with a notice (mirroring how branch propagation already slices to eight).
- Arrival-order representation is finalize-path metadata (per-image position relative to the row's text) composed into ordered parts at persistence time — not a storage-schema change; the existing "text parts concatenate to the row's canonical text" invariant is preserved by construction.
- The zero-image notice (FR-007, second half) fires when the active model is expected to produce images per the existing advisory capability flag — the established capability-gate pattern — and never suppresses or blocks anything.
- Corrupt-byte detection is byte-signature-based (works without a decoder) with decode failures during re-encode treated as per-image drops; environments without any decoder keep today's best-effort behavior instead of dropping everything.
- Scope is exactly the seven failure modes of issue #70 on the finalize/persist/projection path of spec 030; spec 030's contracts remain authoritative and are amended (not contradicted) where this feature refines them — deviations are called out in the plan.
- No schema migrations are expected: the fixes live in projection, the turn loop's persist plumbing, and the store's finalize composition.
