# Feature Specification: Automatic Model Context Lengths

**Feature Branch**: `024-model-context-length`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "As user, in addition to the LLM remaining context story, I would also like to automatically obtain the context length of models from our providers when fetching model data. This makes the context more user friendly because users don't have to find out what is the context length for the given model."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-configuration context lengths from provider model data (Priority: P1)

When the app fetches a provider's model data to list selectable models, and that data includes a model's context-window size, the app captures the number automatically and associates it with that model. Features that need the window — above all the context-remaining indicator (spec 023) — then work with real, per-model windows without the user ever looking up or entering a number.

**Why this priority**: This is the entire ask: remove manual lookup. It closes the biggest blind spot of the context-remaining indicator, whose window sizes are today user-declared per provider (absent when unknown), by making them provider-supplied and per model.

**Independent Test**: Configure a provider whose model data includes context-window sizes, fetch its models, and open a chat with any listed model: the context-remaining indicator measures against that model's own window with zero manual entry or configuration.

**Acceptance Scenarios**:

1. **Given** a configured provider whose model data includes context-window sizes, **When** the app fetches that data, **Then** each listed model's context-window size is captured and associated with that model.
2. **Given** a model with a captured context length, **When** the user chats with that model, **Then** the context-remaining indicator measures against that model's window without any manual configuration.
3. **Given** two models from the same provider with different reported windows, **When** the user switches between them, **Then** each model's own window is used — the value is per model, not one number for the whole provider.
4. **Given** the automatic capture, **When** model data is fetched, **Then** model listing, selection, and error behavior are unchanged from before this feature (capture is purely additive).

---

### User Story 2 - Honest values: unknown stays unknown, user intent wins (Priority: P2)

Models whose data carries no context length show as unknown — never a guess. Implausible reported values are ignored rather than trusted. Wherever a context window is shown, the user can tell whether it came from the provider or from their own entry, and a user-specified value always takes precedence over the automatically captured one.

**Why this priority**: Trust decides whether users act on the context-remaining numbers, and automatic data can be missing, malformed, or stale. Honesty and override rules keep the automation from poisoning the indicator; they only matter once capture exists (Story 1).

**Independent Test**: Use a provider that omits context lengths and confirm those models show as unknown; enter a manual value for a model and confirm it wins over the captured one and is labeled as user-specified; clear it and confirm the captured value returns.

**Acceptance Scenarios**:

1. **Given** a model whose provider data lacks a context length, **When** its window is displayed or used, **Then** it is presented as unknown — no inferred, remembered-elsewhere, or default number is shown.
2. **Given** a reported value that is not a usable positive whole number, **When** model data is processed, **Then** the value is treated as not reported.
3. **Given** a user-specified value and a provider-reported value for the same model, **When** the window is used or displayed, **Then** the user-specified value wins; clearing it falls back to the provider-reported one.
4. **Given** a context window shown to the user, **When** it is displayed, **Then** its provenance (provider-reported vs. user-specified vs. unknown) is discernible.

---

### User Story 3 - Staying current as provider catalogs evolve (Priority: P3)

Provider catalogs change: models appear, disappear, and their advertised windows get revised. Whenever model data is fetched again, automatically captured lengths refresh to the provider's latest values, while user-specified values are never touched. A failed fetch retains the last known values rather than silently wiping them.

**Why this priority**: Stale numbers erode trust, but the first successful fetch already delivers the core value; refresh correctness is what keeps the feature honest over time.

**Independent Test**: Against a provider whose reported window for a model changes between fetches (or a test fixture simulating it), re-fetch model data and confirm the displayed window follows the latest report while a user-specified value for another model is untouched.

**Acceptance Scenarios**:

1. **Given** a previously captured length, **When** model data is fetched again and the provider now reports a different length, **Then** the new value replaces the old one.
2. **Given** user-specified values, **When** model data is re-fetched, **Then** they remain exactly as the user set them.
3. **Given** a failed or interrupted model-data fetch, **When** it does not complete, **Then** previously captured lengths are retained and the failure surfaces the same way model-fetch failures already do — no new error states.

---

### User Story 4 - Context length visible when choosing a model (Priority: P4)

Wherever the app lets the user browse or inspect a provider's models, the context window is part of the model's details (with its provenance), so a user comparing models can see which ones handle more context before choosing.

**Why this priority**: Convenience beyond the indicator — the indicator already covers the core need; this helps users choose the right model up front rather than discover limits mid-conversation.

