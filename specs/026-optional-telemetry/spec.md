# Feature Specification: Optional User-Defined Telemetry (Langfuse First)

**Feature Branch**: `026-optional-telemetry`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "i'd like to setup an optional, user-defined, telemetry support. First use case is langfuse. I will be using this for prompt improvement and data gathering." (`ideas/optional-telemetry.md`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Telemetry is strictly opt-in and provably silent when off (Priority: P1)

A fresh Mayon deployment collects and emits nothing: no conversation data, no usage events, no outbound requests to any analytics or observability service. Telemetry exists only after the deployment owner deliberately turns it on. Turning it off again is equally absolute — emission stops immediately, any queued-but-unsent records are discarded rather than zombie-flushed, and the deployment returns to zero external traffic. The guarantee is verifiable, not a promise: with telemetry disabled, a network-level inspection of a typical chat session shows zero telemetry-related requests.

**Why this priority**: Mayon holds the owner's private conversations; silent or default-on collection would betray that. Every other story's value depends on this trust precondition — an opt-in feature that leaks when "off" is worse than no feature. It also stands alone: the off-state guarantee can be built, tested, and defended before any destination exists.

**Independent Test**: Bring up a stock deployment, hold telemetry off, and inspect all outbound traffic during normal chatting: no telemetry requests appear. Toggle telemetry on and off mid-session: emission starts only after the explicit opt-in and stops immediately (including discarding pending records) after the toggle-off.

**Acceptance Scenarios**:

1. **Given** a freshly installed deployment that has never configured telemetry, **When** the owner chats normally, **Then** no telemetry data is collected or transmitted anywhere.
2. **Given** telemetry enabled and actively emitting, **When** the owner disables it, **Then** no further records are transmitted, and records queued but not yet delivered are discarded rather than sent.
3. **Given** telemetry disabled, **When** any network-level inspection runs over a full chat session, **Then** zero telemetry-related outbound requests are observable.
4. **Given** telemetry disabled in configuration, **When** the application runs for an extended period, **Then** no telemetry records accumulate in local storage waiting for a future enablement.

---

### User Story 2 - LLM interactions become structured traces in the owner's Langfuse (Priority: P2)

With telemetry enabled and a Langfuse destination configured, every LLM interaction in a conversation is captured as a structured record and delivered to the owner's Langfuse project: the model used, the prompt/messages sent, the response received, token usage when the provider reports it, timing, and error outcomes. Records carry conversation linkage so Langfuse groups a whole conversation's interactions into one inspectable session, letting the owner walk a chat end-to-end after the fact. This is the raw material for the owner's stated goal — prompt improvement and data gathering: real production traces in Langfuse can be promoted into datasets, evaluated, and compared across prompt versions entirely inside Langfuse. Delivery is invisible to the chat itself: records are batched and sent in the background, telemetry failures never surface in the conversation flow, and capturing a long conversation never degrades it.

**Why this priority**: This is the feature's entire payoff — without faithful, well-linked traces in Langfuse, there is nothing to improve prompts with. It ranks below Story 1 only because the trust precondition must exist first.

**Independent Test**: Enable telemetry against a working Langfuse project, hold a multi-turn conversation across two different providers, and open Langfuse: all LLM calls appear as structured traces grouped under the conversation, each showing model, input, output, usage, and duration; a provider error during one turn appears as an errored record, not a gap.

**Acceptance Scenarios**:

1. **Given** telemetry enabled with a healthy Langfuse destination, **When** the owner completes an LLM interaction, **Then** a record containing model, input, output, usage (when available), duration, and outcome is delivered to the destination.
2. **Given** a multi-turn conversation with telemetry on, **When** the owner inspects the destination, **Then** all of the conversation's interactions are grouped into one linked session and can be followed end-to-end.
3. **Given** an LLM call that fails (provider error, aborted stream), **When** the record is delivered, **Then** it captures the failure outcome and whatever partial context is available, rather than being silently dropped.
4. **Given** telemetry enabled, **When** delivery happens, **Then** it occurs in the background after the interaction, adding no user-perceptible delay to chats.
5. **Given** the owner's prompt-improvement workflow in Langfuse, **When** traces arrive, **Then** they carry sufficient fidelity (full prompt and response in content mode) to be used as dataset items and evaluation material without re-collection.

---

### User Story 3 - The owner controls exactly what content leaves the deployment (Priority: P3)

Enabling telemetry is a consent decision about the owner's own data, and the owner decides what actually leaves: at enablement they choose a capture mode — full content (prompts and responses included, the default for prompt-improvement work) or metadata-only (model, usage, timing, outcome, and linkage, with no conversation text at all). The choice is explicit, visible next to the toggle, and changeable at any time; switching to metadata-only stops any further content emission immediately. Records are finalized before leaving the deployment, so whatever the owner excluded or redacted is never transmitted, not merely hidden in the destination's UI.

**Why this priority**: "Optional, user-defined" means the owner shapes the data flow, not just flips it on. It ranks after capture because the default mode already serves the stated use case, but it converts telemetry from all-or-nothing into a dial the owner can turn as their privacy posture changes.

**Independent Test**: Enable telemetry in metadata-only mode, hold a conversation, and inspect the records in the destination: trace structure is intact (model, timing, usage, session linkage) and a search for any phrase actually spoken in the conversation returns nothing.

**Acceptance Scenarios**:

1. **Given** telemetry being enabled, **When** the owner chooses a capture mode, **Then** the consequences of each mode (what fields leave, what stays) are stated plainly at the point of choice.
2. **Given** metadata-only mode, **When** any record is delivered, **Then** it contains no conversation text — inputs, outputs, and message bodies are absent.
3. **Given** telemetry running in full-content mode, **When** the owner switches to metadata-only, **Then** subsequent records contain no content, and the switch takes effect without requiring a restart or redeployment.
4. **Given** any capture mode, **When** records are assembled for delivery, **Then** excluded or redacted fields are removed before transmission rather than masked at the destination.

---

### User Story 4 - Connection setup and delivery health are visible, not mysterious (Priority: P4)

Configuring the Langfuse destination (its address and the project's access credentials) is a guided, validated act: the owner enters the details, the system verifies it can reach the destination and authenticate, and reports the outcome in plain language — connected, unreachable, rejected credentials — before the owner relies on it. After setup, a persistent, low-key status reflects delivery health (last successful delivery, persistent failures), so an expired credential or an unreachable self-hosted instance is discovered from the status, not inferred from mysteriously empty dashboards. Credential material is stored and transported consistent with Mayon's existing secret-handling conventions — never in the plain settings store.

**Why this priority**: Telemetry that silently fails is worse than none — the owner believes they are gathering data while losing it. Validation and status make the pipeline trustworthy day-to-day, but they refine rather than enable the core value, so they land last.

**Independent Test**: Enter a destination with wrong credentials: setup reports rejection clearly and no records are delivered; correct them and complete setup: a first-trace confirmation arrives. Take the destination offline for a day: chat works unaffected and the status shows the delivery failure; restore it: delivery resumes and the status recovers.

**Acceptance Scenarios**:

1. **Given** telemetry being configured, **When** the owner submits destination details, **Then** the system validates reachability and authentication and reports success or the specific failure plainly.
2. **Given** telemetry enabled, **When** delivery fails persistently, **Then** the failure is reflected in a visible status without interrupting or annotating ongoing chats.
3. **Given** destination credentials entered by the owner, **When** they are stored, **Then** they follow the deployment's existing secret-handling conventions and are never persisted in the plain settings store.
4. **Given** telemetry enabled and the destination healthy, **When** the owner checks status, **Then** it confirms recent successful delivery (e.g., last delivery time) rather than merely showing "enabled".

---

### Edge Cases

- **Destination unreachable or credentials rejected mid-run**: chat proceeds unaffected; pending records are held in a bounded queue and dropped oldest-first rather than growing without limit; the persistent-failure status appears; recovery resumes delivery without owner action beyond fixing the destination.
- **Disabled while records are queued**: unsent records are discarded — disablement is immediate and total, at the cost of losing in-flight records.
- **Extremely long conversations and large records**: record size is bounded so a single huge prompt/response cannot stall delivery or unbalance the pipeline; truncation, when unavoidable, is marked in the record.
- **Backup/restore of deployment data**: restore must not silently re-enable telemetry or resurrect stale credentials — telemetry state restores as disabled-or-explicitly-as-configured and revalidates the destination before emitting.
- **Server-less runtime**: the SPA running without the server keeps the same zero-emission-when-off and never-attempts-telemetry-without-server behavior (progressive capability, consistent with existing server-detected features). Note: the browser can reach providers directly without the server, but the app runtime itself requires the server (boot gates on the database), so telemetry requiring the server loses no chat coverage.
- **Sensitive material in conversations** (pasted keys, personal data): metadata-only mode is the always-available escape; content mode is the owner's explicit choice about their own data.
- **Self-hosted Langfuse beside Mayon** (same host/network, no public internet): fully supported — the destination is an owner-defined address, identical in status and behavior to a cloud destination.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Telemetry MUST be disabled by default; enabling it MUST require an explicit, deliberate owner action.
- **FR-002**: While telemetry is disabled, the system MUST NOT collect telemetry records or make any telemetry-related outbound requests; this MUST hold at network-inspection level, not only in UI state.
- **FR-003**: Disabling telemetry MUST stop emission immediately and MUST discard any queued-but-unsent records.
- **FR-004**: The system MUST let the owner define a telemetry destination — a Langfuse project's address and access credentials — with entry validated for reachability and authentication before the destination is considered active, and with outcomes reported in plain language.
- **FR-005**: Telemetry credentials MUST be stored and transported consistent with the deployment's existing secret-handling conventions; they MUST NOT be persisted in the plain settings store.
- **FR-006**: When enabled, the system MUST capture each LLM interaction as a structured record including model, input, output (per capture mode), token usage when the provider reports it, duration, and outcome (success or error), and MUST associate records with their conversation so a conversation's records form one linked group in the destination.
- **FR-007**: Capture and delivery MUST happen in the background and MUST NOT delay, block, or visibly alter chat interactions; telemetry faults MUST NOT cause chat failures.
- **FR-008**: The system MUST offer two capture modes — full content and metadata-only (no conversation text) — selected at enablement and changeable at any time without restart; the mode's data consequences MUST be stated at the point of selection.
- **FR-009**: Switching to metadata-only MUST take effect for all subsequent records, and content excluded by the active mode MUST be removed before the record leaves the deployment.
- **FR-010**: Delivery failures MUST be reflected in a visible delivery-health status (including last successful delivery); the status MUST NOT interrupt or annotate ongoing chats.
- **FR-011**: The telemetry mechanism MUST be designed as a generic, opt-in sink (normalized interaction records, owner-defined destination) with Langfuse as the first connector, so additional destinations can be added later without redesigning capture or consent.
- **FR-012**: Records MUST carry the fidelity needed for the owner's prompt-improvement workflow in the destination — conversation/session linkage, model identity, and (in content mode) complete prompt and response text — while evaluation, dataset-building, and prompt versioning themselves remain the destination tool's job, not Mayon's.

### Key Entities *(include if feature involves data)*

- **Telemetry Configuration**: the owner-defined state — enabled/disabled, destination descriptor (address, credential handle), capture mode, and linkage preferences. Non-secret by convention except the separately-stored credential handle.
- **Telemetry Interaction Record**: the normalized unit of capture — one LLM interaction with conversation reference, model, input, output (per capture mode), usage, timing, and outcome — finalized locally before delivery.
- **Telemetry Sink (connector)**: the destination abstraction that receives interaction records; Langfuse is its first realization, with tracing-session grouping as its delivery shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With telemetry disabled, a network-level capture over a full chat session shows zero telemetry-related outbound requests (100% of sessions, including fresh installs and post-disable states).
- **SC-002**: An owner with a working Langfuse project can go from unconfigured telemetry to a validated connection and first visible traces in under 5 minutes.
- **SC-003**: With telemetry enabled and the destination healthy, at least 99% of completed LLM interactions are visible in the destination within 2 minutes of completion.
- **SC-004**: Delivery outages of any duration cause zero user-visible chat failures and zero loss of conversation data; with telemetry on, chat latency remains user-perceptibly unchanged versus telemetry off.
- **SC-005**: In metadata-only mode, 0% of delivered records contain conversation text, verifiable by searching the destination for phrases actually used in the conversation.
- **SC-006**: Given a conversation conducted with telemetry on, the owner can locate it in Langfuse and follow it end-to-end within 1 minute, using session grouping alone.

## Assumptions

- "User-defined" means owner-configured (destination, capture mode, on/off state) — not a general custom-event authoring SDK inside Mayon.
- The Langfuse instance (cloud or self-hosted) is chosen, provided, and operated by the deployment owner; Mayon neither bundles nor requires one, and the first connector targets Langfuse's tracing model (traces with conversation/session grouping).
- Prompt evaluation and improvement (datasets, experiments, prompt versioning) happen inside Langfuse, on the traces Mayon exports — consistent with the standing decision that prompt-quality evaluation is decoupled from Mayon's application code. Mayon's obligation is faithful, well-linked export.
- Consent is single-owner: Mayon is a self-hosted, single-user deployment, so the person enabling telemetry is the data owner; no multi-user consent or anonymization workflow is in scope.
- Telemetry is forward-only: it covers interactions after enablement; there is no retroactive export of existing conversation history.
- Version-one scope is LLM chat interactions. Other event families (tool/MCP invocations, UI analytics, error reporting) are future sinks on the same design, out of scope now.
- Retention, access control, and further processing of exported data are governed in the destination (the owner's Langfuse), not in Mayon.
