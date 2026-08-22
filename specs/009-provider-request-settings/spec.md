# Feature Specification: Provider Request Settings — Sampling Defaults, Reasoning Dialects, and Raw Extra-Body Passthrough

**Feature Branch**: `009-provider-request-settings`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Provider request settings: sampling defaults (Tier A), a static dialect table + unified resolver replacing `providerOptionsForReasoning` (Tier B), and raw extra-body passthrough (Tier C). Source of truth: `research/005-provider-request-settings.md`."

## User Scenarios & Testing _(mandatory)_

Mayon users can today control exactly one request-level knob — the off/on/deep
reasoning-effort toggle — and even that works only for GLM models reached by
un-prefixed ids. Users cannot set sampling parameters (temperature, max tokens,
…), cannot opt in to provider-specific flags (prompt-cache keys, router
preferences, `top_k`, …), and the reasoning mapping is stale: it misses current
dialects (Anthropic adaptive thinking, Gemini 3 `thinkingLevel`, DeepSeek v4,
Groq `reasoning_format`, Kimi k3, DashScope `enable_thinking`) and silently
fails on router-prefixed model ids (`z-ai/glm-5.2` via OpenRouter/Kilo/Vercel).

This feature delivers three complementary slices — correct reasoning dialect
resolution for every documented provider (Tier B), per-provider sampling
defaults (Tier A), and a raw "extra request body" escape hatch (Tier C) — each
independently valuable, all routed through one resolution path so behavior
cannot drift between call sites. All provider data is transcribed from
`research/005-provider-request-settings.md` (checked 2026-08-22).

### User Story 1 - Correct reasoning behavior on every provider (Priority: P1)

A user chats with a reasoning model on any of the ten documented provider
dialects — GLM/Z.AI, Anthropic, Gemini (2.5 and 3.x), DeepSeek, Groq, Kimi,
Qwen/DashScope, Mistral, Ollama, or a generic OpenAI-compatible endpoint — and
toggles reasoning off/on/deep in the chat UI. The request sent to the provider
carries the correct thinking/effort parameters for that provider's current
dialect, regardless of whether the model id is router-prefixed
(`z-ai/glm-5.2`, `anthropic/claude-sonnet-4.5`). All four model-call paths —
agent chat, the critic correction pass, structured lab/quiz generation, and
title generation — resolve reasoning the same way; title generation always
requests effort off.

**Why this priority**: This is the keystone slice. It fixes silently-broken
behavior for existing users (GLM via routers currently receives no
`reasoning_effort`; Anthropic receives deprecated `budget_tokens` that is
rejected on Opus 4.7; Groq leaks raw `<think>` tags) and establishes the single
resolution path the other stories build on.

**Independent Test**: Given a provider on a router with model
`z-ai/glm-5.2` and effort on, the request trace shows `reasoning_effort` in the
provider namespace. Given effort on with Anthropic, the trace shows adaptive
thinking with an effort level and no `budget_tokens`.

**Acceptance Scenarios**:

