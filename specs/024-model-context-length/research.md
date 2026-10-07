# Research: Automatic Model Context Lengths

**Branch**: `024-model-context-length` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

Three read-only investigations grounded this research: (A) model-data flow & storage,
(B) the 023 context-gauge integration, (C) provider `/models` payload shapes (repo
fixtures/docs) plus live-docs verification for OpenRouter and GitHub Copilot.

## Current state (verified)

- Discovery is settings-page-only: `ProviderConfig.svelte:refreshModels` (:204–230, triggered
  on mount :140, after template add :182, key save :402, Copilot auth :415, and the picker's
  ⟳ :586) → `discoverProviderModels` (`client.ts:90–95`) → `discoverModels`
  (`model-discovery.ts:60–83`). `testProviderConnection` (`connection-test.ts:79–83`) is the
  only other caller.
- Parsers discard all metadata: `parseModelIds` keeps only `id` (+ `type` embedding denylist)
  — `model-discovery.ts:154–173`; `parseCopilotModelIds` keeps `id` after
  `object`/`capabilities.type`/`policy.state` filters (:183–201). Response interfaces declare
  "only the fields we read" (:34–45).
- Discovered lists persist as `ProviderConfig.models: string[]` (IDs only, `types.ts:137`)
  inside the `providers` settings KV (Postgres `settings` table, `schema.ts:228–231`) via
  `saveProviders` → `repos.settings.set` (`client.ts:49–53`). Re-fetched on settings mount;
  the stored fallback list survives discovery failure (`ProviderConfig.svelte:224–226`).
- `contextWindow?: number` is user-declared **per provider** (`types.ts:173–178`), edited in
  `ProviderConfig.svelte:607–623`, normalized to positive integers in
  `normalizeProviderConfig` (`registry.ts:354–368`).
- The 023 gauge resolves its window in `deriveContextGauge` (`context-usage.ts:71–82`):
  `declaredWindow` → `limitSource: 'provider-declared'`; else static catalog
  `estimateContextLimit(activeModelId)` (`model-limits.ts:18–31`) → `'catalog'`; else
  `'unknown'` / `state: 'no-limit'`. The chat page already passes `activeModelId` one line
  above `declaredWindow` (`+page.svelte:109–115`) — the integration point exists.
- Nothing per-model is persisted today; the only per-model metadata is code-side heuristics
  (vision allowlist `vision-capability.ts`, dialect overlays `dialects.ts`).
- No repo fixture or doc records a context-length wire field; spec 023's research deferred
  exactly this harvest ("`parseModelIds` discards it today").

## Decisions

### D1: Harvest at the existing discovery parsers; read two top-level wire fields

