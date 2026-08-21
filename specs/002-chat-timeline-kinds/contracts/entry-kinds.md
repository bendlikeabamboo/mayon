# Contract: Entry Kinds (data contract)

Closed enumeration of durable timeline kinds, their lanes, and their per-kind `metadata` payload schemas. This is the contract between the persistence layer (repositories), the presentation registry, and the context projection. Naming: column `kind`; rows are "entries" (D12).

## Enumeration & lanes

| kind                | lane     | role (authoring side) | content semantics              | provider-visible? (projection)                          |
| ------------------- | -------- | --------------------- | ------------------------------ | ------------------------------------------------------- |
| `user_message`      | user     | `user`                | the user's text                | yes — `user` text part                                  |
| `assistant_message` | external | `assistant`           | assistant text for the user    | yes — `assistant` text part                             |
| `reasoning`         | internal | `assistant`           | one iteration's reasoning text | **no**                                                  |
| `tool_call`         | internal | `assistant`           | empty (args live in metadata)  | yes — `assistant` `tool-call` part                      |
| `tool_result`       | internal | `tool`                | one-line summary               | yes — `tool` `tool-result` part                         |
| `approval`          | internal | `assistant`           | ask label (tool + description) | **no** (record only)                                    |
| `sampling`          | internal | `assistant`           | ask label (server + prompt)    | **no** (record only)                                    |
| `elicitation`       | internal | `assistant`           | ask label (server + message)   | **no** (record only)                                    |
| `choices`           | internal | `assistant`           | offer label (`nextUnit`)       | yes — synthesized `tool-call` + `tool-result` pair (D4) |
| `self_corrected`    | internal | `assistant`           | note label                     | **no**                                                  |

Lane and all presentation attributes are **derived from kind** — never stored per row.

## Per-kind metadata payload schemas

Shared decoration keys (any kind, optional): `hidden?: true`, `interrupted?: true`, `artifact?: { kind, id }`, `sources?: Source[]`, `reasoning?: string` (legacy embedded only), `model?`, `tokens?`.

### `user_message`

```jsonc
{
	"hidden": true, // optional; hidden prompts (expound branch seeds)
	"choicesEntryId": "<uuid>"
} // optional; set when this row is a tapped chip
// linking back to its choices offer
```

### `assistant_message`

```jsonc
{
	"reasoning": "<legacy pre-split only>",
	"interrupted": true,
	"artifact": { "kind": "lab", "id": "…" }
}
```

### `reasoning`

```jsonc
{ "iteration": 0, "model": "gpt-…" } // iteration ≥ 0; one entry per agent-loop iteration
```

### `tool_call`

```jsonc
{ "args": { … } }                        // tool input as received from the provider
```

### `tool_result`

```jsonc
{ "detail": { … } }                      // structured result payload (already persisted today);
                                         // rendered as collapsible detail, collapsed by default
```

### `approval` (bound to its tool call via `toolCallId`)

```jsonc
{ "toolName": "create_lab", "description": "…", "args": { … },
  "outcome": null                        // pending
    | { "decision": "approved" | "declined", "aborted"?: true }
    | { "decision": "undecided" } }      // swept on abort/session close
```

### `sampling`

```jsonc
{ "serverName": "…", "prompt": "…", "maxTokens": 1024, "remainingBudget": 512,
  "outcome": null | { "decision": "allowed" | "denied" } | { "decision": "undecided" } }
```

### `elicitation`

```jsonc
{ "serverName": "…", "message": "…", "schema": { … },
  "outcome": null
    | { "decision": "accepted", "data": { … } }
    | { "decision": "declined" }
    | { "decision": "undecided" } }
```

### `choices`

```jsonc
{ "nextUnit": "Unit 3", "options": ["continue", "go deeper"], "progress": "Unit 2 / 5" }
// shape-compatible with the legacy GateBlock args;
// taken selection lives on the linked user_message
```

### `self_corrected`

```jsonc
{ "issues": [{ "type": "mermaid", "message": "…" }], "attempts": 1, "succeeded": true } // attempts ≥ 1; written only when a correction ran
```

## Write-back contract

- Ask outcomes (`approval`/`sampling`/`elicitation`) are updated **in place** on the same row: `updateOutcome(id, outcome)` repository method; terminal once set; `undecided` is written by the abort sweep, never by the user.
- Chip selections are **new** `user_message` rows carrying `choicesEntryId`; the `choices` row is never mutated after creation.
- Everything else is append-only via the existing next-`ord` append path.

## Backfill mapping (legacy columns → kind)

Ordered rules; unmatched rows fail the migration (see `contracts/migration-v2.md` § Backfill):

1. `role='user'` → `user_message`
2. `role='assistant' AND toolCallId≠NULL AND toolName='present_choices'` → `choices`
3. `role='assistant' AND toolCallId≠NULL` → `tool_call`
4. `role='tool' AND toolName='present_choices'` → `tool_result` (hidden under its choices unit)
5. `role='tool'` → `tool_result`
6. `role='assistant' AND toolCallId=NULL` → `assistant_message`
7. `role='system'` → `assistant_message` (explicit; expected count zero, logged)
8. otherwise → migration failure (loud, transactional rollback)
