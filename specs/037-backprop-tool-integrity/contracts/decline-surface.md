# Contract: Declined tool-call surface (037)

Governs US7 of `specs/037-backprop-tool-integrity/spec.md`. Extends (does not amend)
`specs/027-backprop-tool/contracts/propagate-tool.md` execution-contract step 1 —
the decline outcome is now durably legible to the model.

## Persisted shape

When the learner declines a high-risk tool call, the loop synthesizes (without
executing the tool) and persists one `tool_result` row:

```text
content:  'user declined'
metadata: {"declined":true,"ok":false}
toolName: <the declined tool's name>
toolCallId: <the call's id>
```

The `declined: true` marker is added via the synthesized result's `detail`
(`{ declined: true }`); `appendToolResult` merges detail + `ok` into metadata.

## Reassembly surface

On next-turn context assembly (`assembleContext` → projection), the declined call's
tool-result output MUST parse to an object carrying `declined: true`. Concretely:
`toolResult = metadata ?? content` yields `{"declined":true,"ok":false}` —
machine-checkable and model-legible ("the learner declined this"), matching the
capabilities-preamble etiquette line ("Do not re-request an action the learner has
declined").

## Distinction rules

1. `declined: true` appears on a tool_result iff the learner actively declined the
   approval ask.
2. Abort sweeps (stop pressed with a pending ask → decision `declined` + `aborted`
   on the approval row) and non-decline failures NEVER carry `declined: true` on
   their tool_result rows — failure summaries and `'aborted'` keep their existing
   shapes.
3. No new persisted entity, message kind, or migration (027 invariant): the marker
   rides the existing row's metadata.

## Documentation

`docs/reference/tool-map.qmd` documents the approval/decline flow and MUST be
updated in the same change to record the durable declined marker (AGENTS.md
tool-map invariant).
