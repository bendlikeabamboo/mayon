# Contract: Settings — Provider Advanced Section & Trace Surface

**Feature**: 009-provider-request-settings | **Checked**: 2026-08-22

## Part A — Provider "Advanced" section (Settings UI)

**Location**: inside each provider `<li>` in `src/lib/components/ai/ProviderConfig.svelte`,
after the tool-capability/models block and before the API key block. Rendered as a
`Collapsible` (existing `$lib/components/ui/collapsible`), following the page's raw
`<input>`/`<<select>` + shared `inputClass` form conventions (the project has no
shadcn Input/Textarea primitives — do not introduce new dependencies).

### Contents (top to bottom)

1. **Sampling defaults** — seven inputs bound to `config.requestDefaults`:
   `temperature` (0–2), `topP` (0–1), `maxOutputTokens` (≥1), `stopSequences`
   (comma-separated → trimmed array), `seed`, `frequencyPenalty` (−2–2),
   `presencePenalty` (−2–2).
   - Empty input ⇒ field unset (omit-empty wire contract).
   - Invalid input ⇒ inline field error; invalid values are never persisted.
   - When `describeDialect(config, defaultModel)?.locksSampling` is true: inputs
     disabled/hidden + `locks-sampling` hazard copy shown.
   - When matched hazards include `thinking-ignores-sampling` /
     `thinking-rejects-sampling` / `reasoning-eats-token-cap`: warning line shown
     (fields remain editable — the provider is the authority).
2. **Extra request body (JSON)** — `<textarea>` bound to a draft string.
   - On change: parse + `validateExtraBody` → inline error list (object-ness, size cap,
     secret-like keys, proto keys) with actionable messages; save blocked while invalid.
   - Under the editor: dropped-keys warning — keys from the (valid) extraBody that the
     provider kind cannot forward (`droppedExtraKeys` from the resolver), rendered as
     an explicit warning, never a silent drop. Empty for openai-compatible.
3. **Resolved-request preview** (read-only) — rendered by calling the **real**
   `resolveRequestSettings` against the current (possibly unsaved) form state, the
   provider's `defaultModel`, and a small off/on/deep selector:
   - shows `callSettings` (top-level params) and `providerOptions` (namespaced body
     additions) as formatted JSON, plus hazard chips for the matched dialect.
   - updates live as fields/effort change (pure function — no request is made).
   - reflects exactly what the live call path would send (same resolver, FR-015/FR-016).

### Persistence

Unchanged mechanism: local `providers` state → whole-list `saveProviders` (settings KV
`'providers'`) on commit. API-key flow untouched (keys never enter `ProviderConfig`).

### Acceptance mirrors (spec)

- AC-4/SC: kimi-k3 selected ⇒ sampling disabled + hazard shown.
- AC-5/SC-003/SC-004: invalid extraBody rejected with UI error; dropped keys listed.

## Part B — Chat UI

The Composer effort toggle (Off/On/Deep, `Composer.svelte:392-434`) is **unchanged** in
shape and persistence (`'reasoningEffort'` settings KV; default `'on'`). The Deep
option's visibility source changes: `routes/chat/[id]/+page.svelte:69-70` replaces
`supportsReasoningEffort(activeModelId)` with
`describeDialect(config, activeModelId)?.effortLevels.includes('deep') ?? false`.

## Part C — Trace surface (verification path)

1. **Chat request trace**: `TraceEvent` variant `'request'`
   (`src/lib/agent/trace.ts`) gains `callSettings` beside the existing
   `providerOptions`; emitted at the chat streamText call (`loop.ts:309-315`) with both
   resolver outputs. Critic-pass requests are traced by the same mechanism.
2. **Object-tool traces**: `buildObjectTrace` request payload gains optional
   `providerOptions` + `callSettings`, populated by lab/quiz/title generate paths.
3. **DiagnosticsPanel** (`src/lib/components/diagnostics/DiagnosticsPanel.svelte`):
   the per-iteration "Assembled Request" block renders `providerOptions` and
   `callSettings` as a compact JSON block (they are already in the Copy payload at
   line 367; this adds visible rendering). No storage change (`agent_traces.trace`
   is JSON text; fields are additive).

This surface is the end-to-end verification path for spec SC-001/SC-002/SC-005: a user
can observe sampling fields, dialect parameters, and extraBody values in the exact
request that was sent.
