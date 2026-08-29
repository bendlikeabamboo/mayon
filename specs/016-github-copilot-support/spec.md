# Feature Specification: GitHub Copilot Support

**Feature Branch**: `016-github-copilot-support`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "I want to support github-copilot because that's our main AI in my official work. and I want to use this application there."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add GitHub Copilot as a provider and chat with it (Priority: P1)

A user whose workplace provides GitHub Copilot opens the provider settings and adds GitHub Copilot as a new provider. The add flow guides them through authorizing the application with their GitHub account, after which the provider appears alongside their existing providers with a sensible default model pre-selected. They select it as the active provider, send a message, and receive a normal streaming reply — indistinguishable in behavior from chatting with any other configured provider.

**Why this priority**: This is the entire core promise — "use the app with our main AI at work." A user who can add the provider and chat has a viable feature; everything else refines it.

**Independent Test**: Can be fully tested by adding a GitHub Copilot provider through settings, completing the authorization, selecting a model, and confirming a chat exchange completes with a streamed reply.

**Acceptance Scenarios**:

1. **Given** the provider settings screen, **When** the user opens the "add provider" picker, **Then** GitHub Copilot is offered as a choice with a description that makes clear it authorizes through a GitHub account rather than a manually pasted key.
2. **Given** the user chose GitHub Copilot, **When** they complete the add flow's authorization step in a browser, **Then** the provider is created without the user ever copying or pasting a secret, and no secret material is stored in the app's general settings storage.
3. **Given** a GitHub Copilot provider exists, **When** the user selects it as the active provider and sends a chat message, **Then** they receive a normal streamed reply with the same affordances (stop, regenerate, error surfacing) as any other provider.
4. **Given** the user has an existing conversation built with another provider, **When** they switch the active provider to GitHub Copilot and continue the conversation, **Then** the conversation continues without loss of history or context.
5. **Given** the user has not yet completed authorization, **When** they attempt to use the GitHub Copilot provider, **Then** the app presents a clear path to (re)start authorization instead of an opaque failure.

---

### User Story 2 - Access keeps working across sessions without manual re-auth (Priority: P2)

Authorization with GitHub yields short-lived access that expires while the user works. The user should not be interrupted by this: when access has lapsed, the next request transparently renews it using the stored grant, and the chat proceeds. If the renewal itself requires the user (for example, the grant was revoked at the GitHub side or the workplace policy changed), the user sees a specific, actionable state — not a generic request failure — and a single action restores service.

**Why this priority**: A workplace daily-driver fails its purpose if it stalls mid-day; but this builds on top of a working P1 connection and only matters once users rely on it regularly.

**Independent Test**: Can be fully tested by letting stored access expire (or simulating expiry), issuing a chat request, and confirming the reply completes without user intervention — plus confirming a revoked-grant state produces an actionable recovery path.

**Acceptance Scenarios**:

1. **Given** stored access has expired, **When** the user sends a chat request, **Then** the request completes successfully with the access renewed behind the scenes, with no prompts and no lost message content.
2. **Given** the stored grant is no longer valid (revoked or expired beyond renewal), **When** the user sends a chat request, **Then** the app shows a provider-specific state explaining that re-authorization with GitHub is needed and offers one action to restart it; the in-progress conversation content is preserved.
3. **Given** the user closed and reopened the application days later, **When** they send a chat request with the GitHub Copilot provider active, **Then** it works without re-entering the add flow (subject to scenario 2 if the grant itself is dead).

---

### User Story 3 - Model list reflects what the workplace Copilot actually offers (Priority: P3)

GitHub Copilot exposes a model catalog that changes as GitHub adds models and as workplace licensing enables or restricts them. After adding the provider, the user sees the models their account can actually use, fetched from the provider when possible, with a sensible fallback list when it cannot be fetched (for example, before authorization completes). The user can pick any listed model, and the previously chosen model stays selected across sessions.

**Why this priority**: Improves accuracy and future-proofing of model choice, but a static curated default model list already delivers a usable experience; this is the polish layer.

**Independent Test**: Can be fully tested by completing authorization, refreshing the model list, and confirming it matches the account's available models; then by blocking the fetch and confirming the fallback list still allows normal use.

**Acceptance Scenarios**:

1. **Given** an authorized GitHub Copilot provider, **When** the user views or refreshes its model list, **Then** the list reflects the models currently offered to their account, replacing the fallback list.
2. **Given** the model catalog cannot be fetched (offline, pre-authorization, or provider outage), **When** the user opens the model picker, **Then** a reasonable fallback list of known Copilot models is shown and chat still works.
3. **Given** the user selected a model that later disappears from the catalog, **When** they next open the provider or start a chat, **Then** the app handles the missing model gracefully (clear indication and an easy re-selection) rather than silently failing every request.

---

### Edge Cases