1. **Given** an OpenAI-compatible provider whose effective model id is
   router-prefixed (`z-ai/glm-5.2`), **When** effort is on or deep, **Then**
   the request body contains the GLM `reasoning_effort` parameter (mapping the
   on/deep toggle to that dialect's accepted values).
2. **Given** an Anthropic provider with effort on, **When** any request is
   sent, **Then** thinking is requested via the adaptive form with an effort
   level — and no `budget_tokens` parameter is sent (rejected on Opus 4.7).
3. **Given** a Gemini provider, **When** effort is on, **Then** Gemini 3.x
   models receive the `thinkingLevel` form and Gemini 2.5 models receive the
   `thinkingBudget` form.
4. **Given** a Groq provider with effort on, **When** a response streams,
   **Then** the request asked for parsed reasoning (`reasoning_format:
'parsed'`) and no raw `<think>` tags leak into visible message content.
5. **Given** a DeepSeek v4, Kimi k2.6, or Qwen/DashScope provider, **When**
   effort is on, **Then** the dialect-correct thinking parameter is sent
   (`thinking` enabled / `enable_thinking: true`); **When** effort is off,
   **Then** the disabling form is sent where the model supports disabling.
6. **Given** any provider whose model always reasons (kimi-k3, GLM-5.3),
   **When** effort is off, **Then** no conflicting thinking parameter is sent
   and the model reasons anyway (a known hazard, surfaced per Story 3).
7. **Given** the critic correction pass, structured lab/quiz generation, or
   title generation, **When** a request is built, **Then** it goes through the
   same resolution as chat (critic gains reasoning parameters it never sent
   before; lab/quiz follow the ambient effort; title generation pins effort
   off).
8. **Given** a provider/model with no matching dialect entry, **When** effort
   is on, **Then** no thinking parameters are invented (generic
   OpenAI-compatible baseline) unless the user supplies them via Story 4.

---

### User Story 2 - Per-provider sampling defaults (Priority: P1)

A user opens a provider's Advanced settings, sets `temperature`, `topP`,
`maxOutputTokens`, `stopSequences`, `seed`, `frequencyPenalty`, or
`presencePenalty`, and every subsequent model call — chat, critic pass,
lab/quiz generation, and title generation — carries those values. Fields the
user leaves unset are omitted from the request entirely (sending explicit
defaults can change provider cache keys on OpenRouter).

**Why this priority**: Sampling control is the most-requested missing knob and
benefits every user tuning determinism, creativity, or output length across
all providers with one generic mechanism (no per-provider branching).

**Independent Test**: Set `temperature` and `maxOutputTokens` on a provider,
send a chat message, and inspect the request trace: both values appear in the
request at every call path; clear them and the fields are absent from the
body.

**Acceptance Scenarios**:

1. **Given** a provider with `temperature: 0.7` and `maxOutputTokens: 4096`
   set, **When** a chat message is sent, **Then** both values reach the request
   body.
2. **Given** the same provider, **When** the critic pass, lab/quiz generation,
   or title generation runs, **Then** those requests also carry the same
   values.
3. **Given** a provider with no sampling fields set, **When** any request is
   sent, **Then** none of the sampling fields appear in the body — behavior is
   byte-identical to today for existing users.
4. **Given** a provider with only `stopSequences` set, **When** a request is
   sent, **Then** only `stopSequences` appears; the other six fields are
   absent.

---

### User Story 3 - Capability-aware Settings UI with resolved-request preview (Priority: P2)

A user opens the Advanced section for a provider and sees honest controls: for
models whose dialect locks sampling (kimi-k3 fixed `temperature`/`top_p`),
sampling inputs are hidden or disabled with an explanation; for models whose
thinking mode ignores sampling, a warning is shown; for models that cannot
disable reasoning, the effort-off hazard is explained. A read-only preview of
the resolved request (sampling + reasoning + extras, given the current
settings and a sample model) shows exactly what will be sent before anything
is saved.

**Why this priority**: Without capability honesty, Stories 1–2 would mislead
(locked fields that appear settable, silent no-ops). The preview closes the
loop between what users configure and what providers receive, using the same
pure resolution logic as the live path.

**Independent Test**: Open Advanced settings for a Kimi provider with kimi-k3
selected: sampling inputs are disabled/hidden with the lock hazard shown; the
preview shows a request with no sampling fields. Switch to an unconstrained
model: inputs enable and preview updates.

**Acceptance Scenarios**:

1. **Given** a provider whose dialect/model sets `locksSampling`, **When** the
   Advanced section renders, **Then** sampling inputs are hidden or disabled
   and the lock hazard is displayed.
2. **Given** a model whose thinking mode ignores sampling parameters, **When**
   effort is on and sampling fields are set, **Then** the UI warns that the
   provider ignores them (fields remain user-settable; no silent dropping).
3. **Given** any provider, **When** settings change, **Then** the preview
   updates to show the fully resolved request — call settings, reasoning
   parameters, and extras — matching what the live path would send.
4. **Given** a provider without any Advanced settings, **When** the section
   renders, **Then** it shows empty defaults and the provider's baseline
   request (no regression in appearance or behavior).

---

### User Story 4 - Raw extra-body passthrough with guardrails (Priority: P2)

A power user pastes a JSON object into the provider's "Extra request body"
field — e.g. `{ "top_k": 40 }`, an OpenRouter routing preference, a
prompt-cache key, or a flag that does not exist yet — and it is merged into
every request for that provider, overriding any colliding dialect value. The
value appears in the request trace. Invalid input (non-object, oversized,
secret-like keys such as `Authorization`, `api_key`, or `headers`) is rejected
with a clear UI error and never saved. For providers where only a known set of
keys can be honored (Anthropic, Gemini, Ollama native namespaces), any
dropped key is surfaced as a UI warning — never silently ignored.

**Why this priority**: This is the future-proofing escape hatch that makes
every documented and not-yet-documented provider flag reachable with zero
per-provider work; it depends on Stories 1–3 (merge-last layer, trace,
preview) but delivers standalone value afterward.

**Independent Test**: Enter `{"top_k": 40}` for an OpenAI-compatible
provider whose dialect would send a different `top_k`; send a message; the
trace shows `top_k: 40` (user value won). Enter `{"api_key": "sk-..."}`; the
UI rejects it with an error and nothing is saved.

**Acceptance Scenarios**:

1. **Given** a provider with `extraBody: { "top_k": 40 }`, **When** any model
   call is made, **Then** `top_k: 40` reaches the request body and appears in
   the request trace.
2. **Given** a dialect that would emit a colliding key, **When** the user's
   extra body sets that key, **Then** the user's value wins (extras merge
   last).
