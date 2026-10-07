# Data Model: Automatic Model Context Lengths

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

**Schema impact: NONE.** All captured data lives in the existing `providers` settings KV
(Postgres `settings` table, JSON value — `src/lib/db/schema.ts:228–231`). No drizzle
migration is generated.

## Persisted entities

### Discovered context windows (on the provider config)

| Field | Location | Type | Content |
|---|---|---|---|
| `modelContextWindows` | `ProviderConfig.modelContextWindows?` (new optional field, `src/lib/ai/types.ts`; persisted inside settings key `providers`) | `Record<string, number>` | Model id → context-window size in tokens, as reported by the provider's model listing. Keyed per provider config; never merged across providers. |

**Validation rules** (enforced in `normalizeProviderConfig`, `registry.ts` — same boundary as
`contextWindow` today):

- Values must be positive integers; invalid values are dropped, never clamped.
- Keys must be present in the same config's `models` array; orphaned keys are dropped
  (bounds the blob when models are removed).
- The field is optional and non-secret handle data (constitution: "no secrets in settings").
- Captured values never overwrite the user-declared `ProviderConfig.contextWindow`; the two
  fields coexist and precedence is resolved at derivation time (below).

**Write boundary**: only discovery refresh writes this field — `refreshModels` (and the
`testConnection` auto-fill path) in `ProviderConfig.svelte`, through the existing
`saveProviders` → `repos.settings.set` path. No other layer writes it.

### Refresh state transitions (per provider, on each discovery attempt)

```text
                    ┌─ success: entry has value ──→ overwrite key (latest wins)
discovery response ─┼─ success: entry lacks value ─→ remove key (provider stopped reporting)
                    └─ model id absent from response → keep last-known key
discovery failure ────────────────────────────────→ map untouched (nothing saved)
normalization (any read) ─────────────────────────→ prune non-positive-int values + keys ∉ models
```

State is a plain snapshot per refresh; there is no cross-refresh accumulation beyond the
rules above (deterministic, no merges of stale values).

## Derived entities (no persistence)

### DiscoveredModel (discovery output)

```ts
type DiscoveredModel = {
    id: string;                 // as today: deduped, embedding-filtered, sorted
    contextWindow?: number;     // positive integer from `context_length` / `context_window`
};                              // absent when the entry carried no usable value
```

Produced by the discovery parsers (`model-discovery.ts`) from the same responses fetched
today; ID-only consumers (`connection-test.ts` probe) map over entries.

### Context window resolution (extends 023's `ContextGauge`)

`deriveContextGauge` (`src/lib/chat/context-usage.ts`) gains input
`listedWindow?: number | null` and `limitSource` gains `'model-listing'`:

```text
1. ProviderConfig.contextWindow        (user-declared)   → limitSource: 'provider-declared'
2. modelContextWindows[activeModelId]  (provider-listed) → limitSource: 'model-listing'
3. estimateContextLimit(activeModelId) (static catalog)  → limitSource: 'catalog'
4. none                                (unknown)         → limitSource: 'unknown', state 'no-limit'
```

First positive-integer hit wins; each rung is strictly more authoritative than the ones
below it (user intent > exact-model provider report > static prefix table > unknown). The
chat page supplies rung 2 from the already-available `activeConfig` + `activeModelId`
(`+page.svelte:109–115`).

## Entity relationships

```text
provider /models response ──► discovery parsers ──► DiscoveredModel {id, contextWindow?}
                                                        │
ProviderConfig (settings KV) ◄── saveProviders ─────────┘ (models[] merge + modelContextWindows)
  ├─ models: string[]                    │
  ├─ modelContextWindows?: {model→tokens}├─► chat page resolution ──► deriveContextGauge(listedWindow)
  └─ contextWindow? (user override) ─────┘              │
                                                        ▼
                                            ContextGauge ──► ContextGauge.svelte (023)
  p.modelContextWindows ────────────────────────────────► ModelSelect (secondary row text)
```

- One map per provider config; entries reference that config's `models` ids only.
- The 023 usage-anchor side of the gauge (tokens, `metadata.usage`) is untouched.
