# Contract — Approval / Confirmation Pattern

UI + state contract for the P2 surface: one shared pattern consumed by both MCP
approval flows (elicitation dialog, sampling card).

## Public surface

`src/lib/components/mcp/confirmation/index.ts`:

```ts
Confirmation; // root: Alert-styled chrome; owns approval state (context)
ConfirmationTitle; // who is asking (server name) + action noun
ConfirmationRequest; // the ask: message / prompt preview (+ budget line for sampling)
ConfirmationActions; // action row (approve/submit primary, decline/cancel secondary)
ConfirmationAccepted; // terminal state body (succeeded)
ConfirmationRejected; // terminal state body (declined / rejected)
confirmationContext; // programmatic read/write of the state machine (tested)
```

State machine (`ApprovalState`): `pending → succeeded | rejected | failed` — one-way
out of `pending`; re-acting on a settled request is a no-op (see data-model.md).

## Behavior contract

| ID   | Contract                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-1 | Both flows render through `Confirmation*` components; no flow-specific approval chrome remains outside this family.                                                                                                                          |
| AP-2 | Elicitation: request body embeds the JSON-schema form (existing field renderer: text/number/boolean + JSON fallback) between `ConfirmationRequest` and `ConfirmationActions`; submit validates (JSON parse errors shown inline, not thrown). |
| AP-3 | Sampling: request body shows prompt preview (collapsible) and token budget; actions are approve/decline.                                                                                                                                     |
| AP-4 | Actions dispatch exactly once per state transition; after settle, the action row is replaced by the terminal state body.                                                                                                                     |
| AP-5 | A dropped/errored request settles `failed` with a dismissible outcome — never a perpetual `pending`.                                                                                                                                         |
| AP-6 | Surfaces appear only when the `stdio-mcp` capability produced the entry (existing gating unchanged); with no server runtime, no approval UI renders.                                                                                         |
| AP-7 | While a restore window is active, submit/approve actions are disabled with the busy state surfaced (degradation rule).                                                                                                                       |
| AP-8 | The elicitation dialog keeps dialog semantics (focus trap, Escape = cancel); the sampling card remains inline in the transcript (non-modal), as today.                                                                                       |

## Consumers

- `ElicitationDialog.svelte` — retained file, now composed from this family (AP-2).
- `SamplingApprovalCard.svelte` — thin instantiation (AP-3); its current prop shape
  (`entry`, `onApprove`, `onDecline`) is preserved for its mounting site.

## Out of scope

No change to elicitation/sampling transport, prompts, or the chat store entries.
