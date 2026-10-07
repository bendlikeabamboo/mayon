# Contract: Context-Window Resolution & Display (024 update to 023's gauge)

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

Updates the window-resolution and display contracts established by
`specs/023-llm-context-remaining/contracts/context-gauge.md`. Consumption/anchor semantics
(usage triples, estimation, states, thresholds) are unchanged and remain governed by 023.

## Gauge window resolution

`deriveContextGauge` input gains one field; its `limitSource` union gains one member:

```ts
input:  { ..., declaredWindow?: number | null; listedWindow?: number | null }
output: { ..., limitSource: 'provider-declared' | 'model-listing' | 'catalog' | 'unknown' }
```

1. `declaredWindow` is a positive integer → `limitSource: 'provider-declared'` (user-declared
   on the provider card — unchanged).
2. else `listedWindow` is a positive integer → `limitSource: 'model-listing'` (provider's
   model listing reported it for the active model).
3. else the static catalog resolves the active model id → `'catalog'` (unchanged).
4. else `limit: null`, `limitSource: 'unknown'`, `state: 'no-limit'` (unchanged).

The chat page supplies `listedWindow: activeConfig?.modelContextWindows?.[activeModelId] ?? null`
alongside the existing `declaredWindow` line. Non-positive-integer inputs at any rung fall
through to the next rung (same tolerance 023 applies to `declaredWindow`).

## Gauge display

- Humanized `limitSource` labels: `declared on provider card` / `provider model listing` /
  `model catalog` / `unknown`. The popover Window row shows the label; provenance remains
  per-figure (FR-009 of the spec: discernible wherever a window is shown).
- The unknown-window guidance copy (trigger title, popover hint) keeps directing users to
  the provider settings card — still the correct last resort for providers that report
  nothing.
- Escalation states (`normal`/`low`/`critical`/`no-limit`), thresholds, and all
  consumption-side display contracts are unchanged from 023.

## Model picker display

`model-select.svelte` (settings provider card usage only):

- New optional prop `contextWindows?: Record<string, number>`; the parent supplies
  `p.modelContextWindows`. The component stays presentational — no fetching, no store access.
- When `contextWindows[model]` exists, the row renders it as muted secondary text beside the
  model name (e.g. `128K`, `1M`, exact thousands below 1M), formatted without loss of the
  underlying value (tooltip/title carries the exact token count).
- Models without a captured value render exactly as today — no placeholder, no "unknown" chip
  in the row (absence in the picker is not an error state; the gauge remains the authority
  for unknown marking).

## Test obligations

- `context-usage.test.ts`: precedence ladder (declared beats listed beats catalog);
  invalid `listedWindow` falls through; `'model-listing'` label on rung-2 hits; no-limit
  unchanged when all rungs miss.
- `ContextGauge.contract.test.ts`: humanized label wiring for the new source; popover row
  unchanged otherwise.
- Model-select contract test (source-text or behavior): secondary text rendered only when a
  value exists; component remains presentational.
