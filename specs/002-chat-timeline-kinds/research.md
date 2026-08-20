# Research: Chat Timeline Kind Model

Phase 0 output. Every decision below is grounded in the codebase facts listed and resolves either a spec open question or a technical unknown surfaced while planning. Format: Decision → Rationale → Alternatives considered.

## Verified starting facts

- `messages` table today: `role` (`system|user|assistant|tool`, NOT NULL), `content`, `ord`, `model`, `tokens`, `toolCallId`, `toolName`, `metadata` (JSON text) — `src/lib/db/schema.ts:53-67`. Writes go through `messagesRepo.append`/`appendToolResult` (next-`ord` computed on insert).
- The UI ladder: `MessageRow.svelte:85-100` (hide empty tool-call rows, hide `present_choices` tool results, one muted line for tool rows, bubble otherwise); `MessageList.svelte:44-54` filters `metadata.hidden`; the duplicated streaming block is `MessageList.svelte:78-111`.
- Ephemeral asks: `chat.svelte.ts:45-74` (`ApprovalEntry`/`McpSamplingEntry`/`ElicitationEntry` hold a `resolve` in `$state` arrays; gone on reload).
- Reasoning is accumulated across ALL loop iterations into one buffer (`loop.ts:191,290-291`) and glued onto the final/terminal assistant row's metadata (`loop.ts:334-336,352-357,547-549`).
- `present_choices` today: assistant tool-call row (`metadata` = tool args, which are the gate block) + a tool-result row; the route derives composer chips via `findGateFromMessages` (`generate-gate.ts:130-146`, scanning back to the last user row); the tapped chip sends a plain user message with no link back.
- Context assembly: `context.ts` gathers ancestor rows into `ChatMessage[]` and `toCoreMessages` (`context.ts:198-255`) guesses intent from role/tool columns and merges adjacent same-role messages. The critic phase also calls `toCoreMessages` (`loop.ts:143`).
- Schema versioning: `SCHEMA_VERSION = 1` in `packages/shared/src/schema-version.ts`; `planRestore` gates restores (refuse-newer / refuse-breaking); the server registry `SCHEMA_MIGRATIONS` (`server/src/schema-migrations.ts`) is **empty** and its only consumer is the restore path (`pg-backup.ts:278-301`, runs `migrate(client)` post-load inside a transaction, then re-stamps). **Boot runs drizzle DDL + FTS bootstrap and stamps the version unconditionally (`server.ts:96-119`) — there is no boot-time data-migration runner.**
- FTS: `messages.search_vec` is `GENERATED ALWAYS` over `strip_search_noise(content)` (`packages/shared/src/fts.ts`); the message search query (`repositories/search.ts:97`) has **no role filter today** — tool summaries and hidden prompts are currently searchable.
- `agent_traces.kind` already exists (default `'chat'`) — a different table, unrelated semantics.
- Critic: `runCriticPhase` (`loop.ts:124-182`) validates and re-emits up to 2 corrections entirely in memory; nothing is persisted.

## D1 — Kind storage: additive `kind` column, text enum, backfilled then constrained

**Decision**: Add `messages.kind` as a drizzle `text` enum column (closed 10-value union, CHECK-constrained) via `pnpm db:generate`. The column is added nullable (cheap `ALTER ... ADD COLUMN`), then the v1→v2 data migration backfills 100% of rows and issues `ALTER COLUMN kind SET NOT NULL` in the same transaction.

**Rationale**: Matches the existing `role`/`quiz_questions.type` pattern (`schema.ts` header comment); additive per the restore gate (`kind: 'additive'`); the SET NOT NULL lands only after the backfill proves completeness, so the constraint is earned, not assumed.

**Alternatives considered**: (a) `NOT NULL DEFAULT 'assistant_message'` on the ALTER — rejected: a silent default would mask unclassified rows, violating FR-013's loud-failure rule. (b) A parallel `entries` table — rejected by spec (single-table evolution). (c) Integer enum — rejected: text is self-describing in dumps/backups and matches house style.

## D2 — Boot-time data-migration runner (closes the registry's missing consumer)

