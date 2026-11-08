# Data Model: Conversational Back-Propagation Tool (027)

Phase 1 output. This feature introduces **no new persisted entities** — no tables, no
message kinds, no settings rows, no drizzle migration. The only new "entity" is the
tool itself as a registry entry plus a runtime latch. Everything the tool writes is
already-shaped 020 data, produced by the same code paths.

## Tool: `propagate_to_parent`

A registered `Tool` (`{ def, run }`) in the deterministic group.

| Field | Value |
|---|---|
| `id` | `propagate_to_parent` |
| `risk` | `high` (approval modal before run; decline final) |
| `generative` | `true` (summary mode performs one LLM sub-call; consumes the per-turn sub-call budget; long-running status label) |
| `terminal` | — (unset) |

**Parameters** (JSON-schema, via `toolSchema`):

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `mode` | `'raw' \| 'summary'` | no | Payload mode. Omitted → `'raw'` (the 020 default). |

**Inputs**: nothing else — target is always the active branch's immediate parent
(`chat.parentId`), resolved from repositories inside `run`; the model never supplies
chat ids.

**Outputs** (`ToolResult`): see [contracts/propagate-tool.md](./contracts/propagate-tool.md)
for the exact ok/fail shapes. Success carries no `detail.artifact` (the artifact lives
in the *parent* chat, not this one — the artifact-link convention does not apply; the
summary names the parent instead).

## Shared in-flight latch (runtime only)

| Aspect | Rule |
|---|---|
| State | Module-level single slot in `src/lib/chat/propagation.ts`; not persisted, not reactive |
| Acquire | Synchronous, at the start of a propagation attempt (tool `run`, store `propagateToParent`) |
| Release | `finally`, on every exit path including abort/throw |
| Contention | Second acquire fails fast: refusal result/error "a propagation is already running" |
| Owner | Correctness primitive only; the store's reactive `propagationStatus` remains the UI state for the manual path |

## Written data (unchanged shapes, same producers)

| Data | Producer (existing) | Shape |
|---|---|---|
| Parent artifact row | `repos.messages.insertAnchored` via `resolveAnchor` + `buildRawDelta`/`generateBranchArtifactSummary` + `branchArtifactMetadata` | `role: 'user'`, `kind: 'branch_artifact'`, metadata `{mode, sourceChatId, sourceChatTitle, branchPointMessageId, anchor, summaryTraceId, regeneratedAt}` — byte-identical to manual |
| Branch timeline rows | Turn pipeline (`runAgentTurn` tool-call persistence) | existing `tool_call` + `tool_result` rows |
| Summary trace | `generateBranchArtifactSummary` | existing `agent_traces` row, kind `branch_artifact_summary` |

## Validation rules (from spec FRs)

- **FR-001**: definition not offered when active chat `parentId === null` or branch has
  0 messages — enforced by `disabledToolIds` at turn assembly; `run` re-validates both
  gates from repositories and returns the matching failure.
- **FR-002**: success path MUST end in the same `insertAnchored` call with the same
  inputs the manual path produces for the same chat + mode (guaranteed structurally by
  D4: shared code, not parity-by-imitation).
- **FR-003**: `mode` optional; omitted → `'raw'`; the result summary names the mode used.
- **FR-006**: every failure returns `ok: false` with a human-readable reason; every
  success returns `ok: true` with parent title + mode.
- **FR-007**: failure leaves zero writes (summary mode generates first, inserts only on
  success — the 020 FR-013 ordering already guarantees this in the shared code).
- **FR-008**: latch refusal as above.
- **FR-009**: no regeneration logic in the tool; repeat calls run the plain propagate
  path (another artifact lands, per 020 semantics).

## State transitions

```text
turn assembly ──▶ definition offered (branch ∧ has messages)
                      │ model emits call ── approval modal (risk high)
                      │                      ├─ decline ──▶ {ok:false,'user declined'} (final this turn)
                      │                      └─ approve ── latch acquire
                      │                                       ├─ busy ──▶ {ok:false,'already running'}
                      │                                       ├─ gate fail ──▶ {ok:false, reason}
                      │                                       ├─ raw ──▶ buildRawDelta ──▶ insert ──▶ ok
                      │                                       └─ summary ──▶ generate (sub-call)
                      │                                                      ├─ throw ──▶ {ok:false, reason}, no insert
                      │                                                      └─ text ──▶ insert ──▶ ok
                      └─ result persisted as tool_call/tool_result rows (existing)
```
