# Feature Specification: Image-First Chat (Multimodal-Ready)

**Feature Branch**: `018-image-chat-parts`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Users can paste or attach an image into a chat whenever the connected model supports vision, so Mayon exercises the capabilities of the models it connects to. The composer and the server LLM path are text-only today, so multimodal models deliver none of that value inside Mayon. Ship images only, built on a parts-based message architecture designed in anticipation of every other modality — voice, files, and video as follow-on slices rather than a rewrite. Client-side compress/downsize before upload is day-one work. Images live alongside the message in the primary store and ride the existing backup story."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paste a screenshot and the model reads it (Priority: P1)

A user is chatting with a vision-capable model and hits an error they can't describe in words. They take a screenshot, paste it into the composer, see a thumbnail appear as an attachment, add a one-line question, and send. The model's reply addresses what is actually visible in the image. Afterwards, the sent message in the conversation shows the image (as a thumbnail that opens larger), not just the text.

**Why this priority**: This is the core loop and the entire point of the feature — "show the model what you see". Without this slice, nothing else has value.

**Independent Test**: Can be fully tested by pasting an image into the composer of a chat connected to a vision-capable model, sending a question about it, and verifying the response reflects the image contents and the image renders in the conversation.

**Acceptance Scenarios**:

1. **Given** a chat with a vision-capable model connected, **When** the user pastes an image into the composer, **Then** a thumbnail preview of the image appears in the composer before sending.
2. **Given** an image attached in the composer with accompanying text, **When** the user sends the message, **Then** the message appears in the conversation showing both the text and the image thumbnail, and the model's reply demonstrably reflects the image's content.
3. **Given** a chat with a vision-capable model connected, **When** the user attaches an image using the attach (paperclip) control and selects a local file, **Then** the image is attached and sent exactly as if it had been pasted.
4. **Given** an attached image in the composer, **When** the user removes it before sending, **Then** the image is dropped from the outgoing message and is not sent to the model.

---

### User Story 2 - The attach affordance respects the connected model (Priority: P2)

The image attachment control only appears when the currently connected provider/model advertises vision support. If the user sends (or attempts to send) an image to a model whose vision support cannot be confirmed, the system fails visibly and helpfully — a clear, immediate error — rather than failing silently or pretending the gate is omniscient.

**Why this priority**: Gating protects users from confusing failures and wasted metered-API spend, but permissive-with-clear-error is the accepted posture: the gate is advisory, not a hard correctness boundary.

**Independent Test**: Can be fully tested by connecting a vision-capable model (control visible) and a non-vision model (control hidden, and a direct attempt to include an image produces a clear error before the request leaves the app).

**Acceptance Scenarios**:

1. **Given** a model that advertises vision support, **When** the user opens the composer, **Then** the image attach control is available.
2. **Given** a model that does not advertise vision support, **When** the user opens the composer, **Then** the image attach control is not offered.
3. **Given** a model whose vision support is not advertised but an image somehow accompanies the send, **When** the user sends, **Then** the user sees a clear, specific error message about the model not supporting images, and no opaque provider failure surfaces.

---

### User Story 3 - Images persist and ride the existing durability story (Priority: P3)

Sent images are part of the conversation record. Reloading the app, returning to the conversation later, and — critically — restoring from a backup all show the images exactly as sent. Text search over conversation history keeps working on message text and is unaffected by images.

**Why this priority**: A vision feature that loses its images on reload or breaks search or backups would silently violate two existing product promises (durable history, self-maintaining full-text search). It is required for correctness but delivers no new value on its own, hence P3.

**Independent Test**: Can be fully tested by sending an image, reloading the app, verifying the image still renders; then searching for a word from the accompanying text and verifying the message is still found; then performing a backup-and-restore cycle and verifying images survive.

**Acceptance Scenarios**:

