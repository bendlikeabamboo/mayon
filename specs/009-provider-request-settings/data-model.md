# Data Model: Provider Request Settings (Feature 009)

**Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

All new persisted state lives inside the existing `ProviderConfig` object stored in
the settings KV key `'providers'` (JSON, via `repos.settings` /
`saveProviders` — `src/lib/ai/client.ts:36-40`). **No database migration**; both new
fields are optional, so existing rows load unchanged.

## Entities

### 1. ProviderConfig (existing, extended)

Definition site: `src/lib/ai/types.ts:64`. New optional fields:

```ts
interface ProviderConfig {
	// ...existing: id, kind, name, baseUrl, defaultModel, models,
	//             discoverable?, toolCapability?
	requestDefaults?: SamplingRequestDefaults; // Tier A
	extraBody?: Record<string, JSONValue>; // Tier C
}
```

Invariants:

- **No secrets** (constitution I): `extraBody` is validated (see §4) before persist;
  secret-like keys are structurally rejected, not just discouraged.
- Both fields are **user-owned overrides**, never populated by templates or discovery.
- Omission semantics: absent field ≡ absent every sub-field (byte-identical wire for
  pre-existing configs).

### 2. SamplingRequestDefaults (Tier A call settings)

```ts
type SamplingRequestDefaults = {
	temperature?: number; // 0..2
	topP?: number; // 0..1
	maxOutputTokens?: number; // integer >= 1
	stopSequences?: string[]; // non-empty strings, max 16 items
	seed?: number; // integer
	frequencyPenalty?: number; // -2..2
	presencePenalty?: number; // -2..2
};
```

Validation rules (enforced in UI input handling; ranges are the union of documented
provider bounds — research/005 §2):

- Out-of-range / non-integer (where required) values are rejected with field-level
  errors and not persisted.
- `undefined` is the only "unset" representation; the resolver emits **only set keys**
  (never `key: undefined`) — omit-empty is a hard wire contract (OpenRouter cache keys).
- `topK` is intentionally absent (dropped by openai-compatible endpoints; reachable via
  `extraBody` — research/005 §1).

### 3. ResolvedRequestSettings (derived, not persisted)

Produced by `resolveRequestSettings(config, modelId, effort)`
(`src/lib/ai/dialects.ts`, pure):

```ts
type ResolvedRequestSettings = {
	callSettings: SamplingRequestDefaults; // only set keys; consumed as top-level
	// streamText/generateText params
	providerOptions: Record<string, unknown>; // namespaced per provider kind
	droppedExtraKeys: string[]; // extraBody keys the active kind cannot
	// forward (never silently dropped)
};
```

Layering (later overrides earlier — spec FR-005):
kind baseline → endpoint dialect (baseUrl regex) → model overlay (regex on **last path
segment** of `modelId`) → `requestDefaults` (call settings) → `extraBody` (merged last,
user wins). Full algorithm and per-kind namespace rules:
[contracts/request-settings-resolution.md](./contracts/request-settings-resolution.md).

### 4. extraBody (Tier C raw passthrough)

`Record<string, JSONValue>`; validated by pure `validateExtraBody`:

| Rule                                                                                                                                                                    | Failure mode                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Must be a JSON object (not array/scalar)                                                                                                                                | `"Extra body must be a JSON object"`                                       |
| Serialized size ≤ 16 KiB                                                                                                                                                | `"Extra body exceeds 16 KiB limit"`                                        |
| No secret-like top-level key (`authorization`, `api[-_]key`, `x-api-key`, `apikey`, `headers?`, `cookies?`, `token`, `secret`, `password`, `bearer` — case-insensitive) | `"Key "<k>" looks like a secret; secrets never live in provider settings"` |
| No `__proto__` / `constructor` / `prototype`                                                                                                                            | `"Key "<k>" is not allowed"`                                               |

Validation runs (a) in the Settings UI on edit/save with inline errors, and (b)
defensively wherever an unvalidated config could enter the resolver.

### 5. Dialect catalog (static data, not persisted)

Two declarative tables in `src/lib/ai/dialects.ts`, every entry stamped
`source: research/005 §3` + `checked: '2026-08-22'` (spec FR-007):

```ts
interface EndpointDialect {
	id: string; // 'zai' | 'deepseek' | 'groq' | ...
	baseUrl: RegExp; // matched against config.baseUrl
	effort: Record<ReasoningEffort, ProviderOptionsFragment>; // {} allowed
	source: string;
	checked: string;
}

interface ModelOverlay {
	id: string; // 'glm-5.2' | 'kimi-k3' | 'gemini-3' | ...
	model: RegExp; // matched against LAST path segment of modelId
	endpoints?: RegExp[]; // optional scoping; default: all
	effort?: Record<ReasoningEffort, ProviderOptionsFragment>; // {} = suppress
	locksSampling?: boolean;
	effortLevels?: ReasoningEffort[]; // which efforts differ; default ['off','on','deep']
	hazards?: HazardId[];
	source: string;
	checked: string;
}

type HazardId =
	| 'locks-sampling' // temperature/top_p/n fixed by the model
	| 'thinking-ignores-sampling' // accepted but ignored in thinking mode
	| 'thinking-rejects-sampling' // non-default sampling rejected while thinking
	| 'cannot-disable-thinking' // model always reasons
	| 'reasoning-eats-token-cap'; // small maxOutputTokens ⇒ empty replies
```

Complete mappings (effort → fragments per dialect/overlay): authoritative table in
[contracts/dialect-catalog.md](./contracts/dialect-catalog.md).

### 6. Trace records (existing, extended)

- `TraceEvent` variant `'request'` (`src/lib/agent/trace.ts:11-16`) gains optional
  `callSettings?: Record<string, unknown>` alongside the existing `providerOptions`.
- Object-tool trace request (`buildObjectTrace`, `trace.ts:101-112`) gains optional
  `providerOptions` / `callSettings`.
- Storage unchanged (`agent_traces.trace` JSON text) — additive JSON fields only.

## Relationships

```text
ProviderConfig 1──* (runtime) ──> ResolvedRequestSettings   (per call, derived)
ProviderConfig 1──1 (optional) SamplingRequestDefaults      (embedded)
ProviderConfig 1──1 (optional) extraBody                    (embedded)
DialectCatalog (static) ──read──> resolveRequestSettings / describeDialect
ResolvedRequestSettings ──consumed──> 4 call sites + Settings preview + trace events
```

## State transitions

None — all entities are static configuration or per-call derived values. The only
stateful flow is edit → validate → persist (settings KV) and per-request resolve →
send → trace.

## Migration / compatibility

- Existing `providers` settings rows: load unchanged (both new fields optional);
  resolver output for such configs differs from today only by the two documented
  bug fixes (namespace-key case, Gemini nesting) — see research.md R1/R2/Risk table.
- No drizzle migration, no schema-version bump (settings row shape is additive).