3. **Given** extra-body input that is not a JSON object, exceeds the size cap,
   or contains a secret-like key, **When** the user saves, **Then** the UI
   shows an actionable error and the value is not persisted.
4. **Given** an Anthropic, Gemini, or Ollama provider whose request shape only
   accepts known keys, **When** extra body contains keys that cannot be
   forwarded, **Then** the UI lists the dropped keys as a warning; forwardable
   keys still apply.
5. **Given** a provider with no extra body set, **When** any request is sent,
   **Then** the body is unchanged from Story 1/2 output (no regression).

### Edge Cases

- **Router-prefixed model ids**: `z-ai/glm-5.2` or `anthropic/claude-sonnet-4.5`
  (OpenRouter/Kilo/Vercel) — dialect matching must use the effective
  per-request model id, matched against its last path segment, not the
  provider's default model.
- **Explicit defaults ≠ omitted**: unset sampling fields must be absent from
  the body; sending provider defaults explicitly changes cache keys on
  OpenRouter.
- **Thinking mode disables or rejects sampling**: DeepSeek/GLM thinking mode
  ignores temperature/top_p/penalties; Anthropic rejects non-default sampling
  with thinking on. The UI warns; the fields still ride the request (the
  provider's own behavior governs).
- **Reasoning tokens eat the token cap**: small `maxOutputTokens` on
  reasoning models can return empty answers with HTTP 200 (DeepSeek truncates
  reasoning silently). Surfaced as a hazard, not silently.
- **Models that cannot disable reasoning** (kimi-k3, GLM-5.3, several Gemini
  Pro tiers): effort off is a no-op that must not send a conflicting
  parameter; the hazard explains the model still reasons.
- **Anthropic `budget_tokens` churn**: the deprecated form is rejected on
  Opus 4.7 — the dialect must use adaptive thinking + effort.
- **Gemini 3 vs 2.5 dialect split**: `thinkingLevel` vs `thinkingBudget`,
  decided per model.
- **Groq default leaks `<think>` tags**: effort on must request parsed
  reasoning so tags never appear as visible content.
- **`top_k` on OpenAI-shaped endpoints**: not part of the standard sampling
  set (dropped there); it rides the extra-body passthrough instead.
- **Unknown/endpoint-mismatched providers**: no dialect match → baseline
  behavior, no invented parameters.
- **Existing users**: providers saved before this feature have neither field;
  every request must remain byte-identical to current behavior.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Provider configuration MUST support optional per-provider
  sampling defaults limited to `temperature`, `topP`, `maxOutputTokens`,
  `stopSequences`, `seed`, `frequencyPenalty`, `presencePenalty`.
- **FR-002**: The system MUST apply omit-empty semantics: any sampling field
  the user has not set MUST be absent from the outgoing request body at every
  call path.
- **FR-003**: Sampling defaults MUST apply identically at all four model-call
  paths: agent chat, critic correction, structured lab/quiz generation, and
  title generation.
- **FR-004**: The system MUST resolve request settings through a single
  resolution path used by all four call paths, replacing the previous
  reasoning-only mapping (`providerOptionsForReasoning`), producing both
  top-level call settings and provider-namespaced options from (a) provider
  configuration, (b) the effective per-request model id, and (c) the ambient
  off/on/deep effort setting.
- **FR-005**: Resolution MUST be layered with later layers overriding
  earlier ones: provider-kind baseline → endpoint dialect matched by endpoint
  address → model overlay matched against the last path segment of the
  effective model id → user sampling defaults → user extra body (user wins).
- **FR-006**: The dialect table MUST cover, per `research/005` §3/§4
  (checked 2026-08-22): GLM/Z.AI (thinking + `reasoning_effort`, 5.3 cannot
  disable), Anthropic (adaptive thinking + effort, no `budget_tokens`),
  Gemini (2.5 `thinkingBudget`, 3.x `thinkingLevel`), DeepSeek v4, Groq
  (`reasoning_format: 'parsed'` with effort on), Kimi (k2.6 `thinking`; k3
  always-reasons with locked sampling), Qwen/DashScope (`enable_thinking`),
  Mistral, Ollama (`think`), and a generic OpenAI-compatible baseline that
  invents no parameters.
- **FR-007**: Every dialect/model data entry MUST carry a source citation to
  `research/005` and a "checked 2026-08-22" date stamp so staleness is
  visible.
- **FR-008**: Reasoning request mapping MUST tolerate router-prefixed model
  ids by matching dialects against the last path segment of the effective
  per-request model id (never the provider's default model).
- **FR-009**: The off/on/deep effort toggle MUST remain the only reasoning
  control; each dialect maps it to its own accepted values (including value
  remapping, e.g. GLM medium→high, none/minimal→skip).
- **FR-010**: Title generation MUST pin effort off; the critic pass MUST
  receive reasoning parameters through the same resolution as chat (it
  currently sends none); lab/quiz generation MUST use the ambient effort.
- **FR-011**: The dialect table MUST carry capability metadata per
  dialect/model — `locksSampling`, `effortLevels`, `hazards` — and the
  Settings UI MUST use it to hide/disable sampling inputs for locked models
  and display hazards (locked sampling, thinking-ignores-sampling,
  cannot-disable-thinking, token-cap-eaten-by-reasoning).
- **FR-012**: Provider configuration MUST support an optional raw extra-body
  JSON object, merged into the resolved request last (overriding dialect
  values), visible in the existing request trace.
- **FR-013**: Extra-body input MUST be validated before saving: JSON object
  only, bounded size, and rejection of secret-like keys (including
  `Authorization`, `api_key`, and `headers`-class names) — no secrets may ever
  persist in provider settings.
- **FR-014**: For provider kinds whose request shape accepts only known keys,
  the system MUST merge only forwardable keys and MUST surface every dropped
  key as an explicit UI warning; no key may be silently ignored.
- **FR-015**: The Settings UI MUST provide one Advanced section per provider
  containing the sampling fields, the extra-body editor with inline
  validation feedback, and a read-only resolved-request preview derived from
  the same resolution logic as the live path.
- **FR-016**: The resolution logic MUST be pure (no network, no side effects)
  so it is unit-testable and reusable by the preview.

### Key Entities

- **Provider config** (existing, persisted under the `providers` settings key):
  gains two optional, non-secret fields — `requestDefaults` (the seven
  sampling fields) and `extraBody` (raw JSON object). Existing configs without
  them remain valid and behave exactly as before.
- **Dialect table** (new, static and declarative): endpoint dialects matched
  by endpoint address, model overlays matched by model-id pattern, and
  per-entry capability metadata (`locksSampling`, `effortLevels`, `hazards`),
  each entry citing `research/005` with a checked date.
- **Resolved request settings** (new, derived per call): the pair of top-level
  call settings and provider-namespaced options produced by layered
  resolution; consumed identically by all four call paths and by the preview.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For every one of the four call paths, setting sampling defaults
  on a provider changes the outgoing request body, and clearing them removes
  the fields — verifiable end-to-end via the request trace.
- **SC-002**: All ten dialect families in `research/005` produce the correct
  reasoning parameters for effort off/on/deep, including router-prefixed ids,
  with zero per-provider UI added — the single toggle suffices.
- **SC-003**: 100% of invalid extra-body inputs (non-object, oversized,
  secret-like) are rejected with an actionable UI error and none are persisted.
- **SC-004**: No extra-body key is ever dropped without a visible UI warning
  (dropped-key transparency is total).
- **SC-005**: 100% of dialect table entries carry a research citation and a
  checked date (auditable staleness).
- **SC-006**: Providers configured before this feature send byte-identical
  requests afterward (zero-behavior-change regression bar for existing users).
- **SC-007**: The old reasoning mapping (`providerOptionsForReasoning` and its
  GLM-regex) is fully replaced: no call site references it and its unit tests
  are superseded by resolver tests covering layer precedence, router-prefixed
  ids, and every dialect entry.

## Assumptions

- `research/005-provider-request-settings.md` (checked 2026-08-22) is the
  authoritative and current source for all dialect data; provider behavior
  drift after that date is handled by table maintenance, not dynamic
  discovery (explicitly out of scope).
- The existing off/on/deep chat toggle remains the sole reasoning control;
  per-provider effort-mapping customization is deliberately excluded (the
  escape hatch is extra body).
- API keys continue to live exclusively in the runtime key store — never in
  provider settings, never in extra body; validation enforces this.
- The existing request trace (which already records provider options)
  continues to serve as the user-visible verification surface; no new tracing
  surface is built.
- `top_k`, `repetition_penalty`, and other non-core parameters are reachable
  only via the extra-body passthrough (the standard sampling set is the seven
  Tier A fields) because OpenAI-shaped endpoints drop non-standard top-level
  sampling keys.
- The extra-body size cap defaults to a small bound (on the order of tens of
  kilobytes) — enough for any legitimate parameter payload, small enough to
  prevent abuse; the exact number is an implementation choice.
- The AI SDK's documented behavior for OpenAI-compatible providers (unknown
  provider-namespace keys are forwarded verbatim into the request body)
  continues to hold; it is the load-bearing mechanism for the passthrough.
- Structured lab/quiz generation keeps tool-based structured output
  (`response_format` remains out of scope by non-goal).

## Non-Goals

- No dynamic capability discovery (e.g. OpenRouter `supported_parameters`
  from `/models`) — possible future work.
- No per-provider effort-mapping customization UI.
- No `response_format` / logprobs / `n` / server tools / curated per-template
  toggles (future typed overlays over extra body).
- No changes to context projection or reasoning (`reasoning_content`)
  persistence.
- No changes to secret storage.
