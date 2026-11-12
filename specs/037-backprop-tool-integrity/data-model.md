# Data Model: Back-propagation tool integrity fixes (037)

No schema changes, no migrations, no new persisted entities or kinds. This feature
changes how existing rows are **selected**, **updated**, and **surfaced**.

## Entities (existing, deltas noted)

### Message (row) — unchanged shape

| Field | Change |
| --- | --- |
| `id`, `chatId`, `role`, `content`, `ord`, `kind`, `toolCallId`, `toolName`, `metadata`, `parts`, `model`, `tokens`, `createdAt` | none (schema untouched) |

Behavior deltas:

1. **Payload selection (US1)**: `buildRawPayload` / `collectPropagatedImages`
   (`src/lib/chat/propagation.ts`) now treat a row as *propagation chrome* iff
   `row.toolName === 'propagate_to_parent'`; chrome rows are excluded from rendered
   turns and collected images on both propagation paths.
   Validation rule: a branch's payload contains no row whose `toolName` is
   `propagate_to_parent`; every non-propagation row (including other tools' calls,
   approvals, and results) appears exactly as before, in `ord` order.
2. **Image collection (US5)**: collected image parts are deduplicated by
   `part.data` (first occurrence wins, order preserved) before the 8-image cap.
   Validation rule: no two collected parts share `data`; distinct-`data` images are
   never dropped by dedupe.
3. **Artifact update (US6)**: `messagesRepo.updateArtifactContent` accepts an optional
   `parts` argument — `MessagePart[]` (validated: non-empty, ≤ 8 image parts, text
   parts concatenate exactly to `content`) stored atomically with `content` +
   `metadata`; `null` clears the column to NULL; `undefined` leaves it untouched.
   Guard unchanged: only `branch_artifact` rows may be updated.
4. **Declined tool result (US7)**: the loop-synthesized declined result persists
   metadata `{"declined":true,"ok":false}` (content stays `'user declined'`). State
   distinction: `declined:true` appears iff the learner declined; failures and aborts
   never carry it.

### Branch artifact metadata (`BranchArtifactMetadata`) — unchanged shape

`mode`, `sourceChatId`, `sourceChatTitle`, `branchPointMessageId`, `anchor`,
`summaryTraceId`, `regeneratedAt` — untouched. Regeneration continues to patch only
`regeneratedAt`/`summaryTraceId`; the new parts argument carries the image change.

### State transitions

- **Propagation latch** (module-level, `propagation.ts:205-217`): unchanged
  acquire/release; on latch refusal `propagateToParent` now additionally transitions
  `lastPropagation: <stale> → null` before returning (`propagationStatus`/`Error`
  untouched on that path).
- **propagate_to_parent tool run**: new early-exit transition `generated → aborted`
  (signal observed between generation and write): persists nothing, releases latch.
- **Regeneration**: `running → idle` now implies parts reflect the source branch's
  current deduped collected images (or NULL when none); failure/abort leaves the row
  fully unchanged.

## Relationships

- Branch chat → parent chat artifact anchoring: unchanged (`resolveAnchor`,
  `insertAnchored`).
- Branch timeline rows → artifact payload: now a **filtered** projection (chrome
  excluded); branch timeline rows themselves are never deleted or rewritten by
  propagation.
