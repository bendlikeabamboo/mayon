# Contract: `propagate_to_parent` tool (027)

Phase 1 output. The model-facing and runtime contract of the tool. Registry mechanics
(`ToolDefinition` / `ToolResult` / `ToolContext`) are defined by
`src/lib/agent/registry.ts`; this contract binds the new tool to them.

## Definition

```text
id:          propagate_to_parent
risk:        high            → requestApproval modal before run; decline final for the turn
generative:  true            → one-per-turn sub-call budget; status label while running
description: Back-propagate this branch chat's outcome into its parent chat as an
             anchored artifact. Call only when the learner explicitly asks, or after
             they agree to your single offer. Never reproduce the propagated content
             as chat text; confirm in 1–2 sentences (parent chat, mode).
parameters:
  mode: string, optional, enum [raw, summary]
        raw      — verbatim branch delta (default when omitted)
        summary  — model-written handoff summary (one LLM sub-call)
```

The description text above is the contract of record; implementation may tighten
wording but MUST keep all four rules (availability precondition, explicit-consent rule,
no-content-reproduction rule, confirmation shape).

## Availability

Offered on a turn **iff**, at turn-assembly time, the active chat is a branch
(`parentId !== null`) **and** has at least one message — enforced by adding the id to
`disabledToolIds` otherwise (chat store turn assembly, mirroring the manual control's
`canPropagate`). All earlier gates apply unchanged in order: provider tool capability,
session safety net, first-turn blackout, 64-definition cap.

## Execution contract

1. **Approval** (loop-owned, risk `high`): decline → `{ok: false, summary: 'user declined'}`,
   no re-request this turn.
2. **Latch**: acquire the propagation latch (shared with the store's manual path).
   Busy → `{ok: false, summary: 'a propagation is already running'}`.
3. **Gates** (re-validated from repositories inside `run`, defense-in-depth):
   - active chat missing / not a branch → `{ok: false, summary: 'cannot propagate: this chat is not a branch'}`
   - branch has no messages → `{ok: false, summary: 'cannot propagate: this branch has no messages yet'}`
4. **Payload**:
   - `mode: 'raw'` (default): `buildRawDelta(chatId)` — verbatim delta, no LLM call.
   - `mode: 'summary'`: `generateBranchArtifactSummary(chatId, signal)` — generate
     first, insert only on success; abort/throw → `{ok: false, summary: 'summary generation failed: <reason>'}`,
     zero writes.
5. **Write**: one `repos.messages.insertAnchored(parentId, {role:'user', kind:'branch_artifact', content, metadata}, placement)`
   — identical inputs to the manual path (same `resolveAnchor`, same metadata builder).
6. **Abort** (turn aborted mid-run): release latch; report `{ok: false, summary: 'aborted'}`;
   the pre-insert ordering guarantees no partial write.

## Result shapes

**Success**:

```text
{ ok: true,
  summary: "Back-propagated to parent \"<parent title>\" as <raw delta|summary>." }
```

The summary is what the model relays; it MUST name the parent chat and the mode used
(FR-003/FR-006). No `detail.artifact` — the artifact belongs to the parent chat, and
the existing artifact-link convention must not point the learner at a foreign chat's
row. `detail` MAY carry `{parentChatId, mode}` for tests/traces.

**Failure**: `{ok: false, summary: '<plain-language reason>'}` per the execution
contract above. Failures never throw out of `run` (the registry wraps, but the contract
is clean results).

## Downstream effects

- Branch timeline gains `tool_call` + `tool_result` rows via the existing turn pipeline
  (FR-010); rendering, search, and projection need no new cases.
- Parent chat gains the artifact row; a later load of the parent renders it exactly as
  a manual artifact (collapsible, summary-regenerable via the manual affordance).
- No toast on the tool path; no store reactive-state mutation.

## Preamble contract (capabilities preamble additions)

The capabilities preamble (`buildCapabilitiesPreamble`) gains lines establishing, in
substance:

1. On a branched chat, the `propagate_to_parent` tool sends this branch's outcome to
   the parent chat.
2. Call it only when the learner explicitly asks to back-propagate, or after they
   agree to your offer — never unprompted.
3. When the learner signals a branch is done without asking, offer back-propagation at
   most once, in plain terms; if declined or ignored, drop it (no re-request).
4. After success: confirm in 1–2 sentences naming the parent chat and mode; reproduce
   none of the propagated content as chat text.
5. If the tool is not available (root chat, provider without tool support), say the
   manual back-propagate control is the path; never imitate propagation in prose.

## Invariants (must hold in review)

- No new persisted entity, message kind, or migration.
- The tool never imports the chat store; repositories + `src/lib/chat/propagation.ts` +
  the summary generator only.
- Identical-artifact guarantee: same helpers, same insert — not a reimplementation.
- `docs/reference/tool-map.qmd` (+ `agent-map.qmd` if applicable) updated in the same
  change.
