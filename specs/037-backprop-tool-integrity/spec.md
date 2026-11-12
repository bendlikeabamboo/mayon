# Feature Specification: Back-propagation tool integrity fixes

**Feature Branch**: `fix/issue-73-backprop-tool`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "backprop (027): tool-built artifact includes own approval/tool rows, false success toast, root fallback dead end, abort timing, duplicate image keys, stale parts on regeneration, declined tool re-offering (GitHub issue #73)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Artifact payload fidelity for tool-triggered back-propagation (Priority: P1)

When the assistant back-propagates a branch via the propagation tool, the anchored
artifact in the parent chat must read exactly as if the learner had run the manual
back-propagate control at that moment. Today the tool-built payload additionally embeds
the propagation tool's own timeline rows — the tool-call row persisted before execution,
the approval ask row, and (on later runs) earlier propagation result rows — so the
artifact carries its own scaffolding as if it were branch content.

**Why this priority**: The artifact is the durable record of the branch outcome; noise
rows inside it corrupt every downstream use (reading, search, re-propagation) and break
the established byte-identical-parity guarantee between the tool and manual paths.

**Independent Test**: Seed a branch whose timeline contains normal conversation rows plus
propagation-tool chrome rows, run the tool, and compare the landed artifact with the
payload the manual path produces for the same conversation content — they must be
byte-identical, and neither may contain any propagation-tool chrome.

**Acceptance Scenarios**:

1. **Given** a branch containing user/assistant rows and the propagation tool's
   tool-call and approval rows, **When** the tool runs, **Then** the artifact payload
   renders only the branch's conversation rows — no tool-call, approval, or
   propagation-result rows appear.
2. **Given** two identically-seeded branches where one additionally carries
   propagation-tool chrome rows, **When** one is propagated via the tool and the other
   via the manual control, **Then** both artifacts' payloads are byte-identical.
3. **Given** a branch in which an earlier propagation attempt was declined, **When** a
   later propagation runs (either path), **Then** the declined attempt's rows are
   excluded from the payload too.

---

### User Story 2 - No false success toast when a second propagation is refused (Priority: P1)

A learner who triggers back-propagation while another propagation is already in flight
must never be told the second run succeeded. Today the refused second call returns
before clearing the record of the previous successful run, so the UI re-reads that stale
record and toasts success for a run that never happened.

**Why this priority**: A false success toast actively lies to the learner about durable
state in another chat; trust damage outweighs the small likelihood of the race.

**Independent Test**: Complete one propagation (toast shown), then trigger a second
while the first still holds the in-flight slot (or vice versa with the tool path); the
second attempt must not raise a success toast.

**Acceptance Scenarios**:

1. **Given** a completed propagation whose success is recorded, **When** a second
   propagation attempt is refused because one is already running, **Then** no success
   toast is raised for the refused attempt.
2. **Given** a propagation that genuinely completes, **When** it finishes, **Then** the
   success toast still appears exactly once.

---

### User Story 3 - Root-chat fallback guidance points at a real path (Priority: P2)

When the assistant cannot use the propagation tool because the active chat is a root
chat, its guidance must not send the learner hunting for a manual control that is
hidden on roots. Today the capabilities preamble tells the model to point at the manual
back-propagate control, which only exists on branch chats — a root-chat learner hits a
dead end.

**Why this priority**: Correctness of user-facing guidance; the current instruction is
unfollowable in exactly the situation it addresses.

**Independent Test**: Inspect the model-facing capabilities guidance and its behavioral
tests: the root-chat case must direct the learner to continue in (or create) a child
context, and only the provider-without-tools-on-a-branch case may reference the manual
control.

**Acceptance Scenarios**:

1. **Given** a root chat with tools enabled, **When** the learner asks to
   back-propagate, **Then** the model's guidance explains that propagation moves a
   branch's outcome to its parent and this chat is a root, so it needs a child context
   (e.g. branching first) — not a hidden control.
2. **Given** a branch chat whose provider lacks tool support, **When** the learner asks
   to back-propagate, **Then** guidance may still point at the manual back-propagate
   control, which is visible there.

