# Data Model — AI Elements Adoption (Phase 1)

**Scope note**: this feature is presentation-only. There are **no new persisted
entities, no schema changes, no migrations, and no API changes** (spec: presentation
layer on existing stores). This document defines the in-memory presentation entities
and state machines the adopted components expose, so the contracts are testable.

---

## Entities (in-memory, presentation)

### 1. Model option

Feeds the model picker. Unchanged shape from today's provider store projection.

| Field         | Type   | Notes                                                           |
| ------------- | ------ | --------------------------------------------------------------- |
| `id`          | string | Model identifier as used today (e.g. provider-qualified handle) |
| `provider`    | string | Display/grouping label for the owning provider configuration    |
| `displayName` | string | Human label (defaults to `id`)                                  |

**Validation rules**

- The active selection MUST remain listed even if absent from the discovered set
  (preserves current `ModelSelect.svelte:27-30` guarantee — a saved default never
  vanishes).
- Filter matches on `displayName`, `id`, or `provider`, case-insensitive.

### 2. Approval request (elicitation ∪ sampling)

One presentation entity backing both MCP approval flows through the shared
confirmation pattern.

| Field                | Type                                             | Notes                                                            |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `kind`               | `'elicitation' \| 'sampling'`                    | Discriminates response entry (below)                             |
| `serverName`         | string                                           | Originating tool server label                                    |
| `message` / `prompt` | string                                           | Human-facing ask (elicitation message / sampling prompt preview) |
| `schema?`            | JSON-schema object                               | Elicitation only; drives the form body                           |
| `budget?`            | `{ maxTokens: number; remainingBudget: number }` | Sampling only                                                    |
| `state`              | `ApprovalState`                                  | Lifecycle, below                                                 |

**State machine — `ApprovalState`** (shared context; replaces ad-hoc pending spans):

```text
pending ──submit──▶ succeeded
   │  │                │
   │  └──decline───────┴──▶ rejected      (user chose no / tool refused)
   └── failure ──────────▶ failed         (transport error, timeout, server drop)
```

Rules:

- Transitions are one-way out of `pending` (re-submitting a settled request is a no-op
  — guards the duplicate-request edge case).
- `failed` MUST be recoverable-looking (retry affordance or dismissible), never a
  hanging `pending`.
- While a restore/maintenance window is active, surfaces MUST NOT offer submit/approve
  actions (degradation rule, spec edge case).

### 3. Tool activity entry (presentation projection)

Unchanged inputs (`ToolGroup | OrphanToolResult` + `result-shape` classification); new
shell renders them.

| Field                  | Type                                                                                                   | Notes                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `toolName`             | string                                                                                                 | Always visible in collapsed header                                            |
| `status`               | `'awaiting' \| 'declined' \| 'aborted' \| 'running' \| 'failed' \| 'succeeded' \| 'terminal' \| 'gap'` | Existing derivation (today at `ToolActivity.svelte:55-72`), retained verbatim |
| `input`                | parameters object \| null                                                                              | Collapsed-by-default pane                                                     |
| `output`               | shape-classified result \| null                                                                        | Rendered by retained `ToolResultBody`                                         |
| `sources` / `artifact` | existing types                                                                                         | Behavior preserved (links, source list)                                       |

Rules:

- Collapsed by default in every state (FR-004); expansion is user intent only.
- `failed`/`declined`/`aborted` MUST be visually distinct from `succeeded` at a glance
  in the collapsed header (badge + icon).

## Relationships

- Approval requests and tool entries reference the existing chat-graph entries via the
  same store projections used today (`PublicElicitationEntry`,
  `PublicMcpSamplingEntry`, `ToolGroup`/`OrphanToolResult`). No graph changes.
- The model picker reads the existing provider/model store; selection calls the
  existing `onselect` callback chain.

## Persistence

None. All three entities are ephemeral views over existing persisted data.
