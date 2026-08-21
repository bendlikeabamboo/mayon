# Data Model: Timeline UX Fixes

Phase 1 output. **No stored-data changes** — no columns, no migrations, no schema-version bump. This document covers the presentation-only entities the fixes introduce or repair.

## Unchanged stored entities

`messages` rows (ids, `ord`, `content`, `metadata`, `kind`, tool columns) are immutable in every fix. Presentation-time reordering never writes back. Provider-visible context is unchanged (golden tests from 002 remain the acceptance bar).

## Presentation entities (derived at render time)

### Turn (presentation grouping)

| Aspect     | Value                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Definition | span between consecutive visible `user_message` items (turn starts at a user message; items before the first are a lead turn) |
| Used by    | canonical reorder pass (D5) — strictly local to a turn; user messages never move                                              |
| Lifecycle  | computed inside `assembleTimeline`; never stored                                                                              |

### Canonical item order (within a turn)

| Position | Item                                       | Note                                                                            |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| first    | `reasoning` of the iteration               | one entry per iteration (metadata `iteration`)                                  |
| then     | `assistant_message` text of that iteration |                                                                                 |
| then     | tool activity of that iteration            | grouped `ToolGroup` at the call/result position; choices offers render in place |

- Correctly stored turns (all turns persisted after this fix) already satisfy it; the reorder pass no-ops.
- The only reorder the pass performs: `reasoning` after an `assistant_message` with no tool activity between them → move directly before that assistant message.
- Iterations stay chronological; reasoning never crosses a tool boundary.

### ToolGroup placement + pairing (repaired invariants)

| Invariant      | Rule                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing key    | `tool_call.toolCallId === tool_result.toolCallId` (never row id)                                                                      |
| Group position | the result's position when paired; the call's own position when unpaired (no end-of-timeline flush)                                   |
| Choices        | `choices` rows are offer entries rendered in place; a legacy paired `tool_result` of a choices call is hidden (folds under the offer) |
| Orphan results | render visibly (never dropped); result-only presentation without a call header                                                        |

### Terminal-tool presentation state (derived per group)

```
unpaired call:
  terminal(tool registry)  → neutral line: name + label only   (no fail icon, no "No result recorded")
  non-terminal             → fail icon + "No result recorded"  (genuine gap — kept)
paired result:
  ok | fail                → existing marks (regardless of terminality)
```

Source of truth: the tool registry's `terminal` flag. No UI-side tool list.

## State transitions

Only one new state flow, both edges presentation-derived:

```
live turn ──persist──▶ durable turn
  live_reasoning → reasoning entry   (position: before that iteration's text — D3 persist order)
  live_text      → assistant_message
  live_ask       → ask entry (unchanged from 002)
```

No stored-state machine changes; ask outcomes, choices links, self-corrected records behave exactly as specified in 002.

## Validation rules

- `assembleTimeline` output MUST contain every visible input row exactly once (no orphans dropped — the orphan-result fix enforces visibility).
- Reorder pass MUST be stable (equal items keep relative order) and MUST NOT move items across `user_message` boundaries.
- Every rendered diagnostics event row MUST have a unique key (kind + server + position).
- All 002 golden projection fixtures MUST pass unmodified (nothing in this feature touches provider context).

## Invariants preserved

1. Stored row identity/order immutability (ids, `ord`, branch points, expound offsets).
2. `search_vec` and search behavior untouched.
3. One presentation registry; no role-based ladders introduced (fixes route through kinds/groups only).
4. Zero new dependencies; no `+` filenames; all quality gates green (check baseline: 10 pre-existing `server-stdio.test.ts` errors).