---

### User Story 4 - Aborting during tool execution leaves no dangling state (Priority: P2)

A learner who stops the assistant while the propagation tool is between generating the
artifact content and writing it must get a clean stop: nothing further is persisted by
the tool, and the turn's existing abort handling finishes the job.

**Why this priority**: Durable rows written after the learner pressed stop violate the
stop contract and can wedge UI state (an unanchored or half-finished artifact).

**Independent Test**: Abort the turn after content generation begins but before the
artifact write; assert the tool persists nothing further, reports the abort, and
releases its in-flight slot.

**Acceptance Scenarios**:

1. **Given** the propagation tool has generated its payload but not yet written the
   artifact, **When** the learner aborts the turn, **Then** the tool writes nothing,
   returns an aborted outcome, and the in-flight slot is released.
2. **Given** an abort arriving before generation starts, **When** the tool runs,
   **Then** behavior is unchanged (immediate aborted outcome, zero writes).

---

### User Story 5 - Duplicate images never crash the artifact view (Priority: P2)

A branch containing the same image twice (for example, the same generated image
referenced by two rows) must propagate and render without error. Today the artifact
image grid identifies thumbnails by image content alone, so two identical images
collide and crash the view.

**Why this priority**: A rendering crash takes out the whole chat timeline for the
parent chat, far beyond the offending artifact.

**Independent Test**: Propagate a branch containing the same image data in two rows;
assert the collected image set contains no duplicates and the artifact renders both
content and image grid without crashing.

**Acceptance Scenarios**:

1. **Given** a branch with the same image attached in two rows, **When** it is
   propagated (either path), **Then** the artifact carries the image once and its grid
   renders without duplicate-identity errors.
2. **Given** a branch with distinct images, **When** it is propagated, **Then** all
   distinct images are kept (deduplication never drops legitimately different images)
   within the existing image cap.

---

### User Story 6 - Regenerated summary artifacts reflect their current images (Priority: P2)

Regenerating a summary artifact must refresh everything the artifact renders — its text
and its images. Today regeneration replaces only the text and its bookkeeping, so an
artifact whose source branch's image set changed since it was created keeps rendering
stale images.

**Why this priority**: The artifact is the record of the branch outcome; silently stale
images misrepresent that record while looking fresh (the text is new).

**Independent Test**: Create a summary artifact, change the source branch's images,
regenerate; assert the artifact's stored image set matches the branch's current
collected images and its text is the new summary.

**Acceptance Scenarios**:

1. **Given** a summary artifact whose source branch gained an image after creation,
   **When** the artifact is regenerated, **Then** the artifact's image parts reflect
   the branch's current images (same rules as a fresh propagation, including
   deduplication and the image cap).
2. **Given** a summary artifact whose source branch no longer has any images,
   **When** it is regenerated, **Then** the artifact stores no image parts.
3. **Given** a regeneration that fails or is aborted, **When** it ends, **Then** the
   artifact is unchanged (all-or-nothing update).

---

### User Story 7 - A declined tool is not re-offered (Priority: P3)

When the learner declines a tool action, the next turn's model context must make that
decline legible so the model does not re-emit the same call. Today the persisted
declined outcome is ambiguous from the model's seat — it cannot be distinguished from a
generic failure — so re-offering happens.

**Why this priority**: The model re-asking a declined action erodes trust and wastes a
turn; lowest priority only because the turn-level "no re-request this turn" rule and
preamble etiquette already dampen most of it.

**Independent Test**: Decline a high-risk tool call, then reassemble the next turn's
model context from the stored conversation; assert the declined call's record clearly
identifies the learner's decline (not merely a failure).

**Acceptance Scenarios**:

1. **Given** the learner declined a tool call, **When** the next turn's context is
   assembled, **Then** the model sees an explicit, human-legible declined outcome for
   that call.
2. **Given** a tool call that failed for a non-decline reason, **When** the next turn's
   context is assembled, **Then** its record is distinguishable from a declined one.

---

### Edge Cases

- Propagation tool chrome rows from *other* tools (non-propagation tool calls, results,
  approvals) remain part of the branch transcript and stay in the payload.
