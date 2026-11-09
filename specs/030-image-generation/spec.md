# Feature Specification: Model-Generated Images in Chat

**Feature Branch**: `030-image-generation`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "As user, there are times when I want to let an LLM generate a infographic or chart for me and I don't know if LLM sending over images is supported in Mayon. It would be helpful for me." (`ideas/image-generating-models.md`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The model's generated image appears in the chat (Priority: P1)

The user asks the model in a conversation to produce a visual — an infographic, a chart, an illustration — and the model's reply carries an image. That image renders inline in the assistant's message, at the position the model placed it relative to any accompanying text, using the same visual presentation the app already uses for images. The image is part of the conversation record from the moment the reply completes: reopening the app, reloading the conversation, or restoring from a backup all redisplay the image without contacting the model provider again. If the reply mixes text and one or more images, the stored and displayed order matches what the model produced.

**Why this priority**: This is the entire ask — today a model that answers with an image either fails or loses the image, so the value of image-capable models is unrealized in the app. Everything else in this feature presumes this works.

**Independent Test**: Connect an image-capable model, ask it for a simple chart, and let the reply finish: the image renders inline in the reply alongside any text; reloading the conversation still shows the image; a backup taken after the reply and restored elsewhere still shows it.

**Acceptance Scenarios**:

1. **Given** a connected model that returns an image in its reply, **When** the user asks for a chart or infographic and the reply completes, **Then** the image renders inline in the assistant's message at the position the model placed it, with any accompanying text displayed in order.
2. **Given** a completed reply containing one or more generated images, **When** the user reloads the conversation or reopens the app, **Then** every image redisplays without any request to the model provider.
3. **Given** a reply that interleaves text and multiple images, **When** it is stored and later redisplayed, **Then** the sequence of text and images is preserved exactly as the model produced it.
4. **Given** a conversation containing generated images, **When** it is backed up and later restored, **Then** the images survive the round trip.

---

### User Story 2 - The user can tell whether their model can generate images (Priority: P2)

The user can see, before or while asking, whether the connected model is expected to produce images — no guessing, no discovering the limitation by silence. The indication is advisory, following the app's established capability-gate pattern for vision: a stale or incomplete capability list never blocks a model that actually works, and a model that cannot produce images fails with a clear, contained explanation in the conversation rather than a silent text-only non-answer or a raw provider error dump.

**Why this priority**: The input description's confusion ("I don't know if LLM sending over images is supported") is half the pain. Capability clarity turns a confusing dead end into an informed choice of model, but it presupposes that image replies work at all, so it lands after Story 1.

**Independent Test**: With an image-capable model connected, the user sees an indication that image generation is expected; with a text-only model connected, the indication says images are not expected, and asking for one anyway produces a clear in-conversation outcome rather than silence.

**Acceptance Scenarios**:

1. **Given** a connected model on the known image-capable list, **When** the user views model details or asks for an image, **Then** the interface indicates image generation is expected.
2. **Given** a connected model not on the known image-capable list, **When** the user asks for an image and the model returns none, **Then** the user receives a plain-language explanation in the conversation that the model did not produce an image.
3. **Given** a model incorrectly believed to be image-incapable, **When** the user asks anyway and the model does return an image, **Then** the image renders normally — the advisory gate must never suppress a working image.
4. **Given** an image generation attempt that fails at the provider, **When** the failure reaches the conversation, **Then** the user sees a contained, plain-language notice — never a raw provider error dump.

---

### User Story 3 - Generated images are durable, portable conversation content (Priority: P3)

A generated image behaves like any other content the user already trusts: the user can open it full-size and download it from the inline render, it rides the existing backup and branch features unchanged (including branch context propagated back to a parent conversation), and conversations containing generated images search, highlight, and behave exactly like conversations without them.

**Why this priority**: These are the qualities that make the image a first-class part of the user's record rather than a transient decoration. Valuable, but only meaningful once images actually arrive and persist (Stories 1–2).

**Independent Test**: Generate an image, then: open it full-size and download it in no more than two explicit actions; branch the conversation and propagate context back to the parent; run a search that matches the conversation's text. All behave as they do for image-free conversations.

**Acceptance Scenarios**:

1. **Given** an inline generated image, **When** the user acts on it, **Then** a full-size view and a download of the image file are each reachable in at most two explicit actions.
2. **Given** a branched conversation whose reply contains a generated image, **When** branch context is propagated back to the parent, **Then** the image and its position round-trip intact.
3. **Given** a conversation containing generated images, **When** the user searches, makes text selections, or anchors highlights in that conversation's text, **Then** all of these behave exactly as in conversations without images.
4. **Given** a reply containing a generated image, **When** the user continues the conversation, **Then** the image is available to the model as context to the extent the connected model accepts image input, and continuation degrades to text-only without errors when it does not.

---

### Edge Cases

- What happens when the model delivers the image as a remote link instead of embedded content? The displayed and stored image must not depend on that link after the reply completes: the content is materialized when the reply is received, and a link that cannot be fetched yields a contained inline notice, not a permanently broken frame.
- What happens while a reply is still streaming and image data is incomplete? No broken or partially drawn image may flash; presentation completes when the data completes, consistent with how streaming text behaves.
- What happens when the image data is corrupt, truncated, or in a format the app cannot display? The failure is contained within that image's own block with a plain-language notice; the rest of the message and page are untouched.
- What happens with unusually large generated images? Handling stays bounded — the conversation remains responsive — consistent with the app's existing size discipline for images; no unbounded memory or layout growth.
- What happens when the model attaches a textual description or label to the image? It is preserved and displayed with the image as context for what the model intended.
- What happens on re-render (theme change, window resize, conversation reopen)? Images re-render stably without flicker, re-fetching from the provider, or reverting to a failure state.
- What happens when a generated image later participates in branch-context propagation or backup? It rides those existing flows as opaque conversation content; no image-specific paths are introduced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST render images returned by the model inline in the assistant's message, at their position relative to accompanying text, using the app's established image presentation.
- **FR-002**: The system MUST persist generated images as part of the conversation record such that redisplay after reload, app restart, or restore requires no contact with the model provider.
- **FR-003**: The system MUST preserve the model-produced ordering of text and images within a single reply, including replies with multiple images.
- **FR-004**: The system MUST materialize remotely delivered image content into stored conversation content at receive time; after the reply completes, display MUST NOT depend on live remote links, and an un-fetchable link MUST yield a contained inline notice.
- **FR-005**: Conversations containing generated images MUST behave identically to image-free conversations in full-text search, text selection, and anchoring — image content MUST NOT leak into searchable or anchorable text.
- **FR-006**: The system MUST provide an advisory indication of whether the connected model is expected to generate images, following the app's existing capability-gate pattern: permissive by default, never a hard block, with a stale capability list never suppressing a working image reply.
- **FR-007**: Failures — model produces no image, provider error, corrupt or unsupported image data, un-fetchable link — MUST be presented as contained, plain-language notices within the conversation, never as raw provider dumps and never affecting content outside the affected message block.
- **FR-008**: During streaming, the system MUST NOT present broken or partial image visuals; image presentation completes only when the image data is complete.
- **FR-009**: The system MUST offer full-size viewing and file download for each generated image, each reachable in at most two explicit actions from the inline render.
- **FR-010**: Generated images MUST ride existing conversation durability and structure features unchanged: backup/restore round trips and branch-context propagation preserve images and their positions.
- **FR-011**: When a conversation containing generated images continues, the system MUST make those images available as model context to the extent the connected model accepts image input, and MUST degrade to text-only continuation without errors otherwise.

### Key Entities

- **Conversation message (extended)**: an assistant reply may now carry image parts originating from the model, ordered alongside its text, stored and propagated as part of the conversation record.
- **Generated image part**: an image the model returned within a reply — its position in the reply, the image content itself, its format, and any textual description or label the model attached.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of replies from image-capable models in a representative corpus — single image, multiple images, and text-interleaved images — render every image inline upon reply completion, on the first display.
- **SC-002**: Redisplay of stored conversations containing generated images issues zero requests to the model provider.
- **SC-003**: Conversations with generated images show no regressions in search, selection/highlighting, backup/restore, or branching compared to image-free conversations, as verified by the app's existing behavior checks passing unchanged.
- **SC-004**: In every failure mode (non-capable model, provider error, corrupt data, dead link), the user receives an in-conversation plain-language notice — zero raw provider error dumps and zero silent non-answers.
- **SC-005**: Full-size view and file download of a generated image are each achievable in two or fewer explicit actions from the inline render.

## Assumptions

- Scope is chat-embedded image output: the model returns an image as part of its reply. Standalone text-to-image generation outside a conversation is out of scope for this feature and remains future work.
- Both common delivery shapes — embedded image content and remote links — are supported and normalized to stored conversation content at receive time, so display never depends on provider-side retention.
- The feature reuses the parts-based message architecture and image presentation introduced for image input (feature 018), whose contract was explicitly designed for follow-on modality slices; images render outside the Markdown pipeline, which is what keeps search, sanitization, and text anchoring unaffected.
- Generated images live in the primary store and ride the existing backup story, as image input does; no separate media store is introduced.
- Capability gating follows the 018 vision-flag contract: advisory, over a static list, permissive with clear errors — never a hard block, never runtime probing.
- Content of generated images is the provider's and the user's concern; the app stores and displays what the model returned, like any other conversation content.
- Editing, regenerating, or iterating on a previously generated image in place, and prompt-side improvement of image quality, are out of scope.
