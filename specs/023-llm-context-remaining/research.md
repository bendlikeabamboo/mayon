# Research: LLM Context-Remaining Indicator

**Branch**: `023-llm-context-remaining` | **Date**: 2026-10-07

Findings below consolidate three read-only investigations of the codebase (usage data flow, model-limit knowledge, chat UI/path semantics). Every claim carries a file:line citation from the current worktree.

## Established facts

1. **Provider-reported usage exists but is ephemeral.** The agent loop captures `{promptTokens, completionTokens, totalTokens}` from the stream's `finish` part (`src/lib/agent/loop.ts:181-186`) and emits a `usage` trace event per LLM call including tool-loop iterations (`loop.ts:420-430`). `TraceBuilder.emit` deliberately drops `usage` events (`src/lib/agent/trace.ts:253-254`), and `diagnosticsStore.liveEmit` feeds an in-memory `$state` array wiped by `endTurn()` (`src/lib/stores/diagnostics.svelte.ts:7,31-37`). Nothing durable stores it: `messages.tokens` (integer, nullable, `src/lib/db/schema.ts:101`) is accepted by `messagesRepo.append` (`src/lib/db/repositories/messages.ts:26,74`) but no production caller passes it; `SharedMetadata.tokens?: number` is declared and never written (`src/lib/chat/kinds.ts:71`). Usage for old chats is unrecoverable after restart today.
2. **The DiagnosticsPanel already computes exactly the display we need** — `Context: ~{totalTokens} / {limit} (N%) est.` from the last usage event + `estimateContextLimit(modelId)` (`src/lib/components/diagnostics/DiagnosticsPanel.svelte:140-146,281-303`) — but only in-flight, only in the diagnostics drawer.
3. **Context-window knowledge is a 14-entry static prefix table.** `estimateContextLimit` (`src/lib/ai/model-limits.ts:1-28`) normalizes by stripping `[...]` suffixes, lowercases, and prefix-matches; unknown → `null`. It does **not** strip router prefixes, so `z-ai/glm-5.2` and `openai/gpt-4o` return `null` today, while dialect resolution matches model overlays on the last `/` segment (`src/lib/ai/dialects.ts:349-372`).
4. **No context-window field exists anywhere in provider config.** `ProviderConfig` (`src/lib/ai/types.ts:131-175`) and `ProviderTemplate` (`src/lib/ai/registry.ts:21-52`) have none; `maxOutputTokens` is an output cap, not a window. The additive-optional-field pattern (`discoverable`, `group`, `requiresKey`, `toolCapability`, `vision`) normalized at read time in `normalizeProviderConfig` (`registry.ts:354-361`) is the established way to evolve the shape without migration. Custom model ids are freeform strings; router ids are provider-prefixed (`src/lib/components/ai/ProviderConfig.svelte:272-278,658-668`).
5. **One global active model.** Every turn resolves `settings.activeProvider → providers[id].defaultModel → SDK model` (`src/lib/ai/client.ts:101-126`); the loop reads `model.modelId` (`loop.ts:428`). No per-chat override is wired (`ChatStreamOptions.model` is dead). The Composer displays `{providerName} · {modelId}` read-only (`src/lib/components/chat/Composer.svelte:366-370`).
6. **The true "active branch path" is `assembleContext`** (`src/lib/chat/context.ts:52-97`): own messages + ancestors up to each `branchPointMessageId` cutoff, `PROVIDER_EXCLUDED_KINDS` dropped, re-assembled every turn (`src/lib/stores/chat.svelte.ts:652`). The displayed list is only the current chat's own rows (`listByChat`). Regeneration = delete + resend (`src/routes/chat/[id]/+page.svelte:559-577`); no edit-in-place exists. The `streaming true→false` transition in `send()`'s `finally` (`chat.svelte.ts:734-795`) is the single "exchange completed" signal.
7. **UI vocabulary available**: no `progress`/`tooltip`/`hover-card` components exist; there is a CSS-only `.tip` tooltip (`src/app.css:567-593`), `badge` and `popover` in `src/lib/components/ui/`, and a pervasive `text-[11px] text-muted-foreground` micro-row idiom in the Composer status row.
8. **Testing patterns**: Vitest, node environment; chat-area component tests are source-contract style (readFileSync the `.svelte`, assert strings — `Composer.launchers.test.ts`), logic tests use pglite repos + mocked streams (`chat.svelte.test.ts`). The mock LLM reports `usage: {1,1,2}` on every reply kind with model id `mock-sink` (`tests/fixtures/mock-llm/server.mjs:103-108,237-259,286-295`); `estimateContextLimit('mock-sink')` is `null`, so limit-path tests need a declared window.
9. **Seam rules that bind the design** (`docs/reference/seams.qmd`): components/stores call repositories only; `resolveRequestSettings` is the single request-parameter seam (display-only feature must not grow a second resolution path); settings hold non-secret handle fields only.

