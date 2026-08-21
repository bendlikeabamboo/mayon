# Contract: Timeline Assembly (`assembleTimeline`)

**Seam**: `src/lib/chat/entries.ts` — pure function `(messages, liveItems?) → TimelineItem[]`. Consumers: `MessageList.svelte`. Frozen elsewhere: provider projection (`projection.ts`) must be unaffected (golden tests).

## Inputs

- `messages: Message[]` — stored rows, display order (may include this turn's already-persisted rows).
- `liveItems?: LiveEntry[]` — `live_text`, `live_reasoning`, `live_ask` from `ChatState.liveItems`.

## Output rules

### R1 — Exactly-once text (FR-001)

The store guarantees a persisted segment's buffers are cleared at persist time (D1); assembly therefore never sees a live text buffer duplicating a durable row. Assembly adds no dedup pass — **if the invariant breaks, the fix belongs in the store, not here**. Regression: boundary-persisted text + live items present renders one copy.

### R2 — Live ask merge (FR-007)

For a durable row with `kind ∈ {approval, sampling, elicitation}` and id `R`:

| Condition                                    | Emitted at `R`'s position                    | Tail append              |
| -------------------------------------------- | -------------------------------------------- | ------------------------ |
| `live_ask` with `payload.rowId === R` exists | the **live item** (interactive card)         | suppressed for this item |
| no matching live item                        | the durable entry (outcome chip / undecided) | n/a                      |

`live_text` / `live_reasoning` always append at the tail (they are newer than every durable row). Exactly one ask surface may render per pending ask — never both forms.

### R3 — Tool group status derivation (FR-002/FR-003)

Pre-scans (alongside the existing `resultExists` scan):

1. Ask link map: `toolCallId → { undecided: boolean, declined: boolean, aborted: boolean }` from `kind: 'approval'` rows (`outcome == null` / `decision: 'undecided'` → undecided; `decision: 'declined'` → declined, `aborted: true` → aborted).
2. Live pending set: `pendingApprovals` `toolCallId`s (via live ask payloads carrying `approval.toolCallId`) → undecided.

`ToolGroup` additive fields, in precedence order:

```text
awaitingDecision = undecided(link ∪ live)
declined         = declined(link)            // aborted folded into declined presentation
running          = unpaired ∧ ¬terminal ∧ ¬awaitingDecision ∧ ¬declined
                   // streaming flag supplied by the caller as a boolean argument
```

Unpaired non-terminal without any signal and not streaming keeps the 003 genuine-gap presentation; unpaired terminal keeps the 003 neutral presentation — both unchanged. Paired results derive succeeded/failed from `ok` metadata (`ok === false` → failed; absent → succeeded) unless declined-linked.

### R4 — Ordering (inherited, unchanged)

003 canonical ordering, turn boundaries, and pairing positions are untouched. The live-merge substitution happens **at the durable row's position**, so asks land chronologically.

## Examples

```text
messages: [user, asst-text, tool_call(T), approval(T, outcome null)]
live:     [live_ask(rowId=approval), live_text(buffer '')]
→ [user, asst-text, ToolGroup(call T, awaitingDecision), live_ask@approval-position, live_text(pending)]
   // ONE ask surface, ONE text copy, tool row reads awaiting

messages: [user, asst-text, tool_call(T), approval(T, declined), tool_result(T, ok:false, "user declined")]
live:     []
→ [user, asst-text, ToolGroup(T, declined)]   // distinct from failed

messages: [user, asst-text, tool_call(T), tool_result(T, ok:true, <8KB payload>)]
→ ToolGroup(T, succeeded) with clamped collapsed result (see tool-activity-status.md)
```
