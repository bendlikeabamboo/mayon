# Data Model: LLM Context-Remaining Indicator

**Branch**: `023-llm-context-remaining` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

**Schema impact: NONE.** Every persisted field below already exists in `src/lib/db/schema.ts`; this feature populates and types them. No drizzle migration is generated.

## Persisted entities

### Usage anchor (on `messages`)

Written once per completed main-chat turn, onto the turn's **final assistant row** (the row `agent_traces.assistant_message_id` already points at, `schema.ts:214`).

| Field | Location | Type | Content |
|---|---|---|---|
| `tokens` | `messages.tokens` (`schema.ts:101`) | integer, nullable | `totalTokens` of the turn's final agent-loop iteration — the queryable occupancy projection |
| `usage` | `messages.metadata` → `SharedMetadata.usage` (new typed field, `src/lib/chat/kinds.ts`) | JSON object | `{ promptTokens: number; completionTokens: number; totalTokens: number; modelId: string }` — the split + provenance for the P4 breakdown and model-mismatch marking |

Notes:

- `promptTokens` of the final iteration = everything the provider processed (history + fixed instructions + the new user turn); `completionTokens` = the reply. Their sum (`totalTokens`) is the conversation's occupancy as of that exchange — the same semantics the DiagnosticsPanel estimate line uses today.
- The pre-existing `SharedMetadata.tokens?: number` declaration (`kinds.ts:71`) remains unused by this feature; retiring it is out of scope.
- Repository access is a single new method, `messagesRepo.recordUsage(messageId, usage)`, owning the UPDATE of both fields. No other layer writes these fields for chat turns.
- Idempotence/regeneration: regeneration deletes the old assistant row before resending (`+page.svelte:559-577`), so the new turn's anchor replaces it by construction — no accumulation.

**Validation rules** (enforced at the write boundary in `recordUsage` / at derivation time):

- All three counts are non-negative integers; `totalTokens` should equal `promptTokens + completionTokens` when the provider reports all three (when a provider reports only partial fields, persist what arrived; derivation tolerates partials by falling back to `tokens`).
- `modelId` is the SDK `model.modelId` verbatim (`loop.ts:428`), including router prefixes.
- Only rows of `kind = 'assistant_message'` may carry usage.
- Written only after the turn's `finally` (stream complete or aborted-with-partial); aborted turns with no usage event simply write nothing.

### Provider-declared context window (on settings)

| Field | Location | Type | Content |
|---|---|---|---|
| `contextWindow` | `ProviderConfig.contextWindow?` (`src/lib/ai/types.ts`, normalized in `normalizeProviderConfig`, `registry.ts:354-361`) | positive integer (tokens) | User-declared window for this provider's `defaultModel`; overrides the catalog |

Validation: optional; when present must be an integer ≥ 1; normalization drops invalid values rather than clamping. Non-secret handle field (constitution gate 4). Persisted via the existing settings KV through `repos.settings` — no new storage.

## Derived entities (no persistence)

### ContextGauge

Output of the pure derivation `deriveContextGauge` (`src/lib/chat/context-usage.ts`); recomputed on turn completion, chat/branch load, and model/provider change.

```ts
type ContextGauge = {
    usedTokens: number;                       // occupancy anchor
    provenance: 'reported' | 'estimated';     // anchor source
    anchorMessageId: string | null;           // final assistant row carrying usage, if any
    anchorModelId: string | null;             // model that reported the anchor
    limit: number | null;                     // resolved window (null = unknown)
    limitSource: 'provider-declared' | 'catalog' | 'unknown';
    remainingPct: number | null;              // null when limit unknown
    state: 'normal' | 'low' | 'critical' | 'no-limit';
};
```

**Derivation rules**:

1. **Anchor**: scan the active path's candidate rows backward (latest first) for an `assistant_message` with usage → `provenance: 'reported'`. None found → estimate occupancy from the assembled provider context length ÷ 4 (D4) → `provenance: 'estimated'`. Candidate set = the same rows `assembleContext` considers (own rows + ancestors to branch cutoffs, `PROVIDER_EXCLUDED_KINDS` excluded).
2. **Window**: `ProviderConfig.contextWindow` (provider-declared) → `estimateContextLimit(activeModelId)` with router-prefix stripping (catalog) → `null` (unknown). Active model id comes from the same resolution the chat uses (`settings.activeProvider → providers[id].defaultModel`).
3. **Mismatch marking**: if `anchorModelId ≠ activeModelId`, provenance degrades to `estimated` (reported under a different model) even when the anchor is a reported value — the value shown stays, honestly labeled.
4. **States**: `remainingPct > 25` → `normal`; `≤ 25` → `low`; `≤ 10` → `critical`; `limit == null` → `no-limit` (consumption shown, "window unknown" marking; FR-007).

**State table** (state is computed, not stored — no transitions to persist):

| State | Condition | Presentation contract |
|---|---|---|
| `normal` | remaining > 25% | muted tone, no alarm |
| `low` | remaining ≤ 25% | amber tone |
| `critical` | remaining ≤ 10% | destructive tone + guidance in detail |
| `no-limit` | window unresolved | consumption only, "unknown window" marking |

## Entity relationships

```text
ProviderConfig (settings KV)
  └─ contextWindow? ─────────────┐
                                 ▼
messages (assistant rows) ──→ deriveContextGauge ──→ ContextGauge ──→ ContextGauge.svelte
  ├─ tokens (totalTokens)          ▲                                    (Composer status row)
  └─ metadata.usage (triple+model) └─ activeModelId (settings resolution)
```

- One usage anchor per completed turn; at most one gauge per chat view.
- Branch semantics come free: the candidate scan follows the same path rules as the LLM context itself (`assembleContext`), so branch navigation, regeneration (delete + resend), retry, and deletion recompute correctly (spec FR-010).