**Decision**: In `server.ts` boot, after `runPgMigrations` + FTS bootstrap and **before** the version stamp, read `settings.schemaVersion`; if it lags `SCHEMA_VERSION`, execute the pending `SCHEMA_MIGRATIONS` entries in order (each in its own transaction, same loop shape as `pg-backup.ts:278-301`), then stamp. The backfill implementation is written once and runs on both paths: normal upgrade boot and post-restore.

**Rationale**: Today the registry's only consumer is restore; without a boot runner, a normal upgrade would add the column (drizzle) but never backfill, and the unconditional stamp would immediately claim v2 over unbackfilled data. One shared `migrate(client)` keeps upgrade and restore byte-identical in behavior.

**Alternatives considered**: (a) Hand-adding `UPDATE` statements to the generated drizzle SQL — rejected: constitution requires `db:generate`; hand-edits need explicit justification and would also be skipped by the restore path (restore reloads data only, never drizzle bookkeeping). (b) Lazy app-side derivation forever — rejected: spec flips derivation off after migration (FR-013, phasing step 2). (c) Running the backfill from the SPA on first load — rejected: violates the server-owns-schema seam and races multiple clients.

## D3 — `role` values for new kinds: authoring side, not event semantics

**Decision**: `role` remains NOT NULL and keeps its four-value enum. For every new kind it records the _authoring side_: `user_message → 'user'`; `assistant_message`, `reasoning`, `tool_call`, `choices`, `self_corrected`, `approval`, `sampling`, `elicitation` → `'assistant'`; `tool_result` → `'tool'`. Kind — not role — carries event semantics everywhere after the projection rewrite.

**Rationale**: The `role` enum survives untouched (spec: fate of role = retained for transition); no enum migration; restore of old dumps (which carry old role values only) stays compatible; the projection stops reading role for intent anyway.

**Alternatives considered**: (a) Extending the role enum with e.g. `internal` — rejected: churns the column the spec explicitly keeps stable during transition. (b) Allowing NULL role for new kinds — rejected: NOT NULL today; weakening constraints for no gain.

## D4 — `present_choices` → `choices`: dual shape, one projection

**Decision**:

- **Backfill (legacy rows)**: assistant row with `toolCallId` and `toolName = 'present_choices'` → `kind = 'choices'` (its `metadata` args are already the gate block — normalized in place at render, not rewritten); its paired tool-result row → `kind = 'tool_result'` (the registry hides a `tool_result` whose linked call is a `choices` offer — the offer renderer owns presentation).
- **New turns**: the offer persists as a single `choices` entry (payload `{ nextUnit, options, progress }`); **no** separate tool-call/tool-result rows are written for `present_choices`. The tapped chip persists as a `user_message` whose `metadata` links `choicesEntryId`.
- **Projection**: a `choices` entry emits the same provider-visible `tool-call` + `tool-result` pair the model saw when it called the tool (input = offer payload; result = a fixed "options presented" summary), so provider behavior and golden equivalence both hold. The linked chip `user_message` projects exactly as a plain user message (identical to today's tapped chip).
- **Gate lookup**: `findGateFromMessages` becomes kind-first (`kind === 'choices'`) with the legacy `toolName` probe kept as fallback for pre-migration rows.

**Rationale**: Keeps the model's pacing-gate loop intact (it must see its own tool call and result), removes the hidden bookkeeping pair for new turns, and makes offer + selection durable and linked (FR-005).

**Alternatives considered**: (a) Keep writing the legacy pair plus a third `choices` row — rejected: duplicate facts, three rows per offer. (b) New-turn `choices` entries that never reach the provider — rejected: the model would lose sight of its own gating tool use, changing behavior; also breaks the "single projection" seam by needing special casing elsewhere. (c) Synthesizing the pair at projection time only for legacy rows — rejected: legacy rows already store the real pair; synthesizing for new rows and replaying stored pairs for old ones is exactly what this decision does.

## D5 — Reasoning: per-iteration entries, no more glued metadata

**Decision**: In `loop.ts`, the reasoning buffer resets at each iteration boundary; at the end of an iteration with non-empty reasoning, persist a `reasoning` entry (`role 'assistant'`, `content` = that iteration's reasoning, `metadata { iteration, model? }`). Assistant text rows no longer write `metadata.reasoning` on new turns. Legacy assistant rows with embedded `metadata.reasoning` are backfilled as plain `assistant_message` and keep rendering their embedded reasoning as decoration (spec assumption: no retroactive split). The projection never sends reasoning entries to the provider — same as today, where `toCoreMessages` ignores `metadata.reasoning` entirely.

**Rationale**: Fixes mis-attribution (FR-003); provider context is unchanged because reasoning was never provider-visible (SC-004 holds trivially for reasoning); live reasoning keeps streaming through the same `Reasoning` component family.

**Alternatives considered**: (a) Splitting legacy embedded reasoning into synthetic reasoning entries during backfill — rejected by spec (IDs preserved, no retroactive split; offsets/branch references must not move). (b) Keeping a turn-level reasoning roll-up entry as well — rejected: duplicates the per-iteration facts.

## D6 — Asks and outcomes: persist at request, update in place on decision

**Decision**: `requestApproval` / sampling / elicitation handlers persist the ask **when shown** (`approval`/`sampling`/`elicitation` entry, `metadata { payload…, outcome: null }`), then write the decision back to the same row via a new `messagesRepo.updateOutcome(id, outcome)` when the user decides. Outcomes: approval `{ approved | declined | undecided }` (+ aborted flag), sampling `{ allowed | denied | undecided }`, elicitation `{ accepted, data }` or `{ declined }` or `undecided`. On abort/session close, `stop()` sweeps pending asks to `undecided`.

**Rationale**: Spec decision #6 (same-row in-place update). Under truncate-and-reload restore semantics a restored backup consistently recreates whichever state was captured — an ask restored without an outcome simply renders as undecided (spec Story 2 scenario 4). One row = one ask = one auditable fact.

**Alternatives considered**: (a) Append-only outcome events — rejected by spec (would also complicate the ord sequence mid-turn). (b) Persisting only resolved asks — rejected: an aborted ask with no record is exactly the dishonesty this feature removes.

## D7 — Projection: pure module, golden fixtures, critic path migrates too

**Decision**: New pure `src/lib/chat/projection.ts` exporting `projectEntries(entries): ModelMessage[]` with an explicit per-kind rules table (see `contracts/projection.md`). `assembleContext` keeps its ancestor-gathering walk unchanged but delegates conversion to the projection; `toCoreMessages` is deleted. The critic's in-memory correction context (`loop.ts:143`) switches to the same projection. Golden fixtures are captured from the **current** `toCoreMessages` output over a fixture corpus covering: plain user/assistant turns, tool call + result pairs (JSON and text outputs), legacy `present_choices` pairs, hidden prompts, adjacent-message merging, and branch walk ordering — then asserted byte-equal against the projection.

**Rationale**: Single path (FR-016); golden equivalence is decidable only if fixtures are captured before the rewrite; merging behavior (adjacent same-role parts, `context.ts:241-255`) must be reproduced exactly since providers are sensitive to message boundaries.

**Alternatives considered**: (a) Keeping `toCoreMessages` as a legacy shim called by the projection — rejected: two intent systems would coexist. (b) Golden-testing `assembleContext` end-to-end only — rejected: the pure projection is the seam; end-to-end fixtures also depend on repos state.

## D8 — Timeline assembly: entries union, grouped tool units, registry dispatch

**Decision**: `src/lib/chat/entries.ts` defines `TimelineItem = DurableEntry | LiveEntry` and the list-assembly step that pairs `tool_call` + `tool_result` by `toolCallId` into one grouped presentation unit (entries stay separate rows). `src/lib/chat/presentation.ts` is the single registry: kind → lane, collapsible, collapsed-by-default, renderer. Renderers live in `src/lib/components/chat/rows/`; each accepts a `live` prop so streaming text/reasoning/pending-ask render through the same component (the duplicated block in `MessageList.svelte:78-111` is deleted). `LazyMount` + `incRender` bookkeeping carry over unchanged. Expanded/collapsed is component `$state` seeded from registry defaults (spec decision #5).

**Rationale**: FR-008/FR-010; grouping fixes the wall of text (header + summary + collapsible detail) while keeping the two durable facts separate (spec decision #3).

**Alternatives considered**: (a) Rendering call and result as adjacent independent internal lines — rejected by spec's grouped-unit decision. (b) A per-row `collapsed` DB column — rejected: presentation must never be stored (FR-002).

## D9 — Search: query-level kind filter (deliberate tightening)

**Decision**: The message-search SQL gains `AND m.kind IN ('user_message','assistant_message')`. The generated columns are untouched; new internal rows' `search_vec` self-maintains but is filtered at query time.

**Rationale**: FR-015. Note a small deliberate behavior change surfaced during research: today the message search query has no role filter, so tool summaries are currently searchable; the spec's rule (only user/assistant content) removes that noise. Hidden user prompts (decoration `hidden:true` on `user_message` rows) remain searchable exactly as today — the kind filter is the only change.

**Alternatives considered**: (a) Excluding internal kinds from the index — impossible: `GENERATED ALWAYS` columns cannot be conditionally suppressed, and adding reindex paths is constitutionally prohibited. (b) Leaving tool summaries searchable — rejected: contradicts FR-015.

## D10 — Backfill derivation rules (the complete case table)

**Decision** — the migration classifies every row by these ordered rules; any row matching none fails the migration (transaction rolls back, server logs loudly):

| #   | Predicate (legacy columns)                                                   | kind                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `role='user'`                                                                | `user_message`                                                                                                                                                                     |
| 2   | `role='assistant' AND toolCallId IS NOT NULL AND toolName='present_choices'` | `choices`                                                                                                                                                                          |
| 3   | `role='assistant' AND toolCallId IS NOT NULL`                                | `tool_call`                                                                                                                                                                        |
| 4   | `role='tool' AND toolName='present_choices'`                                 | `tool_result` (hidden under its `choices` unit)                                                                                                                                    |
| 5   | `role='tool'`                                                                | `tool_result`                                                                                                                                                                      |
| 6   | `role='assistant' AND toolCallId IS NULL`                                    | `assistant_message` (embedded `metadata.reasoning` stays as decoration)                                                                                                            |
| 7   | `role='system'`                                                              | `assistant_message` (explicit rule + logged count; synthetic system notes are never stored, so this should be zero — if non-zero it is still explicitly classified, not defaulted) |
| —   | anything else                                                                | migration FAILS (FR-013)                                                                                                                                                           |

The migration is idempotent (`WHERE kind IS NULL` guards) because it runs on both the boot path and the post-restore path; `SET NOT NULL` only after the UPDATE.

**Rationale**: Covers every edge case enumerated in the spec (hidden rows — rule 1 with hidden decoration retained; empty tool-call bookkeeping rows — rule 3, rendered hidden inside their grouped unit; `present_choices` pairs — rules 2/4). "Hidden" stays metadata decoration on the parent entry per FR-006.

**Alternatives considered**: Defaulting unmatched rows to `assistant_message` — rejected (FR-013 loud failure); that silence is exactly how the current column soup rotted.

## D11 — `self_corrected`: persisted critic record, never provider-visible

**Decision**: After `runCriticPhase` performs at least one correction attempt, persist a `self_corrected` entry (`role 'assistant'`, `metadata { issues: [{type,message}], attempts, succeeded }`); the correction exchange itself stays in-memory for the live turn exactly as today (providers see it mid-turn; it was never persisted, and persisting it now would change provider context on follow-up turns — breaking golden equivalence).

**Rationale**: Honest provenance (FR-007) without provider-context drift. The entry is internal-lane, collapsed by default.

**Alternatives considered**: Persisting the critic's correction user/assistant exchange as real rows — rejected: changes what the provider sees on subsequent turns vs. today.

## D12 — Naming

**Decision**: Column `kind` (TS: `EntryKind`); terminology "entries" for durable rows; `TimelineItem` for the render union; lanes `user`/`internal`/`external`. `agent_traces.kind` is unrelated and untouched.

**Rationale**: Spec decision #2; `kind` matches the existing `agent_traces`/search vocabulary precedent in the codebase.

**Alternatives considered**: `event`/`timeline_items` — rejected by spec decision.

## D13 — Perf validation approach

**Decision**: Capture a baseline with `window.__MAYON_PERF__ = 1` + `localStorage.mayon_perf_scenario = 'tool-heavy-timeline'` on a tool-heavy chat before the rewrite; re-measure after phases 1 and 5; compare render counts (`MessageRow` counter carries over as a rows counter) and longtask totals.

**Rationale**: Constitution IV requires measurement for performance-sensitive changes; the registry rewrite touches the hottest render path in the app.

**Alternatives considered**: Skipping measurement ("just a refactor") — rejected: unmeasured performance claims are not accepted.