1. **Given** a conversation containing a sent image, **When** the user closes and reopens the app (or reloads the page), **Then** the image is still present and renders in the message.
2. **Given** a conversation with messages containing text and images, **When** the user searches for a word that appears in a message's text, **Then** that message is found by search, exactly as it was before images existed.
3. **Given** a backup of conversations containing images, **When** the user restores it, **Then** the images are present and render correctly afterwards.

---

### User Story 4 - Big screenshots are handled gracefully (Priority: P4)

Retina/high-DPI screenshots routinely arrive at several megabytes. Before an image is sent, the app downsizes and compresses it so uploads stay fast and storage stays reasonable at single-user local scale, while keeping the image fully legible to a vision model. The user doesn't configure anything; it just works, and attachment previews appear quickly.

**Why this priority**: Without this, the P1 experience is slow and the storage decision (images live with the message, conditional on downsizing) is violated. It is day-one work but exists to serve the P1 loop.

**Independent Test**: Can be fully tested by attaching a multi-megabyte screenshot and verifying the image sent is substantially smaller than the original while remaining legible (text in the screenshot still readable by the model), with no user-facing configuration.

**Acceptance Scenarios**:

1. **Given** a ~3 MB retina screenshot pasted into the composer, **When** the user sends, **Then** the image transmitted is reduced in size by a substantial factor (several-fold) while the screenshot's text remains readable to the model.
2. **Given** any pasted or attached image, **When** it is being prepared for sending, **Then** the composer remains responsive (no freeze) and the thumbnail appears promptly.

---

### Edge Cases

- What happens when the user pastes a non-image clipboard item (e.g., copied text, a file path)? Non-image pastes keep behaving as they do today; only image pastes are captured as attachments.
- What happens when the user attaches an unsupported image format? The app rejects it with a clear message naming supported formats; supported formats are the common web image formats (PNG, JPEG, WebP, GIF).
- What happens when the user attaches many images or extremely large images? The composer enforces a per-message cap on attachments (see Assumptions) and rejects images beyond the cap with a clear message.
- What happens when an image fails to upload or the send fails mid-flight? The user sees the failure and can retry; a failed send leaves no orphaned half-message in the conversation.
- What happens when the conversation is restored from a backup stamped with images but the restore is refused (newer-backup guard)? The existing restore refusal behavior is unchanged; images introduce no new restore failure mode.
- What happens to selection/highlight (expound) on a message that contains an image? Selection continues to operate on the message's text; images are not selectable text and must not corrupt text-offset alignment.
- What happens when an image-only message (no accompanying text) is sent or searched? It renders and persists like any message; it contributes no searchable words but does not break search for other messages.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to add an image to a message draft in the composer by pasting it from the clipboard or by selecting a file via the attach control.
- **FR-002**: The composer MUST show a thumbnail preview of each attached image before sending, and MUST let the user remove an attached image before sending.
- **FR-003**: The system MUST send the image together with the message text to the connected model, preserving which content is text and which is an image (message content is carried as ordered, typed parts — e.g., text parts and image parts — rather than a single string).
- **FR-004**: The system MUST pass image content through to the provider unaltered in structure: the server's LLM path MUST forward text and image parts as-is, without stripping, re-encoding, or mixing them into text.
- **FR-005**: The system MUST compress/downsize images on the user's device before sending, so multi-megabyte screenshots are substantially reduced while remaining legible to a vision model, with no user configuration required.
- **FR-006**: The attach control MUST be offered only when the connected provider/model advertises vision support.
- **FR-007**: If an image is sent to a model whose vision support is not advertised, the system MUST fail with a clear, specific error to the user before any opaque provider error surfaces (permissive gating with clear errors, not silent failure).
- **FR-008**: Sent images MUST be stored as part of the message in the primary store (not a separate blob store) so they are versioned, backed up, and restored together with the conversation.
- **FR-009**: The system MUST render sent images in the conversation: a thumbnail inline in the message, expandable to view the full image.
- **FR-010**: Full-text search MUST continue to extract searchable words from each message's text content only; introducing image parts MUST NOT break search over message text and MUST NOT make image content searchable.
- **FR-011**: Selection/highlight (expound) behavior on messages MUST continue to resolve against the message's text; images MUST NOT corrupt text-offset alignment.
- **FR-012**: The system MUST accept the common web image formats (PNG, JPEG, WebP, GIF) and reject other file types with a clear message naming what is supported.
- **FR-013**: Images (and their byte content) MUST be included in backups and restored with the conversation during restore, exactly like other message content.
- **FR-014**: The message data model MUST accommodate future content kinds (e.g., voice, files, video) as additional part types without restructuring existing messages, though only text and image parts are produced in this release.
- **FR-015**: When a send containing an image fails, the system MUST surface the failure to the user and leave no partial or orphaned message in the conversation.