## Decisions

### D1 — Persist the turn's final-iteration usage onto the final assistant message

**Decision**: In `chatStore.send()`'s `finally`, if a usage event was captured for the turn, write it to the turn's final assistant row: `messages.tokens = totalTokens` (existing column, now populated) and the full triple + `modelId` into `messages.metadata` under a new typed `SharedMetadata.usage` field. A small new repo method `messagesRepo.recordUsage(messageId, usage)` performs the single-row UPDATE.

**Rationale**: The indicator's anchor is "usage of the latest assistant reply on the active path". Today that value dies with `endTurn()`. Both storage targets already exist in the schema — zero migration, satisfying the drizzle gate trivially. The `tokens` integer gives a cheap queryable projection; the metadata triple carries prompt/completion split and model provenance needed by the P4 breakdown and by model-mismatch marking. `agent_traces.assistant_messageId` (`schema.ts:214`) already links turns to their final assistant row, but the trace JSON has no usage and adding columns there would need a migration — strictly worse.

**Alternatives considered**: (a) persist usage into `agent_traces` (new columns → migration; trace rows also exist for title/brief/lab/quiz turns that don't consume chat context) — rejected. (b) Rebuild occupancy purely by estimation on every render (no persistence) — rejected: spec US2 requires reported values to win and survive reload (edge case "Reopening an old chat"). (c) Write usage at `appendAssistantText` time — impossible: usage is only known at stream `finish`, after the row is created.

### D2 — Mount the indicator in the Composer status row

**Decision**: The indicator renders right-aligned in the existing `{providerName} · {modelId}` micro-row (`Composer.svelte:366-370`), inheriting its `text-[11px] text-muted-foreground` idiom; escalation states recolor it; the on-demand detail (spec P4) is a `popover` (already in `src/lib/components/ui/`) with `.tip` as the hover affordance label.

**Rationale**: It is the only always-visible, glanceable-while-typing location already showing model identity; zero new layout surface; the hero-page Composer instance (no `modelId` prop) simply doesn't render the gauge, which matches "per active chat" semantics.

**Alternatives considered**: (a) footer toolbar left cluster — competes with action launchers, hidden behind card chrome; (b) `bottomPane` status-card stack (`+page.svelte:995-1034`) — reserved for transient statuses, not ambient state; (c) message-list header — not visible while composing at the bottom.

### D3 — Context window resolves provider-declared → catalog → unknown

**Decision**: Resolution chain: (1) new optional `ProviderConfig.contextWindow?: number` (positive integer, normalized in `normalizeProviderConfig`, editable on the provider card — the established additive-field pattern); (2) `estimateContextLimit(modelId)` after fixing it to strip router prefixes by matching on the last `/` segment (mirroring `dialects.ts:349-351`); (3) `null` → unknown-window mode: consumption displayed, no denominator, "window unknown" marking (spec FR-007).

**Rationale**: Custom endpoints and routers have freeform model ids no catalog can cover; the user is the authority there (FR-007 forbids inventing). The router-prefix fix is a straight bug aligned with existing dialect-matching precedent and also repairs the DiagnosticsPanel estimate for router users. The field is a non-secret handle — constitution gate 4 satisfied.

**Alternatives considered**: (a) per-model override map in settings — second source of truth vs the provider card that already owns model identity; (b) harvesting `context_length` from model discovery (`parseModelIds` discards it today, `src/lib/ai/model-discovery.ts:150-173`) — larger surface, best-effort data, deferred; noted as future enrichment, not v1.

### D4 — Estimation is a dependency-free chars/4 heuristic over assembled context

**Decision**: When no reported usage exists (fresh chat, silent provider, model switch before next exchange), estimate occupancy from the character length of the assembled provider context (`assembleContext` output) divided by ~4 chars/token, including fixed instructions and attachment notes. Always visibly marked "est.".

**Rationale**: The constitution's bundle-growth gate makes a tokenizer library a non-starter for an approximation. The assembled context is already computed per turn and reflects exactly what the provider sees (including the brief/branch-excerpt/MCP notes prepended at `context.ts:146-170`). Chars/4 is the industry-standard rough heuristic and the spec only demands "within a stated tolerance, corrected by reported figures".

**Alternatives considered**: (a) `gpt-tokenizer`/similar npm package — rejected (bundle gate, precision not needed for a warning gauge); (b) estimate from displayed messages only — undercounts fixed instructions and ancestor-path content, violating the "everything sent counts" assumption.

### D5 — Pure derivation module + thin component

**Decision**: New `src/lib/chat/context-usage.ts` exposing a pure `deriveContextGauge(input) → ContextGauge` (anchor selection by scanning candidate rows backward, window resolution per D3, provenance, state). `ContextGauge.svelte` is presentational; the Composer/page feeds it derived input from `chatStore.messages` + active model/config. Recompute triggers: turn completion (`streaming` → false), chat/branch load, model/provider change — never per keystroke or stream chunk.

**Rationale**: Matches the codebase's pure-function seam style (`assembleContext`, `assembleTimeline`, `breadcrumbToRoot`) and the constitution's testability gate: the entire decision surface (anchor pick, mismatch marking, thresholds, states) is unit-testable without DOM. Event-driven recompute keeps it off the hot render path (perf gate).

**Alternatives considered**: (a) a new singleton store — the state is fully derived from existing stores/repo reads; a store would duplicate `chatStore`'s lifecycle for no benefit; (b) compute inside the component only — untestable per repo conventions (no component DOM tests exist).

### D6 — Scope of written usage: main chat turns only

**Decision**: Only `send()` turns (configKind `'chat'`) write usage. Title, brief, lab, quiz, and grading generations consume their own contexts, not the chat's, and their traces are already kinded separately (`agent_traces.configKind`).

**Rationale**: The indicator answers "how full is this conversation's window". Counting side generations would corrupt the anchor. Smallest correct write surface.

### D7 — Warning states and thresholds

**Decision**: Derived states: `normal` (>25% remaining), `low` (≤25%), `critical` (≤10%), plus `no-limit` (unknown window) — thresholds as fractions of the window per FR-005, matching the spec's stated defaults (quarter/tenth). Escalation is color + a short guidance line in the critical state's popover ("start a new chat or branch to free context"), using existing tone classes (`text-muted-foreground` → amber tone → `text-destructive`).

**Rationale**: Spec assumptions fix the fractions; color-only escalation reuses existing visual language (no new primitives, gate 7) and never blocks input (FR-008).

### D8 — Model switch and stale anchors

**Decision**: The gauge keeps the latest reported anchor but, when the anchor's stored `modelId` differs from the active model, treats occupancy as an estimate (marked) and resolves the window against the **active** model — exactly spec US1 scenario 3 and US2 scenario 4.

**Rationale**: Occupancy of the same conversation under a new model is genuinely approximate until the next exchange reports; the window (the denominator) is model-specific and known statically. This is the honest reading of the data available.

### D9 — Mock-LLM test strategy

**Decision**: Logic tests cover derivation tables (including router-prefixed ids post-fix). The store integration test drives a chat turn through the mock LLM and asserts `messages.tokens`/`metadata.usage` persisted on the final assistant row. The limit path is exercised by setting `contextWindow` on the (mock) provider config rather than by extending the static catalog for `mock-sink` — the same path real custom endpoints will use. Component presence/mount assertions use the source-contract style.

**Rationale**: Keeps the catalog honest (no test-only entries), covers the new provider-declared field where it is real code, and follows the repo's established test idioms (gate 6).

## Resolved NEEDS CLARIFICATION

The spec shipped with zero `[NEEDS CLARIFICATION]` markers (all defaults documented in its Assumptions section). Every default is now grounded: display-only scope (D1–D8 introduce no trimming/compaction), composer-adjacent placement (D2), estimate marking (D4, D8), threshold defaults (D7), and unknown-window handling (D3).
