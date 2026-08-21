# Data Model: Internal Area Unification

Phase 1 output. **No database schema change.** The `messages` table, `kind` column, and all existing metadata shapes are untouched; historical rows are never rewritten. The additions below are (a) presentation-time derived state, (b) one additive metadata field on **newly written** rows, and (c) widened trace annotations.

## 1. Text segment (presentation concept — not stored)

The span of assistant text between turn start (or a prior tool boundary) and the next tool-call boundary or turn end.

**Lifecycle**:

```text
streaming ──(boundary: text persisted)──> persisted-authoritative
    │                                        │
    │ live copy renders the buffer           │ live copy retired in same update (D1);
    │                                        │ empty live_text shows quiet pending bubble
    ▼                                        ▼
(turn end: live items removed; durable rows remain — exactly one copy throughout)
```

**Invariants** (FR-001): at most one rendered copy at any instant; the live copy retires in the same update that persists the segment; final durable rendering equals what was streamed.

**Validation**: exactly-once count asserted with a live buffer present and an approval pending (US1 scenarios 1-4).

## 2. Tool activity status (derived vocabulary — never stored)

Derived per `ToolGroup` inside `assembleTimeline` from: the call row, an optional paired result row, ask rows linked by `toolCallId`, live `pendingApprovals`, `chatStore.streaming`, and registry `terminal` classification.

| Status           | Derivation (in precedence order)                                                                                         | Reset/transition                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `awaiting`       | linked approval row with `outcome == null` / `decision: 'undecided'`, **or** live pending approval for this `toolCallId` | → `running` (approved), `declined` (declined), `aborted` (abort sweep) |
| `declined`       | linked approval row `decision: 'declined'`, `aborted` absent/`false`                                                     | terminal for the call                                                  |
| `aborted`        | linked approval row `decision: 'declined', aborted: true` (or abort-swept)                                               | terminal                                                               |
| `running`        | unpaired, non-terminal, no awaiting signal, chat streaming                                                               | → `succeeded`/`failed` on result; → genuine-gap after reload           |
| `succeeded`      | paired result, `ok !== false`, not declined-linked (legacy rows without `ok` land here)                                  | terminal                                                               |
| `failed`         | paired result with `ok === false`, not declined-linked                                                                   | terminal                                                               |
| genuine gap      | unpaired, non-terminal, no awaiting signal, not streaming (003 rule, unchanged)                                          | —                                                                      |
| terminal-neutral | unpaired, registry `terminal` (003 rule, unchanged)                                                                      | —                                                                      |

**Validation** (FR-002/FR-003): each status maps to exactly one presentation row in [tool-activity-status.md](./contracts/tool-activity-status.md); awaiting never shows a failure mark or "No result recorded"; declined is visually distinct from failed; genuine-gap and failed fixtures keep their marks.

## 3. `ToolGroup` extension (in-memory, `src/lib/chat/entries.ts`)

Additive optional fields computed during assembly:

```text
ToolGroup {
  ...existing (source, group, call, result)
  awaitingDecision?: boolean   // status === 'awaiting'
  declined?: boolean           // status === 'declined' | 'aborted'
  running?: boolean            // status === 'running'
}
```

Relationships: linked ask rows are found by `toolCallId` equality against `kind ∈ {approval}` rows (sampling/elicitation rows carry no `toolCallId` and never link).

## 4. Live ask merge (in-memory, `assembleTimeline`)

```text
durable ask row (kind approval|sampling|elicitation, id R)
  + live_ask item (payload.rowId === R) present
      → emit the live item at R's chronological position; suppress the durable entry
      → the merged live item is not appended again at the tail
decision resolves → pending list empties → durable row renders with outcome chip
reload mid-wait  → no live items → durable undecided row renders (002 US2 behavior)
```

**Invariant**: exactly one rendered ask surface per pending ask (FR-007).

## 5. Additive metadata: `tool_result.ok` (new rows only)

```text
ToolResultMeta (kinds.ts) += ok?: boolean
appendToolResult(chatId, { toolCallId, toolName, summary, detail?, ok? })
  → metadata: JSON.stringify({ ...(detail ?? {}), ok })   // when ok provided
loop.ts passes entry.result.ok at the append site
```

Legacy rows without `ok` derive `succeeded` (today's behavior — documented fallback). No backfill, no migration (FR-009).

**Validation**: repository test asserts `ok` round-trips into metadata; derivation tests cover `ok: false` → `failed`.

## 6. Interactive choices offer (component state machine)

```text
inactive (default)          every durable offer whose entry is not the active gate
   │
   │ gate active: !streaming && findGateFromMessages(messages).entryId === entry.id
   ▼
active (tappable)           options render as buttons; tap → chatStore.send(option, { choicesEntryId: entry.id })
   │
   │ user row linked (UserMessageMeta.choicesEntryId === entry.id)
   ▼
taken (read-only)           taken option marked — existing durable rendering, incl. after reload
```

The gate scan stops at the last user message, so taking a choice (or any reply) deactivates the offer on the next derivation.

**Validation** (FR-006): tap sends the linked reply; offer flips to read-only; composer shows no chips in any state.

## 7. Trace request message (annotation widening, `trace.ts`)

```text
request.messages[i] = {
  role: string                       // as projected ('user' | 'assistant' | 'tool')
  content: string
  toolCallId?: string                // present on tool-call / tool-result projections
  toolName?: string
  kind?: string                      // source row kind ('choices', 'tool_call', 'tool_result', …)
}
```

**Invariants** (FR-008): trace messages are the projected wire payload one-to-one; no `role: 'system'` rows appear in `messages` (system prompt lives in the `system` field, exactly once). Old traces (without the optional fields) remain valid.

## Entity relationships summary

```text
Message rows (stored, immutable history)
  ├─ kind: assistant_message ── renders once (text segment invariant)
  ├─ kind: tool_call ──────────┐
  ├─ kind: tool_result ────────┤ paired by toolCallId → ToolGroup (+ derived status fields)
  ├─ kind: approval ───────────┘ links by toolCallId (outcome drives awaiting/declined)
  ├─ kind: sampling|elicitation → ask entries (live-merge by rowId)
  ├─ kind: choices ──────────── offer ⇄ user_message via choicesEntryId (active/taken states)
  └─ kind: reasoning|self_corrected (unchanged)

Live state (transient)
  ├─ streamBuffer/streamBufferRender ── retired on persist (D1)
  ├─ pendingApprovals ───────────────── awaiting derivation + live-ask merge input
  └─ streaming ──────────────────────── running vs genuine-gap discriminator
```
