# Data Model: Branch Back-Propagation

**Feature**: `020-branch-backprop` | **Date**: 2026-09-06

## Entity changes overview

| Entity | Change |
| --- | --- |
| `messages` | New `kind` value `branch_artifact`; `ord` column type `integer` → `double precision` |
| `chats` | No change (`parent_id`, `branch_point_message_id`, `created_at` are read-only inputs) |
| `branch_sources` | No change (`excerpt` is a read-only input) |
| New tables | None (Card 005 ruling: no separate store) |

## messages (branch_artifact rows)

Existing table (`src/lib/db/schema.ts:61-103`); new value + type change only.

| Column | Value for branch_artifact | Notes |
| --- | --- | --- |
| `id` | uuid | as existing |
| `chatId` | **parent** chat id | the artifact lives in the parent thread |
| `kind` | `'branch_artifact'` | added to the drizzle TS enum + `EntryKind` |
| `role` | `'user'` | so default context emission (`context.ts:80-91`) and the projection's user-turn path carry it |
| `content` | payload text: raw-delta transcript or summary text | verbatim by construction for raw mode; feeds `search_vec` automatically (kind-agnostic generated column) |
| `parts` | `null` | plain-text payload; image parts not applicable |
| `ord` | `double precision` midpoint (see Placement) | single-row anchored insert |
| `model` | `null` | not a model reply |
| `tokens` | `null` | |
| `toolCallId` / `toolName` | `null` | |
| `metadata` | JSON string, `BranchArtifactMetadata` (below) | |
| `search_vec` | GENERATED ALWAYS — never written | constitution invariant |
| `createdAt` | insertion time | |

### BranchArtifactMetadata (JSON in `metadata`)

| Field | Type | Meaning |
| --- | --- | --- |
| `mode` | `'raw' \| 'summary'` | payload mode chosen by the user (FR-002) |
| `sourceChatId` | uuid (chat id) | the branch the artifact came from |
| `sourceChatTitle` | string | snapshot of the branch title at propagation time (for the framing label; not a FK — the artifact survives branch deletion, spec edge case) |
| `branchPointMessageId` | uuid \| null | the anchor message in the parent, as recorded on the branch (`recorded`) |
| `anchor` | `'recorded' \| 'derived'` | `derived` when the branch had `branch_point_message_id: null` (R1) |
| `summaryTraceId` | uuid \| null | `agent_traces` entry for the summary generation (summary mode) |
| `regeneratedAt` | ISO string \| null | set by regenerate; anchor and id unchanged |

### ord placement rule (new repo seam)

`messagesRepo.insertAnchored(chatId, entry, { afterOrd, beforeOrd | null })`:

- `beforeOrd` present → `ord = (afterOrd + beforeOrd) / 2`
- `beforeOrd` null (anchor is last message) → `ord = afterOrd + 1`
- start-of-thread anchor (no parent messages eligible) → `ord = minOrd − 1`

`double precision` resolution (~2^53) makes collision practically impossible for any
realistic insert volume; **no rebalancing/rewrite path exists or may be added**
(FR-005, SC-003: propagation never rewrites existing rows). Existing `append`
(`max(ord) + 1`) is unchanged and still yields integral ords.

### Anchor resolution (propagation-time, read-only)

1. `branch.branchPointMessageId` non-null → anchor message = that parent row;
   `afterOrd = anchor.ord`, `beforeOrd = ord of the next parent row by ord` (null if none).
2. Null (composer-branch) → derived: last parent row with `createdAt ≤ branch.createdAt`;
   same midpoint math; `anchor: 'derived'`.
3. No eligible parent row → start-of-thread placement.

## Raw-delta content format (`content` for `mode: 'raw'`)

Deterministic, human- and model-readable transcript:

```text
[excerpt]
<anchored excerpt text>
[/excerpt]

[user] <verbatim text>
[assistant] <verbatim text>
[tool: <toolName>] <verbatim result>
```

- Turns in branch `ord` order; every branch row included (R2); no truncation (spec edge case).
- Excerpt section omitted when no excerpt is resolvable.
- `mode: 'summary'` → `content` is the model-written summary text as returned.

## Composition mapping (read path, no schema)

- `context.ts`: `branch_artifact` is **not** in `PROVIDER_EXCLUDED_KINDS` → emitted with
  its stored `role: 'user'`.
- `projection.ts`: new branch maps the row to a user message: deterministic framing
  header derived from metadata (`[Back-propagated from "<sourceChatTitle>" · <mode> ·
  <createdAt>]`) + `\n\n` + `content`; participates in the existing consecutive-user
  merge.
- Parent composition (own rows, all ords) includes it → steers future parent turns (FR-008).
- Pre-existing sibling branches: artifact `ord` > their cutoff (`ord <= cutoff` walk,
  `context.ts:102-106`) → invisible to them (FR-009). Post-propagation branches created
  below the anchor include it naturally.
- Timeline: falls through `assembleTimeline` to the durable lane (`laneOf` → `'internal'`
  unless given a case); rendered at its ord position.

## Relationships

- `branch_artifact.chatId` → parent `chats.id` (existing FK).
- `metadata.sourceChatId` is informational (plain string, **not** a FK) so deleting the
  source branch never cascades into the parent's history.
- `chats.branch_point_message_id` (existing) supplies the anchor; not modified by
  propagation.

## State transitions

| State | Trigger | Result |
| --- | --- | --- |
| (absent) | user triggers propagate, raw mode | row inserted atomically (single INSERT) |
| (absent) | user triggers propagate, summary mode | generation runs → success: single INSERT; failure: nothing inserted (FR-013) |
| summary artifact | regenerate | `content` + `regeneratedAt` updated in place; `id`, `ord`, anchor unchanged |
| any artifact | delete | row removed; no other rows affected |
| any artifact | restore from backup | rides generic `pg_restore` like all message rows |

## Validation rules

- Propagate control hidden when `chats.parentId` is null; disabled-with-reason when the
  branch has zero own messages (FR-010, R8).
- Regenerate offered only for `mode: 'summary'` (FR-007).
- Raw-delta payload built fully before insert; summary inserted only after generation
  succeeds (FR-011 atomicity).
- `kind: 'branch_artifact'` rows never carry `toolCallId`/`toolName`/`parts`.
