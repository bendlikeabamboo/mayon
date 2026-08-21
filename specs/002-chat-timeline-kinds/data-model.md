# Data Model: Chat Timeline Kind Model

Phase 1 output. Evolves the existing `messages` table in place (single-table evolution); no new tables. Field names below are logical — physical mapping is the existing `messages` columns plus one additive `kind` column. See `contracts/entry-kinds.md` for the payload schemas per kind and `contracts/migration-v2.md` for the v1→v2 backfill.

## Entity: Timeline Entry (= one `messages` row)

| Field                          | Type                                      | Constraints / notes                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | text UUID                                 | PK; **immutable across migration** — branch points (`chats.branchPointMessageId`), `branch_sources.sourceMessageId`, and expound source-map offsets reference it                                                                               |
| `chatId`                       | text UUID                                 | FK → chats                                                                                                                                                                                                                                     |
| `kind`                         | text enum (10 values, below)              | NEW. Nullable at DDL-add time; `SET NOT NULL` by the v2 migration after backfill. App layer rejects writes outside the enum (drizzle text enum + repo validation)                                                                              |
| `role`                         | text enum `system\|user\|assistant\|tool` | Retained, NOT NULL. Records the **authoring side** only: `user_message → user`; `tool_result → tool`; all other kinds → `assistant` (D3). No longer the source of presentation or provider intent                                              |
| `content`                      | text                                      | Kind-dependent: message text (`user_message`, `assistant_message`, `reasoning`), summary line (`tool_result`), ask label (`approval`/`sampling`/`elicitation`), offer label (`choices`), note (`self_corrected`); empty string for `tool_call` |
| `ord`                          | integer                                   | Existing append-order within chat; unchanged semantics (new kinds append with the same next-ord rule)                                                                                                                                          |
| `toolCallId`                   | text?                                     | Links `tool_call` ↔ `tool_result` pairs; also recorded on `approval` entries to bind the ask to its tool call                                                                                                                                  |
| `toolName`                     | text?                                     | Tool identity for `tool_call`/`tool_result`/`approval`; legacy `present_choices` marker during backfill                                                                                                                                        |
| `metadata`                     | text (JSON)                               | Kind-specific payload (see contracts) **plus** shared decorations: `hidden?: true`, `interrupted?: true`, `artifact?`, `sources?`, `reasoning?` (legacy embedded only), `model?`/`tokens?` mirror columns                                      |
| `model`, `tokens`, `createdAt` | existing                                  | Unchanged                                                                                                                                                                                                                                      |

### Kind enumeration (closed)

`user_message`, `assistant_message`, `reasoning`, `tool_call`, `tool_result`, `approval`, `sampling`, `elicitation`, `choices`, `self_corrected`

### Lane derivation (computed, never stored)

- `user` lane ← `user_message`
- `external` lane ← `assistant_message`
- `internal` lane ← `reasoning`, `tool_call`, `tool_result`, `approval`, `sampling`, `elicitation`, `choices`, `self_corrected`

## Entity: Live Entry (in-memory only, never persisted)

The streaming/pending counterpart that flows through the same presentation registry:

| Variant                                    | Replaces today                              | Lifecycle                                                                                                         |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `live_text`                                | stream buffer bubble                        | streaming → persisted as `assistant_message` / discarded                                                          |
| `live_reasoning`                           | reasoning buffer toggle                     | streaming → persisted as `reasoning` / discarded                                                                  |
| `live_ask` (approval/sampling/elicitation) | bottom-pane pending cards (`$state` arrays) | pending → durable ask row created at request time, outcome updated in place; on abort/session close → `undecided` |

Carries only render state (buffers, resolve callbacks); all durable facts live on the entry row.

## Entity: Presentation Registry (code, not data)

Single `kind → { lane, collapsible, collapsedByDefault, renderer }` table. Pure function of kind; expanded/collapsed is component state. Detailed contract: `contracts/presentation-registry.md`.

## Entity: Context Projection (code, not data)

Pure `entries → ModelMessage[]` function with a per-kind visibility table. Detailed contract: `contracts/projection.md`.

## State transitions

### `approval` / `sampling` / `elicitation` outcome (same-row, in-place)

```
(ask row created, outcome = null)          ← persisted when the card is shown
  ├─ user approves/allows/answers → outcome = approved | allowed | {accepted, data}
  ├─ user declines                        → outcome = declined | denied
  └─ abort / session close / reload cut   → outcome = undecided   (swept by stop())
```

Terminal: every outcome value is final; no re-asking reuses the row (a new ask is a new row).

### `choices` offer

```
(choices row created with payload {options,…})  ← model called present_choices
  └─ user taps chip → user_message row with metadata.choicesEntryId = <choices row id>
     (no outcome written on the choices row itself — the link is on the reply)
```

Legacy shape (pre-migration chats): offer = backfilled `choices` row + paired `tool_result` row (hidden under the offer unit); no `choicesEntryId` link exists — acceptable, renders identically minus the link.

### Turn lifecycle (live → durable)

```
streaming text      → assistant_message (or discarded when a generative tool resets the buffer)
streaming reasoning → reasoning (one per iteration; buffer resets at iteration boundary)
pending ask card    → ask row exists from request time; card is the live_ask view of it
critic corrections  → self_corrected (only when ≥1 correction attempt occurred)
```

## Validation rules

- Writes with `kind` outside the 10-value enum are rejected at the repository layer and by the DB CHECK constraint.
- `tool_call`/`tool_result` rows must carry `toolCallId` + `toolName`; the pairing is validated at timeline assembly (an unpaired `tool_call` renders "no result recorded"; an orphan `tool_result` renders standalone — neither is a hard error, both are turn-abort shapes).
- `approval`/`sampling`/`elicitation` rows must carry `metadata.outcome ∈ null | resolved-shapes` (shapes in `contracts/entry-kinds.md`).
- `choices` rows must carry `metadata.options` (non-empty array) — the gate lookup depends on it.
- `reasoning` rows must carry `metadata.iteration ≥ 0`.
- Backfill: any legacy row not matching the D10 case table fails the migration (loud, transactional).

## Invariants preserved

1. **IDs immutable** — migration updates `kind` only; never inserts/deletes/renames rows, never touches `content` (expound offsets stay valid).
2. **`search_vec` untouched** — generated columns self-maintain on the backfill UPDATE (content unchanged, so vectors are stable); search filters kinds at query level.
3. **`ord` monotonic per chat** — new kinds append with the existing next-ord computation; no renumbering.
4. **No secrets** — ask payloads contain tool args/prompts only, same sensitivity class as today's stored tool metadata.
5. **Restore compatibility** — old backups (v1/legacy) restore into the v2 schema (data-only), then the same backfill runs post-load; newer-than-server backups are refused by the existing gate, unchanged.
