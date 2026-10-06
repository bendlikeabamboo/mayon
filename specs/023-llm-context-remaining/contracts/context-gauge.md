# Contract: Context Gauge

**Branch**: `023-llm-context-remaining` | **Date**: 2026-10-07 | **Plan**: [plan.md](./plan.md)

This feature has no external API surface. The contracts below are the internal module/UI seams other code may rely on. Consumers: `Composer.svelte`, `chatStore`, the provider settings card, and tests.

## Pure derivation seam — `src/lib/chat/context-usage.ts`

```ts
export type ContextUsageTriple = {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    modelId: string;
};

export type ContextGaugeInput = {
    candidates: Array<{ id: string; kind: string; tokens: number | null; usage: ContextUsageTriple | null }>; // active-path rows, any order
    assembledChars: number;        // character length of the assembled provider context (estimation fallback)
    activeModelId: string | null;
    declaredWindow: number | null; // ProviderConfig.contextWindow, if set
};

export type ContextGauge = { /* see data-model.md */ };

export function deriveContextGauge(input: ContextGaugeInput): ContextGauge;
```

- **Deterministic and side-effect free**: no IO, no clocks, no randomness. Same input → same output (unit-testable without DOM or DB).
- **Caller obligations**: `candidates` must be the active-path rows per `assembleContext` semantics; `assembledChars` must include fixed instructions and prepended notes; `activeModelId` must be the id the next request would use.
- **Guarantees**: never throws on empty/partial input (empty chat → estimated small occupancy or zero); never invents a limit (limit is `null` unless resolvable); `provenance` is `estimated` whenever the anchor is missing, partial, or reported under a different model id.
- **Thresholds** (exported constants, fractions of the window): `LOW_REMAINING = 0.25`, `CRITICAL_REMAINING = 0.10`.

## Repository seam — `messagesRepo.recordUsage`

```ts
recordUsage(messageId: string, usage: ContextUsageTriple): Promise<void>;
```

- Single-row UPDATE of `messages.tokens` (`= totalTokens ?? promptTokens + completionTokens`) and `metadata.usage`. Repository-owned SQL; nothing else in the app writes these fields for chat turns.
- Called from `chatStore.send()`'s `finally`, only when a usage event was captured and a final assistant row exists for the turn. No-ops (log-free) on missing row.
- Kind-guarded: refuses rows whose `kind` is not `assistant_message`.

## Provider config field — `ProviderConfig.contextWindow?`

- Optional positive integer (tokens), normalized in `normalizeProviderConfig` (invalid → dropped, not clamped), editable as "Context window (tokens)" on the provider card. Non-secret handle field.
- Precedence in window resolution: `contextWindow` → `estimateContextLimit(activeModelId)` (router-prefix-stripped) → unknown. `estimateContextLimit` itself remains the single static-catalog home for model limits; the feature adds no second request-settings path (display only).

## UI contract — `ContextGauge.svelte` in the Composer status row

Mount: right side of the existing `{providerName} · {modelId}` row (`Composer.svelte:366-370`); hidden when no `modelId` prop (hero composer). Props: the derived `ContextGauge` (or the raw inputs + derivation owned by the parent — decided at task level, either way the component stays presentational).

| State | Always-visible element | Detail (popover / `.tip`) |
|---|---|---|
| `normal` | muted-tone `{used}` / `{limit}` (compact % or tokens) | provenance + window source |
| `low` | amber tone | same + "context running low" |
| `critical` | destructive tone | same + guidance: start a new chat or branch to free context |
| `no-limit` | `{used}` + "window unknown" marking | provenance + how to declare a window (provider card) |
| `estimated` (provenance) | `~` prefix and/or `est.` marking on the number | explains estimate and that reported usage replaces it |

- Visual vocabulary: existing idioms only — `text-[11px]`/`text-muted-foreground` row, `popover` from `src/lib/components/ui/`, `.tip` hover (`src/app.css:567-593`), tone classes for escalation. No new UI primitives.
- Behavior: never blocks or intercepts composing, sending, or selection (FR-008); not focusable-operable except the detail affordance; updates only on the discrete recompute events (turn completion, chat/branch/model change) — never per keystroke or stream chunk.
- Spec traceability: states ↔ FR-005/FR-006/FR-007; provenance marking ↔ FR-003/FR-004; detail ↔ FR-009; anchor/path behavior ↔ FR-010.

## Out of contract (explicitly)

- No trimming, compaction, summarization, or auto-branching of history (spec Assumptions: display-only v1).
- No changes to request construction: nothing in this feature feeds `resolveRequestSettings` or any wire parameter.
- No usage writes for title/brief/lab/quiz/grading generations (D6).

## Implementation deviations

Landed implementation notes (supersede the contract text above where they differ):

- Gauge input candidates carry `ord`; the anchor is the highest-`ord` assistant row with usage (order-robust rather than "last candidate").
- `ContextGauge.svelte` takes `anchorUsage: ContextUsageTriple | null` so the breakdown popover shows prompt/completion/total without re-deriving.
- `chatStore.send()` mirrors the final assistant row id locally before cleanup — TraceBuilder's corresponding field is setter-only and unreadable afterward.
- `recordUsage` also updates the in-memory message row, so the gauge refreshes without a reload.