- A branch whose entire timeline is only propagation chrome (no content rows) yields an
  empty-turns payload — the existing empty-payload behavior applies; no special casing.
- The latch can be refused by either path (manual vs tool) holding it; the stale-record
  clearing must cover both refusers.
- Deduplication keys on image data; two images with identical data but different names
  count as one.
- Regeneration while another propagation is running is refused exactly as today.
- Abort racing the artifact write: whichever wins, the outcome is either a complete
  artifact or none — never a partial row.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The propagation payload builders MUST exclude the propagation tool's own
  timeline rows — its tool-call rows, its approval rows, and its result rows — from
  rendered turns and from collected images, on both the tool and manual paths.
- **FR-002**: For the same branch conversation content, the tool-built artifact payload
  MUST equal the manual-path payload byte for byte.
- **FR-003**: A refused (latched) propagation attempt MUST NOT leave a prior run's
  success record observable as this run's outcome; the UI MUST NOT raise a success
  toast for a refused attempt.
- **FR-004**: Root-chat availability guidance MUST direct the learner to a real path
  (propagation moves a branch outcome to its parent; this chat needs a child context),
  and MUST NOT reference the manual control from the root-chat case; the
  provider-without-tools case on a branch MAY still reference the manual control.
- **FR-005**: The propagation tool MUST re-check the abort state after payload
  generation and before the artifact write; when aborted there, it MUST persist
  nothing, report an aborted outcome, and release the in-flight slot.
- **FR-006**: Image collection for propagation MUST deduplicate identical image data
  before applying the existing image cap, on every collection path.
- **FR-007**: The artifact image grid MUST NOT key thumbnails solely by image data.
- **FR-008**: Summary-artifact regeneration MUST update the artifact's stored image
  parts to the source branch's current collected images (same rules as fresh
  propagation) atomically with the content update, preserving the established parts
  invariants.
- **FR-009**: A declined tool call's persisted outcome MUST carry an explicit declined
  marker that survives context reassembly, distinct from failure outcomes.

### Key Entities

- **Branch artifact** (`branch_artifact` message row): anchored parent-chat row carrying
  the payload text, its metadata (mode, source branch, anchor, regeneration stamp), and
  optional image parts; subject to the parts invariants (text parts concatenate exactly
  to content; at most 8 image parts).
- **Propagation chrome rows**: the propagation tool's tool-call, approval, and result
  rows in the branch timeline — durable history, but never artifact payload content.
- **Model conversation record**: the reassembled per-turn view of stored rows; must
  render declined tool outcomes legibly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tool-built artifacts for a given branch conversation are
  byte-identical to the manual-path artifact for that conversation (regression-tested).
- **SC-002**: Zero success toasts for refused (latched) propagation attempts, while
  genuine successes still toast exactly once (regression-tested).
- **SC-003**: No root-chat guidance references a control that is hidden on root chats.
- **SC-004**: Mid-tool aborts produce zero additional persisted rows and always release
  the in-flight slot.
- **SC-005**: Branches with duplicated images propagate and render without rendering
  errors; distinct images are all preserved.
- **SC-006**: Every regenerated summary artifact's rendered image set equals its source
  branch's current collected image set after regeneration.
- **SC-007**: In the turn following a declined tool call, the model-facing record of
  that call identifies the decline explicitly.

## Assumptions

- The four availability gates, the in-flight latch, the approval flow, and the
  raw/summary modes stay as they are; only the listed defects change.
- The 027 "byte-identical" parity guarantee is the governing contract; where this
  feature's fixes touch it, the 027 contract document is amended in place with a 037
  cross-reference.
- Declined-outcome legibility targets the reassembled model context; no new persisted
  entity or migration is introduced.
- Existing house testing patterns (source-wiring component tests, repository tests,
  store tests, loop tests) are reused; no new test infrastructure.
- The issue's P1/P2/P3 severities map to story priorities here (issue "high" → P1,
  "medium" → P2, "low" → P3).

## Open Questions

- None blocking; all defaults chosen are recorded in Assumptions and the plan's
  research decisions.