### Key Entities *(include if feature involves data)*

- **Message**: A single chat message. Its content is an ordered sequence of typed content parts — at minimum a text part (its textual content, which remains the searchable text) and optionally one or more image parts. The message's text part(s) feed full-text search exactly as the whole message text did before.
- **Image Part**: One image attached to a message: the image bytes stored with the message, plus its descriptive attributes (format, pixel dimensions, byte size after downsize). It has no lifecycle separate from its message — it is created with the message, backed up with it, and deleted with it.
- **Provider Vision Capability**: An advertised flag on the connected provider/model configuration stating whether the model accepts images. It gates the composer's attach control and informs error messaging; it is advisory (permissive-with-clear-error posture), not a guarantee.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from "screenshot on clipboard" to "model is answering about the screenshot" in under 15 seconds for a typical multi-megabyte screenshot, including attach/downsize/send.
- **SC-002**: A typical ~3 MB retina screenshot is reduced to a small fraction of its original size (target: ~500 KB or less) before it is transmitted, with screenshot text still readable by the model.
- **SC-003**: 100% of conversations containing images reload with their images intact and renderable, verified across app restarts.
- **SC-004**: Search behavior is unchanged for text: searching a word from any message's text finds that message in 100% of cases after the change, and search latency is not perceptibly affected by the presence of image parts.
- **SC-005**: A backup-and-restore cycle preserves 100% of sent images, renderable and attributed to the correct messages.
- **SC-006**: Attempting to use an image with a non-vision model produces a clear, actionable error message in 100% of such attempts — never a silent failure or an unexplained provider error.
- **SC-007**: Sending an image adds no more than ~2 seconds of perceptible preparation time (downsize + attach) for typical screenshots, and the composer never becomes unresponsive during preparation.

## Assumptions

- Single-user, local-scale deployment: image bytes living alongside messages in the primary store (~1–2 GB/year estimated growth) is acceptable, and is conditional on client-side downsizing (FR-005) being in place from day one.
- Multiple images per message are supported, capped at a small per-message maximum (default: 8) to keep sends predictable; the cap is a guardrail, not a UX feature.
- Vision-capability advertisement varies in reliability across providers; the accepted posture is permissive-with-a-clear-error (FR-007), not strict enforcement — the gate must not pretend to be omniscient.
- Animated images (e.g., animated GIFs) are out of scope for this release; they are accepted as files but only their first frame carries meaning when sent (or they are rejected — final behavior decided at planning with the "first frame is sufficient" default).
- Voice, files, and video modalities are explicitly deferred; the parts-based message structure anticipates them but no UI or transport for them ships in this release.
- No document-extraction pipeline is in scope: this path delivers images the model can see, not documents converted to text.
- A token-cost affordance for image-heavy context (images are token-heavy; context fills faster) is acknowledged as valuable but deferred to post-launch.
- The existing per-day/session durability rules and progressive server-detection behavior are unchanged: image features ride the existing server-enabled capability surface (the LLM path already requires the server).