**Independent Test**: Open the model listing/selection surface for a provider with captured lengths and confirm each model shows its window (and unknown where not reported).

**Acceptance Scenarios**:

1. **Given** a model with a captured length, **When** the user browses or selects models, **Then** the context window is shown with the model.
2. **Given** a model without a captured length, **When** its details are shown, **Then** the absence is presented as unknown rather than being hidden or defaulted.

---

### Edge Cases

- **Provider reports no context length for its whole catalog**: every model stays unknown; the context-remaining indicator follows its existing unknown-window behavior (spec 023).
- **The same model id appears more than once in one listing with conflicting values**: exactly one value is kept per model — deterministic, never both.
- **A model's window is revised between fetches**: the latest report wins (Story 3).
- **A previously unknown model gains a reported window**: the model upgrades from unknown to known on the next fetch, with no user action.
- **Unusually small or large but well-formed values** (thousands to millions of tokens): accepted as reported; beyond the usable-number check, the app does not judge plausibility.
- **The same model name is offered by two different providers with different windows**: values belong to the provider+model pair and are never merged across providers.
- **A user's pre-existing manual context-window setting**: continues to work as the user-specified override under Story 2's precedence rules.
- **The fetch succeeds but returns models without usable metadata**: lengths stay unknown; no new error or warning is introduced.
- **A provider expresses the window in a shape or unit the app cannot confidently interpret as tokens**: treated as absent, never mis-scaled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When fetching a provider's model data, the system MUST capture each listed model's context-window size where the provider includes it in that data.
- **FR-002**: Captured sizes MUST be associated per model of each provider, and MUST be available to the context-remaining indicator and other model-context features without user action.
- **FR-003**: The system MUST treat a reported size as absent when it is not a usable positive whole number.
- **FR-004**: The system MUST NOT invent context-window sizes; a missing value is represented as unknown.
- **FR-005**: User-specified context values MUST take precedence over captured ones, and removing a user-specified value MUST fall back to the captured one when present.
- **FR-006**: Re-fetching model data MUST update captured sizes to the provider's latest values, and MUST NOT alter user-specified values.
- **FR-007**: A failed or partial model-data fetch MUST retain previously captured sizes and MUST NOT introduce new failure modes into model listing.
- **FR-008**: Capture MUST be additive to existing model fetching: model listing results and error reporting remain as before this feature.
- **FR-009**: Where a context-window size is displayed, its provenance (provider-reported vs. user-specified vs. unknown) SHOULD be discernible.

### Key Entities *(include if feature involves data)*

- **ModelContextWindow**: the context-window size associated with one model of one provider; key attributes are the size, its provenance (provider-reported, user-specified, or unknown), and — for provider-reported values — when it was last refreshed. This makes spec 023's `ContextWindow` provenance dimension concrete: "provider-declared" becomes a real, automatically maintained source rather than a user-entered number per provider.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of models whose provider reports a context-window size, a user sees that size in the app (via the context-remaining indicator and/or model details) with zero manual lookup or data entry.
- **SC-002**: For models without a reported size, the app shows unknown 100% of the time — never a fabricated or default number.
- **SC-003**: After a provider revises a reported size and the app's normal model-data fetch runs, the user sees the revised size without restarting or reconfiguring anything.
- **SC-004**: Model listing and selection behave exactly as before this feature — no regressions in fetch success rates or error reporting.

## Assumptions

- "Fetching model data" means the model listing the app already performs when a user picks or refreshes a provider's models; v1 requires no dedicated per-model lookups beyond that. A provider that only exposes the window through extra per-model calls may simply remain unknown in v1.
- Context lengths are expressed in tokens — the unit the context-remaining indicator already uses; values the app cannot confidently interpret as token counts are treated as absent.
- The existing user-facing manual context-window entry (today a per-provider number) remains as the user-specified override; whether manual entry also becomes per-model is a plan-phase UI decision, not a requirement of this spec.
- Precedence default: explicit user-specified value → provider-reported value → unknown.
- Scope is limited to obtaining windows from provider model data; maintaining a hand-curated model catalog (the other option spec 023's assumptions mentioned) is explicitly out of scope.
- How the context-remaining indicator computes consumption is spec 023's concern and is unchanged here; this feature only improves what the window size is and where it comes from.
- Providers are not required to report context lengths at all; absence is a normal, supported state for every story in this spec.