**Decision**: Extend `parseModelIds` / `parseCopilotModelIds` (or sibling entry-returning
functions) to also read a context window from each model entry: top-level
`context_length` or `context_window`, accepted only as a positive integer. Everything else
— nested objects (e.g. OpenRouter's `top_provider.context_length`), summed fields,
`max_tokens` — is ignored. Discovery returns entries (`{ id, contextWindow? }[]`) instead of
bare IDs; the two callers adapt (`refreshModels` consumes entries; `connection-test.ts`
maps to IDs for its probe).

**Rationale**: OpenRouter's `/models` OpenAPI documents `context_length` (integer, tokens)
per entry (verified against openrouter.ai docs, 2026-10-07); the OpenRouter model schema has
become a de-facto extension other gateways copy (e.g. Arcee's OpenRouter-spec `context_length`).
`context_window` covers the other common spelling at zero cost. Top-level-only keeps the
interpretation unambiguous — no unit guessing, no double-counting risk — which the spec's
edge cases demand. Copilot's `/models` exposes no context field (verified against GitHub's
Copilot docs; its entries carry `capabilities.type`/`policy.state` only), so Copilot simply
stays unknown — a supported state everywhere in this feature.

**Alternatives considered**: (1) Harvest `top_provider.context_length` too — rejected: nested,
overlaps the top-level field, adds ambiguity for zero coverage gain. (2) A maintained
in-repo catalog expansion — rejected: spec explicitly excludes hand-curated catalogs; the
static `model-limits.ts` fallback from 023 stays as-is. (3) Per-model detail calls (e.g.
Ollama `/api/show`, NanoGPT `?detailed=true`) — rejected: spec assumes piggybacking on the
existing fetch; dedicated lookups are out of scope for v1.

### D2: Persist as `modelContextWindows` on `ProviderConfig` (settings KV)

**Decision**: Add `modelContextWindows?: Record<string, number>` (model id → positive
integer tokens) to `ProviderConfig`, persisted inside the existing `providers` settings key.
`normalizeProviderConfig` validates: drop non-positive-integer values; drop keys not present
in `models`.

**Rationale**: Rides the exact read/write path `contextWindow` already uses
(`saveProviders` → `repos.settings`), so no migration, no new repository, no schema change.
Context lengths are non-secret handle data — the settings KV is constitution-correct.
Keyed-by-model-id matches how the gauge and picker address models. Pruning keys not in
`models` bounds the blob (removed/manual models can't accumulate garbage).

**Alternatives considered**: (1) New DB table + repository — rejected: over-engineering for a
few hundred integers per provider; violates nothing but adds a migration, repo, and seams doc
churn for no query need (lookups are always by active provider config). (2) In-memory only —
rejected: discovery runs on the settings page while the gauge reads at chat mount; without
persistence the chat view would never see captured values across reloads. (3) IndexedDB —
rejected: splits provider data across stores; IndexedDB is for keys only.

### D3: Refresh semantics — latest report wins, unreported drops, unlisted retains

**Decision**: On each successful discovery, rebuild the map: values from the response
overwrite old ones; models present in the response **without** a value have their entry
removed; models absent from the response keep their last-known value. Failed discovery
leaves the map untouched (existing failure behavior: nothing new is saved).

**Rationale**: FR-006 (latest wins) and FR-007 (retain on failure) come directly from this.
Removing entries the provider stopped reporting prevents stale "known" windows from
surviving catalog revisions; retaining entries for models the provider no longer lists keeps
last-known honesty for manually-added models that still work. Deterministic and explainable.

**Alternatives considered**: Wholesale replace (drop unlisted too) — rejected: manual model
additions (comma-separated editing, `ProviderConfig.svelte:675–685`) would lose their
captured windows on every refresh even though the model still works. Union-keep (never
remove) — rejected: a provider fixing a wrong `context_length` to "absent" would never clear.

### D4: Window precedence gains one rung; `limitSource` gains `'model-listing'`

**Decision**: Resolution order becomes: user-declared per-provider `contextWindow` →
captured `modelContextWindows[activeModelId]` → static catalog `estimateContextLimit` →
unknown. `deriveContextGauge` input gains `listedWindow?: number | null`; the chat page
passes `activeConfig?.modelContextWindows?.[activeModelId] ?? null`. `limitSource` gains
`'model-listing'` (humanized as "provider model listing"); existing `'provider-declared'`
label stays as-is.

**Rationale**: Spec FR-005 (user-specified wins, verbatim override) and FR-004 (no invention).
Captured-per-model beats the static prefix catalog because it is the provider's own
declaration for that exact model id — fresher and more specific than a prefix table. Keeping
`deriveContextGauge` pure with an explicit input field preserves 023's testable derivation
seam (`context-usage.test.ts:151–191` already asserts declared-beats-catalog).

**Alternatives considered**: Resolving precedence in the page component — rejected: moves
logic out of the pure, unit-tested derivation. Replacing the catalog fallback — rejected:
still useful for non-discoverable providers (OpenAI, Anthropic, Gemini, Ollama templates are
not discoverable) and costs nothing.

### D5: Surface in the model picker as presentational secondary text

**Decision**: `model-select.svelte` gains an optional `contextWindows?: Record<string, number>`
prop (supplied by `ProviderConfig.svelte` from `p.modelContextWindows`); each row renders the
formatted window (e.g. `128K`) as muted secondary text next to the name; absent → nothing
extra. The gauge popover's Window row shows the new source label via the existing humanized
`limitSource` path; the unknown-window hint copy keeps pointing at the provider card as the
last resort.

**Rationale**: The picker is already presentational (`models: string[]` prop, no fetching);
adding a data prop keeps the established component split (Composer-style contract tests
assert this shape). 023's contract tests already assert humanized `limitSource` strings
(`ContextGauge.contract.test.ts:92–96`), so the new rung slots into the existing pattern.

**Alternatives considered**: Fetch-on-open metadata enrichment inside the picker — rejected:
picker never fetches today; discovery cadence is settings-owned. Tooltip-only display —
rejected: spec Story 4 wants glanceable comparison while browsing.

## Provider reality table (what the harvest will actually find)

| Provider (discoverable) | Wire field observed/documented | Expected v1 outcome |
|---|---|---|
| OpenRouter | `context_length` per entry (verified: OpenRouter OpenAPI docs) | captured |
| Other OpenAI-compatible gateways (Z.AI, Kilo Gateway, Groq, Mistral, DeepSeek, xAI, Moonshot, OpenCode Zen, LiteLLM, Vercel, Requesty) | not documented in repo; field read opportunistically (`context_length`/`context_window`) | captured where present, unknown otherwise |
| LM Studio / vLLM (local) | stock OpenAI `/v1/models` shape (`id`, `object`, `owned_by`) | unknown |
| GitHub Copilot | no context field in `/models` entries (verified: GitHub Copilot docs) | unknown |
| Non-discoverable templates (OpenAI, Anthropic, Gemini, Ollama, DashScope) | never discovered | unknown (catalog/user fallbacks apply) |

No NEEDS CLARIFICATION markers remain; all spec assumptions map to decisions above
(D1 ↔ "piggyback on existing fetch", D2/D3 ↔ persistence & freshness, D4 ↔ precedence, D5 ↔ picker display).
