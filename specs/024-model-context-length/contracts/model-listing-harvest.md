# Contract: Model-Listing Context-Window Harvest

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

 Governs what the discovery layer accepts from a provider `/models` response and what it
emits. Extends the behavior specified for the OpenAI-compatible path in
`src/lib/ai/model-discovery.ts` and the Copilot path beside it.

## Input (wire) contract

For each model entry in a listing response (`{ data: [...] }` shape, bare array, or the
Copilot shape), the harvest reads **only** these top-level fields:

| Field | Accepted as | Interpretation |
|---|---|---|
| `context_length` | positive integer | context-window size in tokens |
| `context_window` | positive integer | context-window size in tokens |
| `max_context_length` | positive integer | context-window size in tokens (Mistral's spelling) |

Rules:

1. Checked in the order listed; first usable value wins; a value that is absent, non-numeric,
   zero, negative, or non-integral is treated as **not reported** (no clamping, no rounding).
2. No nested objects are read (e.g. `top_provider.*`), no fields are summed or scaled, and
   no other field names are consulted. If all three spellings are absent the entry's window is
   unknown.
3. Existing entry filters are unchanged: `type === 'embedding'` entries are skipped
   (OpenAI-compatible path); Copilot entries must pass `object === 'model'` &&
   `capabilities.type === 'chat'` && `policy.state !== 'disabled'`.
4. Listing shape tolerance is unchanged: unrecognized bodies contribute nothing and never
   throw a new error class; discovery failures surface the same typed provider errors as a
   chat request.

## Output contract

Discovery returns `DiscoveredModel[]`:

```ts
type DiscoveredModel = {
    id: string;              // non-empty, deduped, sorted as today
    contextWindow?: number;  // present only when the input contract yielded a usable value
};
```

- Order and dedupe semantics are identical to today's ID list (sorting by `id.localeCompare`).
- For duplicate ids in one response with differing context values, the parser keeps exactly
   one entry per id — deterministic (the first-encountered value, matching the existing
  first-wins dedupe) — never both.
- ID-only consumers map entries to ids; no caller parses raw bodies.

## Persistence contract

On a successful discovery refresh, the provider config is updated through the existing
`saveProviders` path:

1. `models` merges exactly as today (discovered ∪ manually-added ids).
2. `modelContextWindows` is rebuilt per the state table in
   [data-model.md](../data-model.md): response values overwrite; reported-id-without-value
   entries are removed; ids absent from the response retain last-known; discovery failure
   leaves the stored map untouched.
3. Read-time normalization (`normalizeProviderConfig`) drops invalid values and keys not in
   `models`; the map never contains secrets (non-secret handle data only).

## Precedence contract (consumers)

Any consumer resolving a model's context window MUST apply, in order:
`ProviderConfig.contextWindow` (user, per provider) → `modelContextWindows[modelId]`
(provider-listed) → static catalog (`estimateContextLimit`) → unknown. No consumer may
invent a window, and none may let a captured value override a user-declared one.

## Test obligations

- Parser unit tests (`model-discovery.test.ts` style): each accepted field; each rejection
  case (zero, negative, float, string, nested, absent); dedupe determinism with conflicting
  values; embedding/Copilot filters unaffected; unrecognized shapes yield entries without
  windows.
- Normalization tests (`registry` style): invalid values dropped; orphaned keys pruned;
  valid maps pass through idempotently.