- What happens when the user's workplace uses Copilot Business/Enterprise with policy restrictions? Authorization and model listing follow the same flow; restricted models simply do not appear (or fail with a clear provider error when attempted).
- What happens when the user is already signed in to GitHub in their browser with multiple accounts? The authorization flow makes clear which account granted access; re-running authorization allows switching accounts.
- What happens when two GitHub Copilot providers are added (for example, work and personal accounts)? Each is an independent provider entry with its own authorization and model selection, selectable like any other provider.
- What happens when a chat request fails mid-stream due to an access-renewal boundary? The failure is surfaced like any other mid-stream provider error; the retry path renews access and succeeds without user-visible credential work.
- What happens when the user removes the GitHub Copilot provider? Stored authorization material for it is discarded; no orphaned secrets remain.
- How does the feature behave when the companion server is absent? Consistent with the app's progressive-capability model: provider features that depend on server-assisted requests remain disabled with the same indicators used for other providers, and the feature must not assume the server is present.
- What happens when GitHub itself is unreachable or returns errors? Standard provider error handling applies: clear message, retry affordance, no data loss.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The "add provider" experience MUST offer GitHub Copilot as a first-class choice, labeled clearly, with a description distinguishing account authorization from manually-entered keys.
- **FR-002**: Users MUST be able to complete authorization with their GitHub account without copying, pasting, or otherwise manually handling secret values.
- **FR-003**: Authorization credentials MUST be stored only in the app's dedicated secret storage — never in general settings — consistent with how all provider keys are handled.
- **FR-004**: A GitHub Copilot provider MUST appear and behave like any other provider in the existing provider list: selectable as active, editable, and removable.
- **FR-005**: Removing a GitHub Copilot provider MUST discard its stored authorization material.
- **FR-006**: Chat and other AI features (structured generation such as quizzes) MUST work over a GitHub Copilot provider with feature parity to other providers of the same serving style, including streamed replies, stop, retry, and error surfacing.
- **FR-007**: The system MUST renew expiring access automatically using the stored grant, without user interaction, whenever a request would otherwise fail due to expiry.
- **FR-008**: When the stored grant is invalid beyond renewal, the system MUST present a provider-specific re-authorization state with a single recovery action, preserving conversation content.
- **FR-009**: The model list MUST be fetched from the provider when available, and MUST fall back to a curated list of known models when it cannot be fetched.
- **FR-010**: The user's selected model MUST persist across sessions per provider.
- **FR-011**: A selected model that is no longer offered MUST produce a clear indication and an easy re-selection path rather than repeated silent failures.
- **FR-012**: Multiple independent GitHub Copilot providers (different accounts) MUST be supported simultaneously.
- **FR-013**: The feature MUST respect the app's progressive server-capability model: behavior when the companion server is absent MUST match the established degradation rules for provider networking.
- **FR-014**: All user-facing states (unauthorized, authorizing, active, needs re-authorization, error) MUST be visually distinguishable in the provider UI and match the application's existing design conventions in both light and dark appearances.

### Key Entities *(include if feature involves data)*

- **GitHub Copilot provider**: A provider entry of a new supported kind. Attributes: display name, authorization grant reference (secret storage only), selected model, tool-capability setting. Relates to conversations as their serving provider, exactly like existing providers.
- **Authorization grant**: The stored, renewable link to the user's GitHub account created by the one-time authorization flow. Attributes: grant reference, renewal material, expiry tracking. Never stored in general settings; discarded on provider removal.
- **Model entry**: One selectable model offered by GitHub Copilot. Attributes: identifier, display name. Sourced live from the provider's catalog with a curated fallback list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with a workplace GitHub Copilot license goes from "add provider" to first streamed reply in under 3 minutes, with zero manual secret handling.
- **SC-002**: 100% of chat requests affected only by routine access expiry complete without any user interaction (transparent renewal).
- **SC-003**: In a revoked-grant scenario, the user reaches a successful re-authorization in a single action from the surfaced state.
- **SC-004**: A user can distinguish the GitHub Copilot provider's state (unauthorized / active / needs re-authorization / error) at a glance in the provider UI.
- **SC-005**: After the model list is fetched, it matches the account's actual offered models; with the fetch unavailable, the fallback list still yields a working chat in every attempted case.
- **SC-006**: Existing provider features (conversation switching, structured generation, error surfacing) show zero regressions when a GitHub Copilot provider is the active provider.

## Assumptions

- The user's workplace license is GitHub Copilot (individual or Business/Enterprise); the authorization and serving flow is the same for all tiers, with tier differences surfacing only as model availability and policy errors.
- GitHub's account-authorization flow (the mechanism used by Copilot tooling, which grants short-lived access renewable without user interaction) is the intended authentication model; static personal access tokens are NOT the expected path.
- GitHub Copilot's serving interface is treated as an OpenAI-compatible chat service for feature-parity purposes; provider-kind-specific quirks are absorbed by the existing provider abstraction and resolved at plan time.
- The curated fallback model list is a snapshot at implementation time; it exists only until the first successful catalog fetch.
- Server-assisted request routing follows the existing pattern for provider traffic (secrets never leave the app except to the provider, via the established proxied-request rule).
- Scope is provider support only: no changes to conversation storage, search, or other subsystems.
